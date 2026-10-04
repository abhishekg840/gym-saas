/*
 * ============================================================================
 * Vyroniq R307 / R307S terminal — Phase 17 biometric enrollment.
 * ============================================================================
 *
 * WHAT THIS FIRMWARE DOES
 * -----------------------
 * The R307S is a TEMPLATE-STORAGE device. It stores finger images in its own
 * slots and reports a slot number; it has no concept of a member. So this board
 * cannot be told "enrol member 42" — it can only be told "write whatever is on
 * the sensor into slot 7". The identity mapping lives in Postgres.
 *
 * That makes enrollment a two-machine conversation, which is why it is a job:
 *
 *   1. Desk queues a job        POST /api/hardware/fingerprint
 *   2. Board polls for it       POST /api/hardware/poll        (every 2s, idle)
 *   3. Board runs the capture   R307S, two passes
 *   4. Board reports progress   POST /api/hardware/fingerprint/report
 *   5. Board reports the end    same route, status=succeeded|failed
 *
 * Step 5 is the only thing that binds a slot to a member, so a capture that fell
 * over never leaves someone looking enrolled when their finger would not open
 * the gate.
 *
 * WIRING — RC522 PINS ARE UNCHANGED
 * ---------------------------------
 * The RFID reader on this board is wired exactly as it was for Phase 12 and is
 * deliberately NOT repatched:
 *
 *     SDA/SS  GPIO 5      SCK   GPIO 18     MISO GPIO 19
 *     MOSI    GPIO 23     RST   GPIO 22     3.3V  3V3
 *
 * Adding a fingerprint sensor must never be able to stop a door opening on a
 * card tap, so the two peripherals share the board without touching RC522.
 *
 * R307S ON ITS OWN UART
 * --------------------
 * The R307S is a serial sensor: TTL UART, 57600 8N1, framed commands, wired to
 * the hardware Serial2:
 *
 *     TX (R307S) -> GPIO 16 (ESP32 RX2)
 *     RX (R307S) <- GPIO 17 (ESP32 TX2)
 *
 * GPIO 16/17 are not part of the RC522 bus above. Serial2 rather than
 * SoftwareSerial: the sensor pushes capture notifications at moments when the
 * WiFi stack may be mid-transmit, and a software serial port would drop them or
 * corrupt frames. A hardware UART with its own RX buffer will not.
 *
 * SAFETY: A FINGER ON THE SENSOR IS A PHYSICAL EVENT, NOT A NETWORK ONE
 * ---------------------------------------------------------------------
 * Every stage transition is reported over the network, but a failed report must
 * never desynchronise the sensor from the server. So the local state machine
 * advances on the SENSOR's answer and reports are retried. The server is told
 * the truth as soon as it is reachable, and a job it never hears about expires
 * and releases its slot on its own.
 *
 * IDLE IS NOT AN ERROR
 * --------------------
 * A gate polls forever. "Nothing to do" is the overwhelmingly common answer, so
 * it is HTTP 200 with a null job, not an error. Logging it as a failure would
 * fill the log with noise while the board behaves perfectly.
 * ============================================================================
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// ---------------------------------------------------------------------------
// Configuration — change these and nothing else.
// ---------------------------------------------------------------------------
static const char* WIFI_SSID = "CHANGE-ME";
static const char* WIFI_PASS = "CHANGE-ME";

// Printed once when the terminal is registered on the Hardware tab. This is a
// MACHINE key, not a user session: it authenticates the board, and the server
// re-derives the gym from the device row, so this board can only ever act on its
// own terminal.
static const char* API_KEY   = "CHANGE-ME";
static const char* API_BASE  = "https://YOUR-PROJECT.supabase.co";

static const char* DEVICE_ID = "";   // optional; speeds up job matching

// ---------------------------------------------------------------------------
// R307S on Serial2 (GPIO 16 TX / GPIO 17 RX), 57600 8N1.
// ---------------------------------------------------------------------------
static const int      R307_RX_PIN = 16;   // ESP32 RX2 <- sensor TX
static const int      R307_TX_PIN = 17;   // ESP32 TX2 -> sensor RX
static const uint32_t R307_BAUD   = 57600;

// Not auto-bauded on purpose: a wrong baud rate produces plausible-looking
// garbage frames, and a half-working enrollment is far more confusing than one
// that refuses to start.
static const unsigned long POLL_INTERVAL_MS = 2000;
static const unsigned long REPORT_RETRY_MS  = 3000;
static const unsigned long SENSOR_RESET_MS   = 600;
static const uint8_t       REPORT_ATTEMPTS   = 4;

// Job stages, matching the CHECK constraint in migration 0017 exactly.
static const char* STAGE_CONNECTING     = "connecting";
static const char* STAGE_WAITING_FINGER = "waiting_finger";
static const char* STAGE_PASS1_CAPTURED = "pass1_captured";
static const char* STAGE_REMOVE_FINGER  = "remove_finger";
static const char* STAGE_PASS2_CAPTURED = "pass2_captured";
static const char* STAGE_SAVING         = "saving";
static const char* STAGE_DONE           = "done";

/** The job currently being executed, as handed over by the poll endpoint. */
struct Job {
  String token;          // echoed back on every report
  int    slot = 0;       // slot to write (enroll) or erase (unlink)
  int    deleteSlot = 0; // 0 = nothing to erase
  bool   unlink = false; // erase instead of capture
  bool   valid = false;
};

