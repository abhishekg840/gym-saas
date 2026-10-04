'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { 
  Users, 
  AlertTriangle, 
  CheckCircle, 
  Plus, 
  Dumbbell, 
  Send, 
  QrCode, 
  Calendar, 
  RotateCw, 
  Trash2, 
  Search, 
  Download, 
  Tag, 
  FileText, 
  BarChart3, 
  Lock, 
  Unlock, 
  Target, 
  Fingerprint, 
  Building2, 
  LogOut,
  Snowflake,
  ArrowRightLeft,
  ServerCog,
  ShoppingBag,
  Settings,
  Trophy,
  UserRound,
  CreditCard,
  Menu,
  X,
  Bell,
  ChevronDown,
  MoreHorizontal,
  ArrowUpRight
} from 'lucide-react';
import Link from 'next/link';
import {
  freezeMembership,
  unfreezeMembership,
  transferMembership,
  type MembershipResult,
} from '@/lib/membership';
import { convertLead, takeEnrollPrefill } from '@/lib/crm';
import { hardSignOut } from '@/lib/logout';
import { useLiveCrowd } from '@/lib/live-crowd';
import { gymClock, initialsOf, relativeTime } from '@/lib/live-attendance';
import RfidLinkModal from '@/components/rfid-link-modal';
import { clearSession, readSession } from '@/lib/session';
import { waLink, waMessages } from '@/lib/whatsapp';

interface Plan {
  id: string;
  name: string;
  duration_days: number;
  price: number;
}

interface Member {
  id: string;
  full_name: string;
  phone: string;
  email?: string;
  emergency_contact?: string;
  biometric_id?: number | null;
  /** Phase 12: the linked card serial. Shown in the Link RFID / Bio modal. */
  rfid_card?: string | null;
  membership_end: string;
  status: string;
  amount_paid?: number;
  tenant_id?: string | null;
  is_frozen?: boolean;
  freeze_start_date?: string | null;
  freeze_end_date?: string | null;
  total_freeze_days?: number | null;
  plans?: {
    name: string;
  } | null;
}

interface GymSession {
  userId: string;
  role: string;
  name: string;
  phone: string;
  tenantId?: string | null;
  tenantName?: string | null;
}

// -----------------------------------------------------------------------------
// Overview day metrics â€” pure helpers
//
// Both the revenue and the attendance strip need "today", and "today" here is
// the GYM's day (Asia/Kolkata), matching how the attendance board windows its
// rows: a desk abroad must still read the gym's clock.
// -----------------------------------------------------------------------------

/** Midnight of today in the gym's timezone, as an ISO instant. */
function istDayStartIso(now = new Date()): string {
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return `${day}T00:00:00+05:30`;
}

/** Hour of a punch on the gym's clock, 0â€“23. */
function istHour(iso: string): number | null {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return null;
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      hour12: false,
    }).format(value)
  );
  return Number.isFinite(hour) ? ((hour % 24) + 24) % 24 : null;
}

interface DayAttendance {
  /** Entry punches today (direction 'in'; pre-checkout-era rows count as 'in'). */
  checkins: number;
  /** Busiest hour window on the gym clock â€” "18:00â€“19:00", or null. */
  peak: string | null;
  peakHour: number | null;
  /** Mean inâ†’out duration across completed visits â€” "48 min", or null. */
  avgVisit: string | null;
  /** 24 hourly buckets of entry punches, for the subtle activity strip. */
  hist: number[];
}

function formatVisit(ms: number): string {
  const mins = Math.max(1, Math.round(ms / 60_000));
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  return rest ? `${hours} hr ${rest} m` : `${hours} hr`;
}

/**
 * Derives the "Today's attendance" numbers from raw tenant punches. Visit
 * duration pairs each member's entry with their next exit on the same day â€” a
 * visit still open (member inside now) contributes nothing, which is the
 * honest answer until they punch out.
 */
function computeDayAttendance(
  rows: { punch_time: string; direction: string | null; member_id: string | null }[]
): DayAttendance {
  const hist = new Array<number>(24).fill(0);
  const eventsByMember = new Map<string, { t: number; dir: string }[]>();

  for (const row of rows) {
    // Rows written before migration 0012 carry direction NULL; they predate
    // checkout punches, so every one of them was an entry.
    const dir = row.direction || 'in';
    const t = Date.parse(row.punch_time);
    if (Number.isNaN(t)) continue;

    if (dir === 'in') {
      const hour = istHour(row.punch_time);
      if (hour !== null) hist[hour] += 1;
    }

    if (row.member_id) {
      const list = eventsByMember.get(row.member_id) ?? [];
      list.push({ t, dir });
      eventsByMember.set(row.member_id, list);
    }
  }

  const checkins = hist.reduce((sum, n) => sum + n, 0);

  let peakHour: number | null = null;
  for (let h = 0; h < 24; h += 1) {
    if (hist[h] > 0 && (peakHour === null || hist[h] > hist[peakHour])) {
      peakHour = h;
    }
  }
  const peak =
    peakHour === null
      ? null
      : `${String(peakHour).padStart(2, '0')}:00â€“${String((peakHour + 1) % 24).padStart(2, '0')}:00`;

  const durations: number[] = [];
  for (const events of eventsByMember.values()) {
    events.sort((a, b) => a.t - b.t);
    let enteredAt: number | null = null;
    for (const event of events) {
      if (event.dir === 'in') {
        if (enteredAt === null) enteredAt = event.t;
      } else if (enteredAt !== null) {
        durations.push(event.t - enteredAt);
        enteredAt = null;
      }
    }
  }

  const avgVisit = durations.length
    ? formatVisit(durations.reduce((sum, n) => sum + n, 0) / durations.length)
    : null;

  return { checkins, peak, peakHour, avgVisit, hist };
}

/** Whole days until a YYYY-MM-DD expiry (0 = today, negative = past). */
function daysUntil(dateStr: string): number {
  const target = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(target.getTime())) return Number.POSITIVE_INFINITY;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

/** Quiet ghost button used by the Quick Actions row. */
const QA_CLASS =
  'inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] text-neutral-300 transition hover:bg-neutral-800 hover:text-white';

/** Menu row styling shared by the profile dropdown and row menus. */
const MENU_ITEM =
  'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-neutral-300 transition hover:bg-neutral-900 hover:text-white';

