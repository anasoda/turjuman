import { describe, expect, it } from "vitest";
import { createPasswordRecord, timingSafeEqual, verifyPassword } from "../../worker/lib/crypto";

describe("كلمات المرور", () => {
  it("تُجزَّأ ولا تُخزَّن كما هي، ويتحقق منها بنجاح", async () => {
    const rec = await createPasswordRecord("Secret@2026");
    expect(rec.hash).not.toContain("Secret");
    expect(await verifyPassword("Secret@2026", rec)).toBe(true);
    expect(await verifyPassword("secret@2026", rec)).toBe(false);
  });

  it("لكل كلمة ملح مختلف حتى لو تطابقت الكلمات", async () => {
    const a = await createPasswordRecord("Same@2026pw");
    const b = await createPasswordRecord("Same@2026pw");
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });

  it("المقارنة الثابتة الزمن", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
  });
});