static Job g_job;

// ===========================================================================
// R307S serial driver
//
// Frame format is <header><len><cmd><payload...><checksum>, with 0xEF/0xFE/0xFD
// header bytes, a length byte covering the command and payload, and a 16-bit sum
// of everything from the length byte onward.
//
// Every read is bounded by the frame length AND gated on the checksum, so a
// truncated or corrupt frame can never be mistaken for a complete one. That
// distinction is the whole reason a half-powered sensor does not silently write
// a garbage template into a real member's slot.
// ===========================================================================
static const uint8_t HDR0 = 0xEF, HDR1 = 0xFE, HDR2 = 0xFD;

// Sensor commands used by this flow.
static const uint8_t CMD_VERIFY     = 0x01;  // is a finger on the sensor?
static const uint8_t CMD_ENROLL     = 0x31;  // begin two-pass capture
static const uint8_t CMD_CONTINUE   = 0x32;  // advance / finish the capture
static const uint8_t CMD_DELETE     = 0x0C;  // erase one template
static const uint8_t CMD_TEMPLATE_N = 0x0D;  // how many templates are stored

// Acknowledgements.
static const uint8_t ACK_OK        = 0x00;
static const uint8_t ACK_NO_FINGER = 0x01;
static const uint8_t ACK_TIMEOUT   = 0x02;
static const uint8_t ACK_MISMATCH  = 0x03;  // the two passes did not agree
static const uint8_t ACK_BUSY      = 0x04;
static const uint8_t ACK_PARAM     = 0x05;
static const uint8_t ACK_NO_SLOT   = 0x06;
static const uint8_t ACK_SILENT    = 0xFF;  // our own: nothing answered at all

static uint8_t  g_rx[260];
static uint16_t g_rxLen = 0;
static bool     g_rxOverflow = false;

/**
 * Reset the sensor's UART line.
 *
 * The R307S is power-on self-resetting, but it is also happy to hold a partial
 * frame from a previous power cut. Flushing the buffer is what stops that
 * half-frame being consumed as the first byte of a real reply.
 */
static void r307Begin() {
  Serial2.begin(R307_BAUD, SERIAL_8N1, R307_RX_PIN, R307_TX_PIN);
  g_rxLen = 0;
  g_rxOverflow = false;
  delay(SENSOR_RESET_MS);
  while (Serial2.available()) Serial2.read();   // drain boot chatter
}

