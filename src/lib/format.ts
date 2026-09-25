import { mushafPageFor, surahName, type Position } from "@shared/quran";

export const fmtPos = (p: Position | null | undefined): string => (p ? `${surahName(p.surah)} ${p.ayah}` : "—");
export const fmtPosPage = (p: Position | null | undefined): string => (p ? `${surahName(p.surah)} ${p.ayah} · صفحة ${mushafPageFor(p.surah, p.ayah)}` : "—");

const dateFmt = new Intl.DateTimeFormat("ar-EG-u-nu-latn", { weekday: "long", day: "numeric", month: "long" });
export const fmtDay = (iso: string): string => dateFmt.format(new Date(`${iso}T12:00:00`));

export const todayIso = (): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hebron", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

export const monthIso = (): string => todayIso().slice(0, 7);

export const ATTENDANCE_LABELS = { present: "حاضر", absent: "غائب", excused: "بعذر", late: "متأخر" } as const;
export type Attendance = keyof typeof ATTENDANCE_LABELS;

export const TEST_STATUS_LABELS: Record<string, string> = { proposed: "مقترح", approved: "معتمد", rejected: "مرفوض", completed: "منتهٍ" };
export const TEST_TYPE_LABELS: Record<string, string> = { single: "منفرد", chain: "مجتمع" };

/** اقتراحات نطاق الاختبار المجتمع (الاختيار حرّ؛ هذه للتسهيل فقط). */
export const RANGE_SUGGESTIONS = [
  "عمّ – المجادلة", "الشورى – يس", "النمل – المؤمنون", "الإسراء – يوسف", "التوبة – الأعراف", "النساء – آل عمران",
  "عمّ – الأحقاف", "الشورى – العنكبوت", "النمل – مريم", "الكهف – يونس", "التوبة – المائدة", "النساء – البقرة",
  "عمّ – العنكبوت", "النمل – يونس", "التوبة – البقرة", "عمّ – مريم", "الإسراء – البقرة", "عمّ – يونس", "البقرة – النمل",
  "القرآن الكريم كاملاً"
];

/** عدد مع تمييز عربي صحيح: 1 طالب، 2 طالبان، 3–10 طلاب، 11+ طالباً (والصفر بصيغة الجمع). */
export function countAr(n: number, [one, two, few, many]: [string, string, string, string]): string {
  if (n === 1) return one;
  if (n === 2) return two;
  if (n >= 3 && n <= 10) return `${n} ${few}`;
  return `${n} ${n === 0 ? few : many}`;
}
export const STUDENTS_AR: [string, string, string, string] = ["طالب واحد", "طالبان", "طلاب", "طالباً"];
export const PARTS_AR: [string, string, string, string] = ["جزء واحد", "جزآن", "أجزاء", "جزءاً"];
export const DAYS_AR: [string, string, string, string] = ["يوم واحد", "يومان", "أيام", "يوماً"];
