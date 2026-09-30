'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Cctv,
  Copy,
  Cpu,
  Fingerprint,
  Gauge,
  KeyRound,
  Lock,
  Loader2,
  MapPin,
  Navigation,
  Plus,
  RefreshCw,
  ScanLine,
  ServerCog,
  ShieldAlert,
  Trash2,
  Unlock,
  X,
  Zap,
} from 'lucide-react';
import { readSession, type GymSession } from '@/lib/session';
import {
  DEFAULT_GEOFENCE_RADIUS,
  evaluateGeofence,
  formatDistance,
  type GymGeofence,
} from '@/lib/geofence';
import {
  DEVICE_TYPE_META,
  ONLINE_WINDOW_SECONDS,
  deleteDevice,
  formatSince,
  listDevices,
  pingDevice,
  registerDevice,
  sendPunch,
  type HardwareDevice,
  type HardwareDeviceType,
  type PunchResponse,
  type RegisteredDevice,
} from '@/lib/hardware';

const TYPE_ICONS: Record<HardwareDeviceType, typeof Fingerprint> = {
  biometric_fingerprint: Fingerprint,
  rfid_scanner: ScanLine,
  camera_kiosk: Cctv,
  turnstile_relay: Lock,
  raspberry_pi: Cpu,
};

/** The console polls faster than a device must check in, so a dot can go red here
 * within a second of the device actually going quiet. */
const REFRESH_MS = 4_000;

const STATUS_DOT: Record<HardwareDevice['status'], string> = {
  online: 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.8)]',
  offline: 'bg-neutral-600',
  error: 'bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.7)]',
  maintenance: 'bg-amber-400',
};

function emptyGeofenceForm() {
  return {
    latitude: '',
    longitude: '',
    geofence_radius_meters: String(DEFAULT_GEOFENCE_RADIUS),
    enforce_geofence: false,
  };
}

