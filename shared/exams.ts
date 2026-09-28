import { partsInRange, ayahCount } from "./quran";
import { SURAHS } from "./quran-data";
import type { ExamQuestionSlot } from "./settings";

export type ExamRange =
  | { kind: "juz"; fromJuz: number; toJuz: number }
  | { kind: "surah"; fromSurah: number; toSurah: number };

export function examRangeDetails(range: ExamRange): { parts: number; text: string } | null {
  if (range.kind === "juz") {
    const { fromJuz, toJuz } = range;
    if (!Number.isInteger(fromJuz) || !Number.isInteger(toJuz) || fromJuz < 1 || toJuz > 30 || fromJuz > toJuz) return null;
    return { parts: toJuz - fromJuz + 1, text: fromJuz === toJuz ? `الجزء ${fromJuz}` : `الأجزاء ${fromJuz}–${toJuz}` };
  }
  const { fromSurah, toSurah } = range;
  if (!Number.isInteger(fromSurah) || !Number.isInteger(toSurah) || fromSurah < 1 || toSurah > 114 || fromSurah > toSurah) return null;
  return {
    parts: partsInRange({ surah: fromSurah, ayah: 1 }, { surah: toSurah, ayah: ayahCount(toSurah) }),
    text: fromSurah === toSurah ? `سورة ${SURAHS[fromSurah - 1][0]}` : `من ${SURAHS[fromSurah - 1][0]} إلى ${SURAHS[toSurah - 1][0]}`
  };
}

export function validExamSlots(slots: ExamQuestionSlot[]): boolean {
  return slots.length > 0 && slots.length <= 20 && slots.every((s) => s.label.trim() && Number.isInteger(s.maxScore) && s.maxScore > 0 && s.maxScore <= 100)
    && slots.reduce((sum, s) => sum + s.maxScore, 0) === 100;
}

/** يُبقي السؤال المعدّل ثابتاً ويوزّع باقي المئة على الأسئلة الأخرى. */
export function balanceExamSlots(slots: ExamQuestionSlot[], fixedIndex: number | null = null): ExamQuestionSlot[] {
  if (!slots.length) return [];
  const next = slots.map((slot) => ({ ...slot, maxScore: Math.max(1, Math.min(100, Math.round(slot.maxScore) || 1)) }));
  if (next.length === 1) return [{ ...next[0], maxScore: 100 }];
  let targets = next.map((slot, i) => slot.isQuranic && i !== fixedIndex ? i : -1).filter((i) => i >= 0);
  if (!targets.length || 100 - next.reduce((sum, slot, i) => sum + (targets.includes(i) ? 0 : slot.maxScore), 0) < targets.length) {
    targets = next.map((_, i) => i !== fixedIndex ? i : -1).filter((i) => i >= 0);
  }
  const fixed = next.reduce((sum, slot, i) => sum + (targets.includes(i) ? 0 : slot.maxScore), 0);
  const available = 100 - fixed;
  if (available < targets.length) {
    // لا يمكن تثبيت قيمة تجعل لكل سؤال علامة واحدة؛ نعيد توزيع الجميع.
    targets = next.map((_, i) => i);
  }
  const remaining = 100 - next.reduce((sum, slot, i) => sum + (targets.includes(i) ? 0 : slot.maxScore), 0);
  const base = Math.floor(remaining / targets.length);
  const extra = remaining % targets.length;
  targets.forEach((index, order) => { next[index].maxScore = base + (order < extra ? 1 : 0); });
  return next;
}

/** التنبيهات والأخطاء خصومات من العلامة القصوى للسؤال. */
export function examQuestionScore(maxScore: number, warnings: number, errors: number): number {
  return Math.max(0, maxScore - warnings * 0.5 - errors);
}

export function examTotalScore(questions: ReadonlyArray<{ maxScore: number; warnings: number; errors: number }>): number {
  return Math.round(questions.reduce((sum, q) => sum + examQuestionScore(q.maxScore, q.warnings, q.errors), 0) * 2) / 2;
}