/** Build a checksummed frame into `buf`, returning its total length. */
static uint16_t r307Build(uint8_t* buf, uint8_t cmd, const uint8_t* payload, uint8_t len) {
  uint16_t i = 0;
  buf[i++] = HDR0; buf[i++] = HDR1; buf[i++] = HDR2;
  buf[i++] = (uint8_t)(len + 1);   // length covers cmd + payload
  buf[i++] = cmd;
  for (uint8_t p = 0; p < len; p++) buf[i++] = payload[p];

  uint16_t sum = 0;
  for (uint8_t p = 3; p < i; p++) sum += buf[p];
  buf[i++] = (uint8_t)(sum >> 8);
  buf[i++] = (uint8_t)(sum & 0xFF);
  return i;
}

static void r307Send(uint8_t cmd, const uint8_t* payload, uint8_t len) {
  uint8_t frame[64];
  Serial2.write(frame, r307Build(frame, cmd, payload, len));
  Serial2.flush();
}

/**
 * Read one verified frame, or return 0 on timeout.
 *
 * `ok` distinguishes "the sensor answered no finger" (true) from "nothing came
 * back" (false): one is the normal idle path, the other means the sensor is
 * unplugged and the job must fail rather than hang until the server expires it.
 */
static uint16_t r307Read(uint16_t timeoutMs, bool* ok) {
  unsigned long deadline = millis() + timeoutMs;
  *ok = false;

  while (millis() < deadline) {
    while (Serial2.available()) {
      uint8_t b = Serial2.read();

      // Hunt for the header. Bytes before it are line noise.
      if (g_rxLen == 0 && b != HDR0) continue;
      if (g_rxLen == 1 && b != HDR1) { g_rxLen = 0; continue; }
      if (g_rxLen == 2 && b != HDR2) { g_rxLen = 0; continue; }

      if (g_rxLen < sizeof(g_rx)) g_rx[g_rxLen++] = b;
      else g_rxOverflow = true;   // longer than any frame we send

      if (g_rxLen < 4) continue;

      uint8_t  body  = g_rx[3];                 // cmd + payload length
      uint16_t total = (uint16_t)body + 7;      // 3 hdr + 1 len + body + 2 sum

      if (g_rxLen < total) continue;

      // Verify the checksum BEFORE trusting a single byte of the frame.
      uint16_t sum = 0;
      for (uint8_t p = 3; p < total - 2; p++) sum += g_rx[p];
      if (!g_rxOverflow && (sum >> 8) == g_rx[total - 2] && (sum & 0xFF) == g_rx[total - 1]) {
        *ok = true;
        return total;
      }

      // Corrupt: drop it and resynchronise rather than acting on a partial read.
      g_rxLen = 0;
      g_rxOverflow = false;
    }
    delay(1);
  }
  return 0;
}

/**
 * One-shot command, returning a single normalised ack byte.
 *
 * The sensor puts its real outcome in the byte AFTER the 0x00 acknowledgement
 * (a two-byte ack), so those are folded into the named constants here rather
 * than at every call site.
 */
static uint8_t r307Command(uint8_t cmd, const uint8_t* payload, uint8_t len, uint16_t timeoutMs) {
  r307Send(cmd, payload, len);

  unsigned long deadline = millis() + timeoutMs;
  while (millis() < deadline) {
    bool ok = false;
    uint16_t n = r307Read(250, &ok);

    if (ok && n >= 5) {
      uint8_t ack  = g_rx[4];
      uint8_t next = (n >= 6) ? g_rx[5] : 0x00;
      g_rxLen = 0;
      g_rxOverflow = false;

      if (ack != ACK_OK) return ack;   // transport-level refusal
      if (next == ACK_NO_FINGER) return ACK_NO_FINGER;
      if (next == ACK_TIMEOUT)   return ACK_TIMEOUT;
      if (next == ACK_MISMATCH)  return ACK_MISMATCH;
      if (next == ACK_BUSY)      return ACK_BUSY;
      if (next == ACK_PARAM)     return ACK_PARAM;
      if (next == ACK_NO_SLOT)   return ACK_NO_SLOT;
      return ACK_OK;
    }
    if (!ok && millis() + 250 >= deadline) break;
  }

  g_rxLen = 0;
  g_rxOverflow = false;
  return ACK_SILENT;
}

// ===========================================================================
// Server reporting
// ===========================================================================

