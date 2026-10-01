/**
 * AI Workout & Diet Planner (Module 10.2).
 *
 * Inputs: age, weight, height, goal (fat loss / hypertrophy), available
 * equipment and training split (PPL / Upper-Lower / Full Body).
 *
 * Two ways to produce a plan:
 *   1. `generatePlan()` — the deterministic engine that always works: Mifflin-
 *      St Jeor BMR -> TDEE -> goal-scaled calories + macros, and a weekly
 *      split whose exercises are filtered to the equipment the member owns.
 *   2. `buildPlannerPrompt()` — the structured prompt /api/ai/planner sends to
 *      an OpenAI-compatible endpoint when AI_API_KEY (or OPENAI_API_KEY) is
 *      configured. If the call fails for any reason the route falls back to
 *      (1), so the member always gets a usable plan.
 *
 * The response shape is identical either way — the UI never branches.
 */

export type PlannerGoal = 'fat_loss' | 'hypertrophy';
export type PlannerSplit = 'PPL' | 'Upper-Lower' | 'Full Body';

export const PLANNER_GOALS: { id: PlannerGoal; label: string }[] = [
  { id: 'fat_loss', label: 'Fat Loss' },
  { id: 'hypertrophy', label: 'Hypertrophy (Muscle Gain)' },
];

export const PLANNER_SPLITS: { id: PlannerSplit; label: string; days: number }[] = [
  { id: 'PPL', label: 'Push / Pull / Legs (6 days)', days: 6 },
  { id: 'Upper-Lower', label: 'Upper / Lower (4 days)', days: 4 },
  { id: 'Full Body', label: 'Full Body (3 days)', days: 3 },
];

/** Offered as chips; the engine only selects exercises whose tags overlap. */
export const PLANNER_EQUIPMENT: readonly string[] = [
  'barbell',
  'dumbbell',
  'machine',
  'cable',
  'kettlebell',
  'bodyweight',
  'resistance bands',
  'cardio machines',
] as const;

export interface PlannerInput {
  age: number;
  weightKg: number;
  heightCm: number;
  goal: PlannerGoal;
  equipment: string[];
  split: PlannerSplit;
  /** Optional but improves the calorie math; defaults to male. */
  sex?: 'male' | 'female';
}

export interface PlanExercise {
  name: string;
  sets: number;
  reps: string;
  rest: string;
}

export interface PlanDay {
  day: string;
  focus: string;
  exercises: PlanExercise[];
}

export interface MacroPlan {
  kcal: number;
  proteinG: number;
  carbG: number;
  fatG: number;
  waterL: number;
}

export interface WorkoutPlan {
  split: PlannerSplit;
  goal: PlannerGoal;
  source: 'ai' | 'engine';
  summary: string;
  days: PlanDay[];
  macros: MacroPlan;
  notes: string[];
}

// -----------------------------------------------------------------------------
// Validation — one place both the route and the UI agree on
// -----------------------------------------------------------------------------

export function validatePlannerInput(raw: Record<string, unknown>): {
  ok: boolean;
  input?: PlannerInput;
  error?: string;
} {
  const age = Number(raw.age);
  const weightKg = Number(raw.weightKg ?? raw.weight_kg);
  const heightCm = Number(raw.heightCm ?? raw.height_cm);

  if (!Number.isFinite(age) || age < 12 || age > 90) {
    return { ok: false, error: 'Enter an age between 12 and 90.' };
  }
  if (!Number.isFinite(weightKg) || weightKg < 25 || weightKg > 350) {
    return { ok: false, error: 'Enter a weight between 25 and 350 kg.' };
  }
  if (!Number.isFinite(heightCm) || heightCm < 100 || heightCm > 240) {
    return { ok: false, error: 'Enter a height between 100 and 240 cm.' };
  }

  const goal = raw.goal;
  if (goal !== 'fat_loss' && goal !== 'hypertrophy') {
    return { ok: false, error: 'Goal must be fat_loss or hypertrophy.' };
  }

  const split = raw.split;
  if (split !== 'PPL' && split !== 'Upper-Lower' && split !== 'Full Body') {
    return { ok: false, error: 'Split must be PPL, Upper-Lower or Full Body.' };
  }

  const rawEquipment = Array.isArray(raw.equipment) ? raw.equipment : [];
  const equipment = rawEquipment
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => PLANNER_EQUIPMENT.includes(item))
    .slice(0, PLANNER_EQUIPMENT.length);

  const sex = raw.sex === 'female' ? 'female' : 'male';

  return {
    ok: true,
    input: { age, weightKg, heightCm, goal, equipment, split, sex },
  };
}

