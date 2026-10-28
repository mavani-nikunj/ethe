/**
 * Staff Duty allotment engine (docs/staff-duty-plan.md §8.2). Pure: no database, no randomness.
 * Same input → same output, so an allotment can be explained and re-checked.
 */

export type DutyKind = 'ALL_DUTY' | 'SUPERVISOR' | 'INVIGILATOR' | 'SUPPORTING';

export type EngineSitting = {
  id: string;
  /** YYYY-MM-DD */
  examDate: string;
  /** Morning | Evening */
  shift: string;
  need: Partial<Record<DutyKind, number>>;
};

export type EngineMember = {
  staffId: string;
  /** Seniority / employee code; lower comes first on ties. */
  code: string;
  role: DutyKind | null;
  /** ANY | Morning | Evening */
  shiftPreference: string;
  allot: boolean;
  unavailable: { examDate: string; shift: string }[];
  /** Duties in the previous session: who worked more then gets the remainder duties last. */
  previousLoad?: number;
};

export type EngineAllotment = {
  sittingId: string;
  staffId: string;
  /** The person's role in the session. */
  memberRole: DutyKind;
  /** The requirement this duty fills (a Supervisor can fill an Invigilator shortfall). */
  dutyAs: DutyKind;
  source?: string;
};

export type Shortfall = { sittingId: string; examDate: string; shift: string; dutyAs: DutyKind; missing: number };

/** Filling order inside a sitting (old GetStaffForDuty). */
const FILL_ORDER: DutyKind[] = ['SUPERVISOR', 'INVIGILATOR', 'SUPPORTING', 'ALL_DUTY'];
/** Roles with a fair cap; their shortfall overflows to Supervisors (old rule). */
const CAPPED = new Set<DutyKind>(['INVIGILATOR', 'SUPPORTING']);
const SHIFT_ORDER: Record<string, number> = { Morning: 0, Evening: 1 };

export function compareSittings(a: { examDate: string; shift: string }, b: { examDate: string; shift: string }) {
  return a.examDate.localeCompare(b.examDate) || (SHIFT_ORDER[a.shift] ?? 9) - (SHIFT_ORDER[b.shift] ?? 9);
}

function isSaturdayEvening(s: { examDate: string; shift: string }) {
  const [y, m, d] = s.examDate.split('-').map(Number);
  return s.shift === 'Evening' && new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 6;
}

const byCode = (a: EngineMember, b: EngineMember) =>
  a.code.localeCompare(b.code, undefined, { numeric: true }) || a.staffId.localeCompare(b.staffId);

/** Running state of one allotment pass. */
class Book {
  load = new Map<string, number>();
  lastShift = new Map<string, string>();
  shiftsByDate = new Map<string, Set<string>>();
  satEvening = new Map<string, number>();
  onSitting = new Map<string, Set<string>>();
  filled = new Map<string, number>();

  add(a: EngineAllotment, s: EngineSitting) {
    this.load.set(a.staffId, (this.load.get(a.staffId) || 0) + 1);
    this.lastShift.set(a.staffId, s.shift);
    const dayKey = `${a.staffId}|${s.examDate}`;
    if (!this.shiftsByDate.has(dayKey)) this.shiftsByDate.set(dayKey, new Set());
    this.shiftsByDate.get(dayKey)!.add(s.shift);
    if (isSaturdayEvening(s)) this.satEvening.set(a.staffId, (this.satEvening.get(a.staffId) || 0) + 1);
    if (!this.onSitting.has(s.id)) this.onSitting.set(s.id, new Set());
    this.onSitting.get(s.id)!.add(a.staffId);
    const fk = `${s.id}|${a.dutyAs}`;
    this.filled.set(fk, (this.filled.get(fk) || 0) + 1);
  }

  isOn(staffId: string, sittingId: string) {
    return this.onSitting.get(sittingId)?.has(staffId) || false;
  }
}

/** Can this person sit this sitting at all (role aside)? */
function available(m: EngineMember, s: { examDate: string; shift: string }) {
  if (!m.allot) return false;
  if (m.shiftPreference !== 'ANY' && m.shiftPreference && m.shiftPreference !== s.shift) return false;
  return !m.unavailable.some((u) => u.examDate === s.examDate && u.shift === s.shift);
}

/**
 * Personal targets per role: base = need ÷ pool; the remainder goes to the people with the lowest
 * previous-session load (then seniority). Caps for Invigilator / Supporting are base + 1 (old "max duty").
 */
function targetsFor(sittings: EngineSitting[], members: EngineMember[]) {
  const target = new Map<string, number>();
  const cap = new Map<DutyKind, number>();
  for (const role of FILL_ORDER) {
    const pool = members.filter((m) => m.role === role && m.allot);
    const total = sittings.reduce((n, s) => n + Math.max(0, s.need[role] || 0), 0);
    if (!pool.length) continue;
    const base = Math.floor(total / pool.length);
    const extra = total % pool.length;
    cap.set(role, base + (extra > 0 ? 1 : 0));
    const order = [...pool].sort((a, b) => (a.previousLoad || 0) - (b.previousLoad || 0) || byCode(a, b));
    order.forEach((m, i) => target.set(m.staffId, base + (i < extra ? 1 : 0)));
  }
  return { target, cap };
}

