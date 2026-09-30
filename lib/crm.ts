import { isUuid } from '@/lib/session';

/**
 * Typed client for the Phase 3 endpoints: /api/leads, /api/trainers, /api/pt and
 * /api/store (plus /api/store/checkout).
 *
 * Same contract as lib/hardware.ts and lib/membership.ts: the browser never
 * writes a Phase 3 table directly. Every mutation goes through a route handler
 * that resolves the gym from the request/cookie and forwards to a Postgres
 * function which re-checks tenant ownership, so a stale or hand-edited session
 * cannot reach another gym's rows.
 */

// -----------------------------------------------------------------------------
// Shared envelope
// -----------------------------------------------------------------------------

interface ApiEnvelope {
  ok?: boolean;
  error?: string;
  code?: string;
  [key: string]: unknown;
}

/**
 * One shape for every call, so a failure always reaches the UI as a sentence
 * rather than an unhandled promise rejection.
 */
async function callCrm(
  path: string,
  init: RequestInit
): Promise<{ ok: boolean; error?: string; code?: string; body: ApiEnvelope }> {
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      ...init,
    });
  } catch {
    return { ok: false, error: 'Network error — the request could not reach the server.', body: {} };
  }

  let body: ApiEnvelope;
  try {
    body = (await response.json()) as ApiEnvelope;
  } catch {
    return { ok: false, error: `Server returned an invalid response (${response.status}).`, body: {} };
  }

  if (!response.ok || body.ok === false) {
    return {
      ok: false,
      error: body.error ?? `Request failed with status ${response.status}.`,
      code: body.code,
      body,
    };
  }
  return { ok: true, body };
}

/** Guard so a corrupt session value cannot fire an unscoped request. */
function requireTenant(tenantId: string | null | undefined): string | null {
  return isUuid(tenantId) ? tenantId : null;
}

const NO_GYM = 'No gym is linked to this session. Sign in again.';

