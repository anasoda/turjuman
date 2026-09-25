import { describe, expect, it } from "vitest";
import { partsOf, withParts } from "../../worker/lib/parts";

describe("المحفوظ المحسوب من آخر موضع (قرار المالك)", () => {
  it("الحافظ: تنازلي أتمّ الفاتحة، وتصاعدي أتمّ الناس", () => {
    expect(partsOf({ direction: "descending", lastSurah: 1, lastAyah: 7 })).toBe(30);
    expect(partsOf({ direction: "ascending", lastSurah: 114, lastAyah: 6 })).toBe(30);
  });

  it("لم يكتمل بعد: تنازلي في منتصف النبأ = 0، ومن أتمّ النبأ = جزء واحد", () => {
    expect(partsOf({ direction: "descending", lastSurah: 78, lastAyah: 15 })).toBe(0);
    expect(partsOf({ direction: "descending", lastSurah: 78, lastAyah: 40 })).toBe(1);
  });

  it("يتجاهل الرقم اليدوي القديم ويستبدله بالمحسوب", () => {
    const row = { direction: "descending", lastSurah: 114, lastAyah: 0, memorizedParts: 6 };
    expect(withParts(row).memorizedParts).toBe(0);
  });
});
