// يولّد كشف مواعيد صلاة مصحَّحاً بإزاحة الفجر بعدد دقائق (الأذان الأول ← الثاني).
// الاستخدام: node scripts/shift-fajr.mjs <ملف-الإدخال.json|csv> [الدقائق=30] > الناتج.csv
import { readFileSync } from "node:fs";

const [inputPath, minutesArg] = process.argv.slice(2);
const minutes = Number(minutesArg ?? 30);
if (!inputPath || !Number.isFinite(minutes)) {
  console.error("الاستخدام: node scripts/shift-fajr.mjs <ملف> [دقائق]");
  process.exit(1);
}

const shift = (hhmm, mins) => {
  const [h, m] = hhmm.split(":").map(Number);
  const total = (h * 60 + m + mins + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

const raw = readFileSync(inputPath, "utf8").replace(/^﻿/, "");
const COLS = ["date", "fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"];

let rows;
if (raw.trimStart().startsWith("[")) {
  rows = JSON.parse(raw);
} else {
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  const head = lines[0].split(/[,;\t]/).map((s) => s.trim().replace(/^"|"$/g, ""));
  const idx = COLS.map((c) => head.indexOf(c));
  if (idx.some((i) => i < 0)) { console.error("رأس الملف يجب أن يحوي: " + COLS.join(",")); process.exit(1); }
  rows = lines.slice(1).map((l) => {
    const cells = l.split(/[,;\t]/).map((s) => s.trim().replace(/^"|"$/g, ""));
    return Object.fromEntries(COLS.map((c, k) => [c, cells[idx[k]] ?? ""]));
  });
}

console.log(COLS.join(","));
for (const r of rows) console.log(COLS.map((c) => (c === "fajr" ? shift(r.fajr, minutes) : r[c])).join(","));