/** ₹1,20,000 — the whole app renders Indian numbering. */
export function formatRupees(value: number | string | null | undefined): string {
  const amount = typeof value === 'number' ? value : Number(value ?? 0);
  if (!Number.isFinite(amount)) return '₹0';
  return `₹${amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

/**
 * Today as YYYY-MM-DD in the operator's own timezone (not UTC), so a late-night
 * shift in IST does not see tomorrow's date on the follow-up badges.
 */
export function todayIso(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

// -----------------------------------------------------------------------------
// Module 3.1 — Lead CRM pipeline
// -----------------------------------------------------------------------------

export type LeadStage =
  | 'new'
  | 'contacted'
  | 'trial_booked'
  | 'trial_completed'
  | 'converted'
  | 'lost';

export interface Lead {
  id: string;
  full_name: string;
  phone: string;
  email: string | null;
  source: string;
  status: LeadStage;
  trial_date: string | null;
  follow_up_date: string | null;
  notes: string | null;
  created_at: string;
}

export const LEAD_SOURCES: readonly string[] = [
  'walk-in',
  'instagram',
  'referral',
  'whatsapp',
  'phone-enquiry',
  'google',
  'hoarding',
  'other',
] as const;

interface StageMeta {
  key: LeadStage;
  label: string;
  /** Tailwind classes for the column header pill. */
  badge: string;
  /** Tailwind classes for the column border. */
  lane: string;
  hint: string;
}

/**
 * The six lanes of the board. Order matters: the advance button walks this
 * array, so 'converted' and 'lost' are deliberately last (terminal).
 */
export const PIPELINE_STAGES: readonly StageMeta[] = [
  {
    key: 'new',
    label: 'New Inquiry',
    badge: 'bg-blue-500/10 text-blue-300 border-blue-500/30',
    lane: 'border-blue-500/20',
    hint: 'Walk-in or online lead just captured.',
  },
  {
    key: 'contacted',
    label: 'Contacted',
    badge: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30',
    lane: 'border-cyan-500/20',
    hint: 'First call or WhatsApp reply is done.',
  },
  {
    key: 'trial_booked',
    label: 'Trial Booked',
    badge: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
    lane: 'border-amber-500/20',
    hint: 'A free trial slot is on the calendar.',
  },
  {
    key: 'trial_completed',
    label: 'Trial Done',
    badge: 'bg-purple-500/10 text-purple-300 border-purple-500/30',
    lane: 'border-purple-500/20',
    hint: 'They trained. The fee conversation is next.',
  },
  {
    key: 'converted',
    label: 'Converted',
    badge: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
    lane: 'border-emerald-500/20',
    hint: 'Now an active member. Counted in revenue.',
  },
  {
    key: 'lost',
    label: 'Lost',
    badge: 'bg-neutral-500/10 text-neutral-400 border-neutral-500/30',
    lane: 'border-neutral-700/40',
    hint: 'Not joining for now. Kept for the follow-up report.',
  },
] as const;

const STAGE_KEYS = PIPELINE_STAGES.map((s) => s.key);

export function isLeadStage(value: unknown): value is LeadStage {
  return typeof value === 'string' && (STAGE_KEYS as readonly string[]).includes(value);
}

export function leadStageLabel(stage: string): string {
  return PIPELINE_STAGES.find((s) => s.key === stage)?.label ?? stage;
}

/** The next lane for the card's advance button. null on a terminal stage. */
export function nextStage(stage: LeadStage): LeadStage | null {
  if (stage === 'converted' || stage === 'lost') return null;
  const index = STAGE_KEYS.indexOf(stage);
  return index >= 0 && index < 4 ? (STAGE_KEYS[index + 1] as LeadStage) : null;
}

/**
 * A follow-up is overdue when the promised date is already behind us, and due
 * today when it is today. Both drive the card badge; anything later stays quiet.
 */
export function followUpState(followUpDate: string | null | undefined): 'none' | 'today' | 'overdue' {
  if (!followUpDate) return 'none';
  const today = todayIso();
  if (followUpDate < today) return 'overdue';
  if (followUpDate === today) return 'today';
  return 'none';
}

export interface LeadInput {
  full_name: string;
  phone: string;
  email?: string | null;
  source?: string;
  status?: LeadStage;
  trial_date?: string | null;
  follow_up_date?: string | null;
  notes?: string | null;
}

/** Body shape for a one-click conversion straight from the lead card. */
export interface ConvertLeadInput {
  tenantId: string | null;
  leadId: string;
  planId?: string | null;
  amountPaid?: number | null;
  /** Set when the dashboard already created the member and is only linking it. */
  memberId?: string | null;
}

export interface ConvertedLead {
  lead_id: string;
  member_id: string;
  member_created: boolean;
  full_name: string;
  phone: string;
  plan_name: string | null;
  amount_paid: number;
  membership_end: string | null;
  invoice_id: string | null;
}

// -----------------------------------------------------------------------------
// Module 3.2 — Trainer roster and payouts
// -----------------------------------------------------------------------------

export interface Trainer {
  id: string;
  name: string;
  phone: string;
  specialization: string | null;
  commission_rate_percent: number;
  is_active: boolean;
  created_at: string;
}

export const TRAINER_SPECIALITIES: readonly string[] = [
  'Strength & Conditioning',
  'Weight Loss',
  'CrossFit',
  'Yoga & Mobility',
  'Bodybuilding',
  'Functional Training',
  'Rehab & Physio',
  'Zumba / Dance Fitness',
] as const;

export interface TrainerPayoutRow {
  id: string;
  name: string;
  phone: string;
  specialization: string | null;
  commission_rate_percent: number;
  is_active: boolean;
  clients: number;
  subscriptions: number;
  sessions_total: number;
  sessions_completed: number;
  sessions_remaining: number;
  revenue: number;
  commission: number;
}

export interface PayoutReport {
  from: string;
  to: string;
  trainers: TrainerPayoutRow[];
  total_revenue: number;
  total_commission: number;
  sessions_completed: number;
  subscriptions: number;
}

export interface TrainerInput {
  name: string;
  phone: string;
  specialization?: string | null;
  commission_rate_percent?: number;
  is_active?: boolean;
}

// -----------------------------------------------------------------------------
// Module 3.3 — PT subscriptions
// -----------------------------------------------------------------------------

export type PtStatus = 'active' | 'completed' | 'expired' | 'cancelled';

export interface PtSubscription {
  id: string;
  member_id: string;
  trainer_id: string;
  total_sessions: number;
  completed_sessions: number;
  amount_paid: number;
  start_date: string;
  end_date: string;
  status: PtStatus;
  created_at: string;
  member_name: string | null;
  member_phone: string | null;
  trainer_name: string | null;
}

export interface PtSubscriptionInput {
  memberId: string;
  trainerId: string;
  totalSessions: number;
  amountPaid: number;
  startDate?: string | null;
  endDate?: string | null;
}

export interface SessionPunch {
  subscription_id: string;
  member_id: string;
  member_name: string | null;
  trainer_id: string;
  trainer_name: string | null;
  total_sessions: number;
  completed_sessions: number;
  sessions_remaining: number;
  status: PtStatus;
  package_finished: boolean;
  end_date: string;
}

export const PT_STATUS_META: Record<PtStatus, { label: string; badge: string }> = {
  active: { label: 'Active', badge: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' },
  completed: { label: 'Completed', badge: 'bg-blue-500/10 text-blue-300 border-blue-500/30' },
  expired: { label: 'Expired', badge: 'bg-amber-500/10 text-amber-300 border-amber-500/30' },
  cancelled: { label: 'Cancelled', badge: 'bg-rose-500/10 text-rose-300 border-rose-500/30' },
};

/** Whole days from today until the given date (negative once passed). */
export function daysUntilDate(value: string | null | undefined): number {
  if (!value) return 0;
  const target = new Date(value);
  if (Number.isNaN(target.getTime())) return 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);

  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

// -----------------------------------------------------------------------------
// Module 3.4 — Gym store inventory and POS
// -----------------------------------------------------------------------------

export type ProductCategory = 'protein' | 'supplements' | 'merchandise' | 'beverages' | 'gear';

export interface Product {
  id: string;
  name: string;
  category: ProductCategory;
  cost_price: number;
  selling_price: number;
  stock_quantity: number;
  low_stock_threshold: number;
  sku: string | null;
  created_at: string;
}

interface CategoryMeta {
  label: string;
  badge: string;
  emoji: string;
}

export const PRODUCT_CATEGORIES: readonly ProductCategory[] = [
  'protein',
  'supplements',
  'merchandise',
  'beverages',
  'gear',
] as const;

export const PRODUCT_CATEGORY_META: Record<ProductCategory, CategoryMeta> = {
  protein: { label: 'Protein', badge: 'bg-purple-500/10 text-purple-300 border-purple-500/30', emoji: '🥛' },
  supplements: { label: 'Supplements', badge: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30', emoji: '💊' },
  merchandise: { label: 'Merchandise', badge: 'bg-blue-500/10 text-blue-300 border-blue-500/30', emoji: '👕' },
  beverages: { label: 'Beverages', badge: 'bg-amber-500/10 text-amber-300 border-amber-500/30', emoji: '🥤' },
  gear: { label: 'Gear', badge: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30', emoji: '🧤' },
};

export function isProductCategory(value: unknown): value is ProductCategory {
  return typeof value === 'string' && (PRODUCT_CATEGORIES as readonly string[]).includes(value);
}

export function categoryLabel(value: string): string {
  return isProductCategory(value) ? PRODUCT_CATEGORY_META[value].label : value;
}

/** Products at or below their own re-order level. Drives the low-stock lamp. */
export function isLowStock(product: Pick<Product, 'stock_quantity' | 'low_stock_threshold'>): boolean {
  return product.stock_quantity <= product.low_stock_threshold;
}

/** Margin percentage, guarding the divide-by-zero on a give-away item. */
export function marginPercent(product: Pick<Product, 'cost_price' | 'selling_price'>): number {
  const cost = Number(product.cost_price);
  const price = Number(product.selling_price);
  if (!Number.isFinite(cost) || !Number.isFinite(price) || cost <= 0) return 0;
  return Math.round(((price - cost) / cost) * 1000) / 10;
}

export interface ProductInput {
  name: string;
  category: ProductCategory;
  cost_price: number;
  selling_price: number;
  stock_quantity?: number;
  low_stock_threshold?: number;
  sku?: string | null;
}

export interface OrderLine {
  product_id: string;
  name: string;
  category?: string;
  quantity: number;
  price: number;
  subtotal: number;
}

export interface Order {
  id: string;
  member_id: string | null;
  total_amount: number;
  payment_method: string;
  items: OrderLine[];
  created_at: string;
  member_name: string | null;
}

export interface CartLine {
  product: Product;
  quantity: number;
}

export interface CheckoutInput {
  tenantId: string | null;
  memberId?: string | null;
  paymentMethod?: string;
  lines: Array<{ productId: string; quantity: number }>;
}

export interface CheckoutReceipt {
  order_id: string;
  member_id: string | null;
  member_name: string | null;
  is_walk_in: boolean;
  total_amount: number;
  payment_method: string;
  items: OrderLine[];
  line_count: number;
  created_at: string;
  invoice_id: string | null;
  revenue_logged: boolean;
}

/** The payment modes the till offers; anything else is a typo at the counter. */
export const PAYMENT_METHODS: readonly string[] = ['Cash/UPI', 'UPI', 'Card', 'Cash'] as const;

export function cartTotal(lines: CartLine[]): number {
  return lines.reduce((sum, line) => sum + Number(line.product.selling_price) * line.quantity, 0);
}

// -----------------------------------------------------------------------------
// Lead endpoints
// -----------------------------------------------------------------------------

export async function listLeads(
  tenantId: string | null
): Promise<{ ok: boolean; error?: string; leads: Lead[] }> {
  const tenant = requireTenant(tenantId);
  if (!tenant) return { ok: false, error: NO_GYM, leads: [] };

  const result = await callCrm(`/api/leads?tenant_id=${tenant}`, { method: 'GET' });
  return { ok: result.ok, error: result.error, leads: (result.body.leads ?? []) as Lead[] };
}

export async function createLead(
  tenantId: string | null,
  input: LeadInput
): Promise<{ ok: boolean; error?: string; lead?: Lead }> {
  const tenant = requireTenant(tenantId);
  if (!tenant) return { ok: false, error: NO_GYM };

  const result = await callCrm('/api/leads', {
    method: 'POST',
    body: JSON.stringify({ tenant_id: tenant, ...input }),
  });
  return { ok: result.ok, error: result.error, lead: result.body.lead as Lead | undefined };
}

/** Partial update: only the keys present in `patch` are written. */
export async function updateLead(
  tenantId: string | null,
  leadId: string,
  patch: Partial<LeadInput>
): Promise<{ ok: boolean; error?: string; lead?: Lead }> {
  const tenant = requireTenant(tenantId);
  if (!tenant) return { ok: false, error: NO_GYM };

  const result = await callCrm('/api/leads', {
    method: 'PATCH',
    body: JSON.stringify({ tenant_id: tenant, lead_id: leadId, ...patch }),
  });
  return { ok: result.ok, error: result.error, lead: result.body.lead as Lead | undefined };
}

export async function deleteLead(
  tenantId: string | null,
  leadId: string
): Promise<{ ok: boolean; error?: string }> {
  const tenant = requireTenant(tenantId);
  if (!tenant) return { ok: false, error: NO_GYM };

  const result = await callCrm('/api/leads', {
    method: 'DELETE',
    body: JSON.stringify({ tenant_id: tenant, lead_id: leadId }),
  });
  return { ok: result.ok, error: result.error };
}

/**
 * One-click conversion. Omit memberId and the server creates the membership
 * (this is the "Enroll" button on a lead card); pass memberId when the dashboard
 * already created the member and the lead only needs to be linked and flipped.
 */
export async function convertLead(
  input: ConvertLeadInput
): Promise<{ ok: boolean; error?: string; converted?: ConvertedLead }> {
  const tenant = requireTenant(input.tenantId);
  if (!tenant) return { ok: false, error: NO_GYM };

  const result = await callCrm('/api/leads', {
    method: 'POST',
    body: JSON.stringify({
      action: 'convert',
      tenant_id: tenant,
      lead_id: input.leadId,
      plan_id: isUuid(input.planId) ? input.planId : null,
      amount_paid: input.amountPaid ?? null,
      member_id: isUuid(input.memberId) ? input.memberId : null,
    }),
  });
  return {
    ok: result.ok,
    error: result.error,
    converted: result.body.converted as ConvertedLead | undefined,
  };
}

/**
 * Hand a lead off to the dashboard's enrolment form. The prospect's details ride
 * in localStorage (not the URL) so a phone number never lands in browser history
 * or a server access log.
 */
export const ENROLL_PREFILL_KEY = 'forgeos_enroll_prefill';

export interface EnrollPrefill {
  leadId: string;
  name: string;
  phone: string;
  email?: string | null;
}

export function stashEnrollPrefill(prefill: EnrollPrefill): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(ENROLL_PREFILL_KEY, JSON.stringify(prefill));
}

/** Reads and immediately clears the hand-off, so it is consumed exactly once. */
export function takeEnrollPrefill(): EnrollPrefill | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(ENROLL_PREFILL_KEY);
    if (!raw) return null;
    window.localStorage.removeItem(ENROLL_PREFILL_KEY);

    const parsed = JSON.parse(raw) as EnrollPrefill;
    if (!parsed || !isUuid(parsed.leadId) || !parsed.name) return null;
    return parsed;
  } catch {
    return null;
  }
}

// -----------------------------------------------------------------------------
// Trainer endpoints
// -----------------------------------------------------------------------------

export async function listTrainers(
  tenantId: string | null
): Promise<{ ok: boolean; error?: string; trainers: Trainer[] }> {
  const tenant = requireTenant(tenantId);
  if (!tenant) return { ok: false, error: NO_GYM, trainers: [] };

  const result = await callCrm(`/api/trainers?tenant_id=${tenant}`, { method: 'GET' });
  return { ok: result.ok, error: result.error, trainers: (result.body.trainers ?? []) as Trainer[] };
}

export async function createTrainer(
  tenantId: string | null,
  input: TrainerInput
): Promise<{ ok: boolean; error?: string; trainer?: Trainer }> {
  const tenant = requireTenant(tenantId);
  if (!tenant) return { ok: false, error: NO_GYM };

  const result = await callCrm('/api/trainers', {
    method: 'POST',
    body: JSON.stringify({ tenant_id: tenant, ...input }),
  });
  return { ok: result.ok, error: result.error, trainer: result.body.trainer as Trainer | undefined };
}

export async function updateTrainer(
  tenantId: string | null,
  trainerId: string,
  patch: Partial<TrainerInput>
): Promise<{ ok: boolean; error?: string; trainer?: Trainer }> {
  const tenant = requireTenant(tenantId);
  if (!tenant) return { ok: false, error: NO_GYM };

  const result = await callCrm('/api/trainers', {
    method: 'PATCH',
    body: JSON.stringify({ tenant_id: tenant, trainer_id: trainerId, ...patch }),
  });
  return { ok: result.ok, error: result.error, trainer: result.body.trainer as Trainer | undefined };
}

export async function deleteTrainer(
  tenantId: string | null,
  trainerId: string
): Promise<{ ok: boolean; error?: string }> {
  const tenant = requireTenant(tenantId);
  if (!tenant) return { ok: false, error: NO_GYM };

  const result = await callCrm('/api/trainers', {
    method: 'DELETE',
    body: JSON.stringify({ tenant_id: tenant, trainer_id: trainerId }),
  });
  return { ok: result.ok, error: result.error };
}

/**
 * Monthly payout. Reads fn_trainer_payout_report, so the commission maths lives
 * in Postgres next to the money instead of being re-derived in the browser.
 */
export async function loadPayoutReport(
  tenantId: string | null,
  from?: string | null,
  to?: string | null
): Promise<{ ok: boolean; error?: string; report?: PayoutReport }> {
  const tenant = requireTenant(tenantId);
  if (!tenant) return { ok: false, error: NO_GYM };

  const params = new URLSearchParams({ tenant_id: tenant });
  if (from) params.set('from', from);
  if (to) params.set('to', to);

  const result = await callCrm(`/api/trainers?${params.toString()}`, { method: 'GET' });
  return { ok: result.ok, error: result.error, report: result.body.payout as PayoutReport | undefined };
}

// -----------------------------------------------------------------------------
// PT subscription endpoints
// -----------------------------------------------------------------------------

export async function listSubscriptions(
  tenantId: string | null
): Promise<{ ok: boolean; error?: string; subscriptions: PtSubscription[] }> {
  const tenant = requireTenant(tenantId);
  if (!tenant) return { ok: false, error: NO_GYM, subscriptions: [] };

  const result = await callCrm(`/api/pt?tenant_id=${tenant}`, { method: 'GET' });
  return {
    ok: result.ok,
    error: result.error,
    subscriptions: (result.body.subscriptions ?? []) as PtSubscription[],
  };
}

/** Records one delivered PT session. The server clamps the counter, not the UI. */
export async function logSession(
  tenantId: string | null,
  subscriptionId: string
): Promise<{ ok: boolean; error?: string; punch?: SessionPunch }> {
  const tenant = requireTenant(tenantId);
  if (!tenant) return { ok: false, error: NO_GYM };

  const result = await callCrm('/api/pt', {
    method: 'POST',
    body: JSON.stringify({
      action: 'log_session',
      tenant_id: tenant,
      subscription_id: subscriptionId,
    }),
  });
  return { ok: result.ok, error: result.error, punch: result.body.punch as SessionPunch | undefined };
}

export async function createSubscription(
  tenantId: string | null,
  input: PtSubscriptionInput
): Promise<{ ok: boolean; error?: string; subscription?: PtSubscription }> {
  const tenant = requireTenant(tenantId);
  if (!tenant) return { ok: false, error: NO_GYM };

  const result = await callCrm('/api/pt', {
    method: 'POST',
    body: JSON.stringify({
      action: 'create_subscription',
      tenant_id: tenant,
      member_id: input.memberId,
      trainer_id: input.trainerId,
      total_sessions: input.totalSessions,
      amount_paid: input.amountPaid,
      start_date: input.startDate ?? null,
      end_date: input.endDate ?? null,
    }),
  });
  return {
    ok: result.ok,
    error: result.error,
    subscription: result.body.subscription as PtSubscription | undefined,
  };
}

// -----------------------------------------------------------------------------
// Store endpoints
// -----------------------------------------------------------------------------

export async function listProducts(
  tenantId: string | null
): Promise<{ ok: boolean; error?: string; products: Product[] }> {
  const tenant = requireTenant(tenantId);
  if (!tenant) return { ok: false, error: NO_GYM, products: [] };

  const result = await callCrm(`/api/store?tenant_id=${tenant}`, { method: 'GET' });
  return { ok: result.ok, error: result.error, products: (result.body.products ?? []) as Product[] };
}

export async function listOrders(
  tenantId: string | null,
  limit = 25
): Promise<{ ok: boolean; error?: string; orders: Order[] }> {
  const tenant = requireTenant(tenantId);
  if (!tenant) return { ok: false, error: NO_GYM, orders: [] };

  const result = await callCrm(`/api/store?tenant_id=${tenant}&orders=${limit}`, { method: 'GET' });
  return { ok: result.ok, error: result.error, orders: (result.body.orders ?? []) as Order[] };
}

export async function createProduct(
  tenantId: string | null,
  input: ProductInput
): Promise<{ ok: boolean; error?: string; product?: Product }> {
  const tenant = requireTenant(tenantId);
  if (!tenant) return { ok: false, error: NO_GYM };

  const result = await callCrm('/api/store', {
    method: 'POST',
    body: JSON.stringify({ tenant_id: tenant, ...input }),
  });
  return { ok: result.ok, error: result.error, product: result.body.product as Product | undefined };
}

export async function updateProduct(
  tenantId: string | null,
  productId: string,
  patch: Partial<ProductInput>
): Promise<{ ok: boolean; error?: string; product?: Product }> {
  const tenant = requireTenant(tenantId);
  if (!tenant) return { ok: false, error: NO_GYM };

  const result = await callCrm('/api/store', {
    method: 'PATCH',
    body: JSON.stringify({ tenant_id: tenant, product_id: productId, ...patch }),
  });
  return { ok: result.ok, error: result.error, product: result.body.product as Product | undefined };
}

/**
 * Adds stock to an existing line (a delivery, a stocktake correction). The delta
 * is applied server-side, so two tills receiving stock at the same time do not
 * overwrite each other the way an absolute "set quantity" would.
 */
export async function restockProduct(
  tenantId: string | null,
  productId: string,
  addQuantity: number
): Promise<{ ok: boolean; error?: string; product?: Product }> {
  const tenant = requireTenant(tenantId);
  if (!tenant) return { ok: false, error: NO_GYM };

  const result = await callCrm('/api/store', {
    method: 'PATCH',
    body: JSON.stringify({
      tenant_id: tenant,
      product_id: productId,
      add_stock: addQuantity,
    }),
  });
  return { ok: result.ok, error: result.error, product: result.body.product as Product | undefined };
}

export async function deleteProduct(
  tenantId: string | null,
  productId: string
): Promise<{ ok: boolean; error?: string }> {
  const tenant = requireTenant(tenantId);
  if (!tenant) return { ok: false, error: NO_GYM };

  const result = await callCrm('/api/store', {
    method: 'DELETE',
    body: JSON.stringify({ tenant_id: tenant, product_id: productId }),
  });
  return { ok: result.ok, error: result.error };
}

/**
 * Rings up a sale. The stock decrement, the order row and the receipt are all
 * written by fn_store_checkout in one transaction, so a partial sale is
 * impossible: either the whole cart is sold or nothing moves.
 */
export async function checkout(
  input: CheckoutInput
): Promise<{ ok: boolean; error?: string; receipt?: CheckoutReceipt }> {
  const tenant = requireTenant(input.tenantId);
  if (!tenant) return { ok: false, error: NO_GYM };

  const result = await callCrm('/api/store/checkout', {
    method: 'POST',
    body: JSON.stringify({
      tenant_id: tenant,
      member_id: isUuid(input.memberId) ? input.memberId : null,
      payment_method: input.paymentMethod ?? 'Cash/UPI',
      items: input.lines.map((line) => ({
        product_id: line.productId,
        quantity: line.quantity,
      })),
    }),
  });

  return { ok: result.ok, error: result.error, receipt: result.body.receipt as CheckoutReceipt | undefined };
}

/** Local date (not UTC) so a late-night shift does not file the month early. */
export function monthStartIso(reference = new Date()): string {
  const offset = reference.getTimezoneOffset() * 60_000;
  const local = new Date(reference.getTime() - offset);
  return `${local.toISOString().slice(0, 7)}-01`;
}

/** "12 Sep, 6:40 pm" — the till receipt timestamp. */
export function formatStamp(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}






