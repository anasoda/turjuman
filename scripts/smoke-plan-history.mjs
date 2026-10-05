// اقتراح هدف الشهر، سجل الخطط، وحصص الشهر في لوحة التسميع. لا يعتمد على نافذة الأيام الخمسة الأخيرة.
import assert from "node:assert/strict";

const base = process.env.API_BASE || "http://127.0.0.1:8787";
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hebron", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const current = today.slice(0, 7);
const shift = (month, n) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + n, 1)).toISOString().slice(0, 7);
const previous = shift(current, -1);

async function call(path, method = "GET", body, cookie) {
  const response = await fetch(base + path, {
    method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: response.status, data: await response.json().catch(() => ({})), cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "" };
}
async function login(centerId, username) {
  const r = await call("/api/auth/login", "POST", { centerId, username, password: "Demo@2026pass" });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.cookie;
}

const admin = await login("obai-01", "admin");
const teacher = await login("obai-01", "obai.teacher1");
const otherTeacher = await login("obai-01", "obai.teacher3");
const otherCenter = await login("test-center-02", "other.teacher1");
const circle = (await call("/api/circles", "GET", undefined, teacher)).data.circles.find((c) => c.category === "male" && c.studentCount < 20);
assert.ok(circle, "لا توجد حلقة متاحة");
const guardianId = (await call("/api/students", "GET", undefined, admin)).data.students.find((s) => s.guardianId)?.guardianId;
const created = await call("/api/students", "POST", {
  nationalId: String(Math.floor(100000000 + Math.random() * 900000000)), name: "طالب تجربة سجل الخطط",
  birth: "2013-01-02", gender: "male", circleId: circle.id, guardianId,
  direction: "descending", lastSurah: 114, lastAyah: 0, monthlyPlanPages: 10, monthlyReviewPlanPages: 4
}, teacher);
assert.equal(created.status, 201, JSON.stringify(created.data));
const id = created.data.id;
const daily = (date, from, to) => call("/api/daily", "POST", { studentId: id, date, attendance: "present", from, to, grade: "", review: null, next: null, note: "" }, admin);

// بلا أشهر سابقة منجزة: لا اقتراح
const none = (await call(`/api/students/${id}/plan?month=${current}`, "GET", undefined, teacher)).data;
assert.equal(none.history.length, 3);
assert.equal(none.suggestion, null);

// الناس كاملة (صفحة واحدة) في الشهر السابق ← اقتراح صفحة واحدة بناءً على شهر واحد
const old = await daily(`${previous}-10`, { surah: 114, ayah: 1 }, { surah: 114, ayah: 6 });
assert.equal(old.status, 201, JSON.stringify(old.data));
const hint = (await call(`/api/students/${id}/plan?month=${current}`, "GET", undefined, teacher)).data;
assert.deepEqual(hint.suggestion, { pages: 1, basedOn: 1 });
assert.equal(hint.history[0].month, previous);
assert.equal(hint.history[0].pages, 1);

// حصص الشهر تصل مع اللوحة: null بلا جدول، ثم عدّ أيام الجدول (الأحد والثلاثاء) في الشهر
const boardPath = `/api/daily/board?date=${today}&circleId=${circle.id}`;
const before = await call(boardPath, "GET", undefined, teacher);
assert.equal(before.status, 200, JSON.stringify(before.data));
if (before.data.monthSessions === null) {
  const put = await call(`/api/schedule/${circle.id}`, "PUT", { entries: [{ weekday: 0, start: "16:00", end: "18:00", place: "المسجد" }, { weekday: 2, start: "16:00", end: "18:00", place: "المسجد" }] }, admin);
  assert.equal(put.status, 200, JSON.stringify(put.data));
}
const expectedSessions = (() => {
  const [y, m] = current.split("-").map(Number);
  const [wA, wB] = before.data.monthSessions === null ? [0, 2] : [null, null];
  if (wA === null) return null; // الجدول موجود مسبقاً: نتحقق فقط من النطاق
  let n = 0;
  for (let d = 1; d <= new Date(Date.UTC(y, m, 0)).getUTCDate(); d++) { const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); if (w === wA || w === wB) n++; }
  return n;
})();
const board = await call(boardPath, "GET", undefined, teacher);
if (expectedSessions !== null) assert.equal(board.data.monthSessions, expectedSessions);
else assert.ok(board.data.monthSessions >= 1 && board.data.monthSessions <= 31);

// سجل الخطط: الشهر الجاري بخطته ومنجزه، والسابق منجزه بلا خطة
const rec = await daily(today, { surah: 113, ayah: 1 }, { surah: 113, ayah: 5 });
assert.equal(rec.status, 201, JSON.stringify(rec.data));
const hist = await call(`/api/students/${id}/plan-history`, "GET", undefined, teacher);
assert.equal(hist.status, 200, JSON.stringify(hist.data));
assert.equal(hist.data.current, current);
const nowRow = hist.data.months.find((m) => m.month === current);
assert.deepEqual([nowRow.planPages, nowRow.reviewPlanPages, nowRow.pages, nowRow.set], [10, 4, 1, true]);
const prevRow = hist.data.months.find((m) => m.month === previous);
assert.deepEqual([prevRow.pages, prevRow.set], [1, false]);
const order = hist.data.months.map((m) => m.month);
assert.deepEqual(order, [...order].sort().reverse(), "الأحدث أولاً");

// العزل
assert.equal((await call(`/api/students/${id}/plan-history`, "GET", undefined, otherTeacher)).status, 404);
assert.equal((await call(`/api/students/${id}/plan-history`, "GET", undefined, otherCenter)).status, 404);
assert.equal((await call(`/api/students/${id}/plan-history`)).status, 401);
console.log("✓ اقتراح الهدف وسجل الخطط وحصص الشهر وعزلها");