export default function GymDashboard() {
  const router = useRouter();
  const [session, setSession] = useState<GymSession | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterTab, setFilterTab] = useState<'all' | 'active' | 'expiring' | 'expired' | 'frozen'>('all');

  // Membership transfer modal: null = closed. Owner-only action.
  const [transferTarget, setTransferTarget] = useState<Member | null>(null);

  // RFID / fingerprint linking modal (Phase 12): null = closed.
  const [linkTarget, setLinkTarget] = useState<Member | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [transferName, setTransferName] = useState('');
  const [transferPhone, setTransferPhone] = useState('');
  const [transferBusy, setTransferBusy] = useState(false);
  
  const [currentRole, setCurrentRole] = useState<'owner' | 'reception'>('owner');
  const [pinPrompt, setPinPrompt] = useState(false);
  const [enteredPin, setEnteredPin] = useState('');

  // Form States
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [emergencyPhone, setEmergencyPhone] = useState('');
  const [biometricId, setBiometricId] = useState('');
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [amountPaid, setAmountPaid] = useState('');
  const [loading, setLoading] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);

  // Set when the enrolment was started from a card on /leads: the lead id rides
  // along so a successful enrolment can convert that card too.
  const [enrollLeadId, setEnrollLeadId] = useState<string | null>(null);
  const [enrollBanner, setEnrollBanner] = useState<string | null>(null);

  // Failure of the CURRENT enrolment attempt, rendered inside the form instead
  // of a blocking window.alert(): the desk keeps whatever they typed and can act
  // on the message (e.g. "run migration 0016") without losing the form.
  const [enrollError, setEnrollError] = useState<string | null>(null);

  // Set after a successful enrolment: everything the WhatsApp onboarding
  // message needs. Offered as a button rather than auto-opened, because a tab
  // spawned after the awaits in addMember() would be blocked as a popup.
  const [welcomeInvite, setWelcomeInvite] = useState<{
    name: string;
    phone: string;
    endDate: string;
  } | null>(null);

  // ---- Desk UI state (presentation only; no business logic lives here) ------
  // The enrolment form lives in a right-side drawer so the dashboard stays an
  // operations view. A lead hand-off (applyEnrollPrefill) opens it automatically.
  const [enrollOpen, setEnrollOpen] = useState(false);
  // "View" in the table: a read-only detail sheet for one member.
  const [viewTarget, setViewTarget] = useState<Member | null>(null);
  // Quick-action member picker: which command to run once a member is chosen.
  const [pickerMode, setPickerMode] = useState<'link' | 'extend' | null>(null);
  const [pickerTerm, setPickerTerm] = useState('');
  // One open row "More" menu at a time, plus the open header dropdown.
  const [openRowMenu, setOpenRowMenu] = useState<string | null>(null);
  const [openDropdown, setOpenDropdown] = useState<
    'profile' | 'more' | 'notif' | 'mobile' | null
  >(null);

  // Today's read-only metrics; null until the fetch resolves (renders "â€”").
  const [todayRevenue, setTodayRevenue] = useState<number | null>(null);
  const [paymentCount, setPaymentCount] = useState<number | null>(null);
  const [attStats, setAttStats] = useState<DayAttendance | null>(null);

  // Live occupancy behind the "Attendance Live" panel â€” the same useLiveCrowd
  // hook the old card used, so the data path is unchanged, only its shape.
  const crowd = useLiveCrowd(session?.tenantId ?? null);

  useEffect(() => {
    const parsed = readSession();
    if (!parsed) {
      router.push('/login');
      return;
    }

    // The session lives in localStorage, which only exists in the browser, so it
    // can only be read after hydration â€” this setState is the effect's whole job.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSession(parsed);
    if (parsed.role === 'receptionist') {
      setCurrentRole('reception');
    }
    fetchPlans(parsed.tenantId);
    fetchMembers(parsed.tenantId);
    fetchTodayStats(parsed.tenantId);
    // A card on /leads can hand a prospect over to this form. The payload sits
    // in localStorage rather than the URL, so a phone number never lands in
    // browser history, and takeEnrollPrefill clears it on read.
    applyEnrollPrefill();
  }, [router]);

  // Header dropdowns and row "More" menus dismiss on an outside click or any
  // scroll, so a menu can never be left floating over a table the desk has
  // scrolled past. Attaching with capture keeps the scroll handler working for
  // scrollable ancestors too.
  useEffect(() => {
    if (!openDropdown && !openRowMenu) return;

    function dismiss() {
      setOpenDropdown(null);
      setOpenRowMenu(null);
    }

    function onDown(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (target && target.closest('[data-menu-root]')) return;
      dismiss();
    }

    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', dismiss, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', dismiss, true);
    };
  }, [openDropdown, openRowMenu]);

  /**
   * Fills the enrolment form from the Lead Pipeline hand-off and remembers which
   * lead it came from, so submitting can flip that card to Converted.
   */
  function applyEnrollPrefill() {
    const prefill = takeEnrollPrefill();
    if (!prefill) return;

    setName(prefill.name);
    setPhone(prefill.phone);
    setEmail(prefill.email ?? '');
    setEnrollLeadId(prefill.leadId);
    setEnrollBanner(prefill.name);
    // The form lives in a drawer now: the lead hand-off must surface it or the
    // pre-filled prospect would land behind a closed panel.
    setEnrollOpen(true);
  }

  async function fetchPlans(tenantId?: string | null) {
    let query = supabase.from('plans').select('id, name, duration_days, price');
    if (tenantId) {
      query = query.or(`tenant_id.eq.${tenantId},tenant_id.is.null`);
    }
    const { data } = await query;
    if (data && data.length > 0) {
      setPlans(data);
      setSelectedPlanId(data[0].id);
      setAmountPaid(data[0].price.toString());
    }
  }

  async function fetchMembers(tenantId?: string | null) {
    // Never run this unscoped: with no gym on the session the query would return
    // every tenant's members. The dashboard is always a single-gym view.
    if (!tenantId) {
      setMembers([]);
      console.warn('Member list not loaded: no gym is linked to this session.');
      return;
    }

    const { data, error } = await supabase
      .from('members')
      .select('*, plans(name)')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (data) setMembers(data as unknown as Member[]);
    if (error) console.error('Fetch error:', error.message);
  }

  /**
   * Read-only day metrics for the overview panels: today's invoices (revenue)
   * and today's punches (attendance numbers). Both queries are tenant-scoped
   * with the same eq-filter pattern fetchMembers uses, they only ever read
   * tables this console already reads, and a failure degrades to "â€”" instead of
   * breaking the desk. No pre-existing query is modified.
   */
  async function fetchTodayStats(tenantId?: string | null) {
    if (!tenantId) return;
    const dayStart = istDayStartIso();

    const [invoices, punches] = await Promise.all([
      supabase
        .from('invoices')
        .select('amount')
        .eq('tenant_id', tenantId)
        .gte('issued_at', dayStart),
      supabase
        .from('attendances')
        .select('punch_time, direction, member_id')
        .eq('tenant_id', tenantId)
        .gte('punch_time', dayStart),
    ]);

    if (invoices.data) {
      setTodayRevenue(
        invoices.data.reduce((sum, row) => sum + (Number(row.amount) || 0), 0)
      );
      setPaymentCount(invoices.data.length);
    }
    if (punches.data) setAttStats(computeDayAttendance(punches.data));
  }

  function handleLogout() {
    // Was `clearSession(); router.push('/login')` â€” the same bug as the member
    // side: the gym session was dropped but Supabase's tokens survived, so the
    // background auto-refresh silently signed the owner straight back in.
    void hardSignOut();
  }

  function handlePlanChange(planId: string) {
    setSelectedPlanId(planId);
    const chosen = plans.find(p => p.id === planId);
    if (chosen) {
      setAmountPaid(chosen.price.toString());
    }
  }

  /**
   * Maps a raw PostgREST/Postgres failure from the enrolment INSERT into text
   * the desk can act on, instead of the bare database string a window.alert()
   * used to show. The RLS case is called out because it is not a form mistake:
   * it means the database is missing the Phase 16 policies, and only running
   * that migration can fix it.
   */
  function describeEnrollError(error: { message?: string | null } | null): string {
    const raw = error?.message?.trim() || 'The member could not be enrolled.';
    if (raw.includes('row-level security')) {
      return 'Enrollment was blocked by the database security policy. Run 0016_phase16_members_desk_write.sql in the Supabase SQL Editor, then try again.';
    }
    if (raw.includes('null value in column')) {
      return 'A required enrollment field is empty â€” check the full name, phone and membership plan.';
    }
    if (raw.includes('duplicate key value')) {
      return 'A member with that email already exists â€” clear the email field or use a different one.';
    }
    return raw;
  }

  async function addMember(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setEnrollError(null);

    // Nothing below may escape as an unhandled rejection: supabase-js can
    // reject on a network drop, and an escaped error would leave the button
    // stuck on "Enrolling..." with no message. Everything lands in enrollError.
    try {
      const chosenPlan = plans.find(p => p.id === selectedPlanId);
      const durationDays = chosenPlan ? chosenPlan.duration_days : 30;

      const endDate = new Date();
      endDate.setDate(endDate.getDate() + durationDays);
      const feeAmount = parseFloat(amountPaid) || 0;

      const { data: memberData, error: memberError } = await supabase
        .from('members')
        .insert([
          {
            full_name: name.trim(),
            phone: phone.trim(),
            email: email.trim() || null,
            emergency_contact: emergencyPhone.trim() || null,
            biometric_id: biometricId ? parseInt(biometricId) : null,
            plan_id: selectedPlanId || null,
            amount_paid: feeAmount,
            // Sent explicitly because both server-side enrolment paths
            // (fn_lead_convert_to_member and the transfer function) set it too:
            // the desk payload must not depend on an unknown column default.
            membership_start: new Date().toISOString().split('T')[0],
            membership_end: endDate.toISOString().split('T')[0],
            status: 'active',
            tenant_id: session?.tenantId || null
          }
        ])
        .select()
        .single();

      if (memberError || !memberData) {
        setEnrollError(describeEnrollError(memberError));
        return;
      }

      await supabase.from('invoices').insert([
        {
          member_id: memberData.id,
          amount: feeAmount,
          payment_method: 'Cash/UPI',
          status: 'paid'
        }
      ]);

      setName('');
      setPhone('');
      setEmail('');
      setEmergencyPhone('');
      setBiometricId('');

      // When the enrolment began on a pipeline card, link the lead to the member
      // we just created and flip it to Converted. convertLead refuses a second
      // conversion, so a re-submitted form cannot mint a duplicate membership.
      if (enrollLeadId) {
        const linked = await convertLead({
          tenantId: session?.tenantId ?? null,
          leadId: enrollLeadId,
          memberId: memberData.id,
          planId: selectedPlanId || null,
          amountPaid: feeAmount,
        });

        if (!linked.ok) {
          setEnrollError(
            linked.error ||
              'The member was enrolled, but the lead could not be marked converted. Convert it from the pipeline.'
          );
        }
        setEnrollLeadId(null);
        setEnrollBanner(null);
      }

      // Offer the WhatsApp onboarding message for the member we just created:
      // portal link, pass instructions and expiry, sent from the shared
      // template so the console and the cron word it identically.
      setWelcomeInvite({
        name: memberData.full_name || name.trim(),
        phone: memberData.phone,
        endDate: memberData.membership_end,
      });

      fetchMembers(session?.tenantId);
    } catch (err) {
      setEnrollError(
        err instanceof Error ? err.message : 'Enrollment failed unexpectedly. Please retry.'
      );
    } finally {
      setLoading(false);
    }
  }

  async function renewMember(member: Member) {
    setActionId(member.id);
    const currentEnd = new Date(member.membership_end);
    const today = new Date();
    const baseDate = currentEnd > today ? currentEnd : today;

    baseDate.setDate(baseDate.getDate() + 30);
    const newEndStr = baseDate.toISOString().split('T')[0];

    const { error } = await supabase
      .from('members')
      .update({ membership_end: newEndStr, status: 'active' })
      .eq('id', member.id);

    if (!error) {
      await supabase.from('invoices').insert([
        {
          member_id: member.id,
          amount: member.amount_paid || 1500,
          payment_method: 'Renewal',
          status: 'paid'
        }
      ]);
      fetchMembers(session?.tenantId);
    } else {
      alert(error.message);
    }
    setActionId(null);
  }

  async function deleteMember(member: Member) {
    if (currentRole !== 'owner') {
      alert('Only Owner role can delete member profiles.');
      return;
    }
    if (!confirm(`Are you sure you want to remove ${member.full_name}?`)) return;

    setActionId(member.id);
    const { error } = await supabase.from('members').delete().eq('id', member.id);

    if (!error) {
      fetchMembers(session?.tenantId);
    } else {
      alert(error.message);
    }
    setActionId(null);
  }

  /**
   * Freeze / unfreeze / transfer are delegated to /api/membership/actions, which
   * runs the tenant-checked Postgres functions. The dashboard never edits the
   * membership columns directly, so the freeze day maths lives in exactly one
   * place and cannot drift from what the gate enforces.
   */
  function requireTenant(): string {
    const tenantId = session?.tenantId ?? '';
    if (!tenantId) throw new Error('No gym is linked to this session. Sign in again.');
    return tenantId;
  }

  function reportFailure(res: MembershipResult) {
    alert(res.error || 'The gym server rejected this action.');
  }

  async function freezeMember(member: Member) {
    if (!confirm(`Freeze ${member.full_name}'s membership? Gate access stops immediately.`)) return;

    setActionId(member.id);
    try {
      const res = await freezeMembership(member.id, requireTenant());
      if (!res.ok) reportFailure(res);
      else fetchMembers(session?.tenantId);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Freeze failed');
    }
    setActionId(null);
  }

  async function unfreezeMember(member: Member) {
    setActionId(member.id);
    try {
      const res = await unfreezeMembership(member.id, requireTenant());
      if (!res.ok) reportFailure(res);
      else fetchMembers(session?.tenantId);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Unfreeze failed');
    }
    setActionId(null);
  }

  function openTransferModal(member: Member) {
    if (currentRole !== 'owner') {
      alert('Only Owner role can transfer a membership to another person.');
      return;
    }
    setTransferTarget(member);
    setTransferName('');
    setTransferPhone('');
  }

  /**
   * Saves a tapped or typed credential (Phase 12).
   *
   * The roster row is refreshed in place from the response rather than
   * re-fetching the whole member list: linking a card is a single-cell change,
   * and refetching would make the desk lose scroll position and search text for
   * no benefit.
   *
   * Note the modal passes `biometricId: null` when the owner leaves the field
   * blank, which the modal treats as "no change". Clearing a slot is a separate,
   * explicit action so an empty input can never silently wipe a fingerprint.
   */
  async function saveHardwareCredential(input: {
    rfidUid: string | null;
    biometricId: number | null;
  }) {
    if (!linkTarget) return;

    setLinkBusy(true);
    try {
      const response = await fetch('/api/hardware/link', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant_id: requireTenant(),
          member_id: linkTarget.id,
          rfid_uid: input.rfidUid,
          biometric_id: input.biometricId,
        }),
      });

      const result = (await response.json()) as { ok?: boolean; error?: string };

      if (!response.ok || !result.ok) {
        throw new Error(result.error ?? 'Could not save that credential.');
      }

      setMembers(prev =>
        prev.map(m =>
          m.id === linkTarget.id
            ? {
                ...m,
                rfid_card: input.rfidUid ?? m.rfid_card,
                // Only overwrite the slot when one was actually supplied.
                biometric_id: input.biometricId ?? m.biometric_id,
              }
            : m
        )
      );

      // Success is reported inside the modal by its own closing (the row updates
      // and the dialog disappears), so a toast here would only duplicate it. The
      // thrown Error carries the database message â€” e.g. "That card is already
      // linked to another member" â€” which the modal displays verbatim.
    } finally {
      setLinkBusy(false);
    }
  }

  async function submitTransfer(e: React.FormEvent) {
    e.preventDefault();
    if (!transferTarget) return;

    setTransferBusy(true);
    try {
      const res = await transferMembership({
        memberId: transferTarget.id,
        tenantId: requireTenant(),
        toName: transferName,
        toPhone: transferPhone,
      });

      if (!res.ok) {
        reportFailure(res);
      } else {
        alert(
          `Transferred ${transferTarget.full_name} to ${res.to_name ?? transferName} â€” ` +
            `${res.transferred_days ?? 0} days carried over.`
        );
        setTransferTarget(null);
        fetchMembers(session?.tenantId);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Transfer failed');
    }
    setTransferBusy(false);
  }

  async function viewLatestInvoice(memberId: string) {
    const { data } = await supabase
      .from('invoices')
      .select('id')
      .eq('member_id', memberId)
      .order('issued_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data) {
      window.open(`/invoice/${data.id}`, '_blank');
    } else {
      alert('No invoice receipt generated yet.');
    }
  }

  function sendWhatsAppReminder(member: Member) {
    const cleanPhone = member.phone.replace(/[^0-9]/g, '');
    const phoneWithCountry = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
    const gymTitle = encodeURIComponent(session?.tenantName || 'Fitness Club');
    const upiPayLink = `upi://pay?pa=paytmqr@paytm&pn=${gymTitle}&am=${member.amount_paid || 1500}&cu=INR`;

    const message = encodeURIComponent(
      `Hello ${member.full_name}! ðŸ‘‹\n\nYour membership at ${session?.tenantName || 'Fitness Club'} ended on ${member.membership_end}.\n\nðŸ’³ Pay directly via UPI to instantly unblock your gate access:\n${upiPayLink}\n\nThank you!`
    );

    window.open(`https://wa.me/${phoneWithCountry}?text=${message}`, '_blank');
  }

  /**
   * Opens the onboarding chat for the member just enrolled. The body comes
   * from lib/whatsapp's shared `welcome` template â€” the one built for Module
   * 9.2 â€” with one console-specific line appended: the pass link lands on the
   * portal login, so the message says how to get in. The default password is
   * deliberately NOT written into the message; the desk hands it over
   * verbally and /setup-password forces a replacement at first sign-in.
   */
  function sendOnboardingWelcome() {
    if (!welcomeInvite) return;

    const origin = window.location.origin;
    const message =
      waMessages.welcome({
        name: welcomeInvite.name,
        gymName: session?.tenantName || 'our gym',
        passUrl: `${origin}/member/dashboard`,
        expiry: welcomeInvite.endDate,
      }) +
      `\n\nSign in at ${origin}/login with this number â€” the front desk shares your initial password, and you will set your own on first login.`;

    window.open(waLink(welcomeInvite.phone, message), '_blank', 'noopener');
    setWelcomeInvite(null);
  }

  function exportToCSV() {
    if (members.length === 0) return alert('No members to export.');

    const headers = ['Full Name', 'Phone', 'Email', 'Biometric ID', 'Plan', 'Expiry Date', 'Status', 'Fee Paid'];
    const rows = members.map(m => [
      `"${m.full_name}"`,
      `"${m.phone}"`,
      `"${m.email || ''}"`,
      `"${m.biometric_id || 'N/A'}"`,
      `"${m.plans?.name || 'Custom'}"`,
      `"${m.membership_end}"`,
      `"${m.is_frozen ? 'Frozen' : new Date(m.membership_end) < new Date() ? 'Expired' : 'Active'}"`,
      `"${m.amount_paid || 0}"`
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `${(session?.tenantName || 'gym').toLowerCase().replace(/\s+/g, '_')}_members_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function handleSwitchRole() {
    if (currentRole === 'owner') {
      setCurrentRole('reception');
    } else {
      setPinPrompt(true);
    }
  }

  function verifyPin(e: React.FormEvent) {
    e.preventDefault();
    if (enteredPin === '1111' || enteredPin === '1234') {
      setCurrentRole('owner');
      setPinPrompt(false);
      setEnteredPin('');
    } else {
      alert('Invalid Owner PIN (Default: 1234)');
    }
  }

  // A frozen pass is neither active nor expired, so count it separately to keep
  // the summary tiles from double-counting the same member.
  const frozenCount = members.filter((m) => m.is_frozen).length;
  const activeCount = members.filter(
    (m) => !m.is_frozen && new Date(m.membership_end) >= new Date()
  ).length;
  const expiredCount = members.filter(
    (m) => !m.is_frozen && new Date(m.membership_end) < new Date()
  ).length;
  // Expiring soon: still valid today but running out within a week â€” the number
  // the desk acts on. Frozen passes are excluded, they cannot lapse on hold.
  const expiringSoon = members.filter(
    (m) =>
      !m.is_frozen &&
      new Date(m.membership_end) >= new Date() &&
      daysUntil(m.membership_end) <= 7
  );
  const expiringCount = expiringSoon.length;

  const filteredMembers = members.filter(member => {
    const isExpired = new Date(member.membership_end) < new Date();
    const matchesSearch = 
      member.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      member.phone.includes(searchTerm) ||
      (member.biometric_id && member.biometric_id.toString().includes(searchTerm));

    if (!matchesSearch) return false;
    // Frozen is its own bucket: a frozen pass must not read as merely active.
    if (filterTab === 'frozen') return Boolean(member.is_frozen);
    if (filterTab === 'expiring')
      return (
        !isExpired &&
        !member.is_frozen &&
        daysUntil(member.membership_end) <= 7
      );
    if (filterTab === 'active') return !isExpired && !member.is_frozen;
    if (filterTab === 'expired') return isExpired && !member.is_frozen;
    return true;
  });

  // ---- Presentation helpers -------------------------------------------------
  // Row menus are plain render functions rather than child components: their
  // open state lives at page level, so React never remounts them mid-click.
  function scrollToMembers() {
    document
      .getElementById('members')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const emptyRoster = (
    <div className="px-6 py-14 text-center">
      <p className="text-sm text-neutral-400">No members match this view.</p>
      <p className="mt-1 text-xs text-neutral-600">
        Enrol your first member with{' '}
        <span className="text-neutral-400">Add Member</span> â€” the roster
        refreshes the moment they are created.
      </p>
    </div>
  );

  const pickerQuery = pickerTerm.trim().toLowerCase();
  const pickerMembers = members
    .filter(
      (m) =>
        !pickerQuery ||
        m.full_name.toLowerCase().includes(pickerQuery) ||
        m.phone.includes(pickerQuery)
    )
    .slice(0, 40);

  /** The "â€¦" menu â€” one implementation shared by the table and the mobile list. */
  function renderRowMenu(member: Member) {
    const isExpired = new Date(member.membership_end) < new Date();
    const isFrozen = Boolean(member.is_frozen);
    const isProcessing = actionId === member.id;
    const isOpen = openRowMenu === member.id;
    const item =
      'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-neutral-300 transition hover:bg-neutral-900 hover:text-white disabled:opacity-40 disabled:hover:bg-transparent';

    return (
      <div className="relative" data-menu-root>
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={isOpen}
          title="More actions"
          onClick={() => setOpenRowMenu(isOpen ? null : member.id)}
          className="rounded-md p-1.5 text-neutral-500 transition hover:bg-neutral-800 hover:text-white"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>

        {isOpen && (
          <div
            role="menu"
            className="absolute right-0 top-full z-30 mt-1 w-52 rounded-md border border-neutral-700 bg-neutral-950 py-1 shadow-xl"
          >
            <button
              type="button"
              disabled={linkBusy}
              onClick={() => {
                setOpenRowMenu(null);
                setLinkTarget(member);
              }}
              className={item}
            >
              <CreditCard className="h-3.5 w-3.5 text-neutral-500" />
              Link RFID / Biometric
            </button>
            <button
              type="button"
              disabled={isProcessing}
              onClick={() => {
                setOpenRowMenu(null);
                renewMember(member);
              }}
              className={item}
            >
              <RotateCw
                className={`h-3.5 w-3.5 text-neutral-500 ${isProcessing ? 'animate-spin' : ''}`}
              />
              Extend 30 days
            </button>
            {isFrozen ? (
              <button
                type="button"
                disabled={isProcessing}
                onClick={() => {
                  setOpenRowMenu(null);
                  unfreezeMember(member);
                }}
                className={item}
                title={`Resume membership${member.freeze_end_date ? ` (frozen until ${member.freeze_end_date})` : ''}`}
              >
                <Unlock className="h-3.5 w-3.5 text-neutral-500" />
                Resume membership
              </button>
            ) : (
              <button
                type="button"
                disabled={isProcessing || isExpired}
                onClick={() => {
                  setOpenRowMenu(null);
                  freezeMember(member);
                }}
                className={item}
                title="Freeze membership â€” gate access stops immediately"
              >
                <Snowflake className="h-3.5 w-3.5 text-neutral-500" />
                Freeze
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setOpenRowMenu(null);
                void viewLatestInvoice(member.id);
              }}
              className={item}
            >
              <FileText className="h-3.5 w-3.5 text-neutral-500" />
              Invoice / receipt
            </button>

            {currentRole === 'owner' && (
              <button
                type="button"
                onClick={() => {
                  setOpenRowMenu(null);
                  openTransferModal(member);
                }}
                className={item}
              >
                <ArrowRightLeft className="h-3.5 w-3.5 text-neutral-500" />
                Transfer membership
              </button>
            )}

            {isExpired && (
              <button
                type="button"
                onClick={() => {
                  setOpenRowMenu(null);
                  sendWhatsAppReminder(member);
                }}
                className={item}
              >
                <Send className="h-3.5 w-3.5 text-neutral-500" />
                WhatsApp UPI reminder
              </button>
            )}

            {currentRole === 'owner' && (
              <>
                <div className="my-1 border-t border-neutral-800" />
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={() => {
                    setOpenRowMenu(null);
                    void deleteMember(member);
                  }}
                  className={`${item} text-rose-400 hover:bg-rose-500/10 hover:text-rose-300`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete member
                </button>
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      {/* ---- Tap-to-enroll / credential linking (Phase 12) -----------------
          Mounted at the page root so the desk can open it from any row without
          the table needing to own the modal's state. */}
      {linkTarget && (
        <RfidLinkModal
          tenantId={session?.tenantId ?? null}
          memberId={linkTarget.id}
          memberName={linkTarget.full_name}
          initialUid={linkTarget.rfid_card ?? null}
          initialBiometricId={linkTarget.biometric_id ?? null}
          onClose={() => setLinkTarget(null)}
          onSave={saveHardwareCredential}
        />
      )}

      {transferTarget && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
          <form
            onSubmit={submitTransfer}
            className="bg-neutral-900 border border-neutral-800 p-6 rounded-lg w-full max-w-md"
          >
            <h3 className="text-sm font-bold text-white mb-1 flex items-center gap-2">
              <ArrowRightLeft className="w-4 h-4 text-amber-400" /> Transfer Membership
            </h3>
            <p className="text-xs text-neutral-400 mb-5 leading-relaxed">
              {transferTarget.full_name}&apos;s remaining valid days move onto a new member profile.
              The current profile is closed as <span className="text-neutral-200">transferred</span>.
            </p>

            <label className="block text-[10px] uppercase tracking-wider text-neutral-500 mb-1.5">
              Recipient Name
            </label>
            <input
              autoFocus
              value={transferName}
              onChange={(e) => setTransferName(e.target.value)}
              placeholder="Full name"
              className="w-full bg-neutral-950 border border-neutral-800 rounded-md px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500 mb-4"
            />

            <label className="block text-[10px] uppercase tracking-wider text-neutral-500 mb-1.5">
              Recipient Phone (10 digits)
            </label>
            <input
              value={transferPhone}
              onChange={(e) => setTransferPhone(e.target.value)}
              placeholder="9876543210"
              inputMode="numeric"
              className="w-full bg-neutral-950 border border-neutral-800 rounded-md px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500 font-mono mb-6"
            />

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setTransferTarget(null)}
                className="flex-1 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-neutral-300 py-2 rounded-md text-xs font-semibold transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={transferBusy}
                className="flex-1 bg-amber-500 hover:bg-amber-600 text-black py-2 rounded-md text-xs font-bold uppercase tracking-wider transition disabled:opacity-50"
              >
                {transferBusy ? 'Transferring...' : 'Confirm Transfer'}
              </button>
            </div>
          </form>
        </div>
      )}

      {pinPrompt && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
          <div className="bg-neutral-900 border border-neutral-800 p-6 rounded-lg w-full max-w-xs text-center">
            <Lock className="w-8 h-8 text-amber-400 mx-auto mb-2" />
            <h3 className="font-bold text-base mb-1">Enter Owner PIN</h3>
            <p className="text-xs text-neutral-400 mb-4">Required to switch to full Owner Admin mode.</p>
            <form onSubmit={verifyPin} className="space-y-3">
              <input
                type="password"
                maxLength={4}
                autoFocus
                value={enteredPin}
                onChange={e => setEnteredPin(e.target.value)}
                placeholder="****"
                className="w-full bg-neutral-950 border border-neutral-800 text-center tracking-widest text-xl rounded-md py-2 focus:border-amber-400 focus:outline-none"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPinPrompt(false)}
                  className="w-1/2 bg-neutral-800 py-2 rounded-md text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="w-1/2 bg-amber-500 font-bold text-black py-2 rounded-md text-xs"
                >
                  Verify
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ---- Header -------------------------------------------------------
          One calm row: identity and desk role on the left, section navigation
          in the middle, utilities on the right. Everything secondary sits in
          "More" and the profile menu, so the bar never becomes a pill wall.
          Every target is a route the old toolbar already linked to. */}
      <header className="sticky top-0 z-40 border-b border-neutral-800 bg-neutral-950">
        <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-4 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-neutral-700 bg-neutral-900">
              <Dumbbell className="h-4 w-4 text-white" />
            </div>
            <div className="min-w-0 leading-tight">
              <p className="truncate text-[13px] font-semibold text-white">
                {session?.tenantName || 'Gym'}
              </p>
              <p className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-neutral-500">
                Vyroniq
                <span aria-hidden="true">Â·</span>
                <button
                  type="button"
                  onClick={handleSwitchRole}
                  title="Switch desk role (Owner / Reception)"
                  className="inline-flex items-center gap-1 text-neutral-400 transition hover:text-white"
                >
                  {currentRole === 'owner' ? (
                    <Unlock className="h-2.5 w-2.5" />
                  ) : (
                    <Lock className="h-2.5 w-2.5" />
                  )}
                  {currentRole === 'owner' ? 'Owner' : 'Reception'}
                </button>
              </p>
            </div>
          </div>

          <nav
            aria-label="Dashboard sections"
            className="hidden flex-1 items-center justify-center gap-0.5 lg:flex"
          >
            <span className="rounded-md bg-neutral-900 px-3 py-1.5 text-[13px] font-medium text-white">
              Overview
            </span>
            <button
              type="button"
              onClick={scrollToMembers}
              className="rounded-md px-3 py-1.5 text-[13px] text-neutral-400 transition hover:bg-neutral-900 hover:text-white"
            >
              Members
            </button>
            <Link
              href="/attendance"
              className="rounded-md px-3 py-1.5 text-[13px] text-neutral-400 transition hover:bg-neutral-900 hover:text-white"
            >
              Attendance
            </Link>
            <Link
              href="/store"
              title="Counter, POS and payments"
              className="rounded-md px-3 py-1.5 text-[13px] text-neutral-400 transition hover:bg-neutral-900 hover:text-white"
            >
              Payments
            </Link>
            <Link
              href="/trainers"
              className="rounded-md px-3 py-1.5 text-[13px] text-neutral-400 transition hover:bg-neutral-900 hover:text-white"
            >
              Trainers
            </Link>
            {currentRole === 'owner' && (
              <Link
                href="/analytics"
                className="rounded-md px-3 py-1.5 text-[13px] text-neutral-400 transition hover:bg-neutral-900 hover:text-white"
              >
                Analytics
              </Link>
            )}
            <div className="relative" data-menu-root>
              <button
                type="button"
                aria-haspopup="menu"
                onClick={() =>
                  setOpenDropdown(openDropdown === 'more' ? null : 'more')
                }
                className={`flex items-center gap-1 rounded-md px-3 py-1.5 text-[13px] transition ${
                  openDropdown === 'more'
                    ? 'bg-neutral-900 text-white'
                    : 'text-neutral-400 hover:bg-neutral-900 hover:text-white'
                }`}
              >
                More
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform ${
                    openDropdown === 'more' ? 'rotate-180' : ''
                  }`}
                />
              </button>
              {openDropdown === 'more' && (
                <div
                  role="menu"
                  className="absolute left-0 top-full z-50 mt-1 w-48 rounded-md border border-neutral-700 bg-neutral-950 py-1 shadow-xl"
                >
                  <Link
                    href="/leads"
                    className="flex items-center gap-2 px-3 py-1.5 text-xs text-neutral-300 transition hover:bg-neutral-900 hover:text-white"
                  >
                    <Target className="h-3.5 w-3.5 text-neutral-500" />
                    Leads CRM
                  </Link>
                  <Link
                    href="/admin/challenges"
                    title="Launch and manage 30-day gym challenges"
                    className="flex items-center gap-2 px-3 py-1.5 text-xs text-neutral-300 transition hover:bg-neutral-900 hover:text-white"
                  >
                    <Trophy className="h-3.5 w-3.5 text-neutral-500" />
                    Challenges
                  </Link>
                  <Link
                    href="/plans"
                    className="flex items-center gap-2 px-3 py-1.5 text-xs text-neutral-300 transition hover:bg-neutral-900 hover:text-white"
                  >
                    <Tag className="h-3.5 w-3.5 text-neutral-500" />
                    Packages
                  </Link>
                  {(currentRole === 'owner' ||
                    session?.role === 'super_admin') && (
                    <Link
                      href="/hardware"
                      title="Terminals, machine keys and the gym geofence"
                      className="flex items-center gap-2 px-3 py-1.5 text-xs text-neutral-300 transition hover:bg-neutral-900 hover:text-white"
                    >
                      <ServerCog className="h-3.5 w-3.5 text-neutral-500" />
                      Hardware
                    </Link>
                  )}
                </div>
              )}
            </div>
          </nav>

          <div className="ml-auto flex items-center gap-1.5">
            <Link
              href="/scan"
              target="_blank"
              title="Open the QR scanner"
              className="hidden items-center gap-1.5 rounded-md border border-neutral-700 px-2.5 py-1.5 text-[12px] font-medium text-neutral-200 transition hover:border-neutral-600 hover:bg-neutral-900 sm:inline-flex"
            >
              <QrCode className="h-3.5 w-3.5" />
              Scan
            </Link>

            {/* Notifications â€” a real attention list built from the roster
                (members expiring within seven days), never a fabricated badge. */}
            <div className="relative hidden sm:block" data-menu-root>
              <button
                type="button"
                aria-label="Notifications"
                aria-haspopup="menu"
                onClick={() =>
                  setOpenDropdown(openDropdown === 'notif' ? null : 'notif')
                }
                className="relative rounded-md p-2 text-neutral-400 transition hover:bg-neutral-900 hover:text-white"
              >
                <Bell className="h-4 w-4" />
                {expiringCount > 0 && (
                  <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-amber-400" />
                )}
              </button>
              {openDropdown === 'notif' && (
                <div
                  role="menu"
                  className="absolute right-0 top-full z-50 mt-1 w-72 rounded-md border border-neutral-700 bg-neutral-950 shadow-xl"
                >
                  <div className="border-b border-neutral-800 px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                      Needs attention
                    </p>
                  </div>
                  <div className="max-h-72 overflow-y-auto">
                    {expiringSoon.length === 0 ? (
                      <p className="px-3 py-4 text-xs leading-relaxed text-neutral-500">
                        Nothing needs attention â€” no membership expires in the
                        next seven days.
                      </p>
                    ) : (
                      expiringSoon.slice(0, 6).map(member => {
                        const left = daysUntil(member.membership_end);
                        return (
                          <button
                            key={member.id}
                            type="button"
                            onClick={() => {
                              setOpenDropdown(null);
                              setFilterTab('expiring');
                              scrollToMembers();
                            }}
                            className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition hover:bg-neutral-900"
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-xs text-neutral-200">
                                {member.full_name}
                              </span>
                              <span className="block text-[11px] text-neutral-600">
                                expires {member.membership_end}
                              </span>
                            </span>
                            <span className="shrink-0 text-[11px] font-medium text-amber-400">
                              {left <= 0 ? 'today' : `${left}d`}
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>

            <Link
              href="/admin/settings"
              title="Gym announcements and opening hours"
              className="hidden rounded-md p-2 text-neutral-400 transition hover:bg-neutral-900 hover:text-white sm:block"
            >
              <Settings className="h-4 w-4" />
            </Link>
            {/* Profile */}
            <div className="relative" data-menu-root>
              <button
                type="button"
                aria-haspopup="menu"
                onClick={() =>
                  setOpenDropdown(openDropdown === 'profile' ? null : 'profile')
                }
                title="Account"
                className="flex h-8 w-8 items-center justify-center rounded-full border border-neutral-700 bg-neutral-900 text-[11px] font-semibold text-neutral-200 transition hover:border-neutral-600"
              >
                {initialsOf(session?.name)}
              </button>
              {openDropdown === 'profile' && (
                <div
                  role="menu"
                  className="absolute right-0 top-full z-50 mt-1 w-60 rounded-md border border-neutral-700 bg-neutral-950 py-1 shadow-xl"
                >
                  <div className="border-b border-neutral-800 px-3 py-2">
                    <p className="truncate text-xs font-semibold text-white">
                      {session?.name || 'Owner'}
                    </p>
                    <p className="truncate text-[11px] text-neutral-500">
                      {session?.phone}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleSwitchRole}
                    className={MENU_ITEM}
                  >
                    {currentRole === 'owner' ? (
                      <Unlock className="h-3.5 w-3.5 text-neutral-500" />
                    ) : (
                      <Lock className="h-3.5 w-3.5 text-neutral-500" />
                    )}
                    {currentRole === 'owner'
                      ? 'Switch to Reception'
                      : 'Switch to Owner'}
                  </button>
                  <Link
                    href="/member/dashboard"
                    title="Open your Vyroniq member pass and app"
                    className={MENU_ITEM}
                  >
                    <UserRound className="h-3.5 w-3.5 text-neutral-500" />
                    Member Pass &amp; App
                  </Link>
                  {session?.role === 'super_admin' && (
                    <Link href="/super-admin" className={MENU_ITEM}>
                      â˜… Super Admin
                    </Link>
                  )}
                  <button
                    type="button"
                    onClick={exportToCSV}
                    className={MENU_ITEM}
                  >
                    <Download className="h-3.5 w-3.5 text-neutral-500" />
                    Export CSV
                  </button>
                  <div className="my-1 border-t border-neutral-800" />
                  <button
                    type="button"
                    onClick={handleLogout}
                    title="Log out"
                    className={`${MENU_ITEM} text-rose-400 hover:bg-rose-500/10 hover:text-rose-300`}
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    Log out
                  </button>
                </div>
              )}
            </div>

            {/* Mobile: a compact menu sheet replaces the desktop nav. */}
            <button
              type="button"
              aria-label="Open menu"
              onClick={() =>
                setOpenDropdown(openDropdown === 'mobile' ? null : 'mobile')
              }
              className="rounded-md p-2 text-neutral-400 transition hover:bg-neutral-900 hover:text-white lg:hidden"
            >
              <Menu className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] space-y-5 px-4 pb-16 pt-5 sm:px-6">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-white">
            Overview
          </h1>
          <p className="mt-0.5 text-xs text-neutral-500">
            {session
              ? new Intl.DateTimeFormat('en-GB', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                }).format(new Date())
              : ''}
            {' Â· '}
            {session?.tenantName || 'Front desk'}
          </p>
        </div>

        {/* Quick actions â€” one quiet row; every item is a real workflow. */}
        <section
          aria-label="Quick actions"
          className="flex items-center gap-1 overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-900/70 px-2 py-1.5"
        >
          <span className="shrink-0 px-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-600">
            Quick actions
          </span>
          <Link href="/scan" target="_blank" className={QA_CLASS}>
            <QrCode className="h-3.5 w-3.5" />
            Scan Member
          </Link>
          <button
            type="button"
            onClick={() => setEnrollOpen(true)}
            className={QA_CLASS}
          >
            <Plus className="h-3.5 w-3.5" />
            Add Member
          </button>
          <Link href="/store" className={QA_CLASS}>
            <CreditCard className="h-3.5 w-3.5" />
            Collect Payment
          </Link>
          <button
            type="button"
            onClick={() => {
              setPickerTerm('');
              setPickerMode('link');
            }}
            className={QA_CLASS}
          >
            <Fingerprint className="h-3.5 w-3.5" />
            Link Biometric
          </button>
          <button
            type="button"
            onClick={() => {
              setPickerTerm('');
              setPickerMode('extend');
            }}
            className={QA_CLASS}
          >
            <RotateCw className="h-3.5 w-3.5" />
            Extend Membership
          </button>
        </section>


        {/* Four operational numbers â€” one panel with hairline dividers instead
            of four cards competing for attention. */}
        <section
          aria-label="Today at a glance"
          className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-neutral-800 bg-neutral-800 lg:grid-cols-4"
        >
          <div className="bg-neutral-900 px-4 py-3.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
              Members
            </p>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-semibold tabular-nums text-white">
                {members.length}
              </span>
              <span className="text-[11px] text-neutral-500">
                {expiredCount} expired Â· {frozenCount} frozen
              </span>
            </div>
          </div>

          <div className="bg-neutral-900 px-4 py-3.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
              Active access
            </p>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-semibold tabular-nums text-white">
                {activeCount}
              </span>
              <span className="inline-flex items-center gap-1.5 text-[11px] text-neutral-500">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                gate open
              </span>
            </div>
          </div>

          <div className="bg-neutral-900 px-4 py-3.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
              Expiring soon
            </p>
            <div className="mt-1 flex items-baseline gap-2">
              <span
                className={`text-2xl font-semibold tabular-nums ${
                  expiringCount > 0 ? 'text-amber-400' : 'text-white'
                }`}
              >
                {expiringCount}
              </span>
              <span className="text-[11px] text-neutral-500">next 7 days</span>
            </div>
          </div>

          <div className="bg-neutral-900 px-4 py-3.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
              Today&apos;s revenue
            </p>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-semibold tabular-nums text-white">
                {todayRevenue === null
                  ? 'â€”'
                  : `â‚¹${todayRevenue.toLocaleString('en-IN')}`}
              </span>
              <span className="text-[11px] text-neutral-500">
                {paymentCount === null
                  ? 'â€¦'
                  : paymentCount === 0
                    ? 'no payments yet'
                    : `${paymentCount} payment${paymentCount === 1 ? '' : 's'}`}
              </span>
            </div>
          </div>
        </section>

        {/* Attendance â€” live occupancy and today's numbers side by side. */}
        <section className="grid gap-5 lg:grid-cols-2" aria-label="Attendance">
          {/* Attendance Live */}
          <div className="flex flex-col rounded-lg border border-neutral-800 bg-neutral-900">
            <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
              <div className="flex items-center gap-2">
                <h2 className="text-[13px] font-semibold text-white">
                  Attendance Live
                </h2>
                <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  Live
                </span>
                {crowd.loading && (
                  <RotateCw className="h-3 w-3 animate-spin text-neutral-600" />
                )}
              </div>
              <Link
                href="/attendance"
                className="inline-flex items-center gap-1 text-[11px] text-neutral-400 transition hover:text-white"
              >
                View all
                <ArrowUpRight className="h-3 w-3" />
              </Link>
            </div>

            <div className="flex flex-1 flex-col p-4">
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-semibold tabular-nums text-white">
                  {crowd.inside}
                </span>
                <span className="text-xs text-neutral-400">
                  currently inside
                </span>
              </div>

              {crowd.error ? (
                <p className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200">
                  {crowd.error}
                </p>
              ) : crowd.members.length === 0 ? (
                <p className="mt-3 text-xs text-neutral-500">
                  No one inside right now.
                </p>
              ) : (
                <ul className="mt-3 max-h-64 overflow-y-auto">
                  {crowd.members.map((member, index) => (
                    <li
                      key={`${member.phone}-${member.at}-${index}`}
                      className="flex items-center gap-3 border-b border-neutral-800/70 py-2 last:border-0"
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-neutral-800 text-[10px] font-semibold text-neutral-300">
                        {initialsOf(member.full_name)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[13px] text-neutral-100">
                        {member.full_name}
                      </span>
                      <span className="shrink-0 text-right text-[11px] tabular-nums text-neutral-500">
                        <span className="block">{gymClock(member.at)}</span>
                        <span className="block text-neutral-600">
                          {relativeTime(member.at)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              <p className="mt-auto pt-3 text-[10px] text-neutral-600">
                Counted out automatically 3 hours after the last entry.
              </p>
            </div>
          </div>
          {/* Today's attendance */}
          <div className="rounded-lg border border-neutral-800 bg-neutral-900">
            <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
              <h2 className="text-[13px] font-semibold text-white">
                Today&apos;s attendance
              </h2>
              <span className="text-[11px] text-neutral-600">
                {attStats ? `${attStats.checkins} check-ins` : 'loadingâ€¦'}
              </span>
            </div>

            <div className="p-4">
              <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md bg-neutral-800">
                <div className="bg-neutral-900 px-3 py-2.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                    Today&apos;s check-ins
                  </p>
                  <p className="mt-0.5 text-lg font-semibold tabular-nums text-white">
                    {attStats ? attStats.checkins : 'â€”'}
                  </p>
                </div>
                <div className="bg-neutral-900 px-3 py-2.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                    Peak time
                  </p>
                  <p className="mt-0.5 text-lg font-semibold tabular-nums text-white">
                    {attStats?.peak ?? 'â€”'}
                  </p>
                </div>
                <div className="bg-neutral-900 px-3 py-2.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                    Average visit
                  </p>
                  <p className="mt-0.5 text-lg font-semibold tabular-nums text-white">
                    {attStats?.avgVisit ?? 'â€”'}
                  </p>
                </div>
                <div className="bg-neutral-900 px-3 py-2.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                    Currently inside
                  </p>
                  <p className="mt-0.5 flex items-center gap-2 text-lg font-semibold tabular-nums text-white">
                    {crowd.inside}
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  </p>
                </div>
              </div>

              {/* Subtle hourly strip â€” the shape of the day, not a chart. */}
              {attStats && attStats.checkins > 0 ? (
                <div className="mt-4">
                  <div className="flex h-10 items-end gap-[2px]">
                    {attStats.hist.map((count, hour) => {
                      const max = Math.max(...attStats.hist, 1);
                      return (
                        <span
                          key={hour}
                          title={`${String(hour).padStart(2, '0')}:00 â€” ${count} check-in${count === 1 ? '' : 's'}`}
                          className={`flex-1 rounded-[1px] ${
                            attStats.peakHour === hour
                              ? 'bg-neutral-200'
                              : 'bg-neutral-700'
                          }`}
                          style={{
                            height: `${Math.max(6, Math.round((count / max) * 100))}%`,
                          }}
                        />
                      );
                    })}
                  </div>
                  <div className="mt-1 flex justify-between text-[9px] tabular-nums text-neutral-600">
                    <span>00</span>
                    <span>12</span>
                    <span>23</span>
                  </div>
                </div>
              ) : (
                <p className="mt-4 text-xs text-neutral-500">
                  {attStats
                    ? 'No check-ins recorded yet today.'
                    : 'Loading today\u2019s punchesâ€¦'}
                </p>
              )}

              <p className="mt-3 text-[10px] text-neutral-600">
                Entries and exits as recorded at the gate, on the gym clock.
              </p>
            </div>
          </div>
        </section>
        {/* ---- Members workspace ------------------------------------------- */}
        <section
          id="members"
          className="scroll-mt-20 rounded-lg border border-neutral-800 bg-neutral-900"
        >
          <div className="flex flex-col gap-4 px-4 pt-4 sm:px-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-baseline gap-2">
                <h2 className="text-base font-semibold text-white">Members</h2>
                <span className="text-xs text-neutral-500">
                  {members.length} total
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-500" />
                  <input
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    placeholder="Search members or phone"
                    className="h-8 w-52 rounded-md border border-neutral-800 bg-neutral-950 pl-8 pr-3 text-xs text-white placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none sm:w-64"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setEnrollOpen(true)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md bg-emerald-600 px-3 text-[12px] font-semibold text-black transition hover:bg-emerald-500"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Member
                </button>
              </div>
            </div>
            {/* Tabs: an understated underline, not a row of colored pills. */}
            <div
              role="tablist"
              aria-label="Member filters"
              className="flex items-center gap-1 overflow-x-auto border-b border-neutral-800"
            >
              {(
                [
                  ['all', 'All', members.length],
                  ['active', 'Active', activeCount],
                  ['expiring', 'Expiring', expiringCount],
                  ['expired', 'Expired', expiredCount],
                  ['frozen', 'Frozen', frozenCount],
                ] as const
              ).map(([id, label, count]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={filterTab === id}
                  onClick={() => setFilterTab(id)}
                  className={`-mb-px shrink-0 border-b-2 px-2.5 pb-2 pt-1 text-xs transition ${
                    filterTab === id
                      ? 'border-white font-medium text-white'
                      : 'border-transparent text-neutral-500 hover:text-neutral-300'
                  }`}
                >
                  {label}{' '}
                  <span className="tabular-nums text-neutral-600">
                    ({count})
                  </span>
                </button>
              ))}
            </div>
          </div>

        {/* Desktop table. Deliberately no overflow wrapper: columns that would
              not fit at this width are hidden instead, because a scroll box
              would clip the row "More" dropdown. */}
          <div className="hidden md:block">
            <table className="w-full table-auto border-collapse text-left">
              <thead>
                <tr className="border-b border-neutral-800 text-[10px] font-semibold uppercase tracking-wider text-neutral-600">
                  <th className="px-4 py-2.5">Member</th>
                  <th className="hidden px-3 py-2.5 xl:table-cell">Contact</th>
                  <th className="px-3 py-2.5">Plan</th>
                  <th className="px-3 py-2.5">Expiry</th>
                  <th className="px-3 py-2.5">Access</th>
                  <th className="hidden px-3 py-2.5 lg:table-cell">
                    Biometric
                  </th>
                  <th className="px-4 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800/70">
                {filteredMembers.length === 0 ? (
                  <tr>
                    <td colSpan={7}>{emptyRoster}</td>
                  </tr>
                ) : (
                  filteredMembers.map(member => {
                    const isExpired = new Date(member.membership_end) < new Date();
                    const isFrozen = Boolean(member.is_frozen);
                    const left = daysUntil(member.membership_end);
                    const access = isFrozen
                      ? { label: 'Frozen', text: 'text-sky-400', dot: 'bg-sky-400' }
                      : isExpired
                        ? { label: 'Blocked', text: 'text-rose-400', dot: 'bg-rose-400' }
                        : { label: 'Allowed', text: 'text-emerald-400', dot: 'bg-emerald-400' };

                    return (
                      <tr
                        key={member.id}
                        className="transition hover:bg-neutral-800/40"
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-neutral-700 bg-neutral-800 text-[10px] font-semibold text-neutral-300">
                              {initialsOf(member.full_name)}
                            </span>
                            <div className="min-w-0">
                              <p className="truncate text-[13px] font-medium text-white">
                                {member.full_name}
                              </p>
                              <p className="truncate text-[11px] tabular-nums text-neutral-500">
                                {member.phone}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="hidden px-3 py-3 xl:table-cell">
                          <p className="max-w-[140px] truncate text-xs text-neutral-400">
                            {member.email || 'â€”'}
                          </p>
                          {member.emergency_contact && (
                            <p className="max-w-[140px] truncate text-[11px] tabular-nums text-neutral-600">
                              Emg {member.emergency_contact}
                            </p>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <p className="truncate text-xs text-neutral-200">
                            {member.plans?.name || 'Standard'}
                          </p>
                          {member.amount_paid ? (
                            <p className="text-[11px] tabular-nums text-neutral-500">
                              â‚¹{member.amount_paid}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-3 py-3">
                          <p className="text-xs tabular-nums text-neutral-300">
                            {member.membership_end}
                          </p>
                          <p
                            className={`text-[11px] ${
                              isExpired
                                ? 'text-rose-400'
                                : left <= 7
                                  ? 'text-amber-400'
                                  : 'text-neutral-600'
                            }`}
                          >
                            {isExpired
                              ? 'expired'
                              : left === 0
                                ? 'today'
                                : `in ${left}d`}
                          </p>
                        </td>
                        <td className="px-3 py-3">
                          <span
                            className={`inline-flex items-center gap-1.5 text-xs ${access.text}`}
                          >
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${access.dot}`}
                            />
                            {access.label}
                          </span>
                        </td>
                        <td className="hidden px-3 py-3 lg:table-cell">
                          {member.biometric_id ? (
                            <p className="text-[11px] font-medium tabular-nums text-neutral-300">
                              BIO #{member.biometric_id}
                            </p>
                          ) : null}
                          {member.rfid_card ? (
                            <p className="max-w-[96px] truncate text-[11px] tabular-nums text-neutral-500">
                              RFID {member.rfid_card}
                            </p>
                          ) : null}
                          {!member.biometric_id && !member.rfid_card ? (
                            <span className="text-neutral-600">â€”</span>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => setViewTarget(member)}
                              className="rounded px-2 py-1 text-[11px] text-neutral-400 transition hover:bg-neutral-800 hover:text-white"
                            >
                              View
                            </button>
                            {renderRowMenu(member)}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

                            {/* Below md the table would overflow, so the roster becomes a list of
              the same rows â€” same handlers, same "More" menu. */}
          <ul className="divide-y divide-neutral-800/70 md:hidden">
            {filteredMembers.length === 0 ? (
              <li>{emptyRoster}</li>
            ) : (
              filteredMembers.map(member => {
                const isExpired = new Date(member.membership_end) < new Date();
                const isFrozen = Boolean(member.is_frozen);
                const left = daysUntil(member.membership_end);
                const access = isFrozen
                  ? { label: 'Frozen', text: 'text-sky-400', dot: 'bg-sky-400' }
                  : isExpired
                    ? { label: 'Blocked', text: 'text-rose-400', dot: 'bg-rose-400' }
                    : { label: 'Allowed', text: 'text-emerald-400', dot: 'bg-emerald-400' };

                return (
                  <li key={member.id} className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-neutral-700 bg-neutral-800 text-[10px] font-semibold text-neutral-300">
                        {initialsOf(member.full_name)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-white">
                          {member.full_name}
                        </p>
                        <p className="truncate text-[11px] tabular-nums text-neutral-500">
                          {member.phone}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setViewTarget(member)}
                          className="rounded px-2 py-1 text-[11px] text-neutral-400 transition hover:bg-neutral-800 hover:text-white"
                        >
                          View
                        </button>
                        {renderRowMenu(member)}
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 pl-11 text-[11px]">
                      <span
                        className={`inline-flex items-center gap-1.5 ${access.text}`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${access.dot}`} />
                        {access.label}
                      </span>
                      <span className="tabular-nums text-neutral-500">
                        {member.membership_end}
                      </span>
                      <span className="text-neutral-600">
                        {member.plans?.name || 'Standard'}
                      </span>
                      <span className="text-neutral-600">
                        {isExpired
                          ? 'expired'
                          : left === 0
                            ? 'today'
                            : `in ${left}d`}
                      </span>
                    </div>
                  </li>
                );
              })
            )}
          </ul>

          <div className="flex items-center justify-between border-t border-neutral-800 px-4 py-2.5 sm:px-5">
            <p className="text-[11px] text-neutral-600">
              Showing {filteredMembers.length} of {members.length}
            </p>
            <button
              type="button"
              onClick={exportToCSV}
              className="inline-flex items-center gap-1.5 text-[11px] text-neutral-400 transition hover:text-white"
            >
              <Download className="h-3.5 w-3.5" />
              Export CSV
            </button>
          </div>
        </section>
      </main>

      {/* Enrolment drawer â€” "+ Add Member" opens it so the dashboard stays
          about operations. Same handler, same payload, same inline error and
          the same WhatsApp welcome card the inline form used to own. */}
      {enrollOpen && (
        <>
          <div
            aria-hidden="true"
            className="fixed inset-0 z-40 bg-black/60"
            onClick={() => setEnrollOpen(false)}
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Enroll Member"
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-neutral-800 bg-neutral-950 shadow-2xl"
          >
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-neutral-800 px-4">
              <div>
                <h2 className="text-sm font-semibold text-white">
                  Enroll Member
                </h2>
                <p className="text-[11px] text-neutral-500">
                  Creates the member, the invoice and gate access
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEnrollOpen(false)}
                aria-label="Close"
                className="rounded-md p-1.5 text-neutral-400 transition hover:bg-neutral-900 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {enrollBanner && (
                <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-[11px] leading-relaxed text-amber-200">
                  <Target className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    Enrolling <strong>{enrollBanner}</strong> from the Lead
                    Pipeline. Submitting this form also moves that lead card to
                    Converted.
                  </span>
                </div>
              )}

              <form onSubmit={addMember} className="space-y-3.5">
                <div>
                  <label className="mb-1 block text-[10px] uppercase tracking-wider text-neutral-400">
                    Full Name
                  </label>
                  <input
                    required
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="Member Full Name"
                    className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white placeholder:text-neutral-600 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] uppercase tracking-wider text-neutral-400">
                    WhatsApp Phone
                  </label>
                  <input
                    required
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    placeholder="10-digit Phone"
                    inputMode="numeric"
                    className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm tabular-nums text-white placeholder:text-neutral-600 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] uppercase tracking-wider text-neutral-400">
                    Email (optional)
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="Optional"
                    className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white placeholder:text-neutral-600 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] uppercase tracking-wider text-neutral-400">
                    Membership Plan
                  </label>
                  <select
                    value={selectedPlanId}
                    onChange={e => handlePlanChange(e.target.value)}
                    className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                  >
                    {plans.length === 0 ? (
                      <option value="">Standard Monthly Plan</option>
                    ) : (
                      plans.map(p => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.duration_days} Days) - â‚¹{p.price}
                        </option>
                      ))
                    )}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="mb-1 block text-[10px] uppercase tracking-wider text-neutral-400">
                      Fee Paid (â‚¹)
                    </label>
                    <input
                      type="number"
                      value={amountPaid}
                      onChange={e => setAmountPaid(e.target.value)}
                      placeholder="0"
                      className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm tabular-nums text-white placeholder:text-neutral-600 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wider text-neutral-400">
                      <Fingerprint className="h-3.5 w-3.5" />
                      Biometric Slot
                    </label>
                    <input
                      type="number"
                      value={biometricId}
                      onChange={e => setBiometricId(e.target.value)}
                      placeholder="Slot #"
                      className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm tabular-nums text-white placeholder:text-neutral-600 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-[10px] uppercase tracking-wider text-neutral-400">
                    Emergency Phone
                  </label>
                  <input
                    value={emergencyPhone}
                    onChange={e => setEmergencyPhone(e.target.value)}
                    placeholder="Optional"
                    inputMode="numeric"
                    className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm tabular-nums text-white placeholder:text-neutral-600 focus:border-emerald-500 focus:outline-none"
                  />
                </div>

                {enrollError && (
                  <div
                    role="alert"
                    className="flex items-start gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2.5"
                  >
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" />
                    <p className="text-[11px] leading-relaxed text-rose-200">
                      {enrollError}
                    </p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="mt-1 w-full rounded-md bg-emerald-600 py-2.5 text-xs font-semibold uppercase tracking-wider text-black transition hover:bg-emerald-500 disabled:opacity-50"
                >
                  {loading ? 'Enrollingâ€¦' : 'Enroll Member'}
                </button>
                <p className="text-center text-[10px] text-neutral-600">
                  Invoice and gate access are created automatically.
                </p>
              </form>

              {welcomeInvite && (
                <div className="mt-4 flex flex-col gap-2.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-3">
                  <p className="text-[11px] leading-relaxed text-emerald-200">
                    <strong>{welcomeInvite.name}</strong> is enrolled. Send the
                    WhatsApp welcome now â€” it carries the portal link, pass
                    instructions and the membership expiry.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={sendOnboardingWelcome}
                      className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md bg-emerald-600 py-2 text-[11px] font-semibold uppercase tracking-wider text-black transition hover:bg-emerald-500"
                    >
                      <Send className="h-3.5 w-3.5" />
                      Send welcome
                    </button>
                    <button
                      type="button"
                      onClick={() => setWelcomeInvite(null)}
                      className="px-3 py-2 text-[11px] text-neutral-400 transition hover:text-white"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              )}
            </div>
          </aside>
        </>
      )}

      {/* Member detail sheet â€” the read-only counterpart to the row menu. */}
      {viewTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-black/70"
            onClick={() => setViewTarget(null)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={viewTarget.full_name}
            className="relative w-full max-w-md overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900 shadow-2xl"
          >
            <div className="flex items-center gap-3 border-b border-neutral-800 px-4 py-3.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-neutral-700 bg-neutral-800 text-[11px] font-semibold text-neutral-300">
                {initialsOf(viewTarget.full_name)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-white">
                  {viewTarget.full_name}
                </p>
                <p className="truncate text-[11px] tabular-nums text-neutral-500">
                  {viewTarget.phone}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setViewTarget(null)}
                aria-label="Close"
                className="rounded-md p-1.5 text-neutral-400 transition hover:bg-neutral-800 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-px bg-neutral-800">
              <div className="bg-neutral-900 px-4 py-2.5">
                <p className="text-[10px] uppercase tracking-wider text-neutral-500">
                  WhatsApp
                </p>
                <p className="truncate text-xs tabular-nums text-neutral-200">
                  {viewTarget.phone}
                </p>
              </div>
              <div className="bg-neutral-900 px-4 py-2.5">
                <p className="text-[10px] uppercase tracking-wider text-neutral-500">
                  Email
                </p>
                <p className="truncate text-xs text-neutral-200">
                  {viewTarget.email || 'â€”'}
                </p>
              </div>
              <div className="bg-neutral-900 px-4 py-2.5">
                <p className="text-[10px] uppercase tracking-wider text-neutral-500">
                  Plan
                </p>
                <p className="truncate text-xs text-neutral-200">
                  {viewTarget.plans?.name || 'Standard'}
                </p>
              </div>
              <div className="bg-neutral-900 px-4 py-2.5">
                <p className="text-[10px] uppercase tracking-wider text-neutral-500">
                  Fee paid
                </p>
                <p className="text-xs tabular-nums text-neutral-200">
                  {viewTarget.amount_paid ? `â‚¹${viewTarget.amount_paid}` : 'â€”'}
                </p>
              </div>
              <div className="bg-neutral-900 px-4 py-2.5">
                <p className="text-[10px] uppercase tracking-wider text-neutral-500">
                  Expires
                </p>
                <p className="text-xs tabular-nums text-neutral-200">
                  {viewTarget.membership_end}
                </p>
              </div>
              <div className="bg-neutral-900 px-4 py-2.5">
                <p className="text-[10px] uppercase tracking-wider text-neutral-500">
                  Gate access
                </p>
                <p
                  className={`flex items-center gap-1.5 text-xs ${
                    viewTarget.is_frozen
                      ? 'text-sky-400'
                      : new Date(viewTarget.membership_end) < new Date()
                        ? 'text-rose-400'
                        : 'text-emerald-400'
                  }`}
                >
                  <CheckCircle className="h-3.5 w-3.5" />
                  {viewTarget.is_frozen
                    ? 'Frozen'
                    : new Date(viewTarget.membership_end) < new Date()
                      ? 'Blocked'
                      : 'Allowed'}
                </p>
              </div>
              <div className="bg-neutral-900 px-4 py-2.5">
                <p className="text-[10px] uppercase tracking-wider text-neutral-500">
                  Biometric
                </p>
                <p className="text-xs tabular-nums text-neutral-200">
                  {viewTarget.biometric_id
                    ? `BIO #${viewTarget.biometric_id}`
                    : 'Not linked'}
                </p>
              </div>
              <div className="bg-neutral-900 px-4 py-2.5">
                <p className="text-[10px] uppercase tracking-wider text-neutral-500">
                  RFID
                </p>
                <p className="truncate text-xs tabular-nums text-neutral-200">
                  {viewTarget.rfid_card || 'Not linked'}
                </p>
              </div>
              <div className="col-span-2 bg-neutral-900 px-4 py-2.5">
                <p className="text-[10px] uppercase tracking-wider text-neutral-500">
                  Emergency contact
                </p>
                <p className="text-xs tabular-nums text-neutral-200">
                  {viewTarget.emergency_contact || 'â€”'}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 border-t border-neutral-800 px-4 py-3">
              <button
                type="button"
                onClick={() => {
                  setLinkTarget(viewTarget);
                  setViewTarget(null);
                }}
                className="inline-flex items-center gap-1.5 rounded-md border border-neutral-700 px-2.5 py-1.5 text-[11px] text-neutral-300 transition hover:bg-neutral-800 hover:text-white"
              >
                <CreditCard className="h-3.5 w-3.5" />
                Link RFID / Biometric
              </button>
              <button
                type="button"
                onClick={() => {
                  renewMember(viewTarget);
                  setViewTarget(null);
                }}
                className="inline-flex items-center gap-1.5 rounded-md border border-neutral-700 px-2.5 py-1.5 text-[11px] text-neutral-300 transition hover:bg-neutral-800 hover:text-white"
              >
                <RotateCw className="h-3.5 w-3.5" />
                Extend 30 days
              </button>
              <button
                type="button"
                onClick={() => {
                  void viewLatestInvoice(viewTarget.id);
                  setViewTarget(null);
                }}
                className="inline-flex items-center gap-1.5 rounded-md border border-neutral-700 px-2.5 py-1.5 text-[11px] text-neutral-300 transition hover:bg-neutral-800 hover:text-white"
              >
                <FileText className="h-3.5 w-3.5" />
                Invoice
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Member picker for the Link Biometric / Extend Membership actions. */}
      {pickerMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-black/70"
            onClick={() => setPickerMode(null)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Choose a member"
            className="relative flex w-full max-w-md flex-col overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-white">
                  {pickerMode === 'link'
                    ? 'Link RFID / Biometric'
                    : 'Extend membership'}
                </h2>
                <p className="text-[11px] text-neutral-500">
                  {pickerMode === 'link'
                    ? 'Pick the member, then link their card or fingerprint.'
                    : 'Pick the member, then add 30 days and record the renewal.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPickerMode(null)}
                aria-label="Close"
                className="rounded-md p-1.5 text-neutral-400 transition hover:bg-neutral-800 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="border-b border-neutral-800 p-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-500" />
                <input
                  autoFocus
                  value={pickerTerm}
                  onChange={e => setPickerTerm(e.target.value)}
                  placeholder="Search members or phone"
                  className="h-8 w-full rounded-md border border-neutral-800 bg-neutral-950 pl-8 pr-3 text-xs text-white placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none"
                />
              </div>
            </div>

            <ul className="max-h-72 divide-y divide-neutral-800/70 overflow-y-auto">
              {pickerMembers.length === 0 ? (
                <li className="px-4 py-8 text-center text-xs text-neutral-500">
                  No members match that search.
                </li>
              ) : (
                pickerMembers.map(member => (
                  <li key={member.id}>
                    <button
                      type="button"
                      onClick={() => {
                        const target = member;
                        const mode = pickerMode;
                        setPickerMode(null);
                        setPickerTerm('');
                        if (mode === 'link') {
                          setLinkTarget(target);
                        } else {
                          void renewMember(target);
                        }
                      }}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-neutral-800/60"
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-neutral-700 bg-neutral-800 text-[10px] font-semibold text-neutral-300">
                        {initialsOf(member.full_name)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium text-neutral-100">
                          {member.full_name}
                        </span>
                        <span className="block truncate text-[11px] tabular-nums text-neutral-500">
                          {member.phone}
                        </span>
                      </span>
                      <span className="shrink-0 text-[11px] tabular-nums text-neutral-500">
                        {member.membership_end}
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      )}

      {/* Mobile menu â€” every destination the desktop bar exposes, in one sheet. */}
      {openDropdown === 'mobile' && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-black/60"
            onClick={() => setOpenDropdown(null)}
          />
          <div className="absolute inset-y-0 right-0 flex w-72 flex-col border-l border-neutral-800 bg-neutral-950">
            <div className="flex h-14 items-center justify-between border-b border-neutral-800 px-4">
              <div className="flex min-w-0 items-center gap-2.5">
                <Building2 className="h-4 w-4 shrink-0 text-neutral-500" />
                <p className="truncate text-sm font-semibold text-white">
                  {session?.tenantName || 'Gym'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpenDropdown(null)}
                aria-label="Close menu"
                className="rounded-md p-1.5 text-neutral-400 transition hover:bg-neutral-900 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto p-2 text-sm">
              <Link
                href="/admin"
                onClick={() => setOpenDropdown(null)}
                className={MENU_ITEM}
              >
                <Dumbbell className="h-3.5 w-3.5 text-neutral-500" />
                Overview
              </Link>
              <button
                type="button"
                onClick={() => {
                  setOpenDropdown(null);
                  scrollToMembers();
                }}
                className={MENU_ITEM}
              >
                <Users className="h-3.5 w-3.5 text-neutral-500" />
                Members
              </button>
              <Link
                href="/attendance"
                onClick={() => setOpenDropdown(null)}
                className={MENU_ITEM}
              >
                <Calendar className="h-3.5 w-3.5 text-neutral-500" />
                Attendance
              </Link>
              <Link
                href="/store"
                onClick={() => setOpenDropdown(null)}
                className={MENU_ITEM}
              >
                <ShoppingBag className="h-3.5 w-3.5 text-neutral-500" />
                Payments
              </Link>
              <Link
                href="/trainers"
                onClick={() => setOpenDropdown(null)}
                className={MENU_ITEM}
              >
                <Target className="h-3.5 w-3.5 text-neutral-500" />
                Trainers
              </Link>
              {currentRole === 'owner' && (
                <Link
                  href="/analytics"
                  onClick={() => setOpenDropdown(null)}
                  className={MENU_ITEM}
                >
                  <BarChart3 className="h-3.5 w-3.5 text-neutral-500" />
                  Analytics
                </Link>
              )}

              <div className="my-2 border-t border-neutral-800" />

              <Link
                href="/leads"
                onClick={() => setOpenDropdown(null)}
                className={MENU_ITEM}
              >
                <Target className="h-3.5 w-3.5 text-neutral-500" />
                Leads CRM
              </Link>
              <Link
                href="/admin/challenges"
                onClick={() => setOpenDropdown(null)}
                className={MENU_ITEM}
              >
                <Trophy className="h-3.5 w-3.5 text-neutral-500" />
                Challenges
              </Link>
              <Link
                href="/plans"
                onClick={() => setOpenDropdown(null)}
                className={MENU_ITEM}
              >
                <Tag className="h-3.5 w-3.5 text-neutral-500" />
                Packages
              </Link>
              {(currentRole === 'owner' || session?.role === 'super_admin') && (
                <Link
                  href="/hardware"
                  onClick={() => setOpenDropdown(null)}
                  className={MENU_ITEM}
                >
                  <ServerCog className="h-3.5 w-3.5 text-neutral-500" />
                  Hardware
                </Link>
              )}
              {session?.role === 'super_admin' && (
                <Link
                  href="/super-admin"
                  onClick={() => setOpenDropdown(null)}
                  className={MENU_ITEM}
                >
                  â˜… Super Admin
                </Link>
              )}

              <div className="my-2 border-t border-neutral-800" />

              <Link
                href="/scan"
                target="_blank"
                onClick={() => setOpenDropdown(null)}
                className={MENU_ITEM}
              >
                <QrCode className="h-3.5 w-3.5 text-neutral-500" />
                Scanner
              </Link>
              <Link
                href="/admin/settings"
                onClick={() => setOpenDropdown(null)}
                className={MENU_ITEM}
              >
                <Settings className="h-3.5 w-3.5 text-neutral-500" />
                Settings
              </Link>
              <Link
                href="/member/dashboard"
                onClick={() => setOpenDropdown(null)}
                className={MENU_ITEM}
              >
                <UserRound className="h-3.5 w-3.5 text-neutral-500" />
                Member Pass &amp; App
              </Link>
              <button
                type="button"
                onClick={() => {
                  setOpenDropdown(null);
                  exportToCSV();
                }}
                className={MENU_ITEM}
              >
                <Download className="h-3.5 w-3.5 text-neutral-500" />
                Export CSV
              </button>
              <button
                type="button"
                onClick={handleLogout}
                title="Log out"
                className={`${MENU_ITEM} text-rose-400 hover:bg-rose-500/10 hover:text-rose-300`}
              >
                <LogOut className="h-3.5 w-3.5" />
                Log out
              </button>
            </nav>

            <p className="border-t border-neutral-800 px-4 py-3 text-[10px] uppercase tracking-wider text-neutral-600">
              Vyroniq Gym OS Â· {session?.phone}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}