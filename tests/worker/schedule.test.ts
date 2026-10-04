import { describe, expect, it } from "vitest";
import { scheduleSchema } from "../../worker/routes/extras";

describe("circle schedule validation", () => {
  it("accepts prayer appointments without times and clears hidden old times", () => {
    const result = scheduleSchema.parse({ entries: [
      { weekday: 0, slot: "maghrib", start: "", end: "", place: "المسجد" },
      { weekday: 2, slot: "maghrib", start: "16:00", end: "18:00", place: "" }
    ] });
    expect(result.entries).toEqual([
      { weekday: 0, slot: "maghrib", start: "", end: "", place: "المسجد" },
      { weekday: 2, slot: "maghrib", start: "", end: "", place: "" }
    ]);
  });

  it("requires valid, ordered times for hourly appointments", () => {
    const entry = { weekday: 1, slot: "", place: "" };
    expect(scheduleSchema.safeParse({ entries: [{ ...entry, start: "", end: "18:00" }] }).success).toBe(false);
    expect(scheduleSchema.safeParse({ entries: [{ ...entry, start: "18:00", end: "16:00" }] }).success).toBe(false);
    expect(scheduleSchema.safeParse({ entries: [{ ...entry, start: "16:00", end: "18:00" }] }).success).toBe(true);
  });
});
