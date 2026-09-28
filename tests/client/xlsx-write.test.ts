import { describe, expect, it } from "vitest";
import { detectMapping, readSheet, templateHeaders, unzip } from "../../src/lib/sheet";
import { buildXlsx, crc32 } from "../../src/lib/xlsx-write";

const fileOf = (bytes: Uint8Array) => new File([bytes as BlobPart], "out.xlsx");

describe("كاتب xlsx", () => {
  it("ينشئ نموذج الطلاب الفارغ بحقوله الشخصية وحقول ولي الأمر القابلة للاستيراد", async () => {
    const rows = await readSheet(fileOf(buildXlsx(templateHeaders(), [], "الطلاب")));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(templateHeaders());
    expect(detectMapping(rows[0], true)).not.toContain("");
    expect(rows[0]).toContain("رقم الاتصال (ولي الأمر)");
    expect(rows[0]).toContain("رقم الواتساب (ولي الأمر)");
    expect(rows[0]).not.toContain("الخطة الشهرية (صفحات)");
  });

  it("crc32 معروف", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("يكتب ما يقرؤه قارئ الملفات نفسه (عربي وأرقام وخلايا فارغة)", async () => {
    const bytes = buildXlsx(["الطالب", "الصفحات", "ملاحظة"], [["محمد أحمد", 12, ""], ["سارة & خالد <ب>", 0, "ok"]]);
    const rows = await readSheet(fileOf(bytes));
    expect(rows[0]).toEqual(["الطالب", "الصفحات", "ملاحظة"]);
    expect(rows[1].slice(0, 2)).toEqual(["محمد أحمد", "12"]);
    expect(rows[2]).toEqual(["سارة & خالد <ب>", "0", "ok"]);
  });

  it("الأرشيف يحوي الأجزاء الأساسية والورقة من اليمين لليسار", async () => {
    const files = await unzip(buildXlsx(["أ"], [["ب"]]).buffer as ArrayBuffer);
    expect([...files.keys()].sort()).toEqual(["[Content_Types].xml", "_rels/.rels", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml"]);
    expect(new TextDecoder().decode(files.get("xl/worksheets/sheet1.xml")!)).toContain('rightToLeft="1"');
  });

  it("يهرّب المحارف الخاصة ويحذف محارف التحكم", async () => {
    const rows = await readSheet(fileOf(buildXlsx(["س"], [["a\u0001b\"c"]])));
    expect(rows[1][0]).toBe('ab"c');
  });
});
