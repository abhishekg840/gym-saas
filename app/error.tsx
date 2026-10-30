'use client';

import { useEffect } from 'react';
import { AlertTriangle, RotateCw, ArrowLeft } from 'lucide-react';

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log error to console for inspection
    console.error('Unhandled app-level error:', error);
  }, [error]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-800 p-6 sm:p-8 shadow-2xl text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-rose-500/10 text-rose-500 border border-rose-500/20">
          <AlertTriangle className="h-7 w-7" />
        </div>

        <h2 className="text-xl font-bold tracking-tight text-white mb-2">
          Something went wrong
        </h2>
        <p className="text-xs text-slate-400 mb-5">
          An unexpected error occurred while rendering this component.
        </p>

        {/* Technical Debug Box */}
        <div className="mb-6 rounded-xl bg-slate-950 p-4 border border-slate-800 text-left overflow-x-auto">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-rose-400 mb-1">
            Error Details
          </div>
          <div className="font-mono text-xs text-slate-300 break-words">
            {error?.message || 'Unknown runtime exception'}
          </div>
          {error?.digest && (
            <div className="font-mono text-[10px] text-slate-500 mt-2">
              Digest: {error.digest}
            </div>
          )}
          {error?.stack && (
            <details className="mt-3">
              <summary className="text-[10px] text-slate-500 cursor-pointer hover:text-slate-400">
                View Stack Trace
              </summary>
              <pre className="mt-2 text-[10px] text-slate-400 font-mono whitespace-pre-wrap max-h-40 overflow-y-auto">
                {error.stack}
              </pre>
            </details>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            type="button"
            onClick={() => reset()}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-emerald-500 transition shadow-sm"
          >
            <RotateCw className="h-4 w-4" /> Try Again
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 transition"
          >
            Reload Page
          </button>
          <button
            type="button"
            onClick={() => {
              if (window.history.length > 1) {
                window.history.back();
              } else {
                window.location.href = '/admin';
              }
            }}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-800 bg-slate-900 px-4 py-2.5 text-xs font-semibold text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
          >
            <ArrowLeft className="h-4 w-4" /> Go Back
          </button>
        </div>
      </div>
    </div>
  );
}

