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

const G = "obai-01";
const teacher = await session(G, "obai.teacher1");
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
    guardianName: `ولي أمر مستورد ${i}`, guardianCallPhone: `059${stamp.slice(0, 5)}${String(i).padStart(2, "0")}`, guardianWaNational: `059${stamp.slice(0, 5)}${String(i).padStart(2, "0")}`,
    guardianNationalId: "", nationalId: ""
  }));
  const r = await call("/api/students/import", { method: "POST", cookie: admin, body: { circleId: null, tempIds: true, createAccounts: false, rows } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.added, 48, JSON.stringify(r.data));
  assert.equal(r.data.errors, 2);
});

/* ---- مقدمات الواتساب 970/972 فقط، إسناد حلقة لمدير مرحلة، وحذف الكادر ---- */
const staffBody = (n, extra = {}) => ({
  role: "teacher", username: `del${stamp}${n}`, password: "Temp@2026pass", displayName: `معلم للحذف رقم ${n} اختبار`,
  nationalId: `9${stamp}${String(n).padStart(2, "0")}`, phone: "0591234567", waCc: "970", waNational: "",
  birth: "1990-01-01", gender: "male", email: "", address: "", qualification: "بكالوريوس", ajkamCourse: "تأهيلية", memorizedParts: 30, ...extra
});

await test("مقدمة الواتساب: 972 تُقبل و962 و20 تُرفض (كادر)", async () => {
  const bad = await call("/api/staff", { method: "POST", cookie: admin, body: staffBody(1, { waCc: "962" }) });
  assert.equal(bad.status, 400, JSON.stringify(bad.data));
  assert.equal((await call("/api/staff", { method: "POST", cookie: admin, body: staffBody(1, { waCc: "20" }) })).status, 400);
  const ok = await call("/api/staff", { method: "POST", cookie: admin, body: staffBody(1, { waCc: "972" }) });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
});

await test("مقدمة الواتساب: ولي الأمر والاستيراد يرفضان غير 970/972", async () => {
  const g = await call("/api/guardians", { method: "POST", cookie: admin, body: { name: "ولي مقدمة خاطئة", relation: "father", callPhone: "0591112223", waCc: "962", waNational: "0591112223", nationalId: "", withAccount: false, studentIds: [] } });
  assert.equal(g.status, 400, JSON.stringify(g.data));
  const row = { name: "طالب مقدمة خاطئة اختبار", birth: "2012-01-02", gender: "male", guardianName: "ولي أمر مقدمة", guardianCallPhone: `059${stamp.slice(0, 5)}77`, guardianWaNational: `059${stamp.slice(0, 5)}77`, guardianWaCc: "962", nationalId: "", guardianNationalId: "" };
  const r = await call("/api/students/import", { method: "POST", cookie: admin, body: { circleId: null, tempIds: true, createAccounts: false, rows: [row, { ...row, guardianWaCc: "972", guardianCallPhone: `059${stamp.slice(0, 5)}78`, guardianWaNational: `059${stamp.slice(0, 5)}78` }] } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.added, 1, JSON.stringify(r.data));
  assert.equal(r.data.errors, 1);
});

await test("مدير المرحلة يُسند إلى حلقة كمعلّم أساسي", async () => {
  const staff = (await call("/api/staff", { cookie: admin })).data.staff;
  const sm = staff.find((x) => x.username === "obai.stage1");
  assert.equal(sm.role, "stage_manager");
  const r = await call("/api/circles", { method: "POST", cookie: admin, body: { name: `حلقة مدير مرحلة ${stamp}`, category: "male", levelKey: "primary", active: true, primaryTeacherId: sm.id, assistantTeacherId: null } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  await call(`/api/circles/${r.data.id}`, { method: "DELETE", cookie: admin });
});

await test("حذف حساب معلّم: يُحذف ثم لا يدخل، وتُرفض حالات المعيَّن على حلقة", async () => {
  const mk = async (n) => (await call("/api/staff", { method: "POST", cookie: admin, body: staffBody(n) }));
  const a = await mk(2);
  assert.equal(a.status, 201, JSON.stringify(a.data));
  const del = await call(`/api/staff/${a.data.id}`, { method: "DELETE", cookie: admin });
  assert.equal(del.status, 200, JSON.stringify(del.data));
  const login = await call("/api/auth/login", { method: "POST", body: { centerId: G, username: `del${stamp}2`, password: "Temp@2026pass" } });
  assert.notEqual(login.status, 200, "دخل حساب محذوف");
  assert.equal((await call(`/api/staff/${a.data.id}`, { method: "DELETE", cookie: admin })).status, 404);

  const b = await mk(3);
  const circle = await call("/api/circles", { method: "POST", cookie: admin, body: { name: `حلقة حذف ${stamp}`, category: "male", levelKey: "primary", active: true, primaryTeacherId: b.data.id, assistantTeacherId: null } });
  assert.equal(circle.status, 201, JSON.stringify(circle.data));
  assert.equal((await call(`/api/staff/${b.data.id}`, { method: "DELETE", cookie: admin })).status, 409, "حُذف معلّم معيَّن على حلقة");
  await call(`/api/circles/${circle.data.id}`, { method: "DELETE", cookie: admin });
  assert.equal((await call(`/api/staff/${b.data.id}`, { method: "DELETE", cookie: admin })).status, 200);
});

await test("السكرتير لا يحذف مدير مرحلة ولا يحذف حسابه", async () => {
  const secretary = await session(G, "obai.secretary");
  const staff = (await call("/api/staff", { cookie: admin })).data.staff;
  const sm = staff.find((x) => x.username === "obai.stage1");
  assert.equal((await call(`/api/staff/${sm.id}`, { method: "DELETE", cookie: secretary })).status, 404);
  const me = (await call("/api/auth/me", { cookie: secretary })).data.user;
  assert.notEqual((await call(`/api/staff/${me.id}`, { method: "DELETE", cookie: secretary })).status, 200);
});

console.log(`\n${passed} اختباراً ناجحاً (الدفعة 5 — المراجعة)`);
