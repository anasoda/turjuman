import { describe, expect, it } from "vitest";
import { firstOfNextMonth, planTransfer } from "../../shared/transfer-plan";
import { circleOnSql, lastDayOfMonth } from "../../worker/lib/transfers";

describe("firstOfNextMonth", () => {
  it("أول الشهر التالي", () => {
    expect(firstOfNextMonth("2026-09-26")).toBe("2026-10-01");
    expect(firstOfNextMonth("2026-01-31")).toBe("2026-02-01");
  });
  it("ينتقل إلى السنة التالية في ديسمبر", () => {
    expect(firstOfNextMonth("2026-12-25")).toBe("2027-01-01");
  });
});

describe("lastDayOfMonth", () => {
  it("آخر يوم في الشهر", () => {
    expect(lastDayOfMonth("2026-09")).toBe("2026-09-30");
    expect(lastDayOfMonth("2026-12")).toBe("2026-12-31");
  });
  it("شباط في السنة الكبيسة وغيرها", () => {
    expect(lastDayOfMonth("2028-02")).toBe("2028-02-29");
    expect(lastDayOfMonth("2027-02")).toBe("2027-02-28");
  });
});

describe("planTransfer — من اليوم 25 يُرتَّب ويسري من أول الشهر التالي", () => {
  it("اليوم 25 وما بعده: مرتَّب لأي دور وبلا سبب", () => {
    for (const role of ["admin", "secretary", "stage_manager"]) {
      expect(planTransfer("2026-09-25", role, "")).toEqual({ kind: "arranged", effectiveFrom: "2026-10-01" });
      expect(planTransfer("2026-09-30", role, "")).toEqual({ kind: "arranged", effectiveFrom: "2026-10-01" });
    }
  });
  it("اليوم 24 فما قبل: السكرتير ومدير المرحلة ممنوعان (403)", () => {
    for (const role of ["secretary", "stage_manager"]) {
      const p = planTransfer("2026-09-24", role, "سبب واضح");
      expect(p.kind).toBe("denied");
      if (p.kind === "denied") expect(p.status).toBe(403);
    }
  });
  it("المدير قبل اليوم 25 يحتاج سبباً مكتوباً (400) ثم يسري فوراً", () => {
    const noReason = planTransfer("2026-09-10", "admin", " ab ");
    expect(noReason.kind).toBe("denied");
    if (noReason.kind === "denied") expect(noReason.status).toBe(400);
    expect(planTransfer("2026-09-10", "admin", "انتقال سكن الأسرة")).toEqual({ kind: "immediate", effectiveFrom: "2026-09-10" });
  });
  it("اليوم الأول من الشهر ليس نافذة ترتيب", () => {
    expect(planTransfer("2026-10-01", "secretary", "").kind).toBe("denied");
  });
});

describe("circleOnSql", () => {
  it("معامل واحد (التاريخ) ويعتمد أول انتقال يسري بعده", () => {
    const sql = circleOnSql("s");
    expect(sql.match(/\?/g)).toHaveLength(1);
    expect(sql).toContain("t.effective_from > ?");
    expect(sql).toContain("ORDER BY t.effective_from ASC LIMIT 1");
    expect(sql).toContain("s.circle_id");
  });
});
