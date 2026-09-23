'use client';

import { use, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Dumbbell } from 'lucide-react';
import Link from 'next/link';

interface GymInfo {
  id: string;
  name: string;
  slug: string;
  primary_color: string;
}

export default function WhiteLabelGymPortal({ params }: { params: Promise<{ slug: string }> }) {
  const resolvedParams = use(params);
  const [gym, setGym] = useState<GymInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from('gyms')
      .select('*')
      .eq('slug', resolvedParams.slug)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setGym(data);
        setLoading(false);
      });
  }, [resolvedParams.slug]);

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-950 text-white flex items-center justify-center">
        <p className="text-neutral-400 animate-pulse">Loading Gym Experience...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-white p-6 flex flex-col items-center justify-center">
      <div className="w-full max-w-md bg-neutral-900 border border-neutral-800 rounded-3xl p-8 text-center shadow-2xl">
        <div 
          className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 border"
          style={{ 
            backgroundColor: `${gym?.primary_color || '#10b981'}15`,
            borderColor: `${gym?.primary_color || '#10b981'}30`,
            color: gym?.primary_color || '#10b981'
          }}
        >
          <Dumbbell className="w-8 h-8" />
        </div>

        <h1 className="text-2xl font-bold">{gym?.name || `${resolvedParams.slug.toUpperCase()} Fitness`}</h1>
        <p className="text-xs text-neutral-400 mt-1 mb-8">Official Member & Gate Pass Access Portal</p>

        <div className="space-y-3">
          <Link
            href="/member"
            className="block w-full py-3 rounded-xl font-bold text-black transition"
            style={{ backgroundColor: gym?.primary_color || '#10b981' }}
          >
            Open My Dynamic Pass
          </Link>
          <Link
            href="/scan"
            className="block w-full py-3 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white font-semibold transition text-sm border border-neutral-700"
          >
            Reception Kiosk Scanner
          </Link>
        </div>
      </div>
    </div>
  );
}