export default function HardwareConsole() {
  const [session, setSession] = useState<GymSession | null>(null);
  const [devices, setDevices] = useState<HardwareDevice[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeKind, setNoticeKind] = useState<'ok' | 'bad'>('ok');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [registerOpen, setRegisterOpen] = useState(false);
  const [registerForm, setRegisterForm] = useState({
    device_name: '',
    device_type: 'biometric_fingerprint' as HardwareDeviceType,
    firmware_version: 'v1.0.0',
  });
  const [registerBusy, setRegisterBusy] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);
  /** The one-time key. Once this modal is dismissed the key is gone for good. */
  const [issued, setIssued] = useState<RegisteredDevice | null>(null);

  const [geofence, setGeofence] = useState<GymGeofence | null>(null);
  const [geoForm, setGeoForm] = useState(emptyGeofenceForm);
  const [geoBusy, setGeoBusy] = useState(false);
  const [geoNote, setGeoNote] = useState<string | null>(null);
  const [selfFix, setSelfFix] = useState<{ lat: number; lon: number; accuracy: number } | null>(null);

  const [punchDeviceId, setPunchDeviceId] = useState('');
  const [punchKey, setPunchKey] = useState('');
  const [punchCredential, setPunchCredential] = useState({ biometric_id: '', rfid_card: '' });
  const [punchBusy, setPunchBusy] = useState(false);
  const [punchResult, setPunchResult] = useState<PunchResponse | null>(null);

  // A 1s clock so "12s ago" ticks smoothly between the 4s server polls.
  const [now, setNow] = useState(() => Date.now());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    // localStorage only exists in the browser, so the session can only arrive
    // after hydration. This setState is the whole point of the effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSession(readSession());
  }, []);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  const tenantId = session?.tenantId ?? null;
  const canManage = session?.role === 'owner' || session?.role === 'super_admin';

  const flash = useCallback((message: string, kind: 'ok' | 'bad' = 'ok') => {
    setNotice(message);
    setNoticeKind(kind);
  }, []);

  // --- Device list, polled. A tab left open on the front desk stays truthful.
  const refresh = useCallback(async () => {
    if (!tenantId) return;
    const result = await listDevices(tenantId);
    if (!mountedRef.current) return;
    if (result.ok) setDevices(result.devices);
    else flash(result.error ?? 'Could not load terminals.', 'bad');
    setLoaded(true);
  }, [tenantId, flash]);

  useEffect(() => {
    if (!tenantId) return;
    // Data load, not a render-derived setState: everything below lands after an
    // await, and the interval keeps a tab left open on the front desk truthful.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [tenantId, refresh]);

  // --- Geofence configuration, loaded once per gym.
  const refreshGeofence = useCallback(async () => {
    if (!tenantId) return;
    try {
      const res = await fetch(`/api/hardware/geofence?tenant_id=${encodeURIComponent(tenantId)}`);
      const json = (await res.json()) as { ok?: boolean; geofence?: GymGeofence; error?: string };
      if (!res.ok || !json.ok || !json.geofence) return;

      const gym = json.geofence;
      setGeofence(gym);
      setGeoForm({
        latitude: gym.latitude === null ? '' : String(gym.latitude),
        longitude: gym.longitude === null ? '' : String(gym.longitude),
        geofence_radius_meters: String(gym.geofence_radius_meters),
        enforce_geofence: gym.enforce_geofence,
      });
    } catch {
      /* a failed settings read leaves the form as it is; devices still refresh */
    }
  }, [tenantId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshGeofence();
  }, [refreshGeofence]);

  // --- Actions -----------------------------------------------------------------
  async function copyText(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (!tenantId) return;
    setRegisterBusy(true);
    setRegisterError(null);

    const result = await registerDevice({
      tenantId,
      deviceName: registerForm.device_name,
      deviceType: registerForm.device_type,
      firmwareVersion: registerForm.firmware_version,
    });
    if (!mountedRef.current) return;

    if (!result.ok || !result.device) {
      setRegisterError(result.error ?? 'Registration failed.');
      setRegisterBusy(false);
      return;
    }

    setRegisterBusy(false);
    setRegisterOpen(false);
    setRegisterForm({
      device_name: '',
      device_type: 'biometric_fingerprint',
      firmware_version: 'v1.0.0',
    });
    setIssued(result.device);
    // Seed the test panel with the key while it still exists.
    setPunchDeviceId(result.device.id);
    setPunchKey(result.device.api_key);
    void refresh();
  }

  async function handlePing(device: HardwareDevice) {
    setBusyId(device.id);
    const result = await pingDevice(device.id, tenantId);
    if (mountedRef.current) {
      flash(
        result.ok
          ? `${device.device_name} checked in.`
          : result.error ?? `${device.device_name} did not answer.`,
        result.ok ? 'ok' : 'bad'
      );
      await refresh();
    }
    setBusyId(null);
  }

  async function handleForget(device: HardwareDevice) {
    setConfirmId(null);
    setBusyId(device.id);
    const result = await deleteDevice(device.id, tenantId);
    if (mountedRef.current) {
      flash(
        result.ok
          ? `${device.device_name} removed. Any reader holding its key is now dead.`
          : result.error ?? 'Could not remove that terminal.',
        result.ok ? 'ok' : 'bad'
      );
      if (result.ok && punchDeviceId === device.id) {
        setPunchDeviceId('');
        setPunchKey('');
      }
      await refresh();
    }
    setBusyId(null);
  }

  async function handleCopyKey(device: HardwareDevice) {
    const ok = await copyText(device.api_key_masked);
    if (!mountedRef.current) return;
    setCopiedId(device.id);
    setTimeout(() => mountedRef.current && setCopiedId(null), 1800);
    flash(
      ok
        ? 'Masked key copied. The full key is only ever shown once, at registration.'
        : 'Clipboard blocked by the browser.',
      ok ? 'ok' : 'bad'
    );
  }

  // --- Geofence panel ---------------------------------------------------------
  /** "I am standing in the gym right now" — the honest way to capture coordinates. */
  function captureCurrentLocation() {
    if (!('geolocation' in navigator)) {
      setGeoNote('This browser has no location support. Type the coordinates instead.');
      return;
    }
    setGeoNote('Reading GPS…');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(7));
        const lon = Number(pos.coords.longitude.toFixed(7));
        setSelfFix({
          lat,
          lon,
          accuracy: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : 0,
        });
        setGeoForm((prev) => ({ ...prev, latitude: String(lat), longitude: String(lon) }));
        setGeoNote(
          `Captured ±${Math.round(pos.coords.accuracy)} m. Save it, then walk outside to watch the pass lock.`
        );
      },
      (err) => setGeoNote(`GPS refused: ${err.message}`),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 }
    );
  }

  async function handleSaveGeofence(e: React.FormEvent) {
    e.preventDefault();
    if (!tenantId) return;
    setGeoBusy(true);
    setGeoNote(null);

    try {
      const res = await fetch('/api/hardware/geofence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant_id: tenantId,
          latitude: geoForm.latitude.trim() === '' ? null : Number(geoForm.latitude),
          longitude: geoForm.longitude.trim() === '' ? null : Number(geoForm.longitude),
          geofence_radius_meters: Number(geoForm.geofence_radius_meters),
          enforce_geofence: geoForm.enforce_geofence,
        }),
      });
      const json = (await res.json()) as { ok?: boolean; geofence?: GymGeofence; error?: string };
      if (!res.ok || !json.ok || !json.geofence) {
        setGeoNote(json.error ?? 'Could not save the geofence settings.');
      } else {
        setGeofence(json.geofence);
        setGeoNote(
          json.geofence.enforce_geofence
            ? `Saved. Members further than ${json.geofence.geofence_radius_meters} m from the door are now locked out.`
            : 'Saved. Geofencing is measured but not enforced — passes stay live everywhere.'
        );
      }
    } catch {
      setGeoNote('Network problem — settings were not saved.');
    } finally {
      setGeoBusy(false);
    }
  }

  /** What the member's phone would conclude from where this screen is standing. */
  const selfCheck = useMemo(() => {
    if (!geofence || !selfFix) return null;
    return evaluateGeofence(geofence, {
      latitude: selfFix.lat,
      longitude: selfFix.lon,
      accuracy_meters: selfFix.accuracy,
      // `now` is the ticking clock, so the reading goes stale here on schedule.
      taken_at: now,
    });
  }, [geofence, selfFix, now]);

  // `now` belongs in these deps: it re-derives liveness on the 1s tick.
  const liveSeconds = useMemo(() => {
    const map: Record<string, number | null> = {};
    for (const device of devices) {
      map[device.id] = device.last_heartbeat
        ? Math.max(0, Math.round((now - new Date(device.last_heartbeat).getTime()) / 1000))
        : null;
    }
    return map;
  }, [devices, now]);

  const stats = useMemo(() => {
    let online = 0;
    let trouble = 0;
    for (const device of devices) {
      const seen = liveSeconds[device.id];
      if (seen !== null && seen <= ONLINE_WINDOW_SECONDS) online += 1;
      if (device.status === 'error') trouble += 1;
    }
    return { total: devices.length, online, trouble, offline: devices.length - online };
  }, [devices, liveSeconds]);

  // --- Gate test panel --------------------------------------------------------
  async function handleTestPunch(e: React.FormEvent) {
    e.preventDefault();
    setPunchBusy(true);
    setPunchResult(null);

    const biometricRaw = punchCredential.biometric_id.trim();
    const cardRaw = punchCredential.rfid_card.trim();

    const result = await sendPunch({
      apiKey: punchKey.trim(),
      ...(biometricRaw ? { biometricId: Number(biometricRaw) } : {}),
      ...(cardRaw ? { rfidCard: cardRaw } : {}),
    });

    if (mountedRef.current) setPunchResult(result);
    setPunchBusy(false);
    void refresh();
  }

  // --- Render -----------------------------------------------------------------
  if (!session) {
    return (
      <div className="min-h-screen bg-neutral-950 text-white flex items-center justify-center p-6">
        <div className="max-w-sm bg-neutral-900 border border-neutral-800 rounded-3xl p-6 text-center">
          <ShieldAlert className="w-9 h-9 text-rose-400 mx-auto mb-3" />
          <h1 className="text-base font-bold mb-1">Sign in required</h1>
          <p className="text-xs text-neutral-400 mb-4">
            The hardware console is scoped to one gym, so it needs your operator session.
          </p>
          <Link href="/" className="inline-block bg-emerald-500 hover:bg-emerald-600 text-black font-bold text-sm px-4 py-2 rounded-xl">
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-white p-4 sm:p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div>
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-xs text-neutral-400 hover:text-white transition mb-2"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Dashboard
            </Link>
            <h1 className="text-xl sm:text-2xl font-black tracking-tight flex items-center gap-2">
              <ServerCog className="w-6 h-6 text-emerald-400" />
              Hardware &amp; Geofence — {session.tenantName ?? 'Command Center'}
            </h1>
            <p className="text-xs text-neutral-500 mt-1">
              Live terminal health, machine keys, and the gym radius that locks a member pass.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void refresh()}
              className="flex items-center gap-1.5 px-3 py-2 bg-neutral-900 border border-neutral-800 hover:border-neutral-700 rounded-xl text-xs transition"
            >
              <RefreshCw className="w-3.5 h-3.5 text-emerald-400" /> Refresh
            </button>
            {canManage && (
              <button
                onClick={() => {
                  setRegisterError(null);
                  setRegisterOpen(true);
                }}
                className="flex items-center gap-1.5 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-black font-semibold rounded-xl text-xs transition shadow-lg shadow-emerald-500/20"
              >
                <Plus className="w-4 h-4" /> Register Device
              </button>
            )}
          </div>
        </div>

        {notice && (
          <div
            className={`mb-5 flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-xs ${
              noticeKind === 'ok'
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-200'
                : 'bg-rose-500/10 border-rose-500/20 text-rose-200'
            }`}
          >
            <span>{notice}</span>
            <button onClick={() => setNotice(null)} className="opacity-70 hover:opacity-100">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {!tenantId && (
          <div className="mb-5 flex items-center gap-2 rounded-xl bg-amber-500/10 border border-amber-500/20 px-4 py-3 text-xs text-amber-200">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            This session has no gym attached, so no terminals can be listed. Sign in again.
          </div>
        )}

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <StatCard icon={<Activity className="w-4 h-4" />} label="Online now" value={stats.online} tone="emerald" />
          <StatCard icon={<Cpu className="w-4 h-4" />} label="Registered" value={stats.total} tone="neutral" />
          <StatCard icon={<AlertTriangle className="w-4 h-4" />} label="Silent / offline" value={stats.offline} tone="amber" />
          <StatCard
            icon={<Gauge className="w-4 h-4" />}
            label="Reporting error"
            value={stats.trouble}
            tone={stats.trouble > 0 ? 'rose' : 'neutral'}
          />
        </div>

        {/* ---- Live terminal grid ------------------------------------------- */}
        {!loaded ? (
          <div className="flex items-center justify-center gap-2 rounded-2xl border border-neutral-800 bg-neutral-900 py-14 text-sm text-neutral-500">
            <Loader2 className="w-4 h-4 animate-spin text-emerald-400" /> Reading the terminal registry…
          </div>
        ) : devices.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-neutral-800 bg-neutral-900/60 p-8 text-center mb-8">
            <ServerCog className="w-9 h-9 text-neutral-700 mx-auto mb-3" />
            <h2 className="text-sm font-bold mb-1">No terminals registered yet</h2>
            <p className="text-xs text-neutral-500 max-w-md mx-auto">
              Register the turnstile relay, fingerprint reader, RFID pad or the browser kiosk at the
              door. Each one gets a machine key shown once — paste that into the device firmware and
              it will check in here every 30 seconds.
            </p>
            {canManage && (
              <button
                onClick={() => setRegisterOpen(true)}
                className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-black font-semibold rounded-xl text-xs transition"
              >
                <Plus className="w-4 h-4" /> Register the first device
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-8">
            {devices.map((device) => {
              const Icon = TYPE_ICONS[device.device_type] ?? ServerCog;
              const meta = DEVICE_TYPE_META[device.device_type];
              const seconds = liveSeconds[device.id] ?? null;
              const live = seconds !== null && seconds <= ONLINE_WINDOW_SECONDS;

              return (
                <div
                  key={device.id}
                  className={`rounded-2xl border p-4 transition ${
                    live
                      ? 'bg-neutral-900 border-emerald-500/25'
                      : 'bg-neutral-900/70 border-neutral-800'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="p-2 bg-neutral-950 border border-neutral-800 rounded-xl shrink-0">
                        <Icon className="w-4 h-4 text-emerald-400" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-sm font-bold truncate">{device.device_name}</h3>
                        <span
                          className={`inline-block mt-0.5 text-[10px] px-1.5 py-0.5 rounded border ${
                            meta ? meta.badge : 'bg-neutral-800 text-neutral-400 border-neutral-700'
                          }`}
                        >
                          {meta ? meta.label : device.device_type}
                        </span>
                      </div>
                    </div>
                    <span className="flex items-center gap-1.5 text-[10px] uppercase font-bold tracking-wide text-neutral-400 shrink-0">
                      <span className={`w-2 h-2 rounded-full ${STATUS_DOT[device.status]}`} />
                      {device.status}
                    </span>
                  </div>

                  <dl className="grid grid-cols-2 gap-y-1.5 gap-x-3 text-[11px] mb-3">
                    <dt className="text-neutral-500">Last ping</dt>
                    <dd className={`text-right font-mono ${live ? 'text-emerald-400' : 'text-neutral-300'}`}>
                      {formatSince(seconds)}
                    </dd>
                    <dt className="text-neutral-500">IP address</dt>
                    <dd className="text-right font-mono text-neutral-300 truncate">
                      {device.ip_address ?? '—'}
                    </dd>
                    <dt className="text-neutral-500">Firmware</dt>
                    <dd className="text-right font-mono text-neutral-300">{device.firmware_version}</dd>
                    <dt className="text-neutral-500">Machine key</dt>
                    <dd className="text-right font-mono text-neutral-400 truncate">
                      {device.api_key_masked}
                    </dd>
                  </dl>

                  {confirmId === device.id ? (
                    <div className="flex items-center gap-2 rounded-xl bg-rose-500/10 border border-rose-500/25 px-3 py-2">
                      <span className="text-[11px] text-rose-200 flex-1">
                        Remove? A reader holding this key stops working instantly.
                      </span>
                      <button
                        onClick={() => void handleForget(device)}
                        className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-rose-500 text-white hover:bg-rose-600 shrink-0"
                      >
                        Remove
                      </button>
                      <button
                        onClick={() => setConfirmId(null)}
                        className="text-[11px] px-2.5 py-1 rounded-lg bg-neutral-800 hover:bg-neutral-700 shrink-0"
                      >
                        Keep
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => void handleCopyKey(device)}
                        className="flex items-center gap-1 flex-1 justify-center text-[11px] px-2 py-1.5 rounded-lg bg-neutral-950 border border-neutral-800 hover:border-neutral-700 transition"
                      >
                        <Copy className="w-3 h-3 text-blue-400" />
                        {copiedId === device.id ? 'Copied' : 'Copy key'}
                      </button>
                      <button
                        onClick={() => void handlePing(device)}
                        disabled={busyId === device.id}
                        title="Write one heartbeat from the console"
                        className="flex items-center gap-1 flex-1 justify-center text-[11px] px-2 py-1.5 rounded-lg bg-neutral-950 border border-neutral-800 hover:border-emerald-500/40 disabled:opacity-50 transition"
                      >
                        {busyId === device.id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Zap className="w-3 h-3 text-emerald-400" />
                        )}
                        Ping
                      </button>
                      {canManage && (
                        <button
                          onClick={() => setConfirmId(device.id)}
                          title="Remove this terminal"
                          className="flex items-center justify-center text-[11px] px-2 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 hover:bg-rose-500/20 transition"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ---- Geofence + gate test ---------------------------------------- */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
          <form onSubmit={handleSaveGeofence} className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
            <div className="flex items-center gap-2 mb-1">
              <MapPin className="w-4 h-4 text-emerald-400" />
              <h2 className="text-sm font-bold">Gym Geofence</h2>
            </div>
            <p className="text-[11px] text-neutral-500 mb-4">
              Where this gym physically sits, and how far away a member may still open a pass.
              {geofence &&
                (geofence.latitude === null || geofence.longitude === null
                  ? ' No coordinates are saved yet, so geofencing cannot arm.'
                  : ` Now measuring a ${geofence.geofence_radius_meters} m circle${
                      geofence.enforce_geofence ? ' and enforcing it.' : ', not enforced.'
                    }`)}
            </p>

            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label htmlFor="geo-lat" className="block text-[10px] uppercase tracking-wider text-neutral-500 mb-1">
                  Latitude
                </label>
                <input
                  id="geo-lat"
                  value={geoForm.latitude}
                  onChange={(e) => setGeoForm({ ...geoForm, latitude: e.target.value })}
                  placeholder="19.0760900"
                  inputMode="decimal"
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-xs font-mono outline-none focus:border-emerald-500/50"
                />
              </div>
              <div>
                <label htmlFor="geo-lon" className="block text-[10px] uppercase tracking-wider text-neutral-500 mb-1">
                  Longitude
                </label>
                <input
                  id="geo-lon"
                  value={geoForm.longitude}
                  onChange={(e) => setGeoForm({ ...geoForm, longitude: e.target.value })}
                  placeholder="72.8777100"
                  inputMode="decimal"
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-xs font-mono outline-none focus:border-emerald-500/50"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label htmlFor="geo-radius" className="block text-[10px] uppercase tracking-wider text-neutral-500 mb-1">
                  Radius (metres)
                </label>
                <input
                  id="geo-radius"
                  value={geoForm.geofence_radius_meters}
                  onChange={(e) => setGeoForm({ ...geoForm, geofence_radius_meters: e.target.value })}
                  type="number"
                  min={10}
                  max={20000}
                  step={5}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-xs font-mono outline-none focus:border-emerald-500/50"
                />
              </div>
              <label className="flex items-center gap-2 rounded-xl bg-neutral-950 border border-neutral-800 px-3 py-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={geoForm.enforce_geofence}
                  onChange={(e) => setGeoForm({ ...geoForm, enforce_geofence: e.target.checked })}
                  className="w-4 h-4 accent-emerald-500"
                />
                <span className="text-[11px] text-neutral-300">
                  Enforce
                  <span className="block text-[10px] text-neutral-500">Locks passes outside the radius</span>
                </span>
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={captureCurrentLocation}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-neutral-950 border border-neutral-800 hover:border-emerald-500/40 text-xs transition"
              >
                <Navigation className="w-3.5 h-3.5 text-emerald-400" /> Capture my location
              </button>
              {canManage && (
                <button
                  type="submit"
                  disabled={geoBusy}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 disabled:opacity-60 text-black font-semibold text-xs transition"
                >
                  {geoBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MapPin className="w-3.5 h-3.5" />}
                  Save geofence
                </button>
              )}
            </div>

            {geoNote && <p className="mt-3 text-[11px] text-neutral-400">{geoNote}</p>}

            {selfCheck && (
              <div
                className={`mt-3 rounded-xl border px-3 py-2 text-[11px] ${
                  selfCheck.unlocked
                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-200'
                    : 'bg-rose-500/10 border-rose-500/20 text-rose-200'
                }`}
              >
                <span className="font-bold uppercase tracking-wide mr-1">
                  {selfCheck.state === 'inside' ||
                  selfCheck.state === 'not_enforced' ||
                  selfCheck.state === 'unconfigured'
                    ? 'Pass would unlock'
                    : 'Pass would lock'}
                </span>
                {selfCheck.distance_meters !== null &&
                  `${formatDistance(selfCheck.distance_meters)} from these coordinates · `}
                {selfCheck.message}
              </div>
            )}
          </form>

          <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
            <div className="flex items-center gap-2 mb-1">
              <ScanLine className="w-4 h-4 text-emerald-400" />
              <h2 className="text-sm font-bold">Gate Test Panel</h2>
            </div>
            <p className="text-[11px] text-neutral-500 mb-4">
              Exactly what an ESP32 sends: a machine key plus a fingerprint slot or a card serial.
              <span className="text-neutral-400"> fn_hardware_punch </span>
              decides — freeze, expiry, attendance row and heartbeat included.
            </p>

            <form onSubmit={handleTestPunch} className="space-y-3">
              <div>
                <label htmlFor="punch-device" className="block text-[10px] uppercase tracking-wider text-neutral-500 mb-1">
                  Terminal
                </label>
                <select
                  id="punch-device"
                  value={punchDeviceId}
                  onChange={(e) => setPunchDeviceId(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-xs outline-none focus:border-emerald-500/50"
                >
                  <option value="">Choose a registered terminal…</option>
                  {devices.map((device) => (
                    <option key={device.id} value={device.id}>
                      {device.device_name} — {DEVICE_TYPE_META[device.device_type]?.label ?? device.device_type}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="punch-key" className="block text-[10px] uppercase tracking-wider text-neutral-500 mb-1">
                  Machine key
                </label>
                <div className="relative">
                  <KeyRound className="w-3.5 h-3.5 text-neutral-500 absolute left-3 top-2.5" />
                  <input
                    id="punch-key"
                    value={punchKey}
                    onChange={(e) => setPunchKey(e.target.value)}
                    placeholder="fgs_hw_… (shown once at registration)"
                    autoComplete="off"
                    spellCheck={false}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl pl-9 pr-3 py-2 text-xs font-mono outline-none focus:border-emerald-500/50"
                  />
                </div>
                <p className="text-[10px] text-neutral-600 mt-1">
                  The console cannot read a stored key back — paste the one you saved on the device,
                  or register a new terminal to have this field filled in.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="punch-bio" className="block text-[10px] uppercase tracking-wider text-neutral-500 mb-1">
                    Fingerprint slot
                  </label>
                  <input
                    id="punch-bio"
                    value={punchCredential.biometric_id}
                    onChange={(e) => setPunchCredential({ ...punchCredential, biometric_id: e.target.value })}
                    placeholder="42"
                    inputMode="numeric"
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-xs font-mono outline-none focus:border-emerald-500/50"
                  />
                </div>
                <div>
                  <label htmlFor="punch-rfid" className="block text-[10px] uppercase tracking-wider text-neutral-500 mb-1">
                    RFID card
                  </label>
                  <input
                    id="punch-rfid"
                    value={punchCredential.rfid_card}
                    onChange={(e) => setPunchCredential({ ...punchCredential, rfid_card: e.target.value })}
                    placeholder="0012345678"
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-xs font-mono outline-none focus:border-emerald-500/50"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={
                  punchBusy ||
                  !punchKey.trim() ||
                  (!punchCredential.biometric_id.trim() && !punchCredential.rfid_card.trim())
                }
                className="flex items-center justify-center gap-1.5 w-full px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 text-black font-semibold text-xs transition"
              >
                {punchBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                Send punch
              </button>
            </form>

            {punchResult && (
              <div
                className={`mt-4 rounded-xl border px-4 py-3 text-xs ${
                  punchResult.unlock
                    ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-100'
                    : 'bg-rose-500/10 border-rose-500/25 text-rose-100'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  {punchResult.unlock ? (
                    <Unlock className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <Lock className="w-4 h-4 text-rose-400" />
                  )}
                  <span className="font-black tracking-wide">
                    {punchResult.unlock ? 'RELAY: OPEN' : 'RELAY: STAY LOCKED'}
                  </span>
                  <span className="ml-auto font-mono text-[10px] opacity-70">{punchResult.code}</span>
                </div>
                <p className="opacity-90">{punchResult.reason}</p>
                {punchResult.memberName && (
                  <p className="mt-1 font-mono text-[11px] opacity-80">
                    {punchResult.memberName}
                    {punchResult.member_phone ? ` · ${punchResult.member_phone}` : ''}
                    {punchResult.days_left !== undefined ? ` · ${punchResult.days_left}d left` : ''}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        <p className="text-[11px] text-neutral-600 mb-8">
          A terminal is called online while its last heartbeat is under {ONLINE_WINDOW_SECONDS} seconds
          old. Firmware should POST /api/hardware/heartbeat every 30 seconds and
          /api/hardware/punch on every scan — the punch itself counts as a heartbeat, so a reader that
          punches but stops punching shows up red here within a minute.
        </p>
      </div>

      {/* ---- Register modal ------------------------------------------------- */}
      {registerOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleRegister}
            className="w-full max-w-md bg-neutral-900 border border-neutral-800 rounded-3xl p-6 shadow-2xl"
          >
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-base font-bold">Register a terminal</h2>
                <p className="text-[11px] text-neutral-500 mt-0.5">
                  A new machine key is generated and shown once. Copy it into the device firmware.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRegisterOpen(false)}
                className="text-neutral-500 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label htmlFor="reg-name" className="block text-[10px] uppercase tracking-wider text-neutral-500 mb-1">
                  Device name
                </label>
                <input
                  id="reg-name"
                  value={registerForm.device_name}
                  onChange={(e) => setRegisterForm({ ...registerForm, device_name: e.target.value })}
                  placeholder="Main door relay"
                  maxLength={80}
                  required
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-xs outline-none focus:border-emerald-500/50"
                />
              </div>

              <div>
                <label htmlFor="reg-type" className="block text-[10px] uppercase tracking-wider text-neutral-500 mb-1">
                  Device type
                </label>
                <select
                  id="reg-type"
                  value={registerForm.device_type}
                  onChange={(e) =>
                    setRegisterForm({ ...registerForm, device_type: e.target.value as HardwareDeviceType })
                  }
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-xs outline-none focus:border-emerald-500/50"
                >
                  {(Object.keys(DEVICE_TYPE_META) as HardwareDeviceType[]).map((type) => (
                    <option key={type} value={type}>
                      {DEVICE_TYPE_META[type].label}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-neutral-600 mt-1">
                  {DEVICE_TYPE_META[registerForm.device_type].hint}
                </p>
              </div>

              <div>
                <label htmlFor="reg-fw" className="block text-[10px] uppercase tracking-wider text-neutral-500 mb-1">
                  Firmware version
                </label>
                <input
                  id="reg-fw"
                  value={registerForm.firmware_version}
                  onChange={(e) => setRegisterForm({ ...registerForm, firmware_version: e.target.value })}
                  placeholder="v1.0.0"
                  maxLength={24}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-xs font-mono outline-none focus:border-emerald-500/50"
                />
              </div>

              {registerError && (
                <p className="text-[11px] text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-xl px-3 py-2">
                  {registerError}
                </p>
              )}
            </div>

            <div className="flex items-center gap-2 mt-5">
              <button
                type="button"
                onClick={() => setRegisterOpen(false)}
                className="flex-1 px-4 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-xs transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={registerBusy}
                className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 disabled:opacity-60 text-black font-semibold text-xs transition"
              >
                {registerBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                Generate key
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ---- One-time key modal --------------------------------------------- */}
      {issued && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-neutral-900 border border-emerald-500/30 rounded-3xl p-6 shadow-2xl">
            <div className="flex items-center gap-2 mb-3">
              <KeyRound className="w-5 h-5 text-emerald-400" />
              <h2 className="text-base font-bold">{issued.device_name} registered</h2>
            </div>

            <p className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/25 rounded-xl px-3 py-2 mb-4">
              Copy this key into the device firmware now. The console can only show a masked form of it
              afterwards — a lost key means registering the terminal again.
            </p>

            <div className="bg-black/60 border border-neutral-800 rounded-xl p-3 mb-4 break-all font-mono text-xs text-emerald-300 select-all">
              {issued.api_key}
            </div>

            <dl className="grid grid-cols-2 gap-y-1 text-[11px] mb-5">
              <dt className="text-neutral-500">Type</dt>
              <dd className="text-right">
                {DEVICE_TYPE_META[issued.device_type]?.label ?? issued.device_type}
              </dd>
              <dt className="text-neutral-500">Firmware</dt>
              <dd className="text-right font-mono">{issued.firmware_version}</dd>
              <dt className="text-neutral-500">Device id</dt>
              <dd className="text-right font-mono truncate">{issued.id}</dd>
            </dl>

            <div className="flex items-center gap-2">
              <button
                onClick={async () => {
                  const ok = await copyText(issued.api_key);
                  setIssued(null);
                  flash(
                    ok
                      ? 'Key copied — paste it into the device firmware now.'
                      : 'Key dismissed — copy it from the field before it disappears next time.',
                    ok ? 'ok' : 'bad'
                  );
                }}
                className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-black font-semibold text-xs transition"
              >
                <Copy className="w-3.5 h-3.5" /> Copy key and close
              </button>
              <button
                onClick={() => setIssued(null)}
                className="px-4 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-xs transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Small stat tile across the top of the console. */
function StatCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: 'emerald' | 'amber' | 'rose' | 'neutral';
}) {
  const toneClass = {
    emerald: 'border-emerald-500/20 text-emerald-400',
    amber: 'border-amber-500/20 text-amber-400',
    rose: 'border-rose-500/20 text-rose-400',
    neutral: 'border-neutral-800 text-neutral-300',
  }[tone];

  return (
    <div className={`rounded-2xl border bg-neutral-900 px-4 py-3 ${toneClass}`}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-neutral-500 mb-1">
        {icon}
        {label}
      </div>
      <p className="text-2xl font-black text-white leading-none">{value}</p>
    </div>
  );
}






