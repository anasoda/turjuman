// تواريخ المركز بتوقيت فلسطين (Asia/Hebron).
const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hebron", year: "numeric", month: "2-digit", day: "2-digit" });

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export const todayHebron = (): string => fmt.format(new Date());
export const monthOf = (date: string): string => date.slice(0, 7);

/** هل التاريخ ليس بعد غدٍ (نسمح بهامش يوم لفروق التوقيت). */
export function notTooFuture(date: string): boolean {
  const limit = new Date(Date.now() + 36 * 3600_000);
  return new Date(`${date}T00:00:00Z`).getTime() <= limit.getTime();
}
