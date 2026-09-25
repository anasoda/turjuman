import { describe, expect, it } from "vitest";
import { intlFromParts, intlPhone, isPhoneish, localPhone, phoneDigits, telHref, telHrefParts, waHref, waHrefParts } from "../../shared/phone";

describe("أرقام الجوال ومقدمة الدولة", () => {
  it("يحوّل الأرقام العربية ويحذف الرموز", () => {
    expect(phoneDigits("٠٥٩-١٢٣ ٤٥٦٧")).toBe("0591234567");
    expect(phoneDigits("+970 59 123 4567")).toBe("970591234567");
  });

  it("يبني الصيغة الدولية من الرقم المحلي", () => {
    expect(intlPhone("0591234567", "970")).toBe("970591234567");
    expect(intlPhone("00970591234567", "970")).toBe("970591234567");
    expect(intlPhone("970591234567", "970")).toBe("970591234567");
    expect(intlPhone("591234567", "970")).toBe("970591234567");
    expect(intlPhone("0501234567", "962")).toBe("962501234567");
  });

  it("يرفض الأرقام القصيرة", () => {
    expect(intlPhone("12345", "970")).toBe("");
    expect(intlPhone("", "970")).toBe("");
    expect(telHref("123", "970")).toBe("");
    expect(waHref("", "970")).toBe("");
  });

  it("يعيد الصيغة المحلية للعرض", () => {
    expect(localPhone("970591234567", "970")).toBe("0591234567");
    expect(localPhone("00970591234567", "970")).toBe("0591234567");
    expect(localPhone("0591234567", "970")).toBe("0591234567");
  });

  it("يبني روابط الاتصال والواتساب", () => {
    expect(telHref("0591234567", "970")).toBe("tel:+970591234567");
    expect(waHref("0591234567", "970")).toBe("https://wa.me/970591234567");
    expect(waHref("0591234567", "970", "سلام")).toBe("https://wa.me/970591234567?text=%D8%B3%D9%84%D8%A7%D9%85");
  });

  it("التحقق من الإدخال: الفراغ مقبول (اختياري)", () => {
    expect(isPhoneish("")).toBe(true);
    expect(isPhoneish("0591234567")).toBe(true);
    expect(isPhoneish("12")).toBe(false);
  });

  it("intlFromParts يدمج مقدمة الدولة والوطني", () => {
    expect(intlFromParts("970", "0591234567")).toBe("970591234567");
    expect(intlFromParts("+970", "591234567")).toBe("970591234567");
    expect(intlFromParts("970", "")).toBe("");
    expect(intlFromParts("970", "12")).toBe("");
    expect(telHrefParts("970", "0591234567")).toBe("tel:+970591234567");
    expect(waHrefParts("970", "0591234567", "سلام")).toBe("https://wa.me/970591234567?text=%D8%B3%D9%84%D8%A7%D9%85");
    expect(waHrefParts("970", "")).toBe("");
  });
});
