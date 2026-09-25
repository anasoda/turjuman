// يقرأ ملف xlsx حقيقياً (مولَّد بـ scripts/make-xlsx-fixture.mjs) للتأكد من فكّ الـ zip وقراءة الورقة.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildImportRows, detectMapping, looksLikeHeader, readSheet, unzip } from "../../src/lib/sheet";

const bytes = readFileSync(new URL("../fixtures/students-sample.xlsx", import.meta.url));
const file = () => new File([new Uint8Array(bytes)], "students-sample.xlsx");

describe("قراءة ملف xlsx حقيقي", () => {
  it("يفكّ الأرشيف المضغوط والمخزَّن", async () => {
    const files = await unzip(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    expect([...files.keys()]).toContain("xl/worksheets/sheet1.xml");
    expect(new TextDecoder().decode(files.get("xl/sharedStrings.xml")!)).toContain("الاسم الرباعي");
  });

  it("يعيد صفوف الورقة بالنصوص المشتركة", async () => {
    const rows = await readSheet(file());
    expect(rows[0]).toEqual(["الاسم الرباعي", "رقم الهوية", "تاريخ الميلاد", "الجنس", "جوال ولي الأمر"]);
    expect(rows[1]).toEqual(["محمد أحمد سعيد علي", "401234567", "45000", "ذكر", "599876543"]);
    // الصف الثالث ينقصه عمودان (C فارغ وE غير موجود)
    expect(rows[2][0]).toBe("سارة خالد محمود حسن");
    expect(rows[2][2]).toBe("");
    expect(rows[2][3]).toBe("أنثى");
  });

  it("يبني طلاباً جاهزين للاستيراد بتحويل تاريخ Excel الرقمي", async () => {
    const rows = await readSheet(file());
    expect(looksLikeHeader(rows[0])).toBe(true);
    const built = buildImportRows(rows, detectMapping(rows[0], true), { header: true, defaultDirection: "descending", defaultPlan: 10 });
    expect(built).toHaveLength(2);
    expect(built[0].student).toMatchObject({ name: "محمد أحمد سعيد علي", nationalId: "401234567", birth: "2023-03-15", gender: "male", guardianCallPhone: "599876543", guardianWaNational: "599876543" });
    expect(built[1].student).toMatchObject({ name: "سارة خالد محمود حسن", nationalId: "407654321", gender: "female", birth: "" });
    // الـ fixture القديم بلا اسم ولي أمر: صار مشكلة إجبارية (§15.7)
    expect(built[0].problem).toBe("اسم ولي الأمر مطلوب");
    expect(built[1].problem).toBe("تاريخ الميلاد مفقود أو غير صالح");
  });
});
