import { NextResponse } from 'next/server';
import { readJsonBody, badRequest } from '@/lib/sqlstate';
import {
  buildPlannerPrompt,
  generatePlan,
  validatePlannerInput,
  type PlanDay,
  type MacroPlan,
  type WorkoutPlan,
} from '@/lib/planner';

/**
 * POST /api/ai/planner — AI Workout & Diet Planner (Module 10.2).
 *
 * Body: { age, weightKg, heightCm, goal: 'fat_loss'|'hypertrophy',
 *         equipment: string[], split: 'PPL'|'Upper-Lower'|'Full Body', sex? }
 *
 * When AI_API_KEY (or OPENAI_API_KEY) and optionally AI_BASE_URL /
 * AI_MODEL are configured, the prompt from buildPlannerPrompt() is sent to an
 * OpenAI-compatible chat completions endpoint and the JSON answer is
 * shape-checked here. Any missing key, timeout, or malformed reply falls back
 * to the deterministic engine in lib/planner.ts — the member always receives a
 * plan, and `source` says which path produced it.
 *
 * The key never reaches the browser: it is read inside this route only.
 */

const AI_TIMEOUT_MS = 25_000;

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Coerces whatever the model returned into the exact WorkoutPlan shape. */
function coercePlan(raw: unknown, fallback: WorkoutPlan): WorkoutPlan | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Record<string, unknown>;
  if (!Array.isArray(candidate.days) || candidate.days.length === 0) return null;

  const days: PlanDay[] = candidate.days
    .filter((day): day is Record<string, unknown> => Boolean(day) && typeof day === 'object')
    .slice(0, 14)
    .map((day) => ({
      day: String(day.day ?? ''),
      focus: String(day.focus ?? ''),
      exercises: Array.isArray(day.exercises)
        ? day.exercises
            .filter((ex): ex is Record<string, unknown> => Boolean(ex) && typeof ex === 'object')
            .slice(0, 12)
            .map((ex) => ({
              name: String(ex.name ?? 'Exercise'),
              sets: Math.min(8, Math.max(1, Number(ex.sets) || 3)),
              reps: String(ex.reps ?? '8-10'),
              rest: String(ex.rest ?? '90 s'),
            }))
        : [],
    }));

  if (days.length === 0) return null;

  const rawMacros = (candidate.macros ?? {}) as Record<string, unknown>;
  const numeric = (value: unknown, fallbackValue: number) => {
    const num = Number(value);
    return Number.isFinite(num) && num > 0 ? Math.round(num) : fallbackValue;
  };
  const macros: MacroPlan = {
    kcal: numeric(rawMacros.kcal, fallback.macros.kcal),
    proteinG: numeric(rawMacros.proteinG, fallback.macros.proteinG),
    carbG: numeric(rawMacros.carbG, fallback.macros.carbG),
    fatG: numeric(rawMacros.fatG, fallback.macros.fatG),
    waterL: numeric(rawMacros.waterL, fallback.macros.waterL),
  };

  return {
    split: fallback.split,
    goal: fallback.goal,
    source: 'ai',
    summary:
      typeof candidate.summary === 'string' && candidate.summary.trim()
        ? candidate.summary.slice(0, 400)
        : fallback.summary,
    days,
    macros,
    notes: Array.isArray(candidate.notes)
      ? candidate.notes
          .filter((note): note is string => typeof note === 'string')
          .slice(0, 8)
      : fallback.notes,
  };
}

async function askAi(system: string, user: string): Promise<unknown | null> {
  const apiKey = process.env.AI_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const baseUrl = (process.env.AI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model = process.env.AI_MODEL ?? 'gpt-4o-mini';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        messages: [
          { role: 'system', content: system } satisfies ChatMessage,
          { role: 'user', content: user } satisfies ChatMessage,
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) return null;

    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) return null;

    // Models occasionally wrap JSON in ``` fences despite instructions.
    const cleaned = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    return JSON.parse(cleaned) as unknown;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(request: Request) {
  const parsed = await readJsonBody(request);
  if ('response' in parsed) return parsed.response;

  const validated = validatePlannerInput(parsed.body);
  if (!validated.ok || !validated.input) {
    return badRequest(validated.error ?? 'The planner inputs are not valid.');
  }

  const input = validated.input;
  const enginePlan = generatePlan(input);

  const { system, user } = buildPlannerPrompt(input);
  const aiRaw = await askAi(system, user);
  const aiPlan = coercePlan(aiRaw, enginePlan);

  return NextResponse.json({ ok: true, plan: aiPlan ?? enginePlan });
}
