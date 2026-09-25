import { describe, expect, it } from "vitest";
import {
  buildImportRows,
  detectMapping,
  looksLikeHeader,
  norm,
  parseCsvText,
  parseSharedStrings,
  sheetXmlToRows,
  toDirection,
  toGender,
  toIsoDate,
  unescapeXml
} from "../../src/lib/sheet";

describe("قراءة CSV", () => {
  it("يقبل BOM والأقواس والفاصلة المنقوطة", () => {
    const rows = parseCsvText('﻿الاسم;رقم الهوية\n"محمد أحمد سعيد علي";401234567\n');
    expect(rows).toEqual([
      ["الاسم", "رقم الهوية"],
      ["محمد أحمد سعيد علي", "401234567"]
    ]);
  });

  it("يقبل التبويب ويتجاهل الأسطر الفارغة", () => {
    expect(parseCsvText("a\tb\n\n1\t2\n")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("يحترم الفاصلة داخل الأقواس والقوس المزدوج", () => {
    expect(parseCsvText('x,"a,b","ق""ال"')).toEqual([["x", "a,b", 'ق"ال']]);
  });
});

describe("قراءة ورقة xlsx", () => {
  const shared = parseSharedStrings(
    '<sst><si><t>الاسم</t></si><si><t>رقم </t><t>الهوية</t></si><si><t>محمد &amp; أحمد</t></si></sst>'
  );

  it("يقرأ النصوص المشتركة ويدمج المقاطع", () => {
    expect(shared).toEqual(["الاسم", "رقم الهوية", "محمد & أحمد"]);
  });

  it("يحترم مواضع الأعمدة الفارغة", () => {
    const xml =
      '<sheetData>' +
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>' +
      '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>401234567</v></c><c r="C2" t="inlineStr"><is><t>ذكر</t></is></c></row>' +
      '</sheetData>';
    expect(sheetXmlToRows(xml, shared)).toEqual([
      ["الاسم", "", "رقم الهوية"],
      ["محمد & أحمد", "401234567", "ذكر"]
    ]);
  });

  it("يفكّ ترميز XML", () => {
    expect(unescapeXml("a &lt;b&gt; &#65; &amp;")).toBe("a <b> A &");
  });
});

describe("تطبيع وتحويل القيم", () => {
  it("يوحّد الألف والياء والهاء ويحذف التشكيل", () => {
    expect(norm("إسم الطالِب")).toBe(norm("اسم الطالب"));
    expect(norm("ولي الأمر")).toBe(norm("ولي الامر"));
  });

  it("يتعرّف على الجنس والاتجاه بصيغ متعددة", () => {
    expect(toGender("ذكر")).toBe("male");
    expect(toGender("أنثى")).toBe("female");
    expect(toGender("إناث")).toBe("female");
    expect(toGender("غير معروف")).toBeUndefined();
    expect(toDirection("من الناس إلى الفاتحة")).toBe("descending");
    expect(toDirection("تصاعدي")).toBe("ascending");
  });

  it("يحوّل التواريخ بصيغها الشائعة وتاريخ Excel الرقمي", () => {
    expect(toIsoDate("2012-5-4")).toBe("2012-05-04");
    expect(toIsoDate("4/5/2012")).toBe("2012-05-04");
    expect(toIsoDate("٢٠١٢-٠٥-٠٤")).toBe("2012-05-04");
    expect(toIsoDate("45000")).toBe("2023-03-15");
    expect(toIsoDate("")).toBe("");
  });
});

describe("بناء صفوف الاستيراد", () => {
  const rows = [
    ["الاسم الرباعي", "رقم الهوية", "تاريخ الميلاد", "الجنس", "اسم ولي الأمر", "صلة القرابة", "رقم الاتصال", "رقم الواتساب", "آخر سورة", "آخر آية"],
    ["محمد أحمد سعيد علي", "401234567", "2012-05-04", "ذكر", "أحمد سعيد علي", "أب", "٠٥٩٩٨٧٦٥٤٣", "٠٥٩٩٨٧٦٥٤٤", "الناس", "6"],
    ["ن", "", "", "", "", "", "", "", "", ""]
  ];

  it("يتعرّف على صف العناوين ويربط أعمدة الولي (اتصال وواتساب منفصلان)", () => {
    expect(looksLikeHeader(rows[0])).toBe(true);
    expect(detectMapping(rows[0], true)).toEqual([
      "name", "nationalId", "birth", "gender", "guardianName", "guardianRelation", "guardianCallPhone", "guardianWaNational", "lastSurah", "lastAyah"
    ]);
  });

  it("يبني الطلاب ويحوّل السورة بالاسم والأرقام العربية", () => {
    const built = buildImportRows(rows, detectMapping(rows[0], true), { header: true, defaultDirection: "descending", defaultPlan: 10 });
    expect(built).toHaveLength(2);
    expect(built[0].line).toBe(2);
    expect(built[0].problem).toBe("");
    expect(built[0].student).toMatchObject({
      name: "محمد أحمد سعيد علي", nationalId: "401234567", birth: "2012-05-04", gender: "male",
      guardianName: "أحمد سعيد علي", guardianRelation: "father",
      guardianCallPhone: "0599876543", guardianWaNational: "0599876544", guardianWaCc: "970",
      lastSurah: 114, lastAyah: 6, direction: "descending", monthlyPlanPages: 10
    });
    expect(built[1].problem).not.toBe("");
  });

  it("إن غاب عمود الواتساب يُعتمد رقم الاتصال", () => {
    const data = [["الاسم الرباعي", "اسم ولي الأمر", "رقم الاتصال"], ["محمد أحمد سعيد علي", "أحمد سعيد", "0599876543"]];
    const built = buildImportRows(data, detectMapping(data[0], true), { header: true, defaultDirection: "descending", defaultPlan: 10 });
    expect(built[0].student.guardianWaNational).toBe("0599876543");
    expect(built[0].problem).toBe("");
  });

  it("ولي الأمر إجباري: بلا اسم أو بلا رقم/هوية تُرفض الصف", () => {
    const noGuardian = [["الاسم الرباعي"], ["محمد أحمد سعيد علي"]];
    const a = buildImportRows(noGuardian, detectMapping(noGuardian[0], true), { header: true, defaultDirection: "descending", defaultPlan: 10 });
    expect(a[0].problem).toBe("اسم ولي الأمر مطلوب");
    const noPhone = [["الاسم الرباعي", "اسم ولي الأمر"], ["محمد أحمد سعيد علي", "أحمد سعيد"]];
    const b = buildImportRows(noPhone, detectMapping(noPhone[0], true), { header: true, defaultDirection: "descending", defaultPlan: 10 });
    expect(b[0].problem).toBe("رقم واتساب ولي الأمر أو هويته مطلوب");
  });

  it("مقدمة الواتساب من العمود إن وُجد", () => {
    const data = [["الاسم الرباعي", "اسم ولي الأمر", "مقدمة الواتساب", "رقم الواتساب"], ["محمد أحمد سعيد علي", "أحمد", "962", "0791234567"]];
    const built = buildImportRows(data, detectMapping(data[0], true), { header: true, defaultDirection: "descending", defaultPlan: 10 });
    expect(built[0].student).toMatchObject({ guardianWaCc: "962", guardianWaNational: "0791234567" });
  });

  it("بلا عناوين يستعمل الترتيب الافتراضي", () => {
    const data = [["محمد أحمد سعيد علي", "401234567"]];
    const mapping = detectMapping(data[0], false);
    expect(mapping.slice(0, 2)).toEqual(["name", "nationalId"]);
    const built = buildImportRows(data, mapping, { header: false, defaultDirection: "ascending", defaultPlan: 5 });
    expect(built[0].line).toBe(1);
    expect(built[0].student.direction).toBe("ascending");
    expect(built[0].student.monthlyPlanPages).toBe(5);
  });
});
