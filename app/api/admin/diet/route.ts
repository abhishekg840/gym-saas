import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { badRequest, readJsonBody } from '@/lib/sqlstate';
import { isUuid } from '@/lib/session';

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

const DEFAULT_PRESET_DIETS: Omit<DietPlan, 'id' | 'tenant_id' | 'created_at'>[] = [
  {
    plan_name: 'Lean Muscle & High Protein (2,400 kcal)',
    goal: 'Muscle Gain',
    target_calories: 2400,
    target_protein_g: 170,
    target_carbs_g: 260,
    target_fats_g: 70,
    meals: [
      { meal_name: 'Breakfast (8:30 AM)', food_items: '4 Whole Eggs, 60g Rolled Oats with Milk, 1 Banana', calories: 600, protein: 35 },
      { meal_name: 'Mid-Morning Snack (11:30 AM)', food_items: '1 Scoop Whey Protein + 1 Apple + Almonds', calories: 300, protein: 28 },
      { meal_name: 'Lunch (2:00 PM)', food_items: '180g Grilled Chicken Breast or 150g Paneer, 1 Cup Brown Rice, Mixed Salad', calories: 650, protein: 45 },
      { meal_name: 'Pre-Workout (5:30 PM)', food_items: 'Black Coffee + 2 Whole Wheat Bread with Peanut Butter', calories: 250, protein: 10 },
      { meal_name: 'Dinner (8:30 PM)', food_items: '150g Grilled Fish or Tofu, 2 Rotis, Dal, Steamed Veggies', calories: 600, protein: 52 },
    ],
  },
  {
    plan_name: 'Rapid Fat Loss & Caloric Deficit (1,800 kcal)',
    goal: 'Fat Loss',
    target_calories: 1800,
    target_protein_g: 150,
    target_carbs_g: 160,
    target_fats_g: 50,
    meals: [
      { meal_name: 'Breakfast', food_items: '3 Egg Whites + 1 Whole Egg Omelet, 1 Slice Multigrain Toast, Green Tea', calories: 350, protein: 25 },
      { meal_name: 'Lunch', food_items: '150g Chicken/Paneer Salad, Cucumbers, Tomato, Olive Oil drizzle, 1 Roti', calories: 500, protein: 40 },
      { meal_name: 'Snack', food_items: 'Whey Protein Shake with Water + Handful of Walnuts', calories: 250, protein: 27 },
      { meal_name: 'Dinner', food_items: 'Clear Chicken/Veg Soup, 150g Soya Chunks or Chicken, Grilled Zucchini', calories: 450, protein: 45 },
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
      .eq('flag', 'cfg:diet_plans_list')
      .maybeSingle();

    let customPlans: DietPlan[] = [];
    if (flagRow?.updated_by) {
      try {
        customPlans = JSON.parse(flagRow.updated_by);
      } catch {
        customPlans = [];
      }
    }

    const plansToReturn: DietPlan[] = [
      ...customPlans,
      ...DEFAULT_PRESET_DIETS.map((d) => ({
        ...d,
        id: `preset-${d.plan_name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        tenant_id: tenantId,
        created_at: new Date().toISOString(),
      })),
    ];

    return NextResponse.json({ ok: true, plans: plansToReturn });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to fetch diet plans';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const parsed = await readJsonBody(request);
  if ('response' in parsed) return parsed.response;
  const payload = parsed.body;

  const tenantId = String(payload.tenant_id ?? '');
  const planName = String(payload.plan_name ?? '').trim();
  const goal = String(payload.goal ?? 'Muscle Gain');
  const targetCalories = Number(payload.target_calories) || 2000;
  const targetProtein = Number(payload.target_protein_g) || 150;
  const targetCarbs = Number(payload.target_carbs_g) || 200;
  const targetFats = Number(payload.target_fats_g) || 60;
  const meals = (payload.meals ?? []) as MealItem[];
  const memberId = payload.assigned_member_id ? String(payload.assigned_member_id) : null;
  const memberName = payload.assigned_member_name ? String(payload.assigned_member_name) : null;
  const memberPhone = payload.assigned_member_phone ? String(payload.assigned_member_phone) : null;

  if (!isUuid(tenantId) || !planName) {
    return badRequest('tenant_id and plan_name are required');
  }

  const newDiet: DietPlan = {
    id: crypto.randomUUID(),
    tenant_id: tenantId,
    plan_name: planName,
    goal,
    target_calories: targetCalories,
    target_protein_g: targetProtein,
    target_carbs_g: targetCarbs,
    target_fats_g: targetFats,
    meals,
    assigned_member_id: memberId,
    assigned_member_name: memberName,
    assigned_member_phone: memberPhone,
    created_at: new Date().toISOString(),
  };

  try {
    const { data: flagRow } = await supabaseAdmin
      .from('tenant_feature_flags')
      .select('updated_by')
      .eq('tenant_id', tenantId)
      .eq('flag', 'cfg:diet_plans_list')
      .maybeSingle();

    let existing: DietPlan[] = [];
    if (flagRow?.updated_by) {
      try {
        existing = JSON.parse(flagRow.updated_by);
      } catch {
        existing = [];
      }
    }

    const updated = [newDiet, ...existing];

    await supabaseAdmin.from('tenant_feature_flags').upsert(
      {
        tenant_id: tenantId,
        flag: 'cfg:diet_plans_list',
        enabled: true,
        updated_at: new Date().toISOString(),
        updated_by: JSON.stringify(updated),
      },
      { onConflict: 'tenant_id,flag' }
    );

    return NextResponse.json({ ok: true, plan: newDiet });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to save diet plan';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

