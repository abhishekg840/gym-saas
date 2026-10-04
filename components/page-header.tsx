'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

/**
 * The one page masthead every owner-console screen used to reinvent.
 *
 * Nine pages each grew their own back-button-plus-icon-plus-title block, which
 * is why they drifted: different paddings, different icon tiles, different grey
 * for the same subtitle. This renders the shared shape and nothing else, so a
 * screen supplies only what actually differs — where it links back to, which
 * icon stands for it, and what it is called.
 *
 * PRESENTATION ONLY. It never fetches, guards or navigates on its own behalf;
 * `backHref` is just a link target the caller already had.
 */

interface PageHeaderProps {
  /** Where the back arrow goes. Every desk screen goes back to the console. */
  backHref?: string;
  /** Icon tile beside the title. */
  icon: ReactNode;
  title: string;
  /** One line of context under the title — gym name, counts, scope. */
  subtitle?: ReactNode;
  /** Buttons, filters and search on the trailing edge. */
  actions?: ReactNode;
}

export default function PageHeader({
  backHref = '/admin',
  icon,
  title,
  subtitle,
  actions,
}: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-4 pb-5 pt-5 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <Link
          href={backHref}
          title="Back to console"
          className="vy-icon-btn shrink-0 border border-line"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line bg-wash text-ink-2">
          {icon}
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-[17px] font-semibold tracking-tight text-ink">
            {title}
          </h1>
          {subtitle ? (
            <p className="truncate text-[12px] text-muted">{subtitle}</p>
          ) : null}
        </div>
      </div>

      {/* Wrapped rather than one rigid row: on a phone the actions drop below
          the title instead of squeezing it into a two-word ellipsis. */}
      {actions ? (
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          {actions}
        </div>
      ) : null}
    </div>
  );
}