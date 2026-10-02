'use client';

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  KeyRound,
  Loader2,
  LogOut,
  Pencil,
  Shield,
  Smartphone,
} from 'lucide-react';
import { USERNAME_COOLDOWN_DAYS } from '@/lib/companion';
import {
  changeUsername,
  normalizeHandle,
  saveProfile,
  validateHandle,
} from '@/lib/member-account';

/**
 * The member's own account settings (Module 8.3).
 *
 * WHY THE @HANDLE MOVED OFF THE PROFILE CARD
 * ------------------------------------------
 * It used to be a free-text field on the front of the Health tab, next to the
 * photo. Two problems with that: a handle is an identifier, not decoration, and
 * changing it breaks whatever the member had told people. So it lives here, in
 * Settings, behind a 30-day server-side cooldown — and the profile card just
 * SHOWS it.
 *
 * The cooldown is enforced in fn_member_set_username. This screen only reads the
 * last-change timestamp to explain it in advance, so a member is told "you can
 * change this in 12 days" rather than discovering it by being rejected.
 */

const INPUT =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15 disabled:opacity-60';

/** Mirrors the database rule exactly: ^[a-z0-9._]{3,20}$ after lower-casing. */
export const HANDLE_PATTERN = /^[a-z0-9._]{3,20}$/;

const GENDER_OPTIONS = [
  { id: '', label: 'Prefer not to say' },
  { id: 'male', label: 'Male' },
  { id: 'female', label: 'Female' },
  { id: 'nonbinary', label: 'Non-binary' },
] as const;

export interface AccountProfile {
  display_name: string | null;
  emergency_phone: string | null;
  gender: string | null;
  date_of_birth: string | null;
  username_changed_at: string | null;
}

/** Days left before another @handle change, or null when one is available now. */
export function handleCooldownDays(lastChangedAt: string | null, now: Date = new Date()): number | null {
  if (!lastChangedAt) return null;
  const changed = new Date(lastChangedAt).getTime();
  if (Number.isNaN(changed)) return null;
  const readyAt = changed + USERNAME_COOLDOWN_DAYS * 86_400_000;
  if (now.getTime() >= readyAt) return null;
  // Ceiling, not round: at 29.1 days remaining, "29 days" understates the wait.
  return Math.ceil((readyAt - now.getTime()) / 86_400_000);
}

interface AccountSettingsProps {
  memberId: string | null;
  currentUsername: string | null;
  profile: AccountProfile;
  passwordDone: boolean;
  onSaved: (message: string) => void;
  onFlash: (message: string, kind?: 'ok' | 'bad') => void;
  onLogout: () => void;
}

export default function AccountSettings({
  memberId,
  currentUsername,
  profile,
  passwordDone,
  onSaved,
  onFlash,
  onLogout,
}: AccountSettingsProps) {
  const cooldown = useMemo(
    () => handleCooldownDays(profile.username_changed_at),
    [profile.username_changed_at]
  );

  const [handle, setHandle] = useState(currentUsername ?? '');
  const [handleError, setHandleError] = useState<string | null>(null);
  const [handleBusy, setHandleBusy] = useState(false);

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    displayName: profile.display_name ?? '',
    emergencyPhone: profile.emergency_phone ?? '',
    gender: profile.gender ?? '',
    dateOfBirth: profile.date_of_birth ?? '',
  });
  const [profileBusy, setProfileBusy] = useState(false);

  const normalized = normalizeHandle(handle);
  const localProblem = validateHandle(normalized);
  const handleChanged = normalized !== (currentUsername ?? '');

  async function submitHandle(event: React.FormEvent) {
    event.preventDefault();
    if (cooldown !== null || !handleChanged) return;

    const problem = validateHandle(normalized);
    if (problem) {
      setHandleError(problem);
      return;
    }

    setHandleBusy(true);
    setHandleError(null);
    const result = await changeUsername(memberId, normalized);
    setHandleBusy(false);

    if (!result.ok) {
      setHandleError(result.error ?? 'Could not change your @handle.');
      return;
    }

    if (result.changed) {
      onFlash(`Your handle is now @${result.username}.`, 'ok');
      onSaved(`Your handle is now @${result.username}. You can change it again in 30 days.`);
    } else {
      onSaved('That is already your handle.');
    }
  }

  async function submitProfile(event: React.FormEvent) {
    event.preventDefault();

    setProfileBusy(true);
    // Empty strings become null, which the RPC treats as "clear this field".
    // Fields the member did not touch keep their stored value.
    const result = await saveProfile(memberId, {
      displayName: form.displayName.trim() || null,
      emergencyPhone: form.emergencyPhone.trim() || null,
      gender: form.gender || null,
      dateOfBirth: form.dateOfBirth || null,
    });
    setProfileBusy(false);

    if (!result.ok) {
      onFlash(result.error ?? 'Could not save your profile.', 'bad');
      return;
    }

    setEditing(false);
    onSaved('Profile updated.');
    onFlash('Profile updated.', 'ok');
  }

  function resetForm() {
    setForm({
      displayName: profile.display_name ?? '',
      emergencyPhone: profile.emergency_phone ?? '',
      gender: profile.gender ?? '',
      dateOfBirth: profile.date_of_birth ?? '',
    });
    setEditing(false);
  }

  return (
    <div className="space-y-4">
      {/* ---- @handle ------------------------------------------------------ */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-100 text-teal-700">
            <Shield className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-sm font-extrabold tracking-tight">Change @handle</h3>
            <p className="text-[11px] text-slate-500">What your gym calls you at the desk</p>
          </div>
        </div>

        <form onSubmit={submitHandle} className="mt-3.5">
          <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            @handle
          </label>
          <div className="flex gap-2">
            <input
              value={handle}
              onChange={(event) => {
                setHandle(event.target.value);
                setHandleError(null);
              }}
              // Disabled during the cooldown rather than hidden: the member can
              // still see their handle and understand why it is stuck.
              disabled={cooldown !== null}
              placeholder="rahul.kumar"
              autoCapitalize="none"
              autoCorrect="off"
              maxLength={20}
              className={INPUT}
            />
            <button
              type="submit"
              disabled={handleBusy || cooldown !== null || !handleChanged || !!localProblem}
              className="shrink-0 rounded-xl bg-teal-600 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-teal-700 disabled:opacity-40"
            >
              {handleBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save'}
            </button>
          </div>

          {cooldown !== null ? (
            <p className="mt-2 flex items-start gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] font-medium text-amber-800">
              <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
              You can change your @handle again in {cooldown} day{cooldown === 1 ? '' : 's'}.
              Handles are how people find you, so we ask you to keep one for a while.
            </p>
          ) : (
            <>
              {handleError && (
                <p className="mt-2 rounded-xl border border-rose-200 bg-rose-50 px-2.5 py-2 text-[11px] font-medium text-rose-700">
                  {handleError}
                </p>
              )}
              <p className="mt-1.5 text-[11px] text-slate-400">
                3–20 characters: letters, numbers, dots and underscores. You can change it
                once every 30 days.
              </p>
            </>
          )}
        </form>
      </section>

      {/* ---- Edit profile -------------------------------------------------- */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
              <Pencil className="h-4 w-4" />
            </span>
            <div>
              <h3 className="text-sm font-extrabold tracking-tight">Your details</h3>
              <p className="text-[11px] text-slate-500">Name, emergency contact, personal info</p>
            </div>
          </div>
          {!editing && (
            <button
              onClick={() => setEditing(true)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700 transition hover:border-slate-300"
            >
              Edit
            </button>
          )}
        </div>

        {editing ? (
          <form onSubmit={submitProfile} className="mt-3.5 space-y-3">
            <div>
              <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                Display name
              </label>
              <input
                value={form.displayName}
                onChange={(event) => setForm({ ...form, displayName: event.target.value })}
                placeholder="Aarav Bedi"
                maxLength={80}
                className={INPUT}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                Emergency phone
              </label>
              <input
                value={form.emergencyPhone}
                onChange={(event) => setForm({ ...form, emergencyPhone: event.target.value })}
                placeholder="98765 43210"
                inputMode="tel"
                className={INPUT}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  Gender
                </label>
                <select
                  value={form.gender}
                  onChange={(event) => setForm({ ...form, gender: event.target.value })}
                  className={INPUT}
                >
                  {GENDER_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  Date of birth
                </label>
                <input
                  type="date"
                  value={form.dateOfBirth}
                  onChange={(event) => setForm({ ...form, dateOfBirth: event.target.value })}
                  className={INPUT}
                />
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={resetForm}
                className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-600 transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={profileBusy}
                className="flex-1 rounded-xl bg-teal-600 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-teal-700 disabled:opacity-60"
              >
                {profileBusy ? (
                  <Loader2 className="mx-auto h-3.5 w-3.5 animate-spin" />
                ) : (
                  'Save details'
                )}
              </button>
            </div>
          </form>
        ) : (
          <dl className="mt-3 space-y-1.5 text-xs">
            {[
              { label: 'Display name', value: profile.display_name ?? 'Not set' },
              { label: 'Emergency phone', value: profile.emergency_phone ?? 'Not set' },
              {
                label: 'Gender',
                value: GENDER_OPTIONS.find((o) => o.id === profile.gender)?.label ?? 'Not set',
              },
              { label: 'Date of birth', value: profile.date_of_birth ?? 'Not set' },
            ].map((row) => (
              <div key={row.label} className="flex items-center justify-between gap-3">
                <dt className="font-medium text-slate-500">{row.label}</dt>
                <dd className="truncate font-semibold text-slate-800">{row.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      {/* ---- Security ------------------------------------------------------ */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
            <KeyRound className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-sm font-extrabold tracking-tight">Security</h3>
            <p className="text-[11px] text-slate-500">Password and signed-in devices</p>
          </div>
        </div>

        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2.5">
            <span className="flex items-center gap-2 text-xs font-semibold text-slate-700">
              <KeyRound className="h-3.5 w-3.5 text-slate-400" /> Password
            </span>
            {passwordDone ? (
              <span className="flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                <Check className="h-3 w-3" /> Set
              </span>
            ) : (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                Not set
              </span>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2.5">
            <span className="flex items-center gap-2 text-xs font-semibold text-slate-700">
              <Smartphone className="h-3.5 w-3.5 text-slate-400" /> Active devices
            </span>
            <span className="text-[10px] font-medium text-slate-500">This device only</span>
          </div>
        </div>

        <button
          onClick={onLogout}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-100"
        >
          <LogOut className="h-3.5 w-3.5" /> Log out
        </button>
      </section>
    </div>
  );
}