'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Sparkles,
  Plus,
  Search,
  RotateCw,
  Dumbbell,
  Users,
  Flame,
  Utensils,
  Share2,
  Trash2,
  X,
  MessageSquare,
  ChevronRight,
  Send,
  PieChart
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { readSession, type GymSession } from '@/lib/session';
import { waLink } from '@/lib/whatsapp';
import { useFeatureFlags } from '@/lib/use-feature-flags';
import FeatureLockedScreen from '@/components/feature-locked-screen';

interface MealItem {
  meal_name: string;
  food_items: string;
  calories: number;
  protein: number;
}

interface DietPlan {
  id: string;
  tenant_id: string;
  plan_name: string;
  goal: string;
  target_calories: number;
  target_protein_g: number;
  target_carbs_g: number;
  target_fats_g: number;
  meals: MealItem[];
  assigned_member_id?: string | null;
  assigned_member_name?: string | null;
  assigned_member_phone?: string | null;
  created_at: string;
}

interface MemberOption {
  id: string;
  full_name: string;
  phone: string;
}

export default function AdminDietPage() {
  const router = useRouter();
  const [session, setSession] = useState<GymSession | null>(null);
  const { isEnabled, loading: flagsLoading } = useFeatureFlags();

  const [plans, setPlans] = useState<DietPlan[]>([]);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Builder Modal State
  const [showModal, setShowModal] = useState(false);
  const [planName, setPlanName] = useState('');
  const [goal, setGoal] = useState('Muscle Gain');
  const [targetCalories, setTargetCalories] = useState(2200);
  const [targetProtein, setTargetProtein] = useState(160);
  const [targetCarbs, setTargetCarbs] = useState(220);
  const [targetFats, setTargetFats] = useState(65);
  const [assignedMemberId, setAssignedMemberId] = useState('');
  const [meals, setMeals] = useState<MealItem[]>([
    { meal_name: 'Breakfast', food_items: '4 Whole Eggs, 50g Oats with Milk, 1 Banana', calories: 550, protein: 32 },
    { meal_name: 'Lunch', food_items: '180g Chicken Breast / Paneer, 1 Cup Brown Rice, Veggies', calories: 650, protein: 42 },
    { meal_name: 'Snack / Pre-Workout', food_items: '1 Scoop Whey Protein + 2 Bread with Peanut Butter', calories: 350, protein: 30 },
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
      const dRes = await fetch(`/api/admin/diet?tenant_id=${tenantId}`);
      const dData = await dRes.json();
      if (dData.ok) {
        setPlans(dData.plans ?? []);
      }

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
  if (!flagsLoading && !isEnabled('diet_planner')) {
    return (
      <FeatureLockedScreen
        featureName="Diet & Nutrition Planner Engine"
        featureKey="diet_planner"
        description="The Diet & Nutrition Planner is currently locked. Upgrade your subscription tier to prescribe custom macro plans, meal charts, and share WhatsApp diet sheets with members."
      />
    );
  }

  const handleAddMealRow = () => {
    setMeals((prev) => [
      ...prev,
      { meal_name: 'Dinner', food_items: 'Salad with Grilled Chicken / Tofu', calories: 450, protein: 35 },
    ]);
  };

  const handleRemoveMealRow = (index: number) => {
    setMeals((prev) => prev.filter((_, i) => i !== index));
  };

  const handleMealChange = (index: number, field: keyof MealItem, value: any) => {
    setMeals((prev) =>
      prev.map((m, i) => (i === index ? { ...m, [field]: value } : m))
    );
  };

  const handleSavePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId || !planName) return;
    setSaveBusy(true);

    const matchedMember = members.find((m) => m.id === assignedMemberId);

    try {
      const res = await fetch('/api/admin/diet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant_id: tenantId,
          plan_name: planName,
          goal,
          target_calories: targetCalories,
          target_protein_g: targetProtein,
          target_carbs_g: targetCarbs,
          target_fats_g: targetFats,
          meals,
          assigned_member_id: assignedMemberId || null,
          assigned_member_name: matchedMember ? matchedMember.full_name : null,
          assigned_member_phone: matchedMember ? matchedMember.phone : null,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to save diet plan.');

      setShowModal(false);
      setPlanName('');
      void loadData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error creating diet plan.');
    } finally {
      setSaveBusy(false);
    }
  };

  const handleShareWhatsApp = (plan: DietPlan) => {
    const gymName = session?.tenantName || 'Gym';
    const memberName = plan.assigned_member_name || 'Champion';
    const phone = plan.assigned_member_phone || '';

    const mealBreakdown = (plan.meals || [])
      .map((m, i) => `*Meal ${i + 1} (${m.meal_name}):*\n• ${m.food_items} (~${m.calories} kcal, ${m.protein}g protein)`)
      .join('\n\n');

    const msg = `*NUTRITION & MEAL PLAN — ${gymName.toUpperCase()}*\n\nHello ${memberName}!\nHere is your customized nutrition protocol for *${plan.goal.toUpperCase()}*:\n\n*DAILY TARGETS:*\n• Calories: ${plan.target_calories} kcal\n• Protein: ${plan.target_protein_g}g\n• Carbs: ${plan.target_carbs_g}g\n• Healthy Fats: ${plan.target_fats_g}g\n\n${mealBreakdown}\n\nStay consistent and hit your hydration goal (3-4L water/day)!`;

    if (phone) {
      window.open(waLink(phone, msg), '_blank');
    } else {
      window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
    }
  };

  const filteredPlans = plans.filter((p) => {
    const q = search.toLowerCase().trim();
    return (
      p.plan_name.toLowerCase().includes(q) ||
      p.goal.toLowerCase().includes(q) ||
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
                <h1 className="text-base font-bold text-slate-900">Diet &amp; Nutrition Planner</h1>
                <span className="rounded-full bg-purple-50 px-2 py-0.5 text-[10px] font-bold text-purple-700 border border-purple-200">
                  Nutrition Engine Active
                </span>
              </div>
              <p className="text-[11px] text-slate-500">Prescribe macro meal plans and share WhatsApp diet sheets with members</p>
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
              Build Diet Plan
            </button>
          </div>
        </div>
      </header>

      {/* Main Body */}
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 space-y-6">
        {/* Search */}
        <div className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-sm flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search diet plans or member name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 py-1.5 text-xs text-slate-900 placeholder-slate-400 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-3 text-xs text-slate-500">
            <span>{plans.length} Meal Protocols</span>
            <span>·</span>
            <span>{members.length} Enrolled Members</span>
          </div>
        </div>

        {/* Diet Plans Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {loading ? (
            <div className="col-span-full py-12 text-center text-slate-400">
              <RotateCw className="mx-auto h-6 w-6 animate-spin text-slate-300 mb-2" />
              Loading diet protocols...
            </div>
          ) : filteredPlans.length === 0 ? (
            <div className="col-span-full py-12 text-center text-slate-500">
              <Sparkles className="mx-auto h-8 w-8 text-slate-300 mb-2" />
              No diet protocols found. Create your first nutrition plan above!
            </div>
          ) : (
            filteredPlans.map((p) => (
              <div
                key={p.id}
                className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm hover:border-slate-300 transition flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <span className="rounded-md bg-purple-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-purple-700">
                      {p.goal}
                    </span>
                    <span className="flex items-center gap-1 text-xs font-extrabold text-amber-600">
                      <Flame className="h-3.5 w-3.5" />
                      {p.target_calories} kcal
                    </span>
                  </div>

                  <h3 className="text-base font-bold text-slate-900 mt-2">{p.plan_name}</h3>

                  {/* Macro Badges */}
                  <div className="mt-3 grid grid-cols-3 gap-1.5 text-center">
                    <div className="rounded-lg bg-emerald-50 p-1.5">
                      <span className="text-[9px] font-semibold text-slate-500 uppercase">Protein</span>
                      <p className="font-extrabold text-emerald-700 text-xs">{p.target_protein_g}g</p>
                    </div>
                    <div className="rounded-lg bg-amber-50 p-1.5">
                      <span className="text-[9px] font-semibold text-slate-500 uppercase">Carbs</span>
                      <p className="font-extrabold text-amber-700 text-xs">{p.target_carbs_g}g</p>
                    </div>
                    <div className="rounded-lg bg-blue-50 p-1.5">
                      <span className="text-[9px] font-semibold text-slate-500 uppercase">Fats</span>
                      <p className="font-extrabold text-blue-700 text-xs">{p.target_fats_g}g</p>
                    </div>
                  </div>

                  {p.assigned_member_name && (
                    <div className="mt-3 rounded-lg bg-slate-50 border border-slate-200 p-2 text-xs font-semibold text-slate-800 flex items-center justify-between">
                      <div className="flex items-center gap-1.5 truncate">
                        <Users className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
                        <span className="truncate">{p.assigned_member_name}</span>
                      </div>
                      <span className="text-[10px] text-slate-400 font-mono">{p.assigned_member_phone}</span>
                    </div>
                  )}

                  {/* Meals List */}
                  <div className="mt-4 pt-4 border-t border-slate-100 space-y-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Meal Schedule ({p.meals?.length || 0} Meals)
                    </span>
                    <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                      {(p.meals || []).map((m, i) => (
                        <div key={i} className="rounded-lg bg-slate-50 p-2 text-xs text-slate-800">
                          <div className="flex justify-between items-center font-bold text-slate-900">
                            <span>{m.meal_name}</span>
                            <span className="text-[10px] text-slate-500 font-mono">
                              {m.calories} kcal · {m.protein}g P
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-600 mt-0.5 line-clamp-2">{m.food_items}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => handleShareWhatsApp(p)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-800 hover:bg-emerald-100 transition shadow-xs"
                  >
                    <Send className="h-3 w-3 text-emerald-600" />
                    Share on WhatsApp
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setPlanName(`${p.plan_name} (Copy)`);
                      setGoal(p.goal);
                      setTargetCalories(p.target_calories);
                      setTargetProtein(p.target_protein_g);
                      setTargetCarbs(p.target_carbs_g);
                      setTargetFats(p.target_fats_g);
                      setMeals(p.meals || []);
                      setShowModal(true);
                    }}
                    className="text-xs font-semibold text-slate-600 hover:text-slate-900"
                  >
                    Duplicate →
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </main>

      {/* Diet Builder Modal */}
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
              <Sparkles className="h-5 w-5 text-purple-600" />
              Build Diet &amp; Nutrition Protocol
            </h3>
            <p className="text-xs text-slate-500 mt-1">Configure calorie/macro targets and assign meals to a member.</p>

            <form onSubmit={handleSavePlan} className="mt-5 space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Plan Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 2,200 kcal High Protein Lean Bulk"
                  value={planName}
                  onChange={(e) => setPlanName(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Goal Target</label>
                  <select
                    value={goal}
                    onChange={(e) => setGoal(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 focus:outline-none"
                  >
                    <option value="Fat Loss">Fat Loss (Deficit)</option>
                    <option value="Muscle Gain">Muscle Gain (Surplus)</option>
                    <option value="Maintenance">Maintenance &amp; Tone</option>
                    <option value="Keto / Low-Carb">Keto / Low-Carb</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Daily Calories (kcal)</label>
                  <input
                    type="number"
                    value={targetCalories}
                    onChange={(e) => setTargetCalories(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 font-bold focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Protein (g)</label>
                  <input
                    type="number"
                    value={targetProtein}
                    onChange={(e) => setTargetProtein(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 text-center font-bold"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Carbs (g)</label>
                  <input
                    type="number"
                    value={targetCarbs}
                    onChange={(e) => setTargetCarbs(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 text-center font-bold"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Fats (g)</label>
                  <input
                    type="number"
                    value={targetFats}
                    onChange={(e) => setTargetFats(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 text-center font-bold"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Assign to Member</label>
                <select
                  value={assignedMemberId}
                  onChange={(e) => setAssignedMemberId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 focus:outline-none"
                >
                  <option value="">-- Generic Template (No Member Assigned) --</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.full_name} ({m.phone})
                    </option>
                  ))}
                </select>
              </div>

              {/* Meals List Builder */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="font-semibold text-slate-700">Meals Schedule</label>
                  <button
                    type="button"
                    onClick={handleAddMealRow}
                    className="text-xs font-bold text-emerald-600 hover:text-emerald-700"
                  >
                    + Add Meal Slot
                  </button>
                </div>

                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {meals.map((m, i) => (
                    <div key={i} className="bg-slate-50 p-2.5 rounded-lg border border-slate-200 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          placeholder="Meal Name (e.g. Breakfast)"
                          value={m.meal_name}
                          onChange={(e) => handleMealChange(i, 'meal_name', e.target.value)}
                          className="flex-1 rounded border border-slate-200 bg-white px-2 py-1 text-xs font-bold text-slate-900"
                        />
                        <input
                          type="number"
                          placeholder="kcal"
                          value={m.calories}
                          onChange={(e) => handleMealChange(i, 'calories', Number(e.target.value))}
                          className="w-16 rounded border border-slate-200 bg-white px-1.5 py-1 text-xs text-center"
                        />
                        <button
                          type="button"
                          onClick={() => handleRemoveMealRow(i)}
                          className="text-slate-400 hover:text-rose-600 p-1"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <input
                        type="text"
                        placeholder="Food Items (e.g. 4 Eggs, 50g Oats, 1 Apple)"
                        value={m.food_items}
                        onChange={(e) => handleMealChange(i, 'food_items', e.target.value)}
                        className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                      />
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
                  {saveBusy ? 'Saving Protocol...' : 'Save Diet Plan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