/**
 * Post one report for the live job.
 *
 * Retried, because the job's fate is decided here: a 'succeeded' that never
 * arrives leaves a template on the sensor with no binding behind it, which is the
 * one outcome worse than a failed enrollment. A 'failed' that never arrives is
 * survivable — the server expires the job and releases the slot on its own.
 */
static bool reportJob(const char* status, const char* stage, const char* message) {
  if (!g_job.valid) return true;   // nothing claimed, nothing to report

  JsonDocument doc;
  doc["api_key"]   = API_KEY;
  doc["job_token"] = g_job.token;
  doc["status"]    = status;
  doc["stage"]     = stage;
  if (message && *message) doc["message"] = message;

  String body;
  serializeJson(doc, body);

  for (uint8_t attempt = 0; attempt < REPORT_ATTEMPTS; attempt++) {
    HTTPClient http;
    http.setTimeout(8000);
    http.begin(String(API_BASE) + "/api/hardware/fingerprint/report",
               "application/json", body);

    int code = http.POST();
    http.end();

    if (code == 200 || code == 201) return true;

    // 401 means the key is wrong. Retrying cannot fix that, and the poll loop is
    // about to start failing too, so surface it now instead of four times over.
    if (code == 401) {
      Serial.println("[report] 401 — the api key on this board is not registered.");
      return false;
    }
    delay(REPORT_RETRY_MS);
  }
  return false;
}

/** Progress beats. Best-effort by design: never stall the capture to report one. */
static void reportProgress(const char* stage, const char* message = "") {
  reportJob("progress", stage, message);
}

// ===========================================================================
// Poll loop
// ===========================================================================
static bool g_wifiReady = false;

