'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * /admin/leads is the URL the owner console's navigation points at; the screen
 * itself is the Kanban board at /leads (which carries the staff session guard,
 * so the alias keeps the identical protection rather than a looser one).
 *
 * A client redirect keeps this a single source of truth — no second copy of the
 * pipeline to drift, and no build-time prerender surprises from `redirect()`.
 * The reason /leads is the real page and this the alias (rather than the other
 * way round) is that /leads is the URL already bookmarked on every gym's desk.
 */
export default function AdminLeadsAlias() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/leads');
  }, [router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 text-sm text-neutral-400">
      Opening the pipeline…
    </main>
  );
}
