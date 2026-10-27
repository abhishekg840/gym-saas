# Vyroniq — Gym Operating Platform

Enterprise B2B SaaS platform for gym memberships, access control, attendance, billing, retail, and member communication. Indian gyms run their entire operation on Vyroniq: plans and subscriptions, QR gate passes, biometric/RFID turnstiles, front-desk check-in, POS retail, CRM, and a member mobile app.

## Stack

- **Next.js 16** (Turbopack, App Router), **TypeScript**, React 19
- **Supabase** — Postgres, Row Level Security, Security Definer RPCs
- **Cashfree Payments** — B2B subscription billing (Starter ₹799/mo, Pro ₹1,499/mo) with webhook activation
- **ESP32** — WebSocket/REST bridge for turnstiles
- **Capacitor** — native Android gate-pass app

## Architecture

```
browser / Capacitor app
        │ HTTPS/WSS
        ▼
Next.js 16 App Router (app/)
        │
        ├─ Server API routes (app/api/) — Supabase RPC calls, Cashfree webhooks
        ├─ Server components & client components (components/)
        └─ lib/ — supabase client, session, entitlements, cashfree, passtoken, hardware
        │
        ▼ Supabase (Postgres + RLS + Security Definer RPCs)
```

## Key Modules

| Module | Responsibility |
|--------|----------------|
| **Membership & credentials** | bcrypt hashes in a `private` schema; phone/handle/email login; password setup and reset |
| **Access control & gate pass** | HMAC-signed rotating QR pass, 30-second window, optional geofence proof, fail-closed minting |
| **Hardware** | R307/R307S fingerprint enrollment jobs, RFID card tap, terminal heartbeat, slot allocation |
| **Billing** | Cashfree checkout orders, signature-verified webhooks, subscription activation, invoice ledger |
| **Point of sale** | Stock-locked checkout, receipts, revenue ledger, pickups |
| **CRM & leads** | Per-gym member pipeline, announcements, WhatsApp renewal messages |
| **Attendance** | Check-in/checkout pairing, session duration, live crowd |
| **Super-admin console** | Platform-wide gym management, entitlements, billing |
| **Member dashboard** | Smart Pass, schedule, challenges, settings, password gate |

## Hardware Integration

ESP32 turnstiles connect over WebSocket/REST to the hardware API routes. Fingerprint enrollment (R307/R307S) runs as server-reserved slot jobs under an advisory lock — the device fills a slot and only a successful capture binds it to a member. RFID card taps arm a non-biometric terminal for a 60-second window. Terminal heartbeats are computed in the database (60-second rule) and exposed through Security Definer RPCs so the browser never touches `hardware_devices` directly.

## Security

- All credential checks run inside Postgres via `pgcrypto` bcrypt; plaintext credentials never reach the Next layer.
- Gate passes are signed server-side with `AUTH_SECRET`; unsigned minting returns 503 (fail closed).
- Cashfree webhooks are signature-verified before any subscription is activated.
- Tenant scope is resolved server-side from the session cookie and validated as a UUID; dangling scopes are refused with a redirect.

## Setup

1. Copy `.env.example` to `.env.local` and fill in the values.
2. Install dependencies: `npm install`
3. Apply the pending migrations from `supabase/migrations/` in the Supabase SQL Editor.
4. Run the dev server: `npm run dev`
5. Open `http://localhost:3000`

### Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anon (public) key |
| `AUTH_SECRET` | Yes (production) | HMAC-SHA256 key for gate-pass signing; generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `CASHFREE_APP_ID` | Yes (production) | Cashfree merchant app ID |
| `CASHFREE_SECRET_KEY` | Yes (production) | Cashfree secret key |
| `CASHFREE_ENV` | No | `SANDBOX` (default) or `PRODUCTION` |
| `CRON_SECRET` | No | Protects `/api/cron/*` when set |
| `SUPABASE_JWT_SECRET` | No | Fallback gate-pass signing key |

## Scripts

- `npm run dev` — start the Turbopack dev server
- `npm run build` — production build
- `npm run start` — start the production server
- `npm run lint` — run ESLint

## License

Private — Vyroniq platform.
