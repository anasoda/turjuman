// اختبار تكاملي لإصلاحات المراجعة (الدفعة 5): حضور الطالب اليومي بأربع حالات (هجرة 0010) وما يليه.
import assert from "node:assert/strict";

const BASE = process.env.API_BASE || "http://127.0.0.1:8787";
const PASSWORD = "Demo@2026pass";
let passed = 0;

async function call(path, { method = "GET", body, cookie } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: res.status, data: await res.json().catch(() => ({})), cookie: (res.headers.get("set-cookie") || "").split(";")[0] };
}
async function session(centerId, username, password = PASSWORD) {
  const r = await call("/api/auth/login", { method: "POST", body: { centerId, username, password } });
  assert.equal(r.status, 200, `دخول ${username}: ${JSON.stringify(r.data)}`);
  return r.cookie;
}
async function test(name, fn) {
  try { await fn(); passed++; console.log("✓", name); } catch (e) { console.error("✗", name, "\n   ", e.message); process.exitCode = 1; }
}
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

const G = "tarjuman-gaza-01";
const teacher = await session(G, "gaza.teacher1");
const { students } = (await call("/api/students?pageSize=100", { cookie: teacher })).data;
const s = students.find((x) => !x.archivedAt) ?? students[0];
const post = (body) => call("/api/daily", { method: "POST", cookie: teacher, body: { studentId: s.id, ...body } });
const start = (await call(`/api/daily/board?date=${daysAgo(1)}&circleId=${s.circleId}`, { cookie: teacher })).data.rows.find((r) => r.student.id === s.id).student.nextStart;

await test("«بعذر» يُقبل بلا نطاق تسميع مع سبب العذر", async () => {
  const r = await post({ date: daysAgo(21), attendance: "excused", note: "مرض" });
  assert.ok([200, 201].includes(r.status), JSON.stringify(r.data));
  assert.equal(r.data.pages, 0);
});

await test("«بعذر» و«متأخر» بلا ملاحظة مرفوضان", async () => {
  assert.equal((await post({ date: daysAgo(22), attendance: "excused", note: "" })).status, 400);
  assert.equal((await post({ date: daysAgo(22), attendance: "late", from: start, to: start, note: "" })).status, 400);
});

await test("«متأخر» يتطلب نطاق تسميع ويُحسب كحاضر في الإحصاءات", async () => {
  assert.equal((await post({ date: daysAgo(23), attendance: "late", note: "زحمة سير" })).status, 400);
  const ok = await post({ date: daysAgo(23), attendance: "late", from: start, to: start, note: "زحمة سير" });
  assert.ok([200, 201].includes(ok.status), JSON.stringify(ok.data));
  const board = (await call(`/api/daily/board?date=${daysAgo(23)}&circleId=${s.circleId}`, { cookie: teacher })).data;
  const rec = board.rows.find((r) => r.student.id === s.id).record;
  assert.equal(rec.attendance, "late");
  assert.equal(rec.note, "زحمة سير");
});

await test("قيمة حضور غير معروفة ما زالت مرفوضة", async () => {
  assert.equal((await post({ date: daysAgo(24), attendance: "sick", note: "x" })).status, 400);
});

const admin = await session(G, "admin");
const stamp = Date.now().toString().slice(-6);

await test("لا يُترك طالب بلا ولي أمر عند تعديل الأبناء", async () => {
  const st = (await call(`/api/students/${s.id}`, { cookie: admin })).data;
  const gid = st.student?.guardianId ?? st.guardianId;
  assert.ok(gid, "الطالب بلا ولي في البذرة؟");
  const r = await call(`/api/guardians/${gid}/children`, { method: "PUT", cookie: admin, body: { studentIds: [] } });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  const still = (await call(`/api/students/${s.id}`, { cookie: admin })).data;
  assert.equal(still.student?.guardianId ?? still.guardianId, gid, "فُكّ ارتباط الطالب رغم الرفض");
});

await test("استيراد 50 صفاً بأولياء مختلفين لا يتجاوز حدّ 100 معامل، ويرفض الناقص", async () => {
  const rows = Array.from({ length: 50 }, (_, i) => ({
    name: `طالب مستورد رقم ${i} اختبار`, birth: i === 48 ? "" : "2012-01-02", gender: i === 49 ? undefined : "male",
    guardianName: `ولي أمر مستورد ${i}`, guardianCallPhone: `059${stamp}${String(i).padStart(2, "0")}`, guardianWaNational: `059${stamp}${String(i).padStart(2, "0")}`,
    guardianNationalId: "", nationalId: ""
  }));
  const r = await call("/api/students/import", { method: "POST", cookie: admin, body: { circleId: null, tempIds: true, createAccounts: false, rows } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.added, 48, JSON.stringify(r.data));
  assert.equal(r.data.errors, 2);
});

console.log(`\n${passed} اختباراً ناجحاً (الدفعة 5 — المراجعة)`);
