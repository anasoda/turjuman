import { describe, expect, it } from "vitest";
import { countPages, endAfterPages, isValidRange } from "../../shared/quran";

const P = (surah: number, ayah: number) => ({ surah, ayah });

describe("نهاية المقطع من عدد الصفحات", () => {
  it("صفحة كاملة تصاعدياً: صفحة الفاتحة 7 آيات", () => {
    expect(endAfterPages("ascending", P(1, 1), 1)).toEqual(P(1, 7));
  });

  it("صفحتان تصاعدياً تنتهيان عند آخر آية في الصفحة الثانية (البقرة 5)", () => {
    expect(endAfterPages("ascending", P(1, 1), 2)).toEqual(P(2, 5));
  });

  it("تنازلياً يعبر السور بترتيب المسار: صفحة 604 = من الناس إلى الإخلاص", () => {
    expect(endAfterPages("descending", P(114, 1), 1)).toEqual(P(112, 4));
  });

  it("نصف صفحة: ثلاث أو أربع آيات من سبع", () => {
    const end = endAfterPages("ascending", P(1, 1), 0.5);
    expect(end.surah).toBe(1);
    expect([3, 4]).toContain(end.ayah);
  });

  it("حصة صغيرة جداً تعطي آية واحدة على الأقل", () => {
    expect(endAfterPages("ascending", P(2, 1), 0.01)).toEqual(P(2, 1));
  });

  it("خطة صفرية أو بداية غير صالحة: تعود البداية نفسها", () => {
    expect(endAfterPages("ascending", P(1, 1), 0)).toEqual(P(1, 1));
    expect(endAfterPages("ascending", P(1, 99), 3)).toEqual(P(1, 99));
  });

  it("لا يتجاوز نهاية المسار", () => {
    expect(endAfterPages("ascending", P(114, 5), 10)).toEqual(P(114, 6));
    expect(endAfterPages("descending", P(1, 6), 10)).toEqual(P(1, 7));
  });

  it("المقطع الناتج صالح وقريب من الحصة", () => {
    for (const dir of ["ascending", "descending"] as const) {
      const from = dir === "ascending" ? P(2, 100) : P(78, 1);
      const end = endAfterPages(dir, from, 3);
      expect(isValidRange(dir, from, end)).toBe(true);
      expect(Math.abs(countPages(dir, from, end) - 3)).toBeLessThanOrEqual(2);
    }
  });
});
