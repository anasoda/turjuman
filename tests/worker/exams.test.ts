import { describe, expect, it } from "vitest";
import { balanceExamSlots, examQuestionScore, examRangeDetails, examTotalScore, validExamSlots } from "../../shared/exams";
import { DEFAULT_SETTINGS } from "../../shared/settings";
import { juzForPosition } from "../../shared/quran";

describe("نطاق الاختبار", () => {
  it("يحسب الأجزاء من حدودها الشاملة", () => {
    expect(examRangeDetails({ kind: "juz", fromJuz: 3, toJuz: 5 })).toEqual({ parts: 3, text: "الأجزاء 3–5" });
    expect(examRangeDetails({ kind: "juz", fromJuz: 5, toJuz: 3 })).toBeNull();
  });
  it("يحسب الأجزاء التي تمر بها السور المحددة", () => {
    expect(examRangeDetails({ kind: "surah", fromSurah: 1, toSurah: 1 })?.parts).toBe(1);
    expect(examRangeDetails({ kind: "surah", fromSurah: 1, toSurah: 114 })?.parts).toBe(30);
    expect(examRangeDetails({ kind: "surah", fromSurah: 114, toSurah: 1 })).toBeNull();
  });
  it("يحدد جزء موضع السؤال عند حدود الأجزاء", () => {
    expect(juzForPosition({ surah: 2, ayah: 141 })).toBe(1);
    expect(juzForPosition({ surah: 2, ayah: 142 })).toBe(2);
    expect(juzForPosition({ surah: 114, ayah: 6 })).toBe(30);
    expect(juzForPosition({ surah: 1, ayah: 99 })).toBeNull();
  });
});

describe("درجات جلسة الاختبار", () => {
  it("يثبّت توزيع المئة ويعيد توازنه عند تغيير أحكام التجويد", () => {
    const slots = DEFAULT_SETTINGS.examQuestionSlots;
    expect(validExamSlots(slots)).toBe(true);
    const changed = balanceExamSlots(slots.map((s, i) => i === 4 ? { ...s, maxScore: 30 } : s), 4);
    expect(changed[4].maxScore).toBe(30);
    expect(changed.reduce((sum, q) => sum + q.maxScore, 0)).toBe(100);
    expect(validExamSlots(changed)).toBe(true);
    const withoutTajweed = balanceExamSlots(slots.slice(0, 4));
    expect(withoutTajweed.map((q) => q.maxScore)).toEqual([25, 25, 25, 25]);
  });
  it("يخصم نصف علامة للتنبيه وعلامة للخطأ ولا ينزل تحت الصفر", () => {
    expect(examQuestionScore(20, 3, 2)).toBe(16.5);
    expect(examQuestionScore(20, 100, 2)).toBe(0);
    expect(examTotalScore([{ maxScore: 20, warnings: 3, errors: 2 }, { maxScore: 80, warnings: 0, errors: 0 }])).toBe(96.5);
  });
});
