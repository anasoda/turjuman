import { describe, expect, it } from "vitest";
import {
  buildImportRows,
  detectMapping,
  looksLikeHeader,
  norm,
  parseCsvText,
  parseSharedStrings,
  sheetXmlToRows,
  templateCsv,
  toDirection,
  toGender,
  toIsoDate,
  unescapeXml
} from "../../src/lib/sheet";

describe("قراءة CSV", () => {
  it("يعطي نموذجًا فارغًا للحقول الأساسية دون بيانات مثال أو خطة شهرية أو تاريخ انتساب", () => {
    const rows = parseCsvText(templateCsv());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("اسم ولي الأمر");
    expect(rows[0]).not.toContain("الخطة الشهرية (صفحات)");
    expect(rows[0]).not.toContain("تاريخ الانتساب");
  });

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
    const data = [["الاسم الرباعي", "تاريخ الميلاد", "اسم ولي الأمر", "رقم الاتصال"], ["محمد أحمد سعيد علي", "2012-05-04", "أحمد سعيد", "0599876543"]];
    const built = buildImportRows(data, detectMapping(data[0], true), { header: true, defaultDirection: "descending", defaultPlan: 10 });
    expect(built[0].student.guardianWaNational).toBe("0599876543");
    expect(built[0].problem).toBe("");
  });

  it("ولي الأمر إجباري: بلا اسم أو بلا رقم/هوية تُرفض الصف", () => {
    const noGuardian = [["الاسم الرباعي", "تاريخ الميلاد"], ["محمد أحمد سعيد علي", "2012-05-04"]];
    const a = buildImportRows(noGuardian, detectMapping(noGuardian[0], true), { header: true, defaultDirection: "descending", defaultPlan: 10 });
    expect(a[0].problem).toBe("اسم ولي الأمر مطلوب");
    const noPhone = [["الاسم الرباعي", "تاريخ الميلاد", "اسم ولي الأمر"], ["محمد أحمد سعيد علي", "2012-05-04", "أحمد سعيد"]];
    const b = buildImportRows(noPhone, detectMapping(noPhone[0], true), { header: true, defaultDirection: "descending", defaultPlan: 10 });
    expect(b[0].problem).toBe("رقم واتساب ولي الأمر (أو اتصاله) مطلوب، 7 خانات على الأقل");
  });

  it("تاريخ الميلاد إجباري كنموذج الإضافة", () => {
    const data = [["الاسم الرباعي", "اسم ولي الأمر", "رقم الاتصال"], ["محمد أحمد سعيد علي", "أحمد سعيد", "0599876543"]];
    const built = buildImportRows(data, detectMapping(data[0], true), { header: true, defaultDirection: "descending", defaultPlan: 10 });
    expect(built[0].problem).toBe("تاريخ الميلاد مفقود أو غير صالح");
  });

  it("مقدمة الواتساب من العمود إن وُجد", () => {
    const data = [["الاسم الرباعي", "اسم ولي الأمر", "مقدمة الواتساب", "رقم الواتساب"], ["محمد أحمد سعيد علي", "أحمد", "972", "0541234567"]];
    const built = buildImportRows(data, detectMapping(data[0], true), { header: true, defaultDirection: "descending", defaultPlan: 10 });
    expect(built[0].student).toMatchObject({ guardianWaCc: "972", guardianWaNational: "0541234567" });
  });

  it("المقدمة تُطبَّع (+972 و00972 ← 972) وغير 970/972 تُرفض قبل الرفع", () => {
    const rows = (cc: string) => [["الاسم الرباعي", "تاريخ الميلاد", "اسم ولي الأمر", "مقدمة الواتساب", "رقم الواتساب"], ["محمد أحمد سعيد علي", "2012-05-04", "أحمد سعيد", cc, "0541234567"]];
    const build = (cc: string) => buildImportRows(rows(cc), detectMapping(rows(cc)[0], true), { header: true, defaultDirection: "descending", defaultPlan: 10 })[0];
    expect(build("+972").student.guardianWaCc).toBe("972");
    expect(build("00972").student.guardianWaCc).toBe("972");
    expect(build("972").problem).toBe("");
    expect(build("962").problem).toBe("مقدمة الواتساب المسموحة 970 أو 972 فقط");
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

  it("يقرأ عناوين وتواريخ الكشف المرسل دون إضاعة رقم واتساب ولي الأمر", () => {
    const data = [
      ["الاسم   الرباعي", "رقم الهوية", "تاريخ الميلاد", "الجنس", "جوال الطالب", "اسم ولي الأمر", "جوال ولي الأمر (واتساب)", "اتجاه الحفظ", "آخر سورة", "آخر آية", "الخطة الشهرية (صفحات)", "دورة الأحكام", "تاريخ الانتساب"],
      ["محمد أحمد سعيد عبد   الله", "401234567", "14 05 2012", "ذكر", "591234567", "أحمد سعيد عبد الله", "599876543", "من الناس إلى الفاتحة", "الناس", "6", "10", "", "1 09 2026"]
    ];
    const built = buildImportRows(data, detectMapping(data[0], true), { header: true, defaultDirection: "descending", defaultPlan: 10, tempIds: false });
    expect(built[0].problem).toBe("");
    expect(built[0].student).toMatchObject({
      birth: "2012-05-14", joinedAt: "2026-09-01", phoneNational: "591234567",
      guardianWaNational: "599876543", guardianCallPhone: "599876543"
    });
  });

  it("يعرض نقص الهوية والجنس قبل رفع الكشف بحسب خيارات الاستيراد", () => {
    const data = [["الاسم الرباعي", "تاريخ الميلاد", "اسم ولي الأمر", "رقم الاتصال"], ["محمد أحمد سعيد علي", "2012-05-04", "أحمد سعيد", "0599876543"]];
    const mapping = detectMapping(data[0], true);
    const options = { header: true, defaultDirection: "descending" as const, defaultPlan: 10, requireGender: true };
    expect(buildImportRows(data, mapping, { ...options, tempIds: false })[0].problem).toContain("رقم الهوية");
    expect(buildImportRows(data, mapping, { ...options, tempIds: true })[0].problem).toContain("الجنس");
  });
});
