'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * /admin/store is the URL the owner console's navigation has always pointed at;
 * the screen itself is the till at /store (it carries the staff session guard,
 * so the alias keeps the identical protection rather than a looser one).
 * A client redirect keeps this a single source of truth — no second copy of the
 * POS to drift, and no build-time prerender surprises from `redirect()`.
 */
export default function AdminStoreAlias() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/store');
  }, [router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 text-sm text-neutral-400">
      Opening the store…
    </main>
  );
}
