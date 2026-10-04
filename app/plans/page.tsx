'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Plus, Trash2, Tag, Clock, IndianRupee } from 'lucide-react';
import PageHeader from '@/components/page-header';

interface Plan {
  id: string;
  name: string;
  duration_days: number;
  price: number;
  description: string;
}

/**
 * Membership Plans Engine — light Vyroniq surface.
 *
 * Reads and writes are unchanged (same `plans` table, same insert/delete, same
 * confirm-before-delete). Only the presentation moved onto the shared tokens.
 */

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
    // Load-on-mount, not render-derived state: the setStates land after the await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
    <div className="vy-page vy-noscroll">
      <div className="vy-shell">
        <PageHeader
          icon={<Tag className="h-5 w-5" />}
          title="Membership Plans"
          subtitle="Create, customise and price the packages you sell at the desk"
        />

        <div className="grid grid-cols-1 gap-5 pb-16 lg:grid-cols-3">
          {/* Create plan — sticky on a wide screen so the form stays reachable
              while scrolling a long list of existing packages. */}
          <section className="vy-card h-fit lg:sticky lg:top-20">
            <div className="vy-card-head">
              <div className="flex items-center gap-2">
                <Plus className="h-3.5 w-3.5 text-brand" />
                <h2 className="vy-card-title">Add new package</h2>
              </div>
            </div>

            <form onSubmit={handleAddPlan} className="vy-card-body space-y-4">
              <div>
                <label className="vy-label" htmlFor="plan-name">
                  Package name
                </label>
                <input
                  id="plan-name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Gold Monthly"
                  className="vy-input"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="vy-label" htmlFor="plan-duration">
                    Duration (days)
                  </label>
                  <input
                    id="plan-duration"
                    type="number"
                    required
                    min="1"
                    value={duration}
                    onChange={(e) => setDuration(e.target.value)}
                    className="vy-input"
                  />
                </div>
                <div>
                  <label className="vy-label" htmlFor="plan-price">
                    Fee (₹)
                  </label>
                  <input
                    id="plan-price"
                    type="number"
                    required
                    min="0"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder="2500"
                    className="vy-input font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="vy-label" htmlFor="plan-description">
                  Features / description
                </label>
                <textarea
                  id="plan-description"
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Cardio + Weights + Free Diet Consultation"
                  className="vy-textarea resize-none"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="vy-btn vy-btn-lg vy-btn-brand w-full"
              >
                {loading ? 'Creating…' : 'Save plan'}
              </button>
            </form>
          </section>
{/* Existing plans — price is the headline, because that is what the
              desk quotes from memory. */}
          <section className="lg:col-span-2">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {plans.length === 0 ? (
                <div className="vy-empty sm:col-span-2">
                  <Tag className="mx-auto mb-3 h-8 w-8 text-faint" />
                  <p className="text-sm font-semibold text-ink">No packages yet</p>
                  <p className="mx-auto mt-1 max-w-xs text-xs text-muted">
                    Use the form to add your first gym plan — it appears on the
                    enrolment form and in the conversion dialog straight away.
                  </p>
                </div>
              ) : (
                plans.map((plan) => (
                  <article
                    key={plan.id}
                    className="vy-card flex flex-col justify-between p-5 transition hover:border-line-strong"
                  >
                    <div>
                      <div className="mb-2 flex items-start justify-between gap-2">
                        <h3 className="text-[15px] font-semibold tracking-tight text-ink">
                          {plan.name}
                        </h3>
                        <button
                          onClick={() => handleDeletePlan(plan.id, plan.name)}
                          className="vy-icon-btn-sm -mr-1 -mt-1 hover:bg-rose-50 hover:text-rose-600"
                          title="Delete plan"
                          aria-label={`Delete ${plan.name}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <p className="mb-4 min-h-[32px] text-[12px] leading-relaxed text-muted">
                        {plan.description || 'Standard Access'}
                      </p>
                    </div>

                    <div className="flex items-center justify-between border-t border-line pt-4">
                      <span className="flex items-center gap-1.5 text-[12px] text-muted">
                        <Clock className="h-3.5 w-3.5 text-brand" />
                        {plan.duration_days} days
                      </span>
                      <span className="flex items-center text-[17px] font-semibold tabular-nums text-ink">
                        <IndianRupee className="h-4 w-4 text-emerald-600" />
                        {plan.price.toLocaleString('en-IN')}
                      </span>
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
