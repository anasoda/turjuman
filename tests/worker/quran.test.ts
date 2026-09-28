import { describe, expect, it } from "vitest";
import {
  completedJuz, countPages, countUniquePages, countVerses, furthest, isValidRange, mushafPageFor, nextStart, orderKey, rangeDirection, sardBand, sardScore
} from "../../shared/quran";
import { DEFAULT_SETTINGS } from "../../shared/settings";

const P = (surah: number, ayah: number) => ({ surah, ayah });

describe("صفحة المصحف", () => {
  it("مواضع معروفة", () => {
    expect(mushafPageFor(1, 1)).toBe(1);
    expect(mushafPageFor(2, 1)).toBe(2);
    expect(mushafPageFor(2, 5)).toBe(2);
    expect(mushafPageFor(2, 6)).toBe(3);
    expect(mushafPageFor(18, 1)).toBe(293);
    expect(mushafPageFor(112, 1)).toBe(604);
    expect(mushafPageFor(114, 6)).toBe(604);
    expect(mushafPageFor(78, 1)).toBe(582);
  });
});

describe("الاتجاه التنازلي (الناس → الفاتحة)", () => {
  const d = "descending" as const;
  it("النهاية لا تسبق البداية", () => {
    expect(isValidRange(d, P(114, 1), P(114, 6))).toBe(true);
    expect(isValidRange(d, P(114, 1), P(113, 5))).toBe(true); // 114 ثم 113
    expect(isValidRange(d, P(113, 1), P(114, 6))).toBe(false); // عودة إلى الوراء
    expect(isValidRange(d, P(114, 4), P(114, 2))).toBe(false);
    expect(isValidRange(d, P(114, 7), P(114, 8))).toBe(false); // آية غير موجودة
  });
  it("عدّ الآيات عبر السور", () => {
    expect(countVerses(d, P(114, 1), P(114, 6))).toBe(6);
    expect(countVerses(d, P(114, 1), P(113, 5))).toBe(6 + 5); // الناس كاملة + الفلق كاملة
    expect(countVerses(d, P(114, 3), P(112, 2))).toBe(4 + 5 + 2);
    expect(countVerses(d, P(113, 1), P(114, 6))).toBe(0);
  });
  it("الآية التالية", () => {
    expect(nextStart(d, P(114, 0))).toEqual(P(114, 1));
    expect(nextStart(d, P(114, 3))).toEqual(P(114, 4));
    expect(nextStart(d, P(114, 6))).toEqual(P(113, 1));
    expect(nextStart(d, P(1, 7))).toBeNull();
  });
  it("الصفحات المشتركة تُعدّ مرة واحدة", () => {
    expect(countPages(d, P(114, 1), P(112, 4))).toBe(1); // كلها في الصفحة 604
    expect(countPages(d, P(114, 1), P(111, 5))).toBe(2); // 604 + 603
    expect(countUniquePages(d, [{ from: P(114, 1), to: P(114, 6) }, { from: P(113, 1), to: P(113, 5) }])).toBe(1);
  });
  it("الأجزاء المكتملة (على مستوى السورة)", () => {
    expect(completedJuz(d, P(114, 6))).toBe(0);
    expect(completedJuz(d, P(78, 40))).toBe(1); // أتمّ النبأ = الجزء 30
    expect(completedJuz(d, P(78, 10))).toBe(0);
    expect(completedJuz(d, P(1, 7))).toBe(30);
  });
});

describe("الاتجاه التصاعدي (الفاتحة → الناس)", () => {
  const a = "ascending" as const;
  it("الترتيب والصلاحية", () => {
    expect(isValidRange(a, P(1, 1), P(2, 5))).toBe(true);
    expect(isValidRange(a, P(2, 5), P(1, 1))).toBe(false);
    expect(orderKey(a, P(2, 1))).toBeGreaterThan(orderKey(a, P(1, 7)));
    expect(furthest(a, P(2, 10), P(3, 1))).toEqual(P(3, 1));
    expect(furthest("descending", P(2, 10), P(3, 1))).toEqual(P(2, 10));
  });
  it("عدّ الآيات والآية التالية", () => {
    expect(countVerses(a, P(1, 1), P(1, 7))).toBe(7);
    expect(countVerses(a, P(1, 1), P(2, 3))).toBe(7 + 3);
    expect(nextStart(a, P(1, 7))).toEqual(P(2, 1));
    expect(nextStart(a, P(114, 6))).toBeNull();
    expect(nextStart(a, P(2, 0))).toEqual(P(2, 1));
  });
  it("الصفحات", () => {
    expect(countPages(a, P(1, 1), P(1, 7))).toBe(1);
    expect(countPages(a, P(1, 1), P(2, 10))).toBe(3); // 1 و2 و3
  });
  it("الأجزاء المكتملة بحدود دقيقة", () => {
    expect(completedJuz(a, P(2, 140))).toBe(0);
    expect(completedJuz(a, P(2, 141))).toBe(1); // الجزء 1 ينتهي عند 2:141
    expect(completedJuz(a, P(2, 251))).toBe(1);
    expect(completedJuz(a, P(2, 252))).toBe(2); // الجزء 2 ينتهي عند 2:252
    expect(completedJuz(a, P(3, 92))).toBe(3);
    expect(completedJuz(a, P(114, 6))).toBe(30);
  });
});

describe("درجات السرد", () => {
  const s = DEFAULT_SETTINGS;
  it("الخصم والتقدير", () => {
    expect(sardScore(s, 0, 0)).toBe(100);
    expect(sardScore(s, 2, 1)).toBe(97.5);
    expect(sardBand(s, 100)).toBe("ممتاز جداً");
    expect(sardBand(s, 92)).toBe("ممتاز");
    expect(sardBand(s, 85)).toBe("جيد جداً");
    expect(sardBand(s, 69.5)).toBe("إعادة");
    expect(sardScore(s, 500, 0)).toBe(0);
  });
});

describe("اتجاه نطاق المراجعة (حرّ)", () => {
  it("يفضّل اتجاه الطالب إن صلح", () => {
    expect(rangeDirection("descending", P(114, 1), P(110, 3))).toBe("descending");
    expect(rangeDirection("ascending", P(2, 1), P(3, 5))).toBe("ascending");
  });
  it("يقبل العكس إن لم يصلح اتجاه الطالب", () => {
    // طالب تنازلي يراجع مقطعاً بترتيب المصحف: من البقرة إلى آل عمران
    expect(rangeDirection("descending", P(2, 1), P(3, 5))).toBe("ascending");
    expect(rangeDirection("ascending", P(114, 1), P(110, 3))).toBe("descending");
  });
  it("يرفض موضعاً غير صالح", () => {
    expect(rangeDirection("descending", P(1, 99), P(2, 1))).toBeNull();
  });
  it("داخل السورة الواحدة يبقى اتجاه الطالب", () => {
    expect(rangeDirection("descending", P(2, 1), P(2, 50))).toBe("descending");
  });
});
