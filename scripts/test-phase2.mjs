// scripts/test-phase2.mjs
// Vyroniq Phase 2: Full Fast Regression Suite (Native Fetch)

const BASE = "http://localhost:3000";
const TENANT_ID = "328e90f5-aa00-4cab-a130-2a66b87e321d";
const RFID_DEVICE_KEY = "fgs_hw_60af49f2485444c599f40c8203f7ddb7";
const FINGERPRINT_DEVICE_KEY = "fgs_hw_d15615e7e68149d195506da1e8f70b2a";
const ACTIVE_CARD = "413C30A8";
const ACTIVE_MEMBER_ID = "020f5724-318c-4c79-b6d0-830b0608d9ea";
const ACTIVE_PHONE = "8114039175";

async function runTests() {
  console.log("==================================================");
  console.log("     VYRONIQ PHASE 2 - FAST REGRESSION SUITE     ");
  console.log("==================================================\n");

  let passes = 0;
  let fails = 0;

  async function check(name, fn) {
    try {
      const res = await fn();
      if (res.ok) {
        console.log(`[PASS] ${name} -> ${res.msg}`);
        passes++;
      } else {
        console.log(`[FAIL] ${name} -> ${res.msg}`);
        fails++;
      }
    } catch (e) {
      console.log(`[ERR ] ${name} -> ${e.message}`);
      fails++;
    }
  }

  // 1. RFID Gate Check-in
  await check("1. RFID Gate Check-in (Active Member)", async () => {
    const res = await fetch(`${BASE}/api/hardware/gate-checkin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        device_key: RFID_DEVICE_KEY,
        action: "gate_checkin",
        auth_type: "rfid",
        rfid_card: ACTIVE_CARD,
        rfid_uid: ACTIVE_CARD
      })
    });
    const data = await res.json();
    const isGranted = res.status === 200 && (data.access === "GRANTED" || data.status === "granted" || data.ok === true);
    return { ok: isGranted, msg: `Status ${res.status}, access: ${data.access || data.status || "GRANTED"}` };
  });

  // 2. Hardware Punch (Biometric Endpoint Check)
  await check("2. Biometric Hardware Punch Endpoint", async () => {
    const res = await fetch(`${BASE}/api/hardware/punch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey: FINGERPRINT_DEVICE_KEY,
        biometricId: 9999
      })
    });
    return { ok: res.status !== 500, msg: `Status ${res.status} (No 500 Crash)` };
  });

  // 3. Hardware Heartbeat
  await check("3. Hardware Heartbeat", async () => {
    const res = await fetch(`${BASE}/api/hardware/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey: RFID_DEVICE_KEY,
        firmware: "v3.0.0",
        status: "online"
      })
    });
    return { ok: res.status === 200, msg: `Status ${res.status}` };
  });

  // 4. QR Pass Minting (HMAC Signed Token)
  let mintedToken = "";
  await check("4. QR Pass Minting (HMAC Token)", async () => {
    const res = await fetch(`${BASE}/api/member/pass/mint`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        memberId: ACTIVE_MEMBER_ID,
        phone: ACTIVE_PHONE,
        tenant_id: TENANT_ID
      })
    });
    const data = await res.json();
    mintedToken = data.token || data.passToken || data.pass_token || data.qr || "";
    return { 
      ok: res.status === 200 && mintedToken.length > 10, 
      msg: mintedToken ? `Token: ${mintedToken.substring(0, 15)}...` : `Status ${res.status}, Resp: ${JSON.stringify(data)}` 
    };
  });

  // 5. QR Scan Verification (Signed Pass)
  await check("5. QR Pass Verification (Signed Pass)", async () => {
    if (!mintedToken) return { ok: false, msg: "No token minted in step 4" };
    const res = await fetch(`${BASE}/api/scan/verify`, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Cookie": `forgeos_tenant=${TENANT_ID}`
      },
      body: JSON.stringify({
        token: mintedToken,
        tenant_id: TENANT_ID
      })
    });
    const data = await res.json();
    const isGranted = res.status === 200 && (data.ok === true || data.allowed === true || data.access === "GRANTED" || data.reason?.includes("approved"));
    const verdict = data.access || data.status || (data.ok ? "Verified" : (data.allowed ? "GRANTED" : "Denied"));
    return { 
      ok: isGranted, 
      msg: `Status ${res.status}, verdict: ${verdict}` 
    };
  });

  // 6. Anti-Proxy Protection (Reject Legacy/Unsigned Tokens)
  await check("6. Anti-Proxy Check (Reject Legacy/Unsigned)", async () => {
    const res = await fetch(`${BASE}/api/scan/verify`, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Cookie": `forgeos_tenant=${TENANT_ID}`
      },
      body: JSON.stringify({
        token: "FORGED_PLAIN_TOKEN_12345",
        tenant_id: TENANT_ID
      })
    });
    return { ok: res.status === 400 || res.status === 403, msg: `Correctly Rejected with ${res.status}` };
  });

  // 7. RFID Tap-to-Enroll Arming
  await check("7. RFID Tap-to-Enroll Arming", async () => {
    const res = await fetch(`${BASE}/api/hardware/enrollment`, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Cookie": `forgeos_tenant=${TENANT_ID}`
      },
      body: JSON.stringify({
        tenant_id: TENANT_ID,
        purpose: "card",
        wait_seconds: 60
      })
    });
    const data = await res.json();
    return { ok: res.status === 200 && data.ok === true, msg: `Armed for: ${data.device_name || "RFID"}` };
  });

  // 8. Dynamic Settings & UPI Resolution
  await check("8. Dynamic Settings & UPI Resolution", async () => {
    const res = await fetch(`${BASE}/api/settings?tenant_id=${TENANT_ID}`, {
      headers: { "Cookie": `forgeos_tenant=${TENANT_ID}` }
    });
    const data = await res.json();
    return { 
      ok: res.status === 200, 
      msg: `Status ${res.status} - Tenant settings verified (upi_id: ${data.settings?.upi_id || "neutral fallback active"})` 
    };
  });

  console.log("\n==================================================");
  console.log(`FINAL RESULT: ${passes} PASSED, ${fails} FAILED`);
  console.log("==================================================");
}

runTests();