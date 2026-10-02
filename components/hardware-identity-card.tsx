'use client';

import { Cpu, Fingerprint, HelpCircle, Radio } from 'lucide-react';
import {
  HARDWARE_IDENTITY_HINT,
  rfidDisplay,
  slotDisplay,
  type HardwareIdentity,
} from '@/lib/identity';

/**
 * The read-only "Hardware Identity" card (Modules 10 & 33).
 *
 * The product rule this component exists to enforce: a member or an owner NEVER
 * types an RFID key or a biometric slot. There is deliberately no input, no edit
 * affordance and no copy-to-clipboard that would reveal the full key — the
 * values are minted by the gate when hardware is enrolled, and all this screen
 * does is show the member which credential is on their card.
 */

const CARD = 'bg-white rounded-2xl border border-slate-200 shadow-sm';

/** The `?` affordance, shared by both rows. */
function Hint() {
  return (
    <span className="group relative inline-flex">
      <HelpCircle
        className="h-3.5 w-3.5 text-slate-300"
        aria-label={HARDWARE_IDENTITY_HINT}
        role="img"
      />
      {/* CSS-only tooltip: no JS state, and it stays inside the card on mobile
          because the text is absolutely positioned against the icon. */}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full right-0 z-20 mb-2 w-56 rounded-lg border border-slate-200 bg-slate-900 px-2.5 py-2 text-[10px] font-medium leading-relaxed text-white opacity-0 shadow-lg transition group-hover:opacity-100"
      >
        {HARDWARE_IDENTITY_HINT}
      </span>
    </span>
  );
}

interface RowProps {
  icon: typeof Radio;
  label: string;
  value: string;
  linked: boolean;
  mono?: boolean;
}

function IdentityRow({ icon: Icon, label, value, linked, mono }: RowProps) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2.5">
      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
          linked ? 'bg-teal-100 text-teal-700' : 'bg-slate-200 text-slate-400'
        }`}
      >
        <Icon className="h-4 w-4" />
      </div>

      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
          {label}
          <Hint />
        </p>
        <p
          className={`truncate text-sm font-bold ${
            linked ? 'text-slate-800' : 'text-slate-400'
          } ${mono && linked ? 'font-mono tracking-wider' : ''}`}
        >
          {value}
        </p>
      </div>

      <span
        className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${
          linked
            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
            : 'border-slate-200 bg-white text-slate-400'
        }`}
      >
        {linked ? 'Active' : 'None'}
      </span>
    </div>
  );
}

export default function HardwareIdentityCard({
  identity,
}: {
  identity: HardwareIdentity | null;
}) {
  const rfid = rfidDisplay(identity);
  const slot = slotDisplay(identity);
  const anyLinked = Boolean(identity?.rfid_linked || identity?.biometric_linked);

  return (
    <section className={`${CARD} p-5`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
            Hardware Identity
          </p>
          <h2 className="mt-0.5 text-sm font-extrabold tracking-tight">Gate credentials</h2>
        </div>
        <Cpu className={`h-5 w-5 ${anyLinked ? 'text-teal-600' : 'text-slate-300'}`} />
      </div>

      <div className="space-y-2">
        <IdentityRow
          icon={Radio}
          label="RFID Key"
          value={rfid}
          linked={Boolean(identity?.rfid_linked)}
          mono
        />
        <IdentityRow
          icon={Fingerprint}
          label="Biometric Slot"
          value={slot}
          linked={Boolean(identity?.biometric_linked)}
          mono
        />
      </div>

      <p className="mt-3 text-[11px] font-medium leading-relaxed text-slate-500">
        {anyLinked
          ? 'These are assigned by the gym’s card reader and fingerprint scanner. Tap your card or finger at the turnstile — nothing here is ever typed or shared.'
          : 'No card or fingerprint is registered yet. Visit the front desk to enrol — these details are created by the gate hardware, not typed by hand.'}
      </p>
    </section>
  );
}