// -----------------------------------------------------------------------------
// Macro engine — Mifflin-St Jeor, then goal-scaled splits
// -----------------------------------------------------------------------------

export function computeMacros(input: PlannerInput): MacroPlan {
  const sexOffset = input.sex === 'female' ? -161 : 5;
  const bmr = 10 * input.weightKg + 6.25 * input.heightCm - 5 * input.age + sexOffset;
  // 1.45 = "lightly active": a member training 4-6 days a week.
  const tdee = bmr * 1.45;
  const kcal = Math.round((input.goal === 'fat_loss' ? tdee * 0.8 : tdee * 1.1) / 10) * 10;

  const proteinG = Math.round(input.weightKg * (input.goal === 'fat_loss' ? 2.2 : 2.0));
  const fatG = Math.round(input.weightKg * 0.8);
  const carbG = Math.max(50, Math.round((kcal - proteinG * 4 - fatG * 9) / 4));

  return {
    kcal,
    proteinG,
    carbG,
    fatG,
    waterL: Math.max(2.5, Math.round(input.weightKg * 0.035 * 10) / 10),
  };
}

// -----------------------------------------------------------------------------
// Exercise template — every entry carries the equipment it needs, so the
// planner only offers movements the member's kit can actually perform.
// -----------------------------------------------------------------------------

interface TemplateExercise extends PlanExercise {
  /** Satisfied when ANY listed tag is in the member's kit. */
  needs: string[];
}

