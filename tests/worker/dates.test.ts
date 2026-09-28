import { describe, expect, it } from "vitest";
import { nextWeekdayDate, weekdayNameAr } from "../../worker/lib/dates";

describe("weekdayNameAr", () => {
  it("names Sunday 2026-10-04 correctly", () => {
    expect(weekdayNameAr("2026-10-04")).toBe("الأحد");
  });
  it("names Saturday 2026-10-03 correctly", () => {
    expect(weekdayNameAr("2026-10-03")).toBe("السبت");
  });
});

describe("nextWeekdayDate", () => {
  it("finds the next occurrence of a single weekday", () => {
    // 2026-10-01 هو خميس؛ أقرب أحد (0) بعده هو 2026-10-04
    expect(nextWeekdayDate("2026-10-01", [0])).toBe("2026-10-04");
  });
  it("picks the closest of several weekdays", () => {
    // بعد الخميس 2026-10-01: السبت (6) أقرب من الأحد (0)
    expect(nextWeekdayDate("2026-10-01", [0, 6])).toBe("2026-10-03");
  });
  it("never returns the same day, always strictly after", () => {
    // اليوم نفسه خميس (4)؛ يجب إرجاع الخميس التالي لا نفس اليوم
    expect(nextWeekdayDate("2026-10-01", [4])).toBe("2026-10-08");
  });
  it("returns null when no weekdays are scheduled", () => {
    expect(nextWeekdayDate("2026-10-01", [])).toBeNull();
  });
});
