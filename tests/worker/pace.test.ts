import { describe, expect, it } from "vitest";
import { planPace, suggestMonthlyPlan } from "../../shared/pace";

describe("وتيرة الشهر", () => {
  it("بلا خطة: لا وتيرة", () => {
    expect(planPace(0, 5, "2026-10-20")).toBeNull();
  });

  it("قبل اليوم السابع لا يُحكم بتأخر", () => {
    expect(planPace(30, 0, "2026-10-06")?.status).toBe("early");
  });

  it("المتوقع يتناسب مع أيام الشهر (خطة 31 في اليوم 10 من أكتوبر = 10)", () => {
    const p = planPace(31, 4, "2026-10-10");
    expect(p).toEqual({ status: "behind", expectedPages: 10, diffPages: -6 });
  });

  it("متقدم أو على الخط", () => {
    expect(planPace(31, 10, "2026-10-10")?.status).toBe("ahead");
    expect(planPace(31, 12, "2026-10-10")?.diffPages).toBe(2);
  });

  it("اكتمال الخطة يغلب باقي الحالات حتى مبكراً", () => {
    expect(planPace(10, 10, "2026-10-02")?.status).toBe("done");
  });

  it("فبراير يُحسب بعدد أيامه", () => {
    expect(planPace(28, 0, "2026-02-14")?.expectedPages).toBe(14);
  });
});

describe("اقتراح هدف الشهر", () => {
  it("متوسط الأشهر غير الفارغة", () => {
    expect(suggestMonthlyPlan([10, 0, 7])).toEqual({ pages: 9, basedOn: 2 });
  });

  it("لا سجل: لا اقتراح", () => {
    expect(suggestMonthlyPlan([])).toBeNull();
    expect(suggestMonthlyPlan([0, 0, 0])).toBeNull();
  });

  it("حدّ أدنى صفحة وأقصى 604", () => {
    expect(suggestMonthlyPlan([0.2])?.pages).toBe(1);
    expect(suggestMonthlyPlan([900])?.pages).toBe(604);
  });
});