const DAY_TEMPLATES: Record<string, { focus: string; exercises: TemplateExercise[] }> = {
  push: {
    focus: 'Push — chest, shoulders, triceps',
    exercises: [
      { name: 'Barbell Bench Press', sets: 4, reps: '6-8', rest: '2-3 min', needs: ['barbell'] },
      { name: 'Incline Dumbbell Press', sets: 3, reps: '8-10', rest: '90 s', needs: ['dumbbell'] },
      { name: 'Machine Chest Press', sets: 3, reps: '10-12', rest: '90 s', needs: ['machine'] },
      { name: 'Cable Fly', sets: 3, reps: '12-15', rest: '60 s', needs: ['cable'] },
      { name: 'Overhead Press', sets: 4, reps: '6-8', rest: '2-3 min', needs: ['barbell'] },
      { name: 'Dumbbell Lateral Raise', sets: 3, reps: '12-15', rest: '45 s', needs: ['dumbbell'] },
      { name: 'Triceps Pushdown', sets: 3, reps: '10-12', rest: '60 s', needs: ['cable'] },
      { name: 'Push-Up (feet elevated)', sets: 3, reps: 'to failure', rest: '60 s', needs: ['bodyweight'] },
      { name: 'Band Chest Press', sets: 3, reps: '12-15', rest: '60 s', needs: ['resistance bands'] },
    ],
  },
  pull: {
    focus: 'Pull — back, rear delts, biceps',
    exercises: [
      { name: 'Deadlift', sets: 3, reps: '4-6', rest: '3 min', needs: ['barbell'] },
      { name: 'Lat Pulldown', sets: 4, reps: '8-10', rest: '90 s', needs: ['machine', 'cable'] },
      { name: 'Barbell Row', sets: 4, reps: '8-10', rest: '2 min', needs: ['barbell'] },
      { name: 'Seated Cable Row', sets: 3, reps: '10-12', rest: '90 s', needs: ['cable'] },
      { name: 'Dumbbell Row', sets: 3, reps: '10-12', rest: '90 s', needs: ['dumbbell'] },
      { name: 'Face Pull', sets: 3, reps: '15', rest: '45 s', needs: ['cable', 'resistance bands'] },
      { name: 'Pull-Up / Assisted Pull-Up', sets: 3, reps: 'to failure', rest: '2 min', needs: ['bodyweight'] },
      { name: 'Dumbbell Hammer Curl', sets: 3, reps: '10-12', rest: '60 s', needs: ['dumbbell'] },
      { name: 'Band Row', sets: 3, reps: '12-15', rest: '60 s', needs: ['resistance bands'] },
    ],
  },
  legs: {
    focus: 'Legs & core',
    exercises: [
      { name: 'Back Squat', sets: 4, reps: '5-8', rest: '3 min', needs: ['barbell'] },
      { name: 'Romanian Deadlift', sets: 3, reps: '8-10', rest: '2 min', needs: ['barbell', 'dumbbell'] },
      { name: 'Leg Press', sets: 3, reps: '10-12', rest: '2 min', needs: ['machine'] },
      { name: 'Walking Lunge', sets: 3, reps: '12 each', rest: '90 s', needs: ['dumbbell', 'bodyweight'] },
      { name: 'Leg Curl', sets: 3, reps: '10-12', rest: '90 s', needs: ['machine'] },
      { name: 'Kettlebell Goblet Squat', sets: 3, reps: '10-12', rest: '90 s', needs: ['kettlebell'] },
      { name: 'Standing Calf Raise', sets: 4, reps: '12-15', rest: '45 s', needs: ['machine', 'bodyweight'] },
      { name: 'Plank', sets: 3, reps: '45-60 s', rest: '45 s', needs: ['bodyweight'] },
    ],
  },
  upper: {
    focus: 'Upper body — push + pull',
    exercises: [
      { name: 'Barbell Bench Press', sets: 4, reps: '6-8', rest: '2-3 min', needs: ['barbell'] },
      { name: 'Barbell Row', sets: 4, reps: '8-10', rest: '2 min', needs: ['barbell'] },
      { name: 'Overhead Press', sets: 3, reps: '8-10', rest: '2 min', needs: ['barbell', 'dumbbell'] },
      { name: 'Lat Pulldown', sets: 3, reps: '10-12', rest: '90 s', needs: ['machine', 'cable'] },
      { name: 'Incline Dumbbell Press', sets: 3, reps: '10-12', rest: '90 s', needs: ['dumbbell'] },
      { name: 'Seated Cable Row', sets: 3, reps: '10-12', rest: '90 s', needs: ['cable'] },
      { name: 'Lateral Raise', sets: 3, reps: '15', rest: '45 s', needs: ['dumbbell', 'cable'] },
      { name: 'Biceps Curl + Triceps Pushdown (superset)', sets: 3, reps: '12', rest: '60 s', needs: ['cable', 'dumbbell'] },
      { name: 'Push-Up Finisher', sets: 3, reps: 'to failure', rest: '60 s', needs: ['bodyweight'] },
      { name: 'Plank', sets: 3, reps: '45-60 s', rest: '45 s', needs: ['bodyweight'] },
    ],
  },
  lower: {
    focus: 'Lower body — quads, hams, glutes',
    exercises: [
      { name: 'Back Squat', sets: 4, reps: '5-8', rest: '3 min', needs: ['barbell'] },
      { name: 'Romanian Deadlift', sets: 3, reps: '8-10', rest: '2 min', needs: ['barbell', 'dumbbell'] },
      { name: 'Leg Press', sets: 3, reps: '10-12', rest: '2 min', needs: ['machine'] },
      { name: 'Bulgarian Split Squat', sets: 3, reps: '10 each', rest: '90 s', needs: ['dumbbell', 'bodyweight'] },
      { name: 'Leg Curl', sets: 3, reps: '10-12', rest: '90 s', needs: ['machine'] },
      { name: 'Kettlebell Swing', sets: 3, reps: '15', rest: '60 s', needs: ['kettlebell'] },
      { name: 'Standing Calf Raise', sets: 4, reps: '12-15', rest: '45 s', needs: ['machine', 'bodyweight'] },
      { name: 'Hanging Knee Raise', sets: 3, reps: '12-15', rest: '45 s', needs: ['bodyweight'] },
    ],
  },
  cardio: {
    focus: 'Conditioning + core finisher',
    exercises: [
      { name: 'Treadmill Intervals (1 min hard / 2 min easy)', sets: 1, reps: '20 min', rest: '—', needs: ['cardio machines'] },
      { name: 'Rowing Machine', sets: 1, reps: '15 min', rest: '—', needs: ['cardio machines'] },
      { name: 'Jump Rope / Jog in Place', sets: 1, reps: '15 min', rest: '—', needs: ['bodyweight'] },
      { name: 'Plank Circuit (front + sides)', sets: 3, reps: '45 s each', rest: '30 s', needs: ['bodyweight'] },
      { name: 'Band Pull-Apart', sets: 3, reps: '15', rest: '45 s', needs: ['resistance bands'] },
    ],
  },
};

/** Day-by-day skeletons for each split. */
const SPLIT_SCHEDULE: Record<PlannerSplit, { day: string; template: string }[]> = {
  PPL: [
    { day: 'Day 1', template: 'push' },
    { day: 'Day 2', template: 'pull' },
    { day: 'Day 3', template: 'legs' },
    { day: 'Day 4', template: 'push' },
    { day: 'Day 5', template: 'pull' },
    { day: 'Day 6', template: 'legs' },
    { day: 'Day 7', template: 'rest' },
  ],
  'Upper-Lower': [
    { day: 'Day 1', template: 'upper' },
    { day: 'Day 2', template: 'lower' },
    { day: 'Day 3', template: 'rest' },
    { day: 'Day 4', template: 'upper' },
    { day: 'Day 5', template: 'lower' },
    { day: 'Day 6', template: 'rest' },
    { day: 'Day 7', template: 'rest' },
  ],
  'Full Body': [
    { day: 'Day 1', template: 'push' },
    { day: 'Day 2', template: 'rest' },
    { day: 'Day 3', template: 'lower' },
    { day: 'Day 4', template: 'rest' },
    { day: 'Day 5', template: 'pull' },
    { day: 'Day 6', template: 'rest' },
    { day: 'Day 7', template: 'rest' },
  ],
};

