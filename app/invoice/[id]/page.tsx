'use client';

import { use, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Dumbbell, Printer, ArrowLeft, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';

interface InvoiceDetails {
  id: string;
  invoice_number: number;
  amount: number;
  payment_method: string;
  status: string;
  issued_at: string;
  members: {
    full_name: string;
    phone: string;
    email: string | null;
    membership_end: string;
    plans: {
      name: string;
    } | null;
  } | null;
}

export default function InvoiceReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const [invoice, setInvoice] = useState<InvoiceDetails | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadInvoice() {
      const { data, error } = await supabase
        .from('invoices')
        .select(`
          id,
          invoice_number,
          amount,
          payment_method,
          status,
          issued_at,
          members (
            full_name,
            phone,
            email,
            membership_end,
            plans (
              name
            )
          )
        `)
        .eq('id', resolvedParams.id)
        .maybeSingle();

      if (!error && data) {
        setInvoice(data as unknown as InvoiceDetails);
      }
      setLoading(false);
    }

    loadInvoice();
  }, [resolvedParams.id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-950 text-white flex items-center justify-center">
        <p className="text-neutral-400 animate-pulse">Generating Tax Receipt...</p>
      </div>
    );
  }

  if (!invoice || !invoice.members) {
    return (
      <div className="min-h-screen bg-neutral-950 text-white flex flex-col items-center justify-center p-4">
        <p className="text-rose-400 mb-4">Receipt record not found or expired.</p>
        <Link href="/" className="text-xs bg-neutral-900 border border-neutral-800 px-4 py-2 rounded-xl">
          Back to Command Center
        </Link>
      </div>
    );
  }

  const issueDate = new Date(invoice.issued_at).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 p-4 sm:p-10 flex flex-col items-center justify-center">
      {/* Action Controls - Hidden during Browser Print */}
      <div className="w-full max-w-lg flex items-center justify-between mb-4 print:hidden">
        <Link
          href="/"
          className="flex items-center gap-1.5 text-xs text-neutral-400 hover:text-white transition bg-neutral-900 border border-neutral-800 px-3 py-1.5 rounded-xl"
        >
          <ArrowLeft className="w-4 h-4" /> Dashboard
        </Link>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-1.5 text-xs font-semibold bg-emerald-500 hover:bg-emerald-600 text-black px-4 py-2 rounded-xl transition shadow-lg shadow-emerald-500/10"
        >
          <Printer className="w-4 h-4" /> Print / Save PDF
        </button>
      </div>

      {/* Bill Receipt Card */}
      <div className="w-full max-w-lg bg-neutral-900 border border-neutral-800 rounded-3xl p-8 shadow-2xl text-neutral-200 print:bg-white print:text-black print:border-none print:shadow-none print:p-0">
        <div className="flex items-start justify-between border-b border-neutral-800 print:border-neutral-200 pb-6 mb-6">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-emerald-500/10 print:bg-neutral-100 text-emerald-400 print:text-black rounded-2xl border border-emerald-500/20 print:border-none">
              <Dumbbell className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white print:text-black">GLITCH FIESTA GYM</h1>
              <p className="text-xs text-neutral-400 print:text-neutral-600">Official Membership Tax Receipt</p>
            </div>
          </div>
          <div className="text-right font-mono text-xs text-neutral-400 print:text-neutral-600">
            <p className="font-bold text-neutral-200 print:text-black">REC-#{invoice.invoice_number}</p>
            <p>{issueDate}</p>
          </div>
        </div>

        {/* Member & Status Summary */}
        <div className="grid grid-cols-2 gap-4 text-xs mb-6">
          <div>
            <span className="text-neutral-500 print:text-neutral-600 uppercase tracking-wider block mb-1">Billed To</span>
            <p className="font-bold text-white print:text-black text-sm">{invoice.members.full_name}</p>
            <p className="font-mono text-neutral-400 print:text-neutral-600">{invoice.members.phone}</p>
            {invoice.members.email && <p className="text-neutral-400 print:text-neutral-600">{invoice.members.email}</p>}
          </div>
          <div className="text-right">
            <span className="text-neutral-500 print:text-neutral-600 uppercase tracking-wider block mb-1">Payment Status</span>
            <span className="inline-flex items-center gap-1 text-emerald-400 print:text-emerald-700 font-bold bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20">
              <CheckCircle2 className="w-3.5 h-3.5" /> PAID
            </span>
            <p className="mt-1 text-neutral-400 print:text-neutral-600 font-mono">Via {invoice.payment_method}</p>
          </div>
        </div>

        {/* Itemized breakdown */}
        <div className="border border-neutral-800 print:border-neutral-200 rounded-2xl overflow-hidden mb-6">
          <table className="w-full text-left text-xs">
            <thead className="bg-neutral-950 print:bg-neutral-100 text-neutral-400 print:text-neutral-600 uppercase">
              <tr>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800 print:divide-neutral-200">
              <tr>
                <td className="px-4 py-3.5">
                  <p className="font-semibold text-white print:text-black">{invoice.members.plans?.name || 'Custom Fitness Package'}</p>
                  <p className="text-neutral-400 print:text-neutral-600">Access valid until: {invoice.members.membership_end}</p>
                </td>
                <td className="px-4 py-3.5 text-right font-mono font-bold text-white print:text-black">
                  ₹{invoice.amount.toLocaleString()}
                </td>
              </tr>
            </tbody>
            <tfoot className="bg-neutral-950/50 print:bg-neutral-50 font-bold">
              <tr>
                <td className="px-4 py-3 text-neutral-300 print:text-black">Total Paid</td>
                <td className="px-4 py-3 text-right text-emerald-400 print:text-black text-sm font-mono">
                  ₹{invoice.amount.toLocaleString()}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Footer info */}
        <div className="text-center border-t border-neutral-800 print:border-neutral-200 pt-4 text-[11px] text-neutral-500 print:text-neutral-600 space-y-1">
          <p>Thank you for training with us!</p>
          <p>This is a computer-generated digital receipt and requires no physical signature.</p>
        </div>
      </div>
    </div>
  );
}