/** Lower is better. Keys in order: below target, other shift same day, alternation, Saturday evening, last session, seniority. */
function score(m: EngineMember, s: EngineSitting, book: Book, target: Map<string, number>): (number | string)[] {
  const load = book.load.get(m.staffId) || 0;
  const sameDay = book.shiftsByDate.get(`${m.staffId}|${s.examDate}`)?.size ? 1 : 0;
  const last = book.lastShift.get(m.staffId);
  const repeat = last && last === s.shift ? 1 : 0;
  const sat = isSaturdayEvening(s) ? book.satEvening.get(m.staffId) || 0 : 0;
  return [load - (target.get(m.staffId) || 0), sameDay, repeat, sat, m.previousLoad || 0];
}

function compareScores(a: (number | string)[], b: (number | string)[]) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return (a[i] as number) - (b[i] as number);
  return 0;
}

function pick(candidates: EngineMember[], s: EngineSitting, book: Book, target: Map<string, number>) {
  let best: EngineMember | null = null;
  let bestScore: (number | string)[] = [];
  for (const m of candidates) {
    const sc = score(m, s, book, target);
    if (!best || compareScores(sc, bestScore) < 0 || (compareScores(sc, bestScore) === 0 && byCode(m, best) < 0)) {
      best = m;
      bestScore = sc;
    }
  }
  return best;
}

/**
 * Allot duties for every sitting. `fixed` rows (kept from before: manual changes, or everything when
 * filling gaps) count towards the need and the load; only new rows are returned.
 */
export function allot(input: { sittings: EngineSitting[]; members: EngineMember[]; fixed?: EngineAllotment[] }) {
  const sittings = [...input.sittings].sort((a, b) => compareSittings(a, b) || a.id.localeCompare(b.id));
  const members = [...input.members].sort(byCode);
  const sittingById = new Map(sittings.map((s) => [s.id, s]));
  const book = new Book();
  for (const f of [...(input.fixed || [])].sort((a, b) => {
    const sa = sittingById.get(a.sittingId);
    const sb = sittingById.get(b.sittingId);
    return (sa && sb ? compareSittings(sa, sb) : 0) || a.staffId.localeCompare(b.staffId);
  })) {
    const s = sittingById.get(f.sittingId);
    if (s) book.add(f, s);
  }
  const { target, cap } = targetsFor(sittings, members);
  const allotments: EngineAllotment[] = [];
  const shortfalls: Shortfall[] = [];

  const fill = (s: EngineSitting, pool: DutyKind, dutyAs: DutyKind, count: number) => {
    let done = 0;
    const roleCap = CAPPED.has(pool) && pool === dutyAs ? cap.get(pool) : undefined;
    for (; done < count; done++) {
      const candidates = members.filter(
        (m) =>
          m.role === pool &&
          available(m, s) &&
          !book.isOn(m.staffId, s.id) &&
          (roleCap === undefined || (book.load.get(m.staffId) || 0) < roleCap),
      );
      const m = pick(candidates, s, book, target);
      if (!m) break;
      const row: EngineAllotment = { sittingId: s.id, staffId: m.staffId, memberRole: pool, dutyAs, source: 'AUTO' };
      book.add(row, s);
      allotments.push(row);
    }
    return done;
  };

  for (const s of sittings) {
    for (const role of FILL_ORDER) {
      const need = Math.max(0, Math.floor(s.need[role] || 0));
      let missing = need - (book.filled.get(`${s.id}|${role}`) || 0);
      if (missing <= 0) continue;
      missing -= fill(s, role, role, missing);
      if (missing > 0 && CAPPED.has(role)) missing -= fill(s, 'SUPERVISOR', role, missing);
      if (missing > 0) shortfalls.push({ sittingId: s.id, examDate: s.examDate, shift: s.shift, dutyAs: role, missing });
    }
  }

  return { allotments, shortfalls, load: Object.fromEntries([...book.load].sort((a, b) => a[0].localeCompare(b[0]))) };
}

/** "Replace by" list: same role, available for the sitting, not on it; best candidate first, with the load. */
export function rankReplacements(input: {
  sitting: EngineSitting;
  members: EngineMember[];
  allotments: EngineAllotment[];
  role: DutyKind;
  sittings?: EngineSitting[];
}) {
  const sittings = input.sittings || [input.sitting];
  const byId = new Map(sittings.map((s) => [s.id, s]));
  byId.set(input.sitting.id, input.sitting);
  const book = new Book();
  for (const a of input.allotments) {
    const s = byId.get(a.sittingId) || { id: a.sittingId, examDate: '', shift: '', need: {} };
    book.add(a, s);
  }
  const target = new Map<string, number>();
  return input.members
    .filter((m) => m.role === input.role && available(m, input.sitting) && !book.isOn(m.staffId, input.sitting.id))
    .map((m) => ({ member: m, score: score(m, input.sitting, book, target) }))
    .sort((a, b) => compareScores(a.score, b.score) || byCode(a.member, b.member))
    .map((x) => ({ staffId: x.member.staffId, load: book.load.get(x.member.staffId) || 0 }));
}
