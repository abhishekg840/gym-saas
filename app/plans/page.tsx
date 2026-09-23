'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Dumbbell, Plus, Trash2, ArrowLeft, Tag, Clock, IndianRupee } from 'lucide-react';
import Link from 'next/link';

interface Plan {
  id: string;
  name: string;
  duration_days: number;
  price: number;
  description: string;
}

export default function PlansPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [name, setName] = useState('');
  const [duration, setDuration] = useState('30');
  const [price, setPrice] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);

  async function fetchPlans() {
    const { data, error } = await supabase
      .from('plans')
      .select('*')
      .order('duration_days', { ascending: true });
    if (data) setPlans(data);
    if (error) console.error('Fetch error:', error.message);
  }

  useEffect(() => {
    fetchPlans();
  }, []);

  async function handleAddPlan(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const { error } = await supabase.from('plans').insert([
      {
        name: name.trim(),
        duration_days: parseInt(duration),
        price: parseFloat(price) || 0,
        description: description.trim(),
      },
    ]);

    if (!error) {
      setName('');
      setPrice('');
      setDescription('');
      fetchPlans();
    } else {
      alert(error.message);
    }
    setLoading(false);
  }

  async function handleDeletePlan(id: string, planName: string) {
    if (!confirm(`Are you sure you want to delete ${planName}?`)) return;
    const { error } = await supabase.from('plans').delete().eq('id', id);
    if (!error) {
      fetchPlans();
    } else {
      alert(error.message);
    }
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-white p-6 md:p-12">
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between border-b border-neutral-800 pb-6 mb-8 gap-4">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="p-2.5 bg-neutral-900 border border-neutral-800 hover:border-neutral-700 rounded-xl text-neutral-400 hover:text-white transition"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="bg-emerald-500/10 p-3 rounded-xl border border-emerald-500/20 text-emerald-400">
            <Tag className="w-7 h-7" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Membership Plans Engine</h1>
            <p className="text-sm text-neutral-400">Create, customize, and price gym membership packages</p>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Create Plan Form */}
        <div className="bg-neutral-900 border border-neutral-800 p-6 rounded-2xl h-fit">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Plus className="w-5 h-5 text-emerald-400" /> Add New Package
          </h2>
          <form onSubmit={handleAddPlan} className="space-y-4">
            <div>
              <label className="text-xs text-neutral-400 uppercase tracking-wider block mb-1">Plan Name</label>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. 3 Months Transformation"
                className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-emerald-500 text-white"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-neutral-400 uppercase tracking-wider block mb-1">Duration (Days)</label>
                <input
                  type="number"
                  required
                  min="1"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  placeholder="30"
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-emerald-500 text-white font-mono"
                />
              </div>
              <div>
                <label className="text-xs text-neutral-400 uppercase tracking-wider block mb-1">Fee (₹)</label>
                <input
                  type="number"
                  required
                  min="0"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="2500"
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-emerald-500 text-white font-mono"
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-neutral-400 uppercase tracking-wider block mb-1">Features / Description</label>
              <textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Cardio + Weights + Free Diet Consultation"
                className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-emerald-500 text-white resize-none"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-emerald-500 hover:bg-emerald-600 text-black font-semibold py-2.5 rounded-xl transition text-sm disabled:opacity-50"
            >
              {loading ? 'Creating...' : 'Save Plan'}
            </button>
          </form>
        </div>

        {/* Existing Plans Grid */}
        <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4 h-fit">
          {plans.length === 0 ? (
            <div className="col-span-2 bg-neutral-900 border border-neutral-800 p-8 rounded-2xl text-center text-neutral-500">
              No packages created yet. Use the form to add your first gym plan.
            </div>
          ) : (
            plans.map((plan) => (
              <div
                key={plan.id}
                className="bg-neutral-900 border border-neutral-800 hover:border-neutral-700 p-5 rounded-2xl flex flex-col justify-between transition shadow-lg relative group"
              >
                <div>
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="text-lg font-bold text-white">{plan.name}</h3>
                    <button
                      onClick={() => handleDeletePlan(plan.id, plan.name)}
                      className="text-neutral-500 hover:text-rose-400 p-1 rounded-lg transition"
                      title="Delete Plan"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <p className="text-xs text-neutral-400 mb-4 min-h-[32px]">{plan.description || 'Standard Access'}</p>
                </div>

                <div className="pt-4 border-t border-neutral-800 flex items-center justify-between">
                  <span className="flex items-center gap-1 text-xs text-neutral-400 font-mono">
                    <Clock className="w-3.5 h-3.5 text-emerald-400" />
                    {plan.duration_days} Days
                  </span>
                  <span className="flex items-center text-lg font-black text-emerald-400 font-mono">
                    <IndianRupee className="w-4 h-4" />
                    {plan.price.toLocaleString()}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}