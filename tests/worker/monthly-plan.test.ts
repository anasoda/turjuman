import { describe, expect, it } from "vitest";
import { canEditMonthlyPlan } from "../../shared/monthly-plan";

describe("نافذة خطة الشهر", () => {
  it("يبقي سبتمبر مستقلاً ويفتح أكتوبر من 26 سبتمبر", () => {
    expect(canEditMonthlyPlan("2026-09-25", "2026-10")).toBe(false);
    expect(canEditMonthlyPlan("2026-09-26", "2026-10")).toBe(true);
    expect(canEditMonthlyPlan("2026-09-30", "2026-10")).toBe(true);
    expect(canEditMonthlyPlan("2026-09-30", "2026-09")).toBe(true);
    expect(canEditMonthlyPlan("2026-10-01", "2026-09")).toBe(false);
    expect(canEditMonthlyPlan("2026-10-01", "2026-10")).toBe(true);
  });
  it("يحسب آخر خمسة أيام في الشهور القصيرة وعند تبدل السنة", () => {
    expect(canEditMonthlyPlan("2028-02-24", "2028-03")).toBe(false);
    expect(canEditMonthlyPlan("2028-02-25", "2028-03")).toBe(true);
    expect(canEditMonthlyPlan("2026-12-27", "2027-01")).toBe(true);
    expect(canEditMonthlyPlan("2026-12-26", "2027-01")).toBe(false);
  });
});
