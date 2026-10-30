'use client';

import Link from 'next/link';
import { Lock, ArrowLeft, MessageSquare, ShieldAlert } from 'lucide-react';

interface FeatureLockedScreenProps {
  featureName: string;
  featureKey: string;
  description?: string;
}

const SUPPORT_PHONE = '919569272339';

export default function FeatureLockedScreen({
  featureName,
  featureKey,
  description,
}: FeatureLockedScreenProps) {
  const waMsg = encodeURIComponent(
    `Hi Vyroniq Admin, I would like to unlock the "${featureName}" (${featureKey}) module for my gym subscription.`
  );

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl bg-white border border-slate-200/90 p-6 sm:p-8 shadow-xl text-center animate-in fade-in zoom-in-95 duration-150">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 border border-amber-200">
          <Lock className="h-7 w-7" />
        </div>

        <span className="inline-block rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-800 mb-2">
          Enterprise Module Locked
        </span>

        <h2 className="text-xl font-extrabold tracking-tight text-slate-900 mb-2">
          {featureName}
        </h2>

        <p className="text-xs text-slate-600 leading-relaxed mb-6">
          {description ||
            `This module is currently disabled or locked for your gym tier. To enable "${featureName}" for your staff and trainers, request an upgrade from your platform administrator.`}
        </p>

        <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 mb-6 text-left text-[11px] text-slate-500 font-mono">
          <p>Feature Key: <span className="font-bold text-slate-700">{featureKey}</span></p>
          <p>Access Status: <span className="font-bold text-amber-600">Restricted by Super Admin</span></p>
        </div>

        <div className="flex flex-col sm:flex-row gap-2.5 justify-center">
          <a
            href={`https://wa.me/${SUPPORT_PHONE}?text=${waMsg}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-emerald-500 transition"
          >
            <MessageSquare className="h-4 w-4" />
            Request Upgrade via WhatsApp
          </a>

          <Link
            href="/admin"
            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
          >
            <ArrowLeft className="h-4 w-4" />
            Return to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
