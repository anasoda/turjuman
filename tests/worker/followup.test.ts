import { describe, expect, it } from "vitest";
import { daysBetween, followUpReasons, PLAN_LAG_MIN_DAY, type FollowUpInput } from "../../shared/followup";

const TH = { absenceCount: 3, noReciteDays: 7, planLagPct: 30 };
const base: FollowUpInput = { absences: 0, lastReciteDate: "2026-10-19", joinedAt: "2025-09-01", planPages: 0, pages: 0, today: "2026-10-20" };
const kinds = (i: Partial<FollowUpInput>, th = TH) => followUpReasons({ ...base, ...i }, th).map((r) => r.kind);

describe("طلاب يحتاجون متابعة", () => {
  it("لا سبب عند طالب منتظم", () => {
    expect(kinds({})).toEqual([]);
  });

  it("الغياب: عند الحد أو فوقه فقط", () => {
    expect(kinds({ absences: 2 })).toEqual([]);
    expect(kinds({ absences: 3 })).toEqual(["absence"]);
    expect(kinds({ absences: 5 })).toEqual(["absence"]);
    expect(kinds({ absences: 1 }, { ...TH, absenceCount: 1 })).toEqual(["absence"]);
  });

  it("بلا تسميع: العدّ من آخر حضور، والحدّ شامل", () => {
    expect(kinds({ lastReciteDate: "2026-10-14" })).toEqual([]); // 6 أيام
    const r = followUpReasons({ ...base, lastReciteDate: "2026-10-13" }, TH); // 7 أيام
    expect(r).toEqual([{ kind: "noRecite", days: 7, never: false }]);
  });

  it("الحصة الملغاة لا تُحتسب انقطاعاً: العدّ من آخر إلغاء إن كان أحدث", () => {
    expect(kinds({ lastReciteDate: "2026-10-05", lastCancelledDate: "2026-10-19" })).toEqual([]);
    expect(kinds({ lastReciteDate: "2026-10-05", lastCancelledDate: "2026-10-01" })).toEqual(["noRecite"]);
    expect(kinds({ lastReciteDate: "2026-10-05", lastCancelledDate: null })).toEqual(["noRecite"]);
  });

  it("بلا تسميع قط: العدّ من تاريخ الالتحاق، ومن التحق حديثاً لا يُنبَّه", () => {
    expect(followUpReasons({ ...base, lastReciteDate: null, joinedAt: "2026-10-01" }, TH)).toEqual([{ kind: "noRecite", days: 19, never: true }]);
    expect(kinds({ lastReciteDate: null, joinedAt: "2026-10-18" })).toEqual([]);
    expect(kinds({ lastReciteDate: null, joinedAt: null })).toEqual([]);
  });

  it("التأخر عن الخطة: متناسب مع أيام الشهر، والحدّ شامل", () => {
    // 31 يوماً، اليوم 20، خطة 31 صفحة ← المتوقع 20 صفحة
    const at = (pages: number) => followUpReasons({ ...base, planPages: 31, pages }, TH);
    expect(at(20)).toEqual([]);
    expect(at(15)).toEqual([]); // تأخر 25%
    expect(at(14)).toEqual([{ kind: "planLag", lagPct: 30, expectedPages: 20, pages: 14, planPages: 31 }]); // 30% بالضبط
    expect(at(0)).toMatchObject([{ kind: "planLag", lagPct: 100 }]);
    expect(at(40)).toEqual([]); // متقدم على الخطة
  });

  it("لا قياس للتأخر بلا خطة أو قبل اليوم الذي يبدأ عنده القياس", () => {
    expect(kinds({ planPages: 0, pages: 0 })).toEqual([]);
    const early = `2026-10-${String(PLAN_LAG_MIN_DAY - 1).padStart(2, "0")}`;
    expect(kinds({ planPages: 30, pages: 0, today: early, lastReciteDate: early })).toEqual([]);
    const first = `2026-10-${String(PLAN_LAG_MIN_DAY).padStart(2, "0")}`;
    expect(kinds({ planPages: 30, pages: 0, today: first, lastReciteDate: first })).toEqual(["planLag"]);
  });

  it("الأسباب تجتمع", () => {
    expect(kinds({ absences: 4, lastReciteDate: "2026-10-01", planPages: 30, pages: 2 })).toEqual(["absence", "noRecite", "planLag"]);
  });

  it("عدد الأيام يعبر حدود الشهور والسنوات", () => {
    expect(daysBetween("2026-09-28", "2026-10-03")).toBe(5);
    expect(daysBetween("2025-12-30", "2026-01-02")).toBe(3);
    expect(daysBetween("2026-10-20", "2026-10-20")).toBe(0);
  });
});
