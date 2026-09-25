// مواعيد الصلاة: استيراد من نص CSV/جدول منسوخ، وحساب الصلاة القادمة (بتوقيت المركز).

export const PRAYERS = [
  ["fajr", "الفجر"],
  ["dhuhr", "الظهر"],
  ["asr", "العصر"],
  ["maghrib", "المغرب"],
  ["isha", "العشاء"]
] as const;
export type PrayerKey = (typeof PRAYERS)[number][0];

export interface PrayerDay {
  date: string;
  fajr: string;
  sunrise: string;
  dhuhr: string;
  asr: string;
  maghrib: string;
  isha: string;
}

const COLUMNS = ["fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"] as const;
const pad = (n: number) => String(n).padStart(2, "0");
export const toMinutes = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** أرقام عربية/فارسية → لاتينية. */
const latin = (s: string) => s.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));

/**
 * الأوراق المطبوعة غالباً بنظام 12 ساعة بلا ص/م؛ نحوّلها إلى 24 ساعة:
 * الظهر إن كانت الساعة < 10 → مساءً، والعصر والمغرب والعشاء إن كانت < 12 → مساءً.
 */
export function to24(key: (typeof COLUMNS)[number], h: number, m: number): string {
  let hh = h;
  if (key === "dhuhr" && hh < 10) hh += 12;
  if ((key === "asr" || key === "maghrib" || key === "isha") && hh < 12) hh += 12;
  return `${pad(hh)}:${pad(m)}`;
}

function parseDate(raw: string, fallbackYear: number): string | null {
  const s = latin(raw.trim());
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) return `${m[3]}-${pad(+m[2])}-${pad(+m[1])}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})$/); // يوم/شهر بلا سنة
  if (m) return `${fallbackYear}-${pad(+m[2])}-${pad(+m[1])}`;
  return null;
}

export interface PrayerParseResult {
  rows: PrayerDay[];
  errors: string[];
}

/** يقرأ نصاً (فواصل/تبويب/فاصلة منقوطة/مسافات): تاريخ، فجر، شروق، ظهر، عصر، مغرب، عشاء. السطر الأول العنوان يُتجاهل تلقائياً. */
export function parsePrayerText(text: string, fallbackYear: number, opts: { twelveHour: boolean } = { twelveHour: true }): PrayerParseResult {
  const rows: PrayerDay[] = [];
  const errors: string[] = [];
  const lines = latin(text).replace(/^\uFEFF/, "").replace(/"/g, "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  lines.forEach((line, idx) => {
    const cells = line.split(/[,\t;|]+|\s{2,}|\s(?=\d{1,2}:\d{2})/).map((c) => c.trim()).filter(Boolean);
    if (cells.length < 7) {
      if (idx > 0 || /\d/.test(line)) errors.push(`السطر ${idx + 1}: يلزم 7 أعمدة (التاريخ + 6 أوقات)`);
      return;
    }
    const date = parseDate(cells[0], fallbackYear);
    if (!date) { if (idx > 0) errors.push(`السطر ${idx + 1}: تاريخ غير مفهوم «${cells[0]}»`); return; }
    const row: Record<string, string> = { date };
    for (let i = 0; i < COLUMNS.length; i++) {
      const t = cells[i + 1].match(/^(\d{1,2}):(\d{2})/);
      if (!t || +t[1] > 23 || +t[2] > 59) { errors.push(`السطر ${idx + 1}: وقت غير صالح «${cells[i + 1]}»`); return; }
      row[COLUMNS[i]] = opts.twelveHour ? to24(COLUMNS[i], +t[1], +t[2]) : `${pad(+t[1])}:${t[2]}`;
    }
    rows.push(row as unknown as PrayerDay);
  });
  return { rows, errors };
}

export interface NextPrayer {
  key: PrayerKey;
  label: string;
  time: string;
  date: string;
  minutesLeft: number;
}

const dayDiff = (a: string, b: string) => Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86400_000);

/** الصلاة القادمة بعد اللحظة الحالية (اليوم أولاً ثم الأيام التالية المتاحة). */
export function nextPrayer(days: PrayerDay[], today: string, nowHHMM: string): NextPrayer | null {
  const now = toMinutes(nowHHMM);
  const sorted = [...days].filter((d) => d.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  for (const day of sorted) {
    const offset = dayDiff(today, day.date) * 1440;
    for (const [key, label] of PRAYERS) {
      const left = offset + toMinutes(day[key]) - now;
      if (left > 0) return { key, label, time: day[key], date: day.date, minutesLeft: left };
    }
  }
  return null;
}

export function formatCountdown(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h} ساعة${m ? ` و${m} دقيقة` : ""}` : `${m} دقيقة`;
}
