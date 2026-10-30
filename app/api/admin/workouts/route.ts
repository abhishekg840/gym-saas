import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { badRequest, readJsonBody } from '@/lib/sqlstate';
import { isUuid } from '@/lib/session';

interface WorkoutPlan {
  id: string;
  tenant_id: string;
  plan_name: string;
  split_type: string;
  target_goal: string;
  days_per_week: number;
  exercises: { name: string; muscle: string; sets: number; reps: string; rest_sec: number }[];
  assigned_member_id?: string | null;
  assigned_member_name?: string | null;
  created_at: string;
}

const DEFAULT_PRESET_PLANS: Omit<WorkoutPlan, 'id' | 'tenant_id' | 'created_at'>[] = [
  {
    plan_name: 'Push / Pull / Legs (PPL)',
    split_type: 'Push / Pull / Legs',
    target_goal: 'Hypertrophy & Muscle Gain',
    days_per_week: 6,
    exercises: [
      { name: 'Barbell Bench Press', muscle: 'Chest', sets: 4, reps: '8-10', rest_sec: 90 },
      { name: 'Incline Dumbbell Press', muscle: 'Upper Chest', sets: 3, reps: '10-12', rest_sec: 60 },
      { name: 'Overhead Shoulder Press', muscle: 'Shoulders', sets: 3, reps: '8-10', rest_sec: 90 },
      { name: 'Barbell Deadlifts', muscle: 'Back & Hamstrings', sets: 4, reps: '6-8', rest_sec: 120 },
      { name: 'Lat Pulldowns', muscle: 'Lats', sets: 3, reps: '10-12', rest_sec: 60 },
      { name: 'Barbell Back Squats', muscle: 'Quadriceps', sets: 4, reps: '8-10', rest_sec: 120 },
      { name: 'Leg Press', muscle: 'Quads & Glutes', sets: 3, reps: '12-15', rest_sec: 90 },
    ],
  },
  {
    plan_name: 'Upper / Lower Strength Split',
    split_type: 'Upper / Lower',
    target_goal: 'Strength & Conditioning',
    days_per_week: 4,
    exercises: [
      { name: 'Incline Dumbbell Press', muscle: 'Chest', sets: 4, reps: '8-10', rest_sec: 90 },
      { name: 'Bent-Over Barbell Row', muscle: 'Upper Back', sets: 4, reps: '8-10', rest_sec: 90 },
      { name: 'Romanian Deadlifts', muscle: 'Hamstrings', sets: 3, reps: '10-12', rest_sec: 90 },
      { name: 'Bulgarian Split Squats', muscle: 'Glutes & Quads', sets: 3, reps: '10-12', rest_sec: 60 },
      { name: 'Standing Calf Raises', muscle: 'Calves', sets: 4, reps: '15-20', rest_sec: 45 },
    ],
  },
  {
    plan_name: 'Fat Burn & HIIT Circuit',
    split_type: 'Cardio & Conditioning',
    target_goal: 'Fat Loss & Stamina',
    days_per_week: 3,
    exercises: [
      { name: 'Kettlebell Swings', muscle: 'Full Body', sets: 4, reps: '20', rest_sec: 30 },
      { name: 'Battle Ropes Slam', muscle: 'Shoulders & Core', sets: 4, reps: '30s', rest_sec: 45 },
      { name: 'Burpee Box Jumps', muscle: 'Cardio & Legs', sets: 3, reps: '12', rest_sec: 45 },
      { name: 'Plank Hold', muscle: 'Core', sets: 3, reps: '60s', rest_sec: 30 },
    ],
  },
];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tenantId = searchParams.get('tenant_id') || '';

  if (!isUuid(tenantId)) {
    return badRequest('tenant_id must be a valid UUID');
  }

  try {
    const { data: flagRow } = await supabaseAdmin
      .from('tenant_feature_flags')
      .select('updated_by')
      .eq('tenant_id', tenantId)
      .eq('flag', 'cfg:workout_plans_list')
      .maybeSingle();

    let customPlans: WorkoutPlan[] = [];
    if (flagRow?.updated_by) {
      try {
        customPlans = JSON.parse(flagRow.updated_by);
      } catch {
        customPlans = [];
      }
    }

    // Seed preset plans if none exist yet
    const plansToReturn: WorkoutPlan[] = [
      ...customPlans,
      ...DEFAULT_PRESET_PLANS.map((p) => ({
        ...p,
        id: `preset-${p.plan_name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        tenant_id: tenantId,
        created_at: new Date().toISOString(),
      })),
    ];

    return NextResponse.json({ ok: true, plans: plansToReturn });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to fetch workout plans';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const parsed = await readJsonBody(request);
  if ('response' in parsed) return parsed.response;
  const payload = parsed.body;

  const tenantId = String(payload.tenant_id ?? '');
  const planName = String(payload.plan_name ?? '').trim();
  const splitType = String(payload.split_type ?? 'Push / Pull / Legs');
  const targetGoal = String(payload.target_goal ?? 'Muscle Building');
  const daysPerWeek = Number(payload.days_per_week) || 4;
  const exercises = (payload.exercises ?? []) as WorkoutPlan['exercises'];
  const memberId = payload.assigned_member_id ? String(payload.assigned_member_id) : null;
  const memberName = payload.assigned_member_name ? String(payload.assigned_member_name) : null;

  if (!isUuid(tenantId) || !planName) {
    return badRequest('tenant_id and plan_name are required');
  }

  const newPlan: WorkoutPlan = {
    id: crypto.randomUUID(),
    tenant_id: tenantId,
    plan_name: planName,
    split_type: splitType,
    target_goal: targetGoal,
    days_per_week: daysPerWeek,
    exercises,
    assigned_member_id: memberId,
    assigned_member_name: memberName,
    created_at: new Date().toISOString(),
  };

  try {
    const { data: flagRow } = await supabaseAdmin
      .from('tenant_feature_flags')
      .select('updated_by')
      .eq('tenant_id', tenantId)
      .eq('flag', 'cfg:workout_plans_list')
      .maybeSingle();

    let existing: WorkoutPlan[] = [];
    if (flagRow?.updated_by) {
      try {
        existing = JSON.parse(flagRow.updated_by);
      } catch {
        existing = [];
      }
    }

    const updated = [newPlan, ...existing];

    await supabaseAdmin.from('tenant_feature_flags').upsert(
      {
        tenant_id: tenantId,
        flag: 'cfg:workout_plans_list',
        enabled: true,
        updated_at: new Date().toISOString(),
        updated_by: JSON.stringify(updated),
      },
      { onConflict: 'tenant_id,flag' }
    );

    return NextResponse.json({ ok: true, plan: newPlan });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to save workout plan';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