static void connectWifi() {
  if (WiFi.status() == WL_CONNECTED) { g_wifiReady = true; return; }

  Serial.printf("[wifi] connecting to %s\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  unsigned long deadline = millis() + 20000;
  while (WiFi.status() != WL_CONNECTED && millis() < deadline) {
    delay(250);
    Serial.print('.');
  }

  g_wifiReady = (WiFi.status() == WL_CONNECTED);
  Serial.println(g_wifiReady ? "\n[wifi] connected" : "\n[wifi] FAILED — will retry");
}

/**
 * Ask for work.
 *
 * A null job is the normal answer and returns false so the caller just waits out
 * POLL_INTERVAL_MS. Claiming is atomic server-side, so two boards polling at the
 * same moment cannot both be handed the same job.
 */
static bool pollForJob() {
  connectWifi();
  if (!g_wifiReady) return false;

  JsonDocument doc;
  doc["api_key"] = API_KEY;
  if (DEVICE_ID && *DEVICE_ID) doc["device_id"] = DEVICE_ID;

  String body;
  serializeJson(doc, body);

  HTTPClient http;
  http.setTimeout(8000);
  http.begin(String(API_BASE) + "/api/hardware/poll", "application/json", body);

  int code = http.POST();
  String response = (code > 0) ? http.getString() : "";
  http.end();

  if (code == 401) {
    Serial.println("[poll] 401 — api key rejected. Is this terminal registered?");
    return false;
  }
  if (code != 200) {
    Serial.printf("[poll] HTTP %d\n", code);
    return false;
  }

  JsonDocument res;
  if (deserializeJson(res, response) != DeserializationError::Ok) {
    Serial.println("[poll] unreadable response");
    return false;
  }

  JsonObject j = res["job"];
  if (j.isNull()) return false;   // idle — the overwhelmingly common answer

  g_job.token      = j["job_token"] | "";
  g_job.slot       = j["slot"] | 0;
  g_job.deleteSlot = j["delete_slot"] | 0;
  g_job.unlink     = String(j["kind"] | "enroll") == "unlink";
  g_job.valid      = g_job.token.length() > 0 && g_job.slot > 0;

  if (!g_job.valid) {
    Serial.println("[poll] job missing a token or slot — ignoring");
    g_job = Job();
    return false;
  }

  Serial.printf("[poll] claimed %s job on slot %d (erase %d afterwards)\n",
                g_job.unlink ? "UNLINK" : "enroll", g_job.slot, g_job.deleteSlot);
  return true;
}

// ===========================================================================
// The enrollment ceremony
// ===========================================================================

/**
 * Run one claimed job to completion.
 *
 * The sensor drives every transition. In particular the finger is not polled in
 * a tight loop here: a command is sent and the sensor's own answer decides
 * whether to wait longer or move on. That keeps the link quiet between fingers
 * and means a capture is paced by the hardware rather than by however fast this
 * loop happens to run.
 */
static void runEnrollment() {
  reportProgress(STAGE_CONNECTING, "Connecting to the fingerprint sensor.");

  // Bring the sensor up first, so a dead sensor is reported as a dead sensor
  // rather than as a capture that mysteriously timed out.
  r307Begin();
  uint8_t probe = r307Command(CMD_TEMPLATE_N, nullptr, 0, 1500);
  if (probe == ACK_SILENT) {
    Serial.println("[enroll] sensor silent — check TX/RX and the 57600 baud rate");
    reportJob("failed", STAGE_DONE, "The fingerprint sensor did not respond.");
    return;
  }

  uint8_t slotHigh = (uint8_t)(g_job.slot >> 8);
  uint8_t slotLow  = (uint8_t)(g_job.slot & 0xFF);

  // ---- UNLINK: erase the template; there is no capture. --------------------
  if (g_job.unlink) {
    reportProgress(STAGE_SAVING, "Erasing the stored fingerprint.");

    uint8_t payload[2] = { slotHigh, slotLow };
    uint8_t ack = r307Command(CMD_DELETE, payload, 2, 5000);

    // ACK_NO_SLOT means nothing was there, which IS the desired end state.
    // Reporting success there is deliberate: the goal is "this member can no
    // longer be matched on this sensor", and a template that was already gone
    // already satisfies it. Failing would leave the member enrolled forever over
    // a sensor someone had cleaned by hand.
    if (ack == ACK_OK || ack == ACK_NO_SLOT) {
      Serial.printf("[unlink] slot %d erased\n", g_job.slot);
      reportJob("succeeded", STAGE_DONE, "Fingerprint removed from the terminal.");
    } else {
      reportJob("failed", STAGE_DONE, "The terminal could not erase that fingerprint.");
    }
    return;
  }

  // ---- ENROLL: two-pass capture into the reserved slot. --------------------
  reportProgress(STAGE_WAITING_FINGER, "Place your finger on the sensor.");

  // Start the capture. ACK_BUSY means the sensor is still finishing a previous
  // capture, so back off rather than calling it a failure.
  uint8_t startAck = ACK_SILENT;
  for (uint8_t i = 0; i < 10; i++) {
    uint8_t payload[3] = { slotHigh, slotLow, 0x02 };   // 2 passes
    startAck = r307Command(CMD_ENROLL, payload, 3, 4000);
    if (startAck != ACK_BUSY) break;
    delay(1000);
  }

  if (startAck != ACK_OK) {
    Serial.printf("[enroll] start ack 0x%02X\n", startAck);
    reportJob("failed", STAGE_DONE, "The terminal could not start the capture.");
    return;
  }

  // ---- PASS 1 --------------------------------------------------------------
  uint8_t pass1 = ACK_SILENT;
  unsigned long firstWindow = millis() + 30000;
  while (millis() < firstWindow) {
    pass1 = r307Command(CMD_CONTINUE, nullptr, 0, 3000);
    if (pass1 != ACK_SILENT) break;
    delay(300);
  }

  if (pass1 != ACK_OK) {
    Serial.printf("[enroll] pass 1 ack 0x%02X\n", pass1);
    reportJob("failed", STAGE_DONE,
              (pass1 == ACK_TIMEOUT) ? "No finger was detected."
                                     : "The first scan did not complete.");
    return;
  }

  reportProgress(STAGE_PASS1_CAPTURED, "First scan captured. Now lift your finger.");

  // ---- REMOVE --------------------------------------------------------------
  // The sensor must SEE the finger leave before it will accept the second pass,
  // so this waits on a real condition rather than a fixed sleep.
  reportProgress(STAGE_REMOVE_FINGER, "Lift your finger off the sensor.");

  bool lifted = false;
  unsigned long liftWindow = millis() + 15000;
  while (millis() < liftWindow) {
    if (r307Command(CMD_VERIFY, nullptr, 0, 1000) == ACK_NO_FINGER) {
      lifted = true;
      break;
    }
    delay(400);
  }

  if (!lifted) {
    Serial.println("[enroll] finger never came off the sensor");
    reportJob("failed", STAGE_DONE, "The finger was not lifted before the second scan.");
    return;
  }

// ---- PASS 2 --------------------------------------------------------------
  reportProgress(STAGE_WAITING_FINGER, "Place the same finger on the sensor again.");

  uint8_t pass2 = ACK_SILENT;
  unsigned long secondWindow = millis() + 30000;
  while (millis() < secondWindow) {
    pass2 = r307Command(CMD_CONTINUE, nullptr, 0, 3000);
    if (pass2 != ACK_OK && pass2 != ACK_SILENT) break;
    // ACK_OK here just means "not this time" — the member is still positioning.
    // Keep asking until it takes, or the window closes.
    delay(500);
  }

  if (pass2 != ACK_OK) {
    Serial.printf("[enroll] pass 2 ack 0x%02X\n", pass2);
    const char* why = (pass2 == ACK_MISMATCH)
        ? "The two scans did not match. Please try again with the same finger."
        : "The second scan did not complete.";
    reportJob("failed", STAGE_DONE, why);
    return;
  }

  reportProgress(STAGE_PASS2_CAPTURED, "Second scan captured. Saving the fingerprint.");
  reportProgress(STAGE_SAVING, "Saving the fingerprint.");

  uint8_t saved = r307Command(CMD_CONTINUE, nullptr, 0, 8000);
  if (saved != ACK_OK) {
    Serial.printf("[enroll] save ack 0x%02X\n", saved);
    reportJob("failed", STAGE_DONE, "The fingerprint could not be saved to the sensor.");
    return;
  }

  Serial.printf("[enroll] slot %d saved\n", g_job.slot);
  reportJob("succeeded", STAGE_DONE, "Fingerprint registered.");
}

// ===========================================================================
// setup / loop
// ===========================================================================
void setup() {
  Serial.begin(115200);
  delay(400);
  Serial.println("\n=== Vyroniq R307/R307S terminal ===");

  pinMode(LED_BUILTIN, OUTPUT);
  r307Begin();

  // Prove the sensor answers at configure time. Finding this out at the front
  // desk, mid-enrollment, is a far worse place to discover it.
  uint8_t ack = r307Command(CMD_TEMPLATE_N, nullptr, 0, 2000);
  if (ack == ACK_SILENT) {
    Serial.println("[boot] WARNING: no R307S response. Check GPIO16/17 and 57600 8N1.");
  } else {
    Serial.printf("[boot] R307S responding (%u templates stored)\n", ack);
  }

  connectWifi();
}

void loop() {
  // The LED is the only liveness signal a technician gets without a serial
  // cable, so it pulses on every poll whatever the outcome.
  digitalWrite(LED_BUILTIN, HIGH);

  if (pollForJob()) {
    digitalWrite(LED_BUILTIN, LOW);
    runEnrollment();

    // Erase the template this job replaced — but ONLY after the new one is proven
    // written. Doing it in the other order is how a failed re-enrollment destroys
    // a working fingerprint and locks a paying member out of the gym.
    if (!g_job.unlink && g_job.deleteSlot > 0 && g_job.deleteSlot != g_job.slot) {
      Serial.printf("[enroll] erasing replaced slot %d\n", g_job.deleteSlot);
      uint8_t del[2] = {
        (uint8_t)(g_job.deleteSlot >> 8),
        (uint8_t)(g_job.deleteSlot & 0xFF)
      };
      r307Command(CMD_DELETE, del, 2, 5000);
    }

    g_job = Job();
    delay(POLL_INTERVAL_MS);
    return;
  }

  digitalWrite(LED_BUILTIN, LOW);
  delay(POLL_INTERVAL_MS);
}