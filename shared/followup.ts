// «طلاب يحتاجون متابعة» (requirements §14.7): ثلاثة أسباب بحدود يضبطها المدير من الإعدادات.
// دوال نقية بلا قاعدة بيانات ولا ساعة، فتُختبر بتواريخ ثابتة.

export interface FollowUpThresholds {
  /** غيابات الشهر الجاري التي عندها يُنبَّه */
  absenceCount: number;
  /** أيام بلا تسميع (حضور أو تأخر) التي عندها يُنبَّه */
  noReciteDays: number;
  /** نسبة التأخر عن الخطة المتناسبة مع الأيام المنقضية من الشهر */
  planLagPct: number;
}

/** لا يُقاس التأخر عن الخطة قبل هذا اليوم من الشهر: في أول أيامه المتوقَّع صفحات قليلة فيصير الصفر «تأخراً» زائفاً. */
export const PLAN_LAG_MIN_DAY = 7;

export interface FollowUpInput {
  /** غيابات الشهر الجاري (بلا العذر) */
  absences: number;
  /** تاريخ آخر يوم حضر فيه (حاضر أو متأخر)، أو null إن لم يحضر قط */
  lastReciteDate: string | null;
  /** تاريخ التحاقه؛ مرجع العدّ حين لم يسجَّل له تسميع */
  joinedAt: string | null;
  /** خطة الشهر الجاري بالصفحات (0 = بلا خطة فلا يُقاس التأخر) */
  planPages: number;
  /** صفحاته الفريدة المنجزة هذا الشهر */
  pages: number;
  /** اليوم بتوقيت المركز YYYY-MM-DD */
  today: string;
}

export type FollowUpReason =
  | { kind: "absence"; count: number }
  | { kind: "noRecite"; days: number; never: boolean }
  | { kind: "planLag"; lagPct: number; expectedPages: number; pages: number; planPages: number };

const DAY = 86_400_000;
const utc = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));

/** عدد الأيام بين تاريخين YYYY-MM-DD (موجب إن كان `to` بعد `from`). */
export const daysBetween = (from: string, to: string): number => Math.round((utc(to) - utc(from)) / DAY);

export function followUpReasons(input: FollowUpInput, th: FollowUpThresholds): FollowUpReason[] {
  const reasons: FollowUpReason[] = [];
  if (input.absences >= th.absenceCount) reasons.push({ kind: "absence", count: input.absences });

  const ref = input.lastReciteDate ?? input.joinedAt;
  if (ref) {
    const days = daysBetween(ref.slice(0, 10), input.today);
    if (days >= th.noReciteDays) reasons.push({ kind: "noRecite", days, never: input.lastReciteDate === null });
  }

  const day = Number(input.today.slice(8, 10));
  const daysInMonth = new Date(Date.UTC(Number(input.today.slice(0, 4)), Number(input.today.slice(5, 7)), 0)).getUTCDate();
  if (input.planPages > 0 && day >= PLAN_LAG_MIN_DAY) {
    const expected = (input.planPages * day) / daysInMonth;
    const lagPct = Math.round(((expected - input.pages) / expected) * 100);
    if (lagPct >= th.planLagPct) reasons.push({ kind: "planLag", lagPct, expectedPages: Math.round(expected * 10) / 10, pages: input.pages, planPages: input.planPages });
  }
  return reasons;
}
