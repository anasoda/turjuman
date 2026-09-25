// حساب الحفظ: صفحات مصحف المدينة والآيات والأجزاء، مع دعم اتجاه الحفظ لكل طالب.
//
// الاتجاهان:
//  - descending: من الناس إلى الفاتحة — السور تنازلية (114 → 1)، والآيات داخل كل سورة تصاعدية (1 → n).
//  - ascending : من الفاتحة إلى الناس — السور تصاعدية (1 → 114)، والآيات داخل السورة تصاعدية.
//
// «الموضع» = (سورة، آية). آخر موضع محفوظ للطالب آيته 0 تعني «لم يحفظ شيئاً من هذه السورة بعد».
import type { Direction } from "./constants";
import { PAGE_STARTS, SURAHS } from "./quran-data";

export interface Position {
  surah: number;
  ayah: number;
}

export const SURAH_COUNT = 114;
export const PAGE_COUNT = 604;

export const surahName = (surah: number): string => SURAHS[surah - 1]?.[0] ?? "";
export const ayahCount = (surah: number): number => SURAHS[surah - 1]?.[1] ?? 0;

/** ترتيب الموضع داخل مسار الحفظ (أصغر = أبكر). */
export function orderKey(direction: Direction, p: Position): number {
  return (direction === "descending" ? SURAH_COUNT - p.surah : p.surah) * 1000 + p.ayah;
}

export function isValidPosition(p: Position): boolean {
  return Number.isInteger(p.surah) && Number.isInteger(p.ayah) && p.surah >= 1 && p.surah <= SURAH_COUNT && p.ayah >= 1 && p.ayah <= ayahCount(p.surah);
}

/** هل النطاق صالح: الموضعان صحيحان والنهاية لا تسبق البداية وفق الاتجاه. */
export function isValidRange(direction: Direction, from: Position, to: Position): boolean {
  return isValidPosition(from) && isValidPosition(to) && orderKey(direction, from) <= orderKey(direction, to);
}

/** السورة التالية في مسار الحفظ (أو null عند نهاية المسار). */
export function nextSurah(direction: Direction, surah: number): number | null {
  const n = direction === "descending" ? surah - 1 : surah + 1;
  return n >= 1 && n <= SURAH_COUNT ? n : null;
}

/** أول آية يبدأ منها الطالب بعد آخر ما حفظه. null إذا أتمّ المسار كله. */
export function nextStart(direction: Direction, last: Position): Position | null {
  if (last.ayah < ayahCount(last.surah)) return { surah: last.surah, ayah: last.ayah + 1 };
  const s = nextSurah(direction, last.surah);
  return s === null ? null : { surah: s, ayah: 1 };
}

/** الموضع الأول في مسار الحفظ (بداية المسار). */
export const pathStart = (direction: Direction): Position => ({ surah: direction === "descending" ? SURAH_COUNT : 1, ayah: 0 });

/** قطع النطاق إلى مقاطع (سورة، من آية، إلى آية) بترتيب المسار. */
function segments(direction: Direction, from: Position, to: Position): Array<{ surah: number; from: number; to: number }> {
  const out: Array<{ surah: number; from: number; to: number }> = [];
  let s = from.surah;
  for (let guard = 0; guard <= SURAH_COUNT; guard++) {
    const first = s === from.surah ? from.ayah : 1;
    const last = s === to.surah ? to.ayah : ayahCount(s);
    out.push({ surah: s, from: first, to: last });
    if (s === to.surah) break;
    const n = nextSurah(direction, s);
    if (n === null) break;
    s = n;
  }
  return out;
}

/** عدد الآيات من موضع إلى موضع (شاملاً الطرفين). 0 إذا كان النطاق غير صالح. */
export function countVerses(direction: Direction, from: Position, to: Position): number {
  if (!isValidRange(direction, from, to)) return 0;
  return segments(direction, from, to).reduce((n, seg) => n + (seg.to - seg.from + 1), 0);
}

/** رقم صفحة الآية في مصحف المدينة (1..604) بالبحث الثنائي في جدول بدايات الصفحات. */
export function mushafPageFor(surah: number, ayah: number): number {
  const key = surah * 1000 + ayah;
  let lo = 0;
  let hi = PAGE_STARTS.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    const [, s, a] = PAGE_STARTS[mid];
    if (s * 1000 + a <= key) lo = mid;
    else hi = mid - 1;
  }
  return PAGE_STARTS[lo][0];
}

/** مجموعة الصفحات التي يغطيها النطاق (شاملاً الطرفين). */
export function pagesOfRange(direction: Direction, from: Position, to: Position): Set<number> {
  const pages = new Set<number>();
  if (!isValidRange(direction, from, to)) return pages;
  for (const seg of segments(direction, from, to)) {
    const a = mushafPageFor(seg.surah, seg.from);
    const b = mushafPageFor(seg.surah, seg.to);
    for (let p = a; p <= b; p++) pages.add(p);
  }
  return pages;
}

