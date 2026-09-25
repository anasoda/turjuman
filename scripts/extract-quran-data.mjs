// (النظام القديم حُذف من الجهاز؛ لإعادة التوليد استخرج index.html من turjuman-old-backup.zip ومرّر مساره.)
// يستخرج جدول السور وصفحات مصحف المدينة (604) من ملف النظام القديم إلى shared/quran-data.ts
import { readFileSync, writeFileSync } from "node:fs";
const OLD = process.argv[2] || "../turjuman/public/index.html";
const src = readFileSync(OLD, "utf8");
const pages = src.match(/const QURAN_PAGE_STARTS = (\[\[[\s\S]*?\]\]);/);
const surahs = src.match(/const QURAN_SURAHS = (\[[\s\S]*?\n\]);/);
if (!pages || !surahs) throw new Error("لم أجد الجداول في الملف القديم");
const decode = (s) => s.replace(/\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
const P = JSON.parse(pages[1]);
const S = JSON.parse(decode(surahs[1]));
if (P.length !== 604 || S.length !== 114) throw new Error(`أعداد غير متوقعة: ${P.length} صفحة، ${S.length} سورة`);
const out = `// مُولَّد بـ scripts/extract-quran-data.mjs من النظام القديم — لا تعدّله يدوياً.
// جدول السور: [الاسم، عدد الآيات] بترتيب المصحف (الفهرس + 1 = رقم السورة).
export const SURAHS: ReadonlyArray<readonly [string, number]> = ${JSON.stringify(S)};

// بداية كل صفحة في مصحف المدينة (604 صفحات): [رقم الصفحة، رقم السورة، أول آية في الصفحة]
export const PAGE_STARTS: ReadonlyArray<readonly [number, number, number]> = ${JSON.stringify(P)};
`;
writeFileSync("shared/quran-data.ts", out);
console.log("surahs:", S.length, "pages:", P.length, "first:", S[0], "last:", S[113]);
