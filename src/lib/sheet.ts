// قراءة ملف Excel (xlsx) أو CSV في المتصفح بلا مكتبات خارجية، وتحويله إلى صفوف طلاب للاستيراد.
// xlsx = ملف zip؛ نفكّه بـ DecompressionStream ونقرأ الورقة الأولى + النصوص المشتركة بتحليل نصي بسيط.

import { AJKAM_COURSES, type Direction, type Gender } from "@shared/constants";
import { SURAHS } from "@shared/quran-data";
import { latinDigits } from "@shared/phone";

/* ------------------------------ أدوات نصية ------------------------------ */

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
export const unescapeXml = (s: string): string =>
  s.replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g, (m, g: string) => {
    if (g.startsWith("#x") || g.startsWith("#X")) return String.fromCodePoint(parseInt(g.slice(2), 16));
    if (g.startsWith("#")) return String.fromCodePoint(parseInt(g.slice(1), 10));
    return XML_ENTITIES[g] ?? m;
  });

/** تطبيع عربي للمقارنة: بلا تشكيل ولا تطويل، ألف وياء وهاء موحّدة، بلا فراغات ورموز. */
export const norm = (s: string): string =>
  latinDigits(String(s ?? ""))
    .replace(/[ً-ْـ‌-‏]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/[ىئ]/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .toLowerCase();

/* ------------------------------ CSV ------------------------------ */

/** يحلّل نص CSV/TSV (يقبل BOM وأقواس الاقتباس والفاصلة أو الفاصلة المنقوطة أو التبويب). */
export function parseCsvText(text: string): string[][] {
  const clean = text.replace(/^﻿/, "");
  const first = clean.split(/\r?\n/)[0] ?? "";
  const sep = first.includes("\t") ? "\t" : (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"') {
        if (clean[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === sep) { row.push(cell); cell = ""; continue; }
    if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; continue; }
    if (ch === "\r") continue;
    cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((v) => v.trim())).filter((r) => r.some((v) => v !== ""));
}

/* ------------------------------ xlsx ------------------------------ */

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 0x1000000;

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** يفكّ أرشيف zip إلى خريطة (مسار الملف ← بايتاته). يقرأ الفهرس المركزي فقط. */
export async function unzip(buffer: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const b = new Uint8Array(buffer);
  let eocd = -1;
  for (let i = b.length - 22; i >= 0 && i > b.length - 66000; i--) {
    if (u32(b, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("الملف ليس ملف Excel صالحاً (xlsx)");
  const count = u16(b, eocd + 10);
  let p = u32(b, eocd + 16);
  const out = new Map<string, Uint8Array>();
  const dec = new TextDecoder();
  for (let n = 0; n < count && p + 46 <= b.length; n++) {
    if (u32(b, p) !== 0x02014b50) break;
    const method = u16(b, p + 10);
    const compSize = u32(b, p + 20);
    const nameLen = u16(b, p + 28);
    const extraLen = u16(b, p + 30);
    const commentLen = u16(b, p + 32);
    const lho = u32(b, p + 42);
    const name = dec.decode(b.subarray(p + 46, p + 46 + nameLen));
    const dataStart = lho + 30 + u16(b, lho + 26) + u16(b, lho + 28);
    const raw = b.subarray(dataStart, dataStart + compSize);
    out.set(name, method === 0 ? raw : await inflateRaw(raw));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** النصوص المشتركة (sharedStrings.xml) بالترتيب. */
export function parseSharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g)].map((m) =>
    m[1] ? [...m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => unescapeXml(t[1])).join("") : ""
  );
}

const colIndex = (ref: string): number => {
  const letters = ref.replace(/[^A-Za-z]/g, "").toUpperCase();
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return Math.max(0, n - 1);
};

/** ورقة xlsx → صفوف نصية (يحترم مواضع الأعمدة الفارغة). */
export function sheetXmlToRows(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  for (const rm of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g)) {
    const inner = rm[1] ?? "";
    const row: string[] = [];
    for (const cm of inner.matchAll(/<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1] ?? "";
      const body = cm[2] ?? "";
      const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1] ?? "";
      const type = /t="([^"]+)"/.exec(attrs)?.[1] ?? "";
      let value = "";
      if (type === "inlineStr") value = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => unescapeXml(t[1])).join("");
      else {
        const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "";
        value = type === "s" ? shared[Number(v)] ?? "" : unescapeXml(v);
      }
      const at = ref ? colIndex(ref) : row.length;
      while (row.length < at) row.push("");
      row[at] = value.trim();
    }
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v !== ""));
}

