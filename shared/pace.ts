// وتيرة الطالب داخل الشهر واقتراح هدف الشهر القادم. دوال نقية بلا قاعدة بيانات ولا ساعة.
import { PLAN_LAG_MIN_DAY } from "./followup";

export type PaceStatus = "early" | "done" | "ahead" | "behind";

export interface Pace {
  status: PaceStatus;
  /** المتوقَّع إنجازه حتى اليوم بالتناسب مع أيام الشهر */
  expectedPages: number;
  /** الفرق (المنجز − المتوقَّع)؛ سالب = متأخر */
  diffPages: number;
}

/** وتيرة الشهر الجاري. null إن لم توضع خطة. قبل اليوم السابع من الشهر لا يُحكم (نفس عتبة تنبيه التأخر). */
export function planPace(planPages: number, pages: number, today: string): Pace | null {
  if (planPages <= 0) return null;
  const day = Number(today.slice(8, 10));
  const daysInMonth = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).getUTCDate();
  const expectedPages = Math.round(((planPages * day) / daysInMonth) * 10) / 10;
  const diffPages = Math.round((pages - expectedPages) * 10) / 10;
  if (pages >= planPages) return { status: "done", expectedPages, diffPages };
  if (day < PLAN_LAG_MIN_DAY) return { status: "early", expectedPages, diffPages };
  return { status: diffPages >= 0 ? "ahead" : "behind", expectedPages, diffPages };
}

/**
 * اقتراح هدف الشهر: متوسط صفحاته في الأشهر السابقة التي أنجز فيها شيئاً (الأشهر الفارغة لا تُحتسب
 * فلا تُنزل الهدف بسبب إجازة)، مقرَّباً لأقرب صحيح وبحدّ أدنى صفحة. null إن لم يوجد سجل.
 */
export function suggestMonthlyPlan(monthlyPages: number[]): { pages: number; basedOn: number } | null {
  const done = monthlyPages.filter((p) => p > 0);
  if (!done.length) return null;
  const avg = done.reduce((a, b) => a + b, 0) / done.length;
  return { pages: Math.min(604, Math.max(1, Math.round(avg))), basedOn: done.length };
}
