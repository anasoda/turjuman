/**
 * كاتب xlsx بلا مكتبات: أرشيف zip بلا ضغط (method 0) وورقة واحدة من نصوص مضمَّنة (inlineStr) وأرقام.
 * الورقة من اليمين لليسار، والصف الأول عريض بخلفية خفيفة، والأعمدة بعرض مناسب. يفتحه Excel وGoogle Sheets وLibreOffice.
 */
export type Cell = string | number | null | undefined;

const enc = new TextEncoder();

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    // محارف التحكم غير المسموحة في XML 1.0
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

/** اسم العمود بالحروف: 0→A، 26→AA */
function colName(i: number): string {
  let n = i + 1;
  let s = "";
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function sheetXml(head: string[], rows: Cell[][]): string {
  const widths = head.map((h, c) => {
    const longest = Math.max(h.length, ...rows.map((r) => String(r[c] ?? "").length));
    return Math.min(60, Math.max(10, longest + 3));
  });
  const cell = (v: Cell, r: number, c: number, style: number): string => {
    const ref = `${colName(c)}${r}`;
    if (typeof v === "number" && Number.isFinite(v)) return `<c r="${ref}"${style ? ` s="${style}"` : ""}><v>${v}</v></c>`;
    const text = String(v ?? "");
    if (text === "") return `<c r="${ref}"${style ? ` s="${style}"` : ""}/>`;
    return `<c r="${ref}"${style ? ` s="${style}"` : ""} t="inlineStr"><is><t xml:space="preserve">${esc(text)}</t></is></c>`;
  };
  const all = [head, ...rows];
  const body = all.map((row, i) => `<row r="${i + 1}">${row.map((v, c) => cell(v, i + 1, c, i === 0 ? 1 : 0)).join("")}</row>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + `<sheetViews><sheetView rightToLeft="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    + `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>`
    + `<sheetData>${body}</sheetData></worksheet>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
  + `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
  + `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>`
  + `<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>`
  + `<fill><patternFill patternType="solid"><fgColor rgb="FFDCEFE3"/><bgColor indexed="64"/></patternFill></fill></fills>`
  + `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>`
  + `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>`
  + `<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>`
  + `<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center"/></xf></cellXfs>`
  + `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>`
  + `</styleSheet>`;

function zipStored(files: Array<[string, Uint8Array]>): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const u16 = (v: number) => new Uint8Array([v & 0xff, (v >>> 8) & 0xff]);
  const u32 = (v: number) => new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]);
  const cat = (...a: Uint8Array[]) => { const n = a.reduce((t, x) => t + x.length, 0); const o = new Uint8Array(n); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };
  for (const [name, data] of files) {
    const nameBytes = enc.encode(name);
    const crc = crc32(data);
    // علم 0x0800 = أسماء الملفات UTF-8
    const local = cat(u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(data.length), u32(data.length), u16(nameBytes.length), u16(0), nameBytes, data);
    parts.push(local);
    central.push(cat(u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(data.length), u32(data.length), u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBytes));
    offset += local.length;
  }
  const centralAll = cat(...central);
  const end = cat(u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(centralAll.length), u32(offset), u16(0));
  return cat(...parts, centralAll, end);
}

/** يبني ملف xlsx (بايتات) من رأس وصفوف. */
export function buildXlsx(head: string[], rows: Cell[][], sheetName = "التقرير"): Uint8Array {
  const name = esc(sheetName.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Sheet1");
  const files: Array<[string, Uint8Array]> = [
    ["[Content_Types].xml", enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`)],
    ["_rels/.rels", enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`)],
    ["xl/workbook.xml", enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>`)],
    ["xl/_rels/workbook.xml.rels", enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`)],
    ["xl/styles.xml", enc.encode(STYLES)],
    ["xl/worksheets/sheet1.xml", enc.encode(sheetXml(head, rows))]
  ];
  return zipStored(files);
}

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** ينزّل جدولاً كملف Excel حقيقي (.xlsx). */
export function downloadXlsx(filename: string, head: string[], rows: Cell[][], sheetName?: string) {
  const bytes = buildXlsx(head, rows, sheetName);
  const blob = new Blob([bytes as BlobPart], { type: XLSX_MIME });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