/** يقرأ ملفاً يختاره المستخدم: xlsx أو csv/txt. */
export async function readSheet(file: File): Promise<string[][]> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv") || name.endsWith(".txt") || file.type === "text/csv") return parseCsvText(await file.text());
  if (name.endsWith(".xls")) throw new Error("صيغة xls القديمة غير مدعومة — احفظ الملف بصيغة xlsx أو CSV");
  const files = await unzip(await file.arrayBuffer());
  const sharedXml = files.get("xl/sharedStrings.xml");
  const shared = sharedXml ? parseSharedStrings(new TextDecoder().decode(sharedXml)) : [];
  // أول ورقة بحسب ترتيب workbook.xml إن أمكن، وإلا sheet1.xml
  const sheetKey = [...files.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort()[0];
  if (!sheetKey) throw new Error("لم نجد ورقة بيانات في الملف");
  return sheetXmlToRows(new TextDecoder().decode(files.get(sheetKey)!), shared);
}

/* ------------------------------ تحويل الصفوف إلى طلاب ------------------------------ */

export type FieldKey =
  | "name" | "nationalId" | "birth" | "gender"
  | "phoneCc" | "phoneNational"
  | "guardianName" | "guardianRelation" | "guardianCallPhone" | "guardianWaCc" | "guardianWaNational" | "guardianNationalId"
  | "direction" | "lastSurah" | "lastAyah" | "monthlyPlanPages" | "ajkamCourse" | "joinedAt";

export const FIELDS: Array<{ key: FieldKey; label: string; aliases: string[] }> = [
  { key: "name", label: "الاسم الرباعي", aliases: ["الاسم", "اسم الطالب", "الاسم الرباعي", "الاسم الكامل", "name", "student"] },
  { key: "nationalId", label: "رقم الهوية", aliases: ["رقم الهوية", "الهوية", "هوية", "رقم الهويه", "id", "nationalid"] },
  { key: "birth", label: "تاريخ الميلاد", aliases: ["تاريخ الميلاد", "الميلاد", "birth", "dob", "العمر"] },
  { key: "gender", label: "الجنس", aliases: ["الجنس", "النوع", "gender", "sex"] },
  { key: "phoneCc", label: "مقدمة جوال الطالب", aliases: ["مقدمه جوال الطالب", "مقدمه الطالب", "cc طالب", "country"] },
  { key: "phoneNational", label: "جوال الطالب", aliases: ["الجوال", "جوال الطالب", "رقم الجوال", "الهاتف", "موبايل", "phone", "mobile"] },
  { key: "guardianName", label: "اسم ولي الأمر", aliases: ["ولي الامر", "اسم ولي الامر", "اسم الاب", "الاب", "اسم الام", "الام", "guardian", "parent"] },
  { key: "guardianRelation", label: "صلة القرابة", aliases: ["صله القرابه", "الصله", "صفه ولي الامر", "القرابه", "relation"] },
  { key: "guardianCallPhone", label: "رقم الاتصال (ولي الأمر)", aliases: ["رقم الاتصال", "جوال الاتصال", "جوال ولي الامر", "هاتف ولي الامر", "رقم ولي الامر", "جوال الاب", "جوال الام", "جوال الاهل"] },
  { key: "guardianWaCc", label: "مقدمة الواتساب", aliases: ["مقدمه الواتس", "مقدمه الواتساب", "مقدمه", "cc", "الدوله", "country"] },
  { key: "guardianWaNational", label: "رقم الواتساب (ولي الأمر)", aliases: ["رقم الواتس", "رقم الواتساب", "واتساب", "الواتس", "whatsapp", "جوال الواتس"] },
  { key: "guardianNationalId", label: "رقم هوية ولي الأمر", aliases: ["هوية ولي الامر", "رقم هويه ولي الامر", "رقم هويه الاب", "رقم هويه الام", "guardianid"] },
  { key: "direction", label: "اتجاه الحفظ", aliases: ["اتجاه الحفظ", "الاتجاه", "direction"] },
  { key: "lastSurah", label: "آخر سورة", aliases: ["اخر سوره", "السوره", "سوره", "surah"] },
  { key: "lastAyah", label: "آخر آية", aliases: ["اخر ايه", "الايه", "ايه", "ayah"] },
  { key: "monthlyPlanPages", label: "الخطة الشهرية (صفحات)", aliases: ["الخطه الشهريه", "الخطه", "خطه", "plan"] },
  { key: "ajkamCourse", label: "دورة الأحكام", aliases: ["دوره الاحكام", "الاحكام", "دوره"] },
  { key: "joinedAt", label: "تاريخ الانتساب", aliases: ["تاريخ الانتساب", "الانتساب", "تاريخ التسجيل", "joined"] }
];

