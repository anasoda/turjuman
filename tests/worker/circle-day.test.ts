import { describe, expect, it } from "vitest";
import { circleDayStatus, needsReminder } from "../../shared/circle-day";

const base = { cancelled: false, scheduledDay: true as boolean | null, students: 10, recorded: 0 };

describe("حالة الحلقة في اليوم", () => {
  it("حصة ملغاة تغلب كل شيء", () => {
    expect(circleDayStatus({ ...base, cancelled: true, recorded: 5 })).toBe("cancelled");
  });

  it("يوم خارج الجدول بلا تسجيل ليس تقصيراً، ومع تسجيل يُعدّ عادياً", () => {
    expect(circleDayStatus({ ...base, scheduledDay: false })).toBe("off");
    expect(circleDayStatus({ ...base, scheduledDay: false, recorded: 3 })).toBe("partial");
  });

  it("حلقة بلا جدول مضبوط تُعامل كيوم حصة", () => {
    expect(circleDayStatus({ ...base, scheduledDay: null })).toBe("none");
  });

  it("لا تسجيل / جزئي / مكتمل", () => {
    expect(circleDayStatus(base)).toBe("none");
    expect(circleDayStatus({ ...base, recorded: 4 })).toBe("partial");
    expect(circleDayStatus({ ...base, recorded: 10 })).toBe("complete");
  });

  it("حلقة بلا طلاب لا تُنبَّه", () => {
    expect(circleDayStatus({ ...base, students: 0 })).toBe("empty");
  });

  it("التنبيه للحالتين الناقصتين فقط", () => {
    expect((["none", "partial"] as const).every(needsReminder)).toBe(true);
    expect((["complete", "empty", "off", "cancelled"] as const).some(needsReminder)).toBe(false);
  });
});
