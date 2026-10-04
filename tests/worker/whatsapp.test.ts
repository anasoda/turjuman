import { describe, expect, it } from "vitest";
import { waHrefParts } from "../../shared/phone";
import { fillTemplate, WA_TEMPLATES, type TemplateVars } from "../../shared/whatsapp";

const V: TemplateVars = { student: "عمر علي بركات", guardian: "علي بركات", center: "مركز أبي بن كعب", circle: "حلقة الفجر", date: "4 أكتوبر", memorized: 3, plan: 20, position: "سورة النبأ — آية 12" };
const tpl = (key: string) => WA_TEMPLATES.find((t) => t.key === key)!.body;

describe("قوالب واتساب", () => {
  it("أربعة قوالب بمفاتيح فريدة: طلب تواصل وغياب وإشادة وملخص", () => {
    expect(WA_TEMPLATES.map((t) => t.key)).toEqual(["contact", "absence", "praise", "summary"]);
    expect(new Set(WA_TEMPLATES.map((t) => t.label)).size).toBe(4);
  });

  it("كل قالب يُملأ بلا متغيّرات متروكة", () => {
    for (const t of WA_TEMPLATES) {
      const text = fillTemplate(t.body, V);
      expect(text, t.key).not.toMatch(/\{\w+\}/);
      expect(text, t.key).toContain(V.student);
      expect(text, t.key).toContain(V.guardian);
      expect(text, t.key).toContain(V.center);
    }
  });

  it("الغياب يذكر الحلقة والتاريخ، والملخص يحمل الأرقام", () => {
    expect(fillTemplate(tpl("absence"), V)).toContain("غياب الطالب عمر علي بركات في حلقة الفجر اليوم 4 أكتوبر");
    const s = fillTemplate(tpl("summary"), V);
    expect(s).toContain("الأجزاء المحفوظة: 3 من 30");
    expect(s).toContain("آخر موضع حفظ: سورة النبأ — آية 12");
    expect(s).toContain("خطة هذا الشهر: 20 صفحة");
  });

  it("المتغيّر الاختياري الغائب يحذف سطره، والحلقة الغائبة تختفي من الجملة", () => {
    const text = fillTemplate(tpl("summary"), { ...V, circle: null, memorized: null, plan: undefined, position: "" });
    expect(text).not.toContain("الأجزاء المحفوظة");
    expect(text).not.toContain("آخر موضع");
    expect(text).not.toContain("خطة هذا الشهر");
    expect(text).toContain("ملخص متابعة الطالب عمر علي بركات حتى 4 أكتوبر:");
    expect(text).not.toContain("في حلقة");
    expect(fillTemplate(tpl("contact"), { ...V, circle: null })).toContain("بخصوص الطالب عمر علي بركات.");
  });

  it("اسم الحلقة بلا كلمة «حلقة» تُضاف قبله", () => {
    expect(fillTemplate("{student}{circle_in}", { ...V, circle: "حمزة بن عبد المطلب" })).toBe("عمر علي بركات في حلقة حمزة بن عبد المطلب");
  });

  it("الصفر قيمة صالحة (0 جزء) لا غائبة، وما ليس متغيّراً معروفاً يبقى", () => {
    expect(fillTemplate("المحفوظ {memorized} و{غريب} و{other}", { ...V, memorized: 0 })).toBe("المحفوظ 0 و{غريب} و{other}");
  });

  it("النص المحرَّر يصل إلى رابط wa.me مرمَّزاً بالرقم الدولي", () => {
    const text = fillTemplate(tpl("absence"), V) + "\nملاحظة إضافية & رمز";
    const href = waHrefParts("970", "0591234567", text);
    expect(href.startsWith("https://wa.me/970591234567?text=")).toBe(true);
    expect(decodeURIComponent(href.split("?text=")[1])).toBe(text);
  });
});
