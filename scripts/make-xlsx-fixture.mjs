// يولّد ملف xlsx حقيقياً (zip مضغوط) لاختبار قارئ الملفات: tests/fixtures/students-sample.xlsx
import { deflateRawSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { crc32 } from "node:zlib";

const enc = new TextEncoder();

const strings = ["الاسم الرباعي", "رقم الهوية", "تاريخ الميلاد", "الجنس", "جوال ولي الأمر", "محمد أحمد سعيد علي", "ذكر", "سارة خالد محمود حسن", "أنثى"];
const sharedStrings =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">` +
  strings.map((s) => `<si><t>${s}</t></si>`).join("") +
  `</sst>`;

const sheet =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>` +
  `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c><c r="E1" t="s"><v>4</v></c></row>` +
  `<row r="2"><c r="A2" t="s"><v>5</v></c><c r="B2"><v>401234567</v></c><c r="C2" s="1"><v>45000</v></c><c r="D2" t="s"><v>6</v></c><c r="E2"><v>599876543</v></c></row>` +
  `<row r="3"><c r="A3" t="s"><v>7</v></c><c r="B3"><v>407654321</v></c><c r="D3" t="s"><v>8</v></c></row>` +
  `</sheetData></worksheet>`;

const contentTypes =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
  `</Types>`;

const entries = [
  { name: "[Content_Types].xml", data: enc.encode(contentTypes), store: true },
  { name: "xl/sharedStrings.xml", data: enc.encode(sharedStrings), store: false },
  { name: "xl/worksheets/sheet1.xml", data: enc.encode(sheet), store: false }
];

const chunks = [];
const central = [];
let offset = 0;
const push = (buf) => { chunks.push(buf); offset += buf.length; };
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };

for (const e of entries) {
  const raw = Buffer.from(e.data);
  const body = e.store ? raw : Buffer.from(deflateRawSync(raw));
  const name = Buffer.from(e.name, "utf8");
  const crc = crc32(raw);
  const local = offset;
  push(Buffer.concat([u32(0x04034b50), u16(20), u16(0x0800), u16(e.store ? 0 : 8), u16(0), u16(0), u32(crc), u32(body.length), u32(raw.length), u16(name.length), u16(0), name]));
  push(body);
  central.push(
    Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(e.store ? 0 : 8), u16(0), u16(0), u32(crc), u32(body.length), u32(raw.length),
      u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(local), name
    ])
  );
}
const cdStart = offset;
central.forEach(push);
const cdSize = offset - cdStart;
push(Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(cdSize), u32(cdStart), u16(0)]));

mkdirSync("tests/fixtures", { recursive: true });
writeFileSync("tests/fixtures/students-sample.xlsx", Buffer.concat(chunks));
console.log("تم توليد tests/fixtures/students-sample.xlsx");
