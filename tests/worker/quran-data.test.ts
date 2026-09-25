import { describe, expect, it } from "vitest";
import { PAGE_STARTS, SURAHS } from "../../shared/quran-data";

describe("بيانات المصحف", () => {
  it("114 سورة و6236 آية", () => {
    expect(SURAHS).toHaveLength(114);
    expect(SURAHS.reduce((n, s) => n + s[1], 0)).toBe(6236);
    expect(SURAHS[0]).toEqual(["الفاتحة", 7]);
    expect(SURAHS[113]).toEqual(["الناس", 6]);
  });

  it("604 صفحات مرتّبة تصاعدياً وتبدأ من الفاتحة وتنتهي بالناس", () => {
    expect(PAGE_STARTS).toHaveLength(604);
    expect(PAGE_STARTS[0]).toEqual([1, 1, 1]);
    expect(PAGE_STARTS[603]).toEqual([604, 112, 1]);
    for (let i = 1; i < PAGE_STARTS.length; i++) {
      const [pn, surah, ayah] = PAGE_STARTS[i];
      const [, pSurah, pAyah] = PAGE_STARTS[i - 1];
      expect(pn).toBe(i + 1);
      expect(surah > pSurah || (surah === pSurah && ayah > pAyah)).toBe(true);
    }
  });
});