/** عدد صفحات المصحف التي يغطيها النطاق. الصفحة المشتركة بين آيتين تُعدّ مرة واحدة. */
export const countPages = (direction: Direction, from: Position, to: Position): number => pagesOfRange(direction, from, to).size;

/** عدد الصفحات الفريدة عبر عدة نطاقات (الكشف الشهري: تُعدّ الصفحة المشتركة بين يومين مرة واحدة). */
export function countUniquePages(direction: Direction, ranges: Array<{ from: Position; to: Position }>): number {
  const all = new Set<number>();
  for (const r of ranges) for (const p of pagesOfRange(direction, r.from, r.to)) all.add(p);
  return all.size;
}

/** أبعد موضع بين موضعين وفق الاتجاه. */
export function furthest(direction: Direction, a: Position, b: Position): Position {
  return orderKey(direction, a) >= orderKey(direction, b) ? a : b;
}

/* ---------- الأجزاء ---------- */

// أول سورة في كل جزء (المرجع التقريبي على مستوى السورة) — يُستعمل في الاتجاه التنازلي:
// الجزء يُعدّ مكتملاً حين يُتمّ الطالب سورة حدّه ثم يصعد.
const JUZ_START_SURAH = [1, 2, 2, 3, 4, 4, 5, 6, 7, 8, 9, 11, 12, 15, 17, 18, 21, 23, 25, 27, 29, 33, 36, 39, 41, 46, 51, 58, 67, 78];

// بدايات الأجزاء الدقيقة (سورة، آية) — تُستعمل في الاتجاه التصاعدي.
const JUZ_START: ReadonlyArray<Position> = [
  [1, 1], [2, 142], [2, 253], [3, 93], [4, 24], [4, 148], [5, 82], [6, 111], [7, 88], [8, 41],
  [9, 93], [11, 6], [12, 53], [15, 1], [17, 1], [18, 75], [21, 1], [23, 1], [25, 21], [27, 56],
  [29, 46], [33, 31], [36, 28], [39, 32], [41, 47], [46, 1], [51, 31], [58, 1], [67, 1], [78, 1]
].map(([surah, ayah]) => ({ surah, ayah }));

/** عدد الأجزاء المكتملة عند آخر موضع محفوظ. */
export function completedJuz(direction: Direction, last: Position): number {
  if (last.surah < 1 || last.surah > SURAH_COUNT) return 0;
  if (direction === "descending") {
    const doneCurrent = last.ayah >= ayahCount(last.surah);
    return JUZ_START_SURAH.filter((start) => last.surah < start || (last.surah === start && doneCurrent)).length;
  }
  // تصاعدي: الجزء k مكتمل إذا بلغ الموضع نهايته (آية قبل بداية الجزء k+1، ونهاية الجزء 30 آخر آية في المصحف)
  let done = 0;
  for (let k = 0; k < 30; k++) {
    const end = k === 29 ? { surah: 114, ayah: 6 } : prevAyah(JUZ_START[k + 1]);
    if (last.surah * 1000 + last.ayah >= end.surah * 1000 + end.ayah) done++;
  }
  return done;
}

/** الآية السابقة في ترتيب المصحف العادي. */
function prevAyah(p: Position): Position {
  return p.ayah > 1 ? { surah: p.surah, ayah: p.ayah - 1 } : { surah: p.surah - 1, ayah: ayahCount(p.surah - 1) };
}

/** نسبة إنجاز الشهر مقابل الخطة (0..∞، تُقصّ للعرض بـ 100%). */
export function planPercent(pages: number, planPages: number): number {
  return planPages > 0 ? Math.round((pages / planPages) * 100) : 0;
}

/* ---------- درجات السرد ---------- */

export interface ScoreSettings {
  sardStartScore: number;
  sardDeductMistake: number;
  sardDeductAlert: number;
  sardBands: Array<{ min: number; label: string }>;
}

/** درجة السرد = البداية − (الأخطاء × خصم الخطأ) − (التنبيهات × خصم التنبيه)، ولا تقل عن صفر. */
export function sardScore(s: ScoreSettings, mistakes: number, alerts: number): number {
  const raw = s.sardStartScore - mistakes * s.sardDeductMistake - alerts * s.sardDeductAlert;
  return Math.max(0, Math.round(raw * 100) / 100);
}

/** التقدير: أول تقدير (من الأعلى) حدّه الأدنى ≤ الدرجة. */
export function sardBand(s: ScoreSettings, score: number): string {
  const sorted = [...s.sardBands].sort((a, b) => b.min - a.min);
  return sorted.find((b) => score >= b.min)?.label ?? sorted[sorted.length - 1]?.label ?? "";
}