/** Keeps an exercise whose equipment tag overlaps the member's kit. */
function allowedByEquipment(exercise: TemplateExercise, kit: string[]): boolean {
  if (kit.length === 0) return true; // no kit declared: assume a full gym
  return exercise.needs.some((need) => kit.includes(need));
}

/**
 * The deterministic engine: same inputs, same plan, always available. Picks at
 * most six exercises per training day from the templates the member can do.
 */
export function generatePlan(input: PlannerInput): WorkoutPlan {
  const macros = computeMacros(input);
  const schedule = SPLIT_SCHEDULE[input.split];
  const trainingDays = schedule.filter((slot) => slot.template !== 'rest').length;

  const days: PlanDay[] = schedule.map((slot) => {
    if (slot.template === 'rest') {
      return {
        day: slot.day,
        focus: 'Rest & recovery',
        exercises: [
          { name: '30-45 min walk', sets: 1, reps: 'once', rest: '—' },
          { name: 'Stretching / mobility', sets: 1, reps: '10 min', rest: '—' },
        ],
      };
    }
    const template = DAY_TEMPLATES[slot.template];
    const exercises = template.exercises
      .filter((exercise) => allowedByEquipment(exercise, input.equipment))
      .slice(0, 6)
      .map(({ name, sets, reps, rest }) => ({ name, sets, reps, rest }));

    return {
      day: slot.day,
      focus: template.focus,
      exercises:
        exercises.length > 0
          ? exercises
          : [{ name: 'Bodyweight circuit (squat / push-up / plank)', sets: 3, reps: '12', rest: '60 s' }],
    };
  });

  const goalLine =
    input.goal === 'fat_loss'
      ? 'Stay in a moderate calorie deficit; keep protein high to hold muscle while you lean out.'
      : 'Eat around maintenance with a slight surplus; progressive overload on the main lifts is the priority.';

  return {
    split: input.split,
    goal: input.goal,
    source: 'engine',
    summary: `${trainingDays}-day ${input.split} plan for ${
      input.goal === 'fat_loss' ? 'fat loss' : 'hypertrophy'
    }, filtered to your equipment. ${goalLine}`,
    days,
    macros,
    notes: [
      `Aim for ${macros.proteinG} g protein daily — about ${Math.round(macros.proteinG / 4)} g per meal across ${macros.proteinG > 150 ? 4 : 3} meals.`,
      `Drink ~${macros.waterL} L of water across the day, more on training days.`,
      'Add 2.5-5 kg or 1-2 reps only when every set of a lift was clean — that is progressive overload.',
      'Sleep 7-9 hours: recovery is where the adaptation actually happens.',
      'Any pain that changes your movement is a stop sign — ask your trainer on the floor.',
    ],
  };
}

/**
 * The structured prompt for the AI call. Both the system and user halves are
 * returned so /api/ai/planner can post them verbatim to an OpenAI-compatible
 * chat completions endpoint and parse a strict-JSON answer.
 */
export function buildPlannerPrompt(input: PlannerInput): { system: string; user: string } {
  const system =
    'You are a certified strength & conditioning coach and sports nutritionist working inside a gym app. ' +
    'Return ONLY minified JSON matching this TypeScript shape, with no markdown fences and no commentary: ' +
    '{"split": string, "goal": string, "source": "ai", "summary": string, ' +
    'days: [{"day": string, "focus": string, "exercises": [{"name": string, "sets": number, "reps": string, "rest": string}]}], ' +
    'macros: {"kcal": number, "proteinG": number, "carbG": number, "fatG": number, "waterL": number}, ' +
    'notes: string[]}. ' +
    'Rules: 7 day entries (Day 1..Day 7, rest days allowed), only exercises the listed equipment supports, ' +
    'sets 1-8, reps as a short string like "8-10" or "to failure", calories from Mifflin-St Jeor adjusted for the goal.';

  const user = JSON.stringify({
    age: input.age,
    weightKg: input.weightKg,
    heightCm: input.heightCm,
    goal: input.goal,
    split: input.split,
    equipment: input.equipment.length > 0 ? input.equipment : ['full gym'],
    instruction:
      'Produce the weekly workout split and the matching macro-calculated nutrition plan for this member.',
  });

  return { system, user };
}