/** الترتيب المفترض عند عدم وجود صف عناوين. */
const DEFAULT_ORDER: FieldKey[] = ["name", "nationalId", "birth", "gender", "phoneNational", "guardianName", "guardianRelation", "guardianCallPhone", "guardianWaCc", "guardianWaNational", "guardianNationalId", "direction", "lastSurah", "lastAyah", "monthlyPlanPages"];

const ALIAS_INDEX = new Map<string, FieldKey>();
for (const f of FIELDS) {
  ALIAS_INDEX.set(norm(f.label), f.key);
  for (const a of f.aliases) ALIAS_INDEX.set(norm(a), f.key);
}

/** هل هذا الصف صف عناوين؟ (يتعرّف على «الاسم» على الأقل) */
export function looksLikeHeader(row: string[]): boolean {
  return row.some((cell) => ALIAS_INDEX.get(norm(cell)) === "name");
}

/** ربط أعمدة الملف بحقول الطالب (يُرجع مفتاح كل عمود أو "" إن لم يُتعرَّف عليه). */
export function detectMapping(row: string[], header: boolean): Array<FieldKey | ""> {
  if (!header) return row.map((_, i) => DEFAULT_ORDER[i] ?? "");
  const used = new Set<FieldKey>();
  return row.map((cell) => {
    const key = ALIAS_INDEX.get(norm(cell));
    if (!key || used.has(key)) return "";
    used.add(key);
    return key;
  });
}

const SURAH_INDEX = new Map<string, number>(SURAHS.map((s, i) => [norm(s[0]), i + 1]));

const num = (v: string): number | undefined => {
  const d = latinDigits(v).replace(/[^\d.-]/g, "");
  if (!d) return undefined;
  const n = Number(d);
  return Number.isFinite(n) ? n : undefined;
};

/** تاريخ Excel الرقمي (أصله 1899-12-30) أو نص بصيغ شائعة → YYYY-MM-DD */
export function toIsoDate(raw: string): string {
  const v = latinDigits(String(raw ?? "")).trim();
  if (!v) return "";
  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(v);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const dmy = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(v);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  const serial = Number(v);
  if (Number.isFinite(serial) && serial > 0 && serial < 80000) {
    const ms = Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000;
    return new Date(ms).toISOString().slice(0, 10);
  }
  return v;
}

export const toGender = (raw: string): Gender | undefined => {
  const v = norm(raw);
  if (!v) return undefined;
  if (/^(ذكر|ذكور|م|male|m|1|بنين|ولد)$/.test(v)) return "male";
  if (/^(انثي|انثه|اناث|ف|female|f|2|بنات|بنت)$/.test(v)) return "female";
  return undefined;
};

export const toDirection = (raw: string): Direction | undefined => {
  const v = norm(raw);
  if (!v) return undefined;
  if (v.includes("تنازل") || v.includes("الناس")) return "descending";
  if (v.includes("تصاعد") || v.includes("الفاتحه")) return "ascending";
  return undefined;
};

export interface ImportStudent {
  name: string;
  nationalId: string;
  birth: string;
  gender?: Gender;
  phoneCc: string;
  phoneNational: string;
  guardianName: string;
  guardianRelation: "father" | "mother" | "other";
  guardianCallPhone: string;
  guardianWaCc: string;
  guardianWaNational: string;
  guardianNationalId: string;
  direction: Direction;
  lastSurah?: number;
  lastAyah: number;
  monthlyPlanPages: number;
  ajkamCourse: string;
  joinedAt: string;
}

export interface BuiltRow {
  /** رقم السطر في الملف كما يراه المستخدم */
  line: number;
  student: ImportStudent;
  /** خطأ يمنع الاستيراد (اسم ناقص مثلاً) */
  problem: string;
}

