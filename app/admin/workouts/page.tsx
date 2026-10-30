'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Activity,
  Plus,
  Search,
  RotateCw,
  Dumbbell,
  Users,
  CheckCircle,
  Calendar,
  Layers,
  ChevronRight,
  Sparkles,
  Trash2,
  X,
  Send,
  Timer
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { readSession, type GymSession } from '@/lib/session';
import { useFeatureFlags } from '@/lib/use-feature-flags';
import FeatureLockedScreen from '@/components/feature-locked-screen';

interface Exercise {
  name: string;
  muscle: string;
  sets: number;
  reps: string;
  rest_sec: number;
}

interface WorkoutPlan {
  id: string;
  tenant_id: string;
  plan_name: string;
  split_type: string;
  target_goal: string;
  days_per_week: number;
  exercises: Exercise[];
  assigned_member_id?: string | null;
  assigned_member_name?: string | null;
  created_at: string;
}

interface MemberOption {
  id: string;
  full_name: string;
  phone: string;
}

export default function AdminWorkoutsPage() {
  const router = useRouter();
  const [session, setSession] = useState<GymSession | null>(null);
  const { isEnabled, loading: flagsLoading } = useFeatureFlags();

  const [plans, setPlans] = useState<WorkoutPlan[]>([]);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Builder Modal State
  const [showModal, setShowModal] = useState(false);
  const [planName, setPlanName] = useState('');
  const [splitType, setSplitType] = useState('Push / Pull / Legs');
  const [targetGoal, setTargetGoal] = useState('Hypertrophy & Muscle Building');
  const [daysPerWeek, setDaysPerWeek] = useState(4);
  const [assignedMemberId, setAssignedMemberId] = useState('');
  const [exercises, setExercises] = useState<Exercise[]>([
    { name: 'Barbell Bench Press', muscle: 'Chest', sets: 4, reps: '8-10', rest_sec: 90 },
    { name: 'Overhead Dumbbell Press', muscle: 'Shoulders', sets: 3, reps: '10-12', rest_sec: 60 },
  ]);
  const [saveBusy, setSaveBusy] = useState(false);

  useEffect(() => {
    const s = readSession();
    if (!s) {
      router.push('/login');
      return;
    }
    setSession(s);
  }, [router]);

  const tenantId = session?.tenantId;

  const loadData = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      // 1. Load workout plans
      const pRes = await fetch(`/api/admin/workouts?tenant_id=${tenantId}`);
      const pData = await pRes.json();
      if (pData.ok) {
        setPlans(pData.plans ?? []);
      }

      // 2. Load members for assignment
      const { data: mData } = await supabase
        .from('members')
        .select('id, full_name, phone')
        .eq('tenant_id', tenantId)
        .eq('status', 'active')
        .limit(100);

      setMembers((mData ?? []) as MemberOption[]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    if (tenantId) void loadData();
  }, [tenantId, loadData]);

  // Gate Check
  if (!flagsLoading && !isEnabled('workout_builder')) {
    return (
      <FeatureLockedScreen
        featureName="Workout Routine & Exercise Builder"
        featureKey="workout_builder"
        description="The Workout Routine Builder is currently locked. Upgrade your subscription tier to build custom Push/Pull/Legs splits and assign training cards to gym members."
      />
    );
  }

  const handleAddExerciseRow = () => {
    setExercises((prev) => [
      ...prev,
      { name: '', muscle: 'Full Body', sets: 3, reps: '10-12', rest_sec: 60 },
    ]);
  };

  const handleRemoveExerciseRow = (index: number) => {
    setExercises((prev) => prev.filter((_, i) => i !== index));
  };

  const handleExerciseChange = (index: number, field: keyof Exercise, value: any) => {
    setExercises((prev) =>
      prev.map((ex, i) => (i === index ? { ...ex, [field]: value } : ex))
    );
  };

  const handleSavePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId || !planName) return;
    setSaveBusy(true);

    const matchedMember = members.find((m) => m.id === assignedMemberId);

    try {
      const res = await fetch('/api/admin/workouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant_id: tenantId,
          plan_name: planName,
          split_type: splitType,
          target_goal: targetGoal,
          days_per_week: daysPerWeek,
          exercises,
          assigned_member_id: assignedMemberId || null,
          assigned_member_name: matchedMember ? matchedMember.full_name : null,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to save workout plan.');

      setShowModal(false);
      setPlanName('');
      void loadData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error creating plan.');
    } finally {
      setSaveBusy(false);
    }
  };

  const filteredPlans = plans.filter((p) => {
    const q = search.toLowerCase().trim();
    return (
      p.plan_name.toLowerCase().includes(q) ||
      p.split_type.toLowerCase().includes(q) ||
      (p.assigned_member_name && p.assigned_member_name.toLowerCase().includes(q))
    );
  });

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900 font-sans antialiased">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <Link
              href="/admin"
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-white shadow-sm hover:bg-slate-800 transition"
              title="Return to Dashboard"
            >
              <Dumbbell className="h-4 w-4" />
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold text-slate-900">Workout Routine &amp; Split Builder</h1>
                <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700 border border-blue-200">
                  Builder Active
                </span>
              </div>
              <p className="text-[11px] text-slate-500">Design Push/Pull/Legs splits and assign training routines to members</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => void loadData()}
              disabled={loading}
              className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50 transition shadow-xs"
            >
              <RotateCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={() => setShowModal(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-emerald-500 transition"
            >
              <Plus className="h-4 w-4" />
              Build New Routine
            </button>
          </div>
        </div>
      </header>

      {/* Main Body */}
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 space-y-6">
        {/* Search & Stats */}
        <div className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-sm flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search routines or assigned member..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 py-1.5 text-xs text-slate-900 placeholder-slate-400 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-3 text-xs text-slate-500">
            <span>{plans.length} Routines Available</span>
            <span>·</span>
            <span>{members.length} Enrolled Members</span>
          </div>
        </div>

        {/* Routines Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {loading ? (
            <div className="col-span-full py-12 text-center text-slate-400">
              <RotateCw className="mx-auto h-6 w-6 animate-spin text-slate-300 mb-2" />
              Loading routines...
            </div>
          ) : filteredPlans.length === 0 ? (
            <div className="col-span-full py-12 text-center text-slate-500">
              <Dumbbell className="mx-auto h-8 w-8 text-slate-300 mb-2" />
              No workout routines found. Build your first split routine above!
            </div>
          ) : (
            filteredPlans.map((p) => (
              <div
                key={p.id}
                className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm hover:border-slate-300 transition flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <span className="rounded-md bg-blue-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-blue-700">
                      {p.split_type}
                    </span>
                    <span className="text-[11px] font-semibold text-slate-500">{p.days_per_week} Days/Week</span>
                  </div>

                  <h3 className="text-base font-bold text-slate-900 mt-2">{p.plan_name}</h3>
                  <p className="text-xs text-slate-500 mt-0.5">{p.target_goal}</p>

                  {p.assigned_member_name && (
                    <div className="mt-3 rounded-lg bg-emerald-50 border border-emerald-200 p-2 text-xs font-semibold text-emerald-800 flex items-center gap-1.5">
                      <Users className="h-3.5 w-3.5 text-emerald-600" />
                      Assigned to: {p.assigned_member_name}
                    </div>
                  )}

                  {/* Exercises List */}
                  <div className="mt-4 pt-4 border-t border-slate-100 space-y-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Exercise Breakdown ({p.exercises?.length || 0})
                    </span>
                    <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                      {(p.exercises || []).map((ex, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs text-slate-800"
                        >
                          <div>
                            <p className="font-semibold">{ex.name}</p>
                            <span className="text-[10px] text-slate-400">{ex.muscle}</span>
                          </div>
                          <span className="font-mono font-bold text-[11px] text-slate-600">
                            {ex.sets} × {ex.reps}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                  <span className="text-[10px] text-slate-400 font-mono">ID: {p.id.slice(0, 8)}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setPlanName(`${p.plan_name} (Copy)`);
                      setSplitType(p.split_type);
                      setTargetGoal(p.target_goal);
                      setDaysPerWeek(p.days_per_week);
                      setExercises(p.exercises || []);
                      setShowModal(true);
                    }}
                    className="text-xs font-semibold text-emerald-600 hover:text-emerald-700 transition"
                  >
                    Duplicate &amp; Assign →
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </main>

      {/* Routine Builder Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="relative w-full max-w-lg rounded-2xl bg-white shadow-2xl border border-slate-200 p-6 animate-in fade-in zoom-in-95 duration-150">
            <button
              onClick={() => setShowModal(false)}
              className="absolute right-4 top-4 rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-5 w-5" />
            </button>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Activity className="h-5 w-5 text-blue-600" />
              Build &amp; Assign Training Routine
            </h3>
            <p className="text-xs text-slate-500 mt-1">Configure split sets and assign to an active gym member.</p>

            <form onSubmit={handleSavePlan} className="mt-5 space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Routine / Plan Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 6-Day PPL Hypertrophy Protocol"
                  value={planName}
                  onChange={(e) => setPlanName(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Split Type</label>
                  <select
                    value={splitType}
                    onChange={(e) => setSplitType(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 focus:outline-none"
                  >
                    <option value="Push / Pull / Legs">Push / Pull / Legs (PPL)</option>
                    <option value="Upper / Lower">Upper / Lower Split</option>
                    <option value="Full Body 3-Day">Full Body 3-Day</option>
                    <option value="Cardio & HIIT">Cardio &amp; Core HIIT</option>
                    <option value="Custom Split">Custom Split</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Days Per Week</label>
                  <input
                    type="number"
                    min={1}
                    max={7}
                    value={daysPerWeek}
                    onChange={(e) => setDaysPerWeek(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Assign to Member (Optional)</label>
                <select
                  value={assignedMemberId}
                  onChange={(e) => setAssignedMemberId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 focus:outline-none"
                >
                  <option value="">-- Template Routine (No Specific Member) --</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.full_name} ({m.phone})
                    </option>
                  ))}
                </select>
              </div>

              {/* Exercises List Builder */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="font-semibold text-slate-700">Exercises in Routine</label>
                  <button
                    type="button"
                    onClick={handleAddExerciseRow}
                    className="text-xs font-bold text-emerald-600 hover:text-emerald-700"
                  >
                    + Add Exercise
                  </button>
                </div>

                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {exercises.map((ex, i) => (
                    <div key={i} className="flex items-center gap-1.5 bg-slate-50 p-2 rounded-lg border border-slate-200">
                      <input
                        type="text"
                        placeholder="Exercise Name"
                        value={ex.name}
                        onChange={(e) => handleExerciseChange(i, 'name', e.target.value)}
                        className="flex-1 rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 focus:outline-none"
                      />
                      <input
                        type="number"
                        placeholder="Sets"
                        value={ex.sets}
                        onChange={(e) => handleExerciseChange(i, 'sets', Number(e.target.value))}
                        className="w-14 rounded border border-slate-200 bg-white px-1.5 py-1 text-xs text-center"
                      />
                      <input
                        type="text"
                        placeholder="Reps"
                        value={ex.reps}
                        onChange={(e) => handleExerciseChange(i, 'reps', e.target.value)}
                        className="w-16 rounded border border-slate-200 bg-white px-1.5 py-1 text-xs text-center"
                      />
                      <button
                        type="button"
                        onClick={() => handleRemoveExerciseRow(i)}
                        className="text-slate-400 hover:text-rose-600 p-1"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={saveBusy}
                  className="w-full rounded-xl bg-emerald-600 py-2.5 font-bold text-white shadow-md hover:bg-emerald-500 transition disabled:opacity-50"
                >
                  {saveBusy ? 'Saving Routine...' : 'Save & Assign Routine'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

