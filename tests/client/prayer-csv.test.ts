import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parsePrayerText, type PrayerDay } from "../../shared/prayer";

const day = (date: string): PrayerDay => ({ date, fajr: "04:41", sunrise: "06:02", dhuhr: "11:41", asr: "15:04", maghrib: "17:19", isha: "18:40" });

describe("استيراد مواعيد الصلاة من ملف CSV", () => {
  it("يقبل BOM وأقواس الاقتباس وفواصل الأسطر CRLF (كما يصدّره Excel)", () => {
    const csv = "﻿\"date\",\"fajr\",\"sunrise\",\"dhuhr\",\"asr\",\"maghrib\",\"isha\"\r\n\"2026-10-01\",\"04:41\",\"06:02\",\"11:41\",\"15:04\",\"17:19\",\"18:40\"\r\n";
    const { rows, errors } = parsePrayerText(csv, 2026, { twelveHour: false });
    expect(errors).toEqual([]);
    expect(rows).toEqual([day("2026-10-01")]);
  });

  it("كشف المركز المصحَّح (الفجر = الأذان الثاني، §15.1): 30 يوماً بلا أخطاء وأوقات متصاعدة", () => {
    const text = readFileSync("docs/prayer-times-corrected.csv", "utf8");
    const { rows, errors } = parsePrayerText(text, 2026, { twelveHour: false });
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(30);
    expect(rows[0]).toMatchObject({ date: "2026-09-13", fajr: "04:56", isha: "20:10" });
    expect(rows[29]).toMatchObject({ date: "2026-10-12", fajr: "05:15", isha: "19:33" });
    for (const r of rows) {
      const t = [r.fajr, r.sunrise, r.dhuhr, r.asr, r.maghrib, r.isha];
      expect(t.every((x, i) => i === 0 || x > t[i - 1])).toBe(true);
    }
  });

  it("الوضع الافتراضي (12 ساعة) لا يفسد ملفاً بصيغة 24 ساعة", () => {
    const text = readFileSync("docs/prayer-times-corrected.csv", "utf8");
    expect(parsePrayerText(text, 2026).rows).toEqual(parsePrayerText(text, 2026, { twelveHour: false }).rows);
  });
});
