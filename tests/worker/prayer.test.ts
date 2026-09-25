import { describe, expect, it } from "vitest";
import { formatCountdown, nextPrayer, parsePrayerText, to24, type PrayerDay } from "../../shared/prayer";

const day = (date: string): PrayerDay => ({ date, fajr: "04:41", sunrise: "06:02", dhuhr: "11:41", asr: "15:04", maghrib: "17:19", isha: "18:40" });

describe("مواعيد الصلاة", () => {
  it("تحويل نظام 12 ساعة بلا ص/م إلى 24", () => {
    expect(to24("fajr", 4, 41)).toBe("04:41");
    expect(to24("dhuhr", 11, 41)).toBe("11:41");
    expect(to24("dhuhr", 1, 5)).toBe("13:05");
    expect(to24("asr", 3, 4)).toBe("15:04");
    expect(to24("maghrib", 5, 19)).toBe("17:19");
    expect(to24("isha", 6, 40)).toBe("18:40");
    expect(to24("isha", 7, 5)).toBe("19:05");
  });

  it("استيراد نص منسوخ بأشكال مختلفة", () => {
    const csv = ["التاريخ,الفجر,الشروق,الظهر,العصر,المغرب,العشاء", "2026-10-01,4:41,6:02,11:41,3:04,5:19,6:40", "02/10/2026\t4:42\t6:03\t11:40\t3:03\t5:17\t6:38", "٠٣/١٠\t٤:٤٣\t٦:٠٤\t١١:٤٠\t٣:٠٢\t٥:١٦\t٦:٣٧"].join("\n");
    const { rows, errors } = parsePrayerText(csv, 2026);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual(day("2026-10-01"));
    expect(rows[1].date).toBe("2026-10-02");
    expect(rows[2]).toMatchObject({ date: "2026-10-03", fajr: "04:43", asr: "15:02", isha: "18:37" });
  });

  it("يبلّغ عن الأخطاء ويتجاهل العنوان", () => {
    const { rows, errors } = parsePrayerText("date,a,b\n2026-10-01,4:41,6:02,11:41,3:04,5:19\n2026-10-02,4:41,6:02,11:41,3:04,5:19,99:99", 2026);
    expect(rows).toHaveLength(0);
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });

  it("24 ساعة صريحة عند تعطيل التحويل", () => {
    const { rows } = parsePrayerText("2026-10-01,04:41,06:02,11:41,15:04,17:19,18:40", 2026, { twelveHour: false });
    expect(rows[0]).toEqual(day("2026-10-01"));
  });

  it("الصلاة القادمة", () => {
    const days = [day("2026-10-01"), day("2026-10-02")];
    expect(nextPrayer(days, "2026-10-01", "04:00")).toMatchObject({ key: "fajr", minutesLeft: 41 });
    expect(nextPrayer(days, "2026-10-01", "12:00")).toMatchObject({ key: "asr", time: "15:04", minutesLeft: 184 });
    expect(nextPrayer(days, "2026-10-01", "19:00")).toMatchObject({ key: "fajr", date: "2026-10-02", minutesLeft: 9 * 60 + 41 });
    expect(nextPrayer(days, "2026-10-02", "23:00")).toBeNull();
    expect(nextPrayer([], "2026-10-01", "10:00")).toBeNull();
  });

  it("صيغة العدّ التنازلي", () => {
    expect(formatCountdown(41)).toBe("41 دقيقة");
    expect(formatCountdown(120)).toBe("2 ساعة");
    expect(formatCountdown(125)).toBe("2 ساعة و5 دقيقة");
  });
});
