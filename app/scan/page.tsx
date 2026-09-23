'use client';

import { useEffect, useState, useRef } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { supabase } from '@/lib/supabase';
import { ShieldCheck, ShieldAlert, Dumbbell, RefreshCw, Volume2 } from 'lucide-react';

interface VerificationResult {
  allowed: boolean;
  name: string;
  phone: string;
  expiry: string;
  reason: string;
}

export default function GymScanner() {
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [verifying, setVerifying] = useState(false);
  const isProcessingRef = useRef(false);

  useEffect(() => {
    const scanner = new Html5QrcodeScanner(
      'reader',
      {
        fps: 10,
        qrbox: { width: 250, height: 250 },
        aspectRatio: 1.0,
      },
      false
    );

    scanner.render(onScanSuccess, onScanFailure);

    function onScanFailure() {
      // Quietly ignore scan failures while viewfinder is searching
    }

    async function onScanSuccess(decodedText: string) {
      if (isProcessingRef.current) return;
      isProcessingRef.current = true;
      setVerifying(true);

      try {
        // 1. Decode base64 payload
        const rawJson = atob(decodedText);
        const payload = JSON.parse(rawJson);
        const { id, t, ph } = payload;

        // 2. Validate TOTP time window (allows max 1 window drift)
        const currentWindow = Math.floor(Date.now() / 30000);
        const isTimeValid = Math.abs(currentWindow - t) <= 1;

        if (!isTimeValid) {
          setResult({
            allowed: false,
            name: 'Unknown Member',
            phone: ph || 'N/A',
            expiry: 'N/A',
            reason: 'Expired QR Code! Screenshots are not allowed.',
          });
          setVerifying(false);
          return;
        }

        // 3. Query Database for real-time validity
        const { data: member, error } = await supabase
          .from('members')
          .select('*')
          .eq('id', id)
          .maybeSingle();

        if (error || !member) {
          setResult({
            allowed: false,
            name: 'Not Found',
            phone: ph,
            expiry: 'N/A',
            reason: 'Member record does not exist.',
          });
        } else {
          const isExpired = new Date(member.membership_end) < new Date();

          if (isExpired) {
            setResult({
              allowed: false,
              name: member.full_name,
              phone: member.phone,
              expiry: member.membership_end,
              reason: 'Membership expired! Please pay fee to enter.',
            });

            // Log rejected attendance
            await supabase.from('attendances').insert([
              {
                member_id: member.id,
                method: 'qr_geofence',
                status: 'blocked_expired',
              },
            ]);
          } else {
            setResult({
              allowed: true,
              name: member.full_name,
              phone: member.phone,
              expiry: member.membership_end,
              reason: 'Access Approved. Welcome!',
            });

            // Log successful attendance
            await supabase.from('attendances').insert([
              {
                member_id: member.id,
                method: 'qr_geofence',
                status: 'granted',
              },
            ]);
          }
        }
      } catch {
        setResult({
          allowed: false,
          name: 'Invalid QR',
          phone: '',
          expiry: '',
          reason: 'Unrecognized QR code format.',
        });
      } finally {
        setVerifying(false);
      }
    }

    return () => {
      scanner.clear().catch(console.error);
    };
  }, []);

  function resetScanner() {
    setResult(null);
    isProcessingRef.current = false;
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-white flex flex-col items-center justify-center p-4">
      {/* Header */}
      <div className="flex items-center gap-2 mb-6">
        <div className="p-2 bg-emerald-500/10 text-emerald-400 rounded-xl border border-emerald-500/20">
          <Dumbbell className="w-6 h-6" />
        </div>
        <h1 className="text-xl font-bold tracking-tight">Kiosk Access Terminal</h1>
      </div>

      <div className="w-full max-w-md bg-neutral-900 border border-neutral-800 rounded-3xl p-6 shadow-2xl relative">
        {/* Verification Status Overlay */}
        {result && (
          <div
            className={`absolute inset-0 z-20 rounded-3xl p-6 flex flex-col items-center justify-center text-center backdrop-blur-md ${
              result.allowed ? 'bg-emerald-950/95 text-emerald-100' : 'bg-rose-950/95 text-rose-100'
            }`}
          >
            {result.allowed ? (
              <ShieldCheck className="w-20 h-20 text-emerald-400 mb-3 animate-bounce" />
            ) : (
              <ShieldAlert className="w-20 h-20 text-rose-400 mb-3 animate-pulse" />
            )}

            <h2 className="text-3xl font-black mb-1">
              {result.allowed ? 'ACCESS GRANTED' : 'ACCESS DENIED'}
            </h2>
            <p className="text-sm font-semibold opacity-90 mb-4">{result.reason}</p>

            <div className="bg-black/40 border border-white/10 rounded-2xl p-4 w-full text-left space-y-2 mb-6 text-sm">
              <div className="flex justify-between">
                <span className="opacity-70">Member:</span>
                <span className="font-bold text-white">{result.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="opacity-70">Phone:</span>
                <span className="font-mono text-white">{result.phone}</span>
              </div>
              <div className="flex justify-between">
                <span className="opacity-70">Expiry Date:</span>
                <span className="font-semibold text-white">{result.expiry}</span>
              </div>
            </div>

            <button
              onClick={resetScanner}
              className="w-full bg-white text-black font-bold py-3 rounded-xl transition hover:bg-neutral-200 flex items-center justify-center gap-2"
            >
              <RefreshCw className="w-4 h-4" /> Scan Next Member
            </button>
          </div>
        )}

        {/* Camera Viewfinder */}
        <div className="overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-950">
          <div id="reader" className="w-full"></div>
        </div>

        {verifying && (
          <p className="text-center text-xs text-neutral-400 mt-4 animate-pulse">
            Verifying token with secure database...
          </p>
        )}

        <div className="mt-4 flex items-center justify-between text-xs text-neutral-500">
          <span>Camera Access: Active</span>
          <span className="flex items-center gap-1">
            <Volume2 className="w-3.5 h-3.5" /> Auto-Logging Enabled
          </span>
        </div>
      </div>
    </div>
  );
}