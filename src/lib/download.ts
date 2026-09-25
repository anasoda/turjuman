/** ينزّل نصاً كملف (CSV/JSON). يبدأ CSV بعلامة BOM ليقرأه Excel بالعربية. */
export function downloadFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function toCsv(head: string[], rows: Array<Array<string | number | null | undefined>>): string {
  const cell = (v: string | number | null | undefined) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return "﻿" + [head, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
}

export const ageOf = (birth: string | null | undefined): number => (birth ? Math.floor((Date.now() - new Date(birth).getTime()) / 31_557_600_000) : 0);