/** يبني صفوف الاستيراد من خلايا الملف وفق الربط المختار. */
export function buildImportRows(
  rows: string[][],
  mapping: Array<FieldKey | "">,
  opts: { header: boolean; defaultDirection: Direction; defaultPlan: number }
): BuiltRow[] {
  const body = opts.header ? rows.slice(1) : rows;
  const offset = opts.header ? 2 : 1;
  const out: BuiltRow[] = [];
  body.forEach((cells, i) => {
    const get = (key: FieldKey): string => {
      const at = mapping.indexOf(key);
      return at < 0 ? "" : String(cells[at] ?? "").trim();
    };
    const name = get("name").replace(/\s+/g, " ").trim();
    if (!name && !cells.some((c) => c)) return; // سطر فارغ
    const surahRaw = get("lastSurah");
    const surahByName = SURAH_INDEX.get(norm(surahRaw));
    const surahNum = surahByName ?? num(surahRaw);
    const direction = toDirection(get("direction")) ?? opts.defaultDirection;
    const planned = num(get("monthlyPlanPages"));
    const course = get("ajkamCourse").trim();
    const relRaw = norm(get("guardianRelation"));
    const guardianRelation: "father" | "mother" | "other" = /^(ام|الام|mother|m|والده|والدة)$/.test(relRaw) ? "mother" : /^(اخر|اخري|other|o|اخو|اخت|جد|جده)$/.test(relRaw) ? "other" : "father";
    const student: ImportStudent = {
      name,
      nationalId: latinDigits(get("nationalId")).replace(/[^\dA-Za-z-]/g, ""),
      birth: toIsoDate(get("birth")),
      gender: toGender(get("gender")),
      phoneCc: latinDigits(get("phoneCc")).replace(/[^\d]/g, "") || "",
      phoneNational: latinDigits(get("phoneNational")).replace(/[^\d]/g, ""),
      guardianName: get("guardianName").replace(/\s+/g, " ").trim(),
      guardianRelation,
      guardianCallPhone: latinDigits(get("guardianCallPhone")).replace(/[^\d]/g, ""),
      guardianWaCc: latinDigits(get("guardianWaCc")).replace(/[^\d]/g, "") || "970",
      // إن غاب عمود الواتساب يُعتمد رقم الاتصال (كثيراً ما يكونان واحداً)
      guardianWaNational: latinDigits(get("guardianWaNational")).replace(/[^\d]/g, "") || latinDigits(get("guardianCallPhone")).replace(/[^\d]/g, ""),
      guardianNationalId: latinDigits(get("guardianNationalId")).replace(/[^\dA-Za-z-]/g, ""),
      direction,
      lastSurah: surahNum && surahNum >= 1 && surahNum <= 114 ? Math.trunc(surahNum) : undefined,
      lastAyah: Math.max(0, Math.min(286, Math.trunc(num(get("lastAyah")) ?? 0))),
      monthlyPlanPages: Math.max(0, Math.min(604, Math.trunc(planned ?? opts.defaultPlan))),
      ajkamCourse: (AJKAM_COURSES as readonly string[]).includes(course) ? course : "",
      joinedAt: toIsoDate(get("joinedAt"))
    };
    const problem = name.length < 3 ? "الاسم مفقود أو قصير"
      : !student.guardianName ? "اسم ولي الأمر مطلوب"
      : !student.guardianWaNational && !student.guardianNationalId ? "رقم واتساب ولي الأمر أو هويته مطلوب"
      : "";
    out.push({ line: i + offset, student, problem });
  });
  return out;
}

/** نموذج CSV (يُفتح في Excel مباشرة) بعناوين الأعمدة المتوقَّعة. */
export function templateCsv(): string {
  const head = FIELDS.map((f) => f.label).join(",");
  const sample = FIELDS.map((f) => ({
    name: "محمد أحمد سعيد عبد الله", nationalId: "401234567", birth: "2012-05-14", gender: "ذكر",
    phoneCc: "970", phoneNational: "", guardianName: "أحمد سعيد عبد الله", guardianRelation: "أب",
    guardianCallPhone: "0599876543", guardianWaCc: "970", guardianWaNational: "0599876543", guardianNationalId: "801234567",
    direction: "من الناس إلى الفاتحة", lastSurah: "الناس", lastAyah: "6", monthlyPlanPages: "10", ajkamCourse: "", joinedAt: "2026-09-01"
  } as Record<string, string>)[f.key] ?? "").join(",");
  return `\uFEFF${head}\n${sample}\n`;
}
