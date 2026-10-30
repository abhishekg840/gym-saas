'use client';

import { useEffect } from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Global application error:', error);
  }, [error]);

  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4 font-sans">
        <div className="w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-800 p-8 shadow-2xl text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-rose-500/10 text-rose-500 border border-rose-500/20">
            <AlertTriangle className="h-7 w-7" />
          </div>
          <h2 className="text-xl font-bold tracking-tight text-white mb-2">Application Error</h2>
          <p className="text-xs text-slate-400 mb-5">
            A critical error prevented the application from rendering.
          </p>
          <div className="mb-6 rounded-xl bg-slate-950 p-4 border border-slate-800 text-left overflow-x-auto">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-rose-400 mb-1">
              Error Details
            </div>
            <div className="font-mono text-xs text-slate-300 break-words">
              {error?.message || 'Unknown application error'}
            </div>
          </div>
          <button
            type="button"
            onClick={() => reset()}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-semibold text-white hover:bg-emerald-500 transition"
          >
            <RotateCw className="h-4 w-4" /> Try Again
          </button>
        </div>
      </body>
    </html>
  );
}

