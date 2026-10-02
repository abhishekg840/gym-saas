'use client';

import { useRef, useState } from 'react';
import { Camera, Loader2, Trash2 } from 'lucide-react';
import { initialsFor, removeAvatar, uploadAvatar } from '@/lib/identity';

/**
 * The Instagram-style profile photo (Module 2).
 *
 * One component serves both entry points — the /member/health card and the
 * header profile modal — so the validation rules, the 5 MB cap and the
 * cache-bust can never drift between the two.
 *
 * Native capture: the same hidden <input> carries `capture="user"`, so on Android
 * the tap opens the camera roll/camera directly and on the web it degrades to a
 * plain file dialog. Nothing else about the flow changes.
 */

const RING =
  'relative shrink-0 rounded-full ring-2 ring-white shadow-sm transition group-focus-within:ring-teal-500';

interface AvatarUploaderProps {
  memberId: string | null;
  tenantId: string | null;
  name: string;
  /** Unversioned URL straight from the database. */
  avatarUrl: string | null;
  onFlash: (message: string, kind?: 'ok' | 'bad') => void;
  /** Lets the parent mirror the photo into its own header on success. */
  onChanged?: (url: string | null) => void;
  size?: 'sm' | 'lg';
}

export default function AvatarUploader({
  memberId,
  tenantId,
  name,
  avatarUrl,
  onFlash,
  onChanged,
  size = 'lg',
}: AvatarUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  // The rendered URL is state, not derived from the prop: the parent cannot
  // re-read the database fast enough to feel instant, and the whole point of
  // the feature is that the photo appears the moment the upload lands.
  const [shown, setShown] = useState<string | null>(avatarUrl);

  /**
   * Reset when the PROP changes, but not because of an effect. This is React's
   * "adjust state during render" pattern: comparing the incoming prop against
   * the value the state was last derived from is exactly the case an effect
   * handles badly — it would flash the previous member's photo for a frame and
   * then re-render to correct itself.
   */
  const [syncedFrom, setSyncedFrom] = useState<string | null>(avatarUrl);
  if (avatarUrl !== syncedFrom) {
    setSyncedFrom(avatarUrl);
    setShown(avatarUrl);
  }

  const disabled = !memberId || busy;
  const box = size === 'lg' ? 'h-24 w-24' : 'h-11 w-11';
  const cameraSize = size === 'lg' ? 'h-4 w-4' : 'h-3 w-3';

  async function handleFile(file: File | undefined) {
    if (!file || !memberId) return;

    setBusy(true);
    const result = await uploadAvatar({ memberId, tenantId, file });
    setBusy(false);

    if (!result.ok) {
      onFlash(result.error ?? 'Could not upload that photo.', 'bad');
      return;
    }

    setShown(result.url ?? null);
    onChanged?.(result.url ?? null);
    onFlash('Profile photo updated.', 'ok');
  }

  async function handleRemove() {
    if (!memberId) return;

    setBusy(true);
    const result = await removeAvatar(memberId);
    setBusy(false);

    if (!result.ok) {
      onFlash(result.error ?? 'Could not remove that photo.', 'bad');
      return;
    }

    setShown(null);
    onChanged?.(null);
    onFlash('Photo removed.', 'ok');
  }

  return (
    <div className={`${RING} ${box} bg-slate-100`}>
      {shown ? (
        // Plain <img>: the URL is a versioned public Storage link, so next/image
        // would add a loader for a single 96px tile and break cache-busting.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={shown}
          alt={name ? `${name}'s profile photo` : 'Profile photo'}
          className="h-full w-full rounded-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center rounded-full bg-gradient-to-br from-teal-500 to-teal-700 text-xl font-extrabold text-white">
          {initialsFor(name)}
        </div>
      )}

      {/* The camera affordance sits over the bottom-right of the ring, exactly
          where the eye already goes for "change my picture". */}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        title="Change profile photo"
        aria-label="Change profile photo"
        className="absolute -bottom-0.5 -right-0.5 flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-teal-600 text-white shadow-sm transition active:scale-95 disabled:opacity-60"
      >
        {busy ? <Loader2 className={`${cameraSize} animate-spin`} /> : <Camera className={cameraSize} />}
      </button>

      {shown && (
        <button
          type="button"
          onClick={handleRemove}
          disabled={disabled}
          title="Remove photo"
          aria-label="Remove profile photo"
          className="absolute -left-0.5 -top-0.5 flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-slate-700 text-white shadow-sm transition active:scale-95 disabled:opacity-60"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif,image/gif"
        capture="user"
        className="hidden"
        onChange={(event) => {
          // Reset first so picking the SAME file twice still fires onChange.
          const file = event.target.files?.[0];
          event.target.value = '';
          void handleFile(file);
        }}
      />
    </div>
  );
}
