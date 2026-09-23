'use client';

import { useEffect, useState, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { supabase } from '@/lib/supabase';
import { ShieldCheck, ShieldAlert, Dumbbell, RefreshCw, Camera, ArrowLeft, Volume2 } from 'lucide-react';
import Link from 'next/link';

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
  const [cameraError, setCameraError] = useState<string | null>(null);
  const isProcessingRef = useRef(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Initialize Audio Context on first interaction
  function getAudioContext() {
    if (!audioCtxRef.current) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioCtxRef.current = new AudioCtx();
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  }

  function playSound(type: 'success' | 'denied') {
    try {
      const ctx = getAudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === 'success') {
        // High upbeat 2-tone chime
        osc.type = 'sine';
        osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
        osc.frequency.setValueAtTime(880, ctx.currentTime + 0.1); // A5
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.4);
      } else {
        // Double warning buzz
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(150, ctx.currentTime);
        gain.gain.setValueAtTime(0.4, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.5);
      }
    } catch (e) {
      console.error('Audio playback error:', e);
    }
  }

  useEffect(() => {
    // Unlock audio context on any first touch/click anywhere on screen
    function unlockAudio() {
      getAudioContext();
      window.removeEventListener('click', unlockAudio);
      window.removeEventListener('touchstart', unlockAudio);
    }
    window.addEventListener('click', unlockAudio);
    window.addEventListener('touchstart', unlockAudio);

    const html5QrCode = new Html5Qrcode('qr-reader');
    scannerRef.current = html5QrCode;

    const config = {
      fps: 10,
      qrbox: { width: 250, height: 250 },
    };

    html5QrCode
      .start(
        { facingMode: 'environment' },
        config,
        async (decodedText) => {
          if (isProcessingRef.current) return;
          isProcessingRef.current = true;
          setVerifying(true);

          try {
            const rawJson = atob(decodedText);
            const payload = JSON.parse(rawJson);
            const { id, t, ph } = payload;

            const currentWindow = Math.floor(Date.now() / 30000);
            const isTimeValid = Math.abs(currentWindow - t) <= 1;

            if (!isTimeValid) {
              playSound('denied');
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

            const { data: member, error } = await supabase
              .from('members')
              .select('*')
              .eq('id', id)
              .maybeSingle();

            if (error || !member) {
              playSound('denied');
              setResult({
                allowed: false,
                name: 'Not Found',
                phone: ph,
                expiry: 'N/A',
                reason: 'Member record does not exist in database.',
              });
            } else {
              const isExpired = new Date(member.membership_end) < new Date();

              if (isExpired) {
                playSound('denied');
                setResult({
                  allowed: false,
                  name: member.full_name,
                  phone: member.phone,
                  expiry: member.membership_end,
                  reason: 'Membership expired! Fee renewal required.',
                });

                await supabase.from('attendances').insert([
                  { member_id: member.id, method: 'qr_geofence', status: 'blocked_expired' },
                ]);
              } else {
                playSound('success');
                setResult({
                  allowed: true,
                  name: member.full_name,
                  phone: member.phone,
                  expiry: member.membership_end,
                  reason: 'Access Approved. Welcome!',
                });

                await supabase.from('attendances').insert([
                  { member_id: member.id, method: 'qr_geofence', status: 'granted' },
                ]);
              }
            }
          } catch {
            playSound('denied');
            setResult({
              allowed: false,
              name: 'Invalid QR',
              phone: '',
              expiry: '',
              reason: 'Unrecognized QR code structure.',
            });
          } finally {
            setVerifying(false);
          }
        },
        () => {}
      )
      .catch((err) => {
        console.error('Camera startup error:', err);
        setCameraError('Camera access denied or device not found. Please allow camera permissions.');
      });

    return () => {
      window.removeEventListener('click', unlockAudio);
      window.removeEventListener('touchstart', unlockAudio);
      if (scannerRef.current && scannerRef.current.isScanning) {
        scannerRef.current.stop().catch(console.error);
      }
    };
  }, []);

  function resetScanner() {
    setResult(null);
    isProcessingRef.current = false;
  }

  return (
    <div 
      onClick={() => getAudioContext()} 
      className="min-h-screen bg-neutral-950 text-white flex flex-col items-center justify-center p-4 cursor-pointer"
    >
      {/* Header */}
      <div className="flex items-center justify-between w-full max-w-md mb-6">
        <Link
          href="/"
          className="flex items-center gap-1.5 text-xs text-neutral-400 hover:text-white transition bg-neutral-900 border border-neutral-800 px-3 py-1.5 rounded-xl"
        >
          <ArrowLeft className="w-4 h-4" /> Dashboard
        </Link>
        <div className="flex items-center gap-2">
          <div className="p-2 bg-emerald-500/10 text-emerald-400 rounded-xl border border-emerald-500/20">
            <Dumbbell className="w-5 h-5" />
          </div>
          <h1 className="text-base font-bold tracking-tight">Kiosk Scanner</h1>
        </div>
      </div>

      <div className="w-full max-w-md bg-neutral-900 border border-neutral-800 rounded-3xl p-6 shadow-2xl relative">
        {result && (
          <div
            className={`absolute inset-0 z-20 rounded-3xl p-6 flex flex-col items-center justify-center text-center backdrop-blur-md ${
              result.allowed ? 'bg-emerald-950/95 text-emerald-100' : 'bg-rose-950/95 text-rose-100'
            }`}
          >
            {result.allowed ? (
              <ShieldCheck className="w-20 h-20 text-emerald-400 mb-3" />
            ) : (
              <ShieldAlert className="w-20 h-20 text-rose-400 mb-3" />
            )}

            <h2 className="text-2xl font-black mb-1">
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
              onClick={(e) => {
                e.stopPropagation();
                resetScanner();
              }}
              className="w-full bg-white text-black font-bold py-3 rounded-xl transition hover:bg-neutral-200 flex items-center justify-center gap-2"
            >
              <RefreshCw className="w-4 h-4" /> Scan Next
            </button>
          </div>
        )}

        {cameraError ? (
          <div className="p-6 text-center text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-2xl">
            <Camera className="w-10 h-10 mx-auto mb-2 text-rose-400" />
            <p className="font-medium text-sm">{cameraError}</p>
            <p className="text-xs text-neutral-400 mt-2">
              Browser address bar mein camera allow karein aur reload karein.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-neutral-800 bg-black min-h-[300px] flex items-center justify-center">
            <div id="qr-reader" className="w-full"></div>
          </div>
        )}

        <div className="mt-4 flex items-center justify-between text-xs text-neutral-500">
          <span className="flex items-center gap-1">
            <Volume2 className="w-3.5 h-3.5 text-emerald-400" /> Audio Chime Active
          </span>
          {verifying && <span className="text-emerald-400 animate-pulse">Verifying...</span>}
        </div>
      </div>
    </div>
  );
}