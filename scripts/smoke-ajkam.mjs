// اختبار تكاملي لمتابعة دورات الأحكام (هجرة 0026): شيخ مستقل عن الحلقة، لقاءات وحضور وملاحظات وإعلانات،
// بوابة ولي الأمر، وعزل الصلاحيات والمراكز.
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
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

const G = "obai-01";
const admin = await session(G, "admin");
const teacher1 = await session(G, "obai.teacher1");
const teacher2 = await session(G, "obai.teacher2");
const committee = await session(G, "obai.committee");
const wali = await session(G, "801000001", "801000001");
const otherAdmin = await session("test-center-02", "admin");

const staff = (await call("/api/staff", { cookie: admin })).data.staff;
const t2 = staff.find((x) => x.username === "obai.teacher2");
const find = async (q) => (await call(`/api/students?pageSize=100&q=${encodeURIComponent(q)}`, { cookie: admin })).data.students.find((x) => x.name === q);
const umar = await find("عمر علي محمد بركات");
const layan = await find("ليان محمود سعيد عوض");
assert.ok(t2 && umar && layan, "بيانات البذور ناقصة");

let courseId;

await test("المدير ينشئ دورة بشيخ ليس محفّظ الطلاب", async () => {
  const r = await call("/api/courses", { method: "POST", cookie: admin, body: { name: "دورة اختبار الأحكام", status: "active", teacherId: t2.id, studentIds: [umar.id, layan.id] } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  courseId = r.data.id;
});

await test("شيخ غير موجود في الكادر يُرفض", async () => {
  const r = await call("/api/courses", { method: "POST", cookie: admin, body: { name: "دورة خاطئة", status: "active", teacherId: "nope", studentIds: [] } });
  assert.equal(r.status, 400);
});

await test("الشيخ يرى دورته في القائمة والمعلّم الآخر لا يراها", async () => {
  const mine = (await call("/api/courses", { cookie: teacher2 })).data.courses;
  assert.ok(mine.some((c) => c.id === courseId));
  const other = (await call("/api/courses", { cookie: teacher1 })).data.courses;
  assert.ok(!other.some((c) => c.id === courseId));
});

await test("معلّم غير الشيخ يرى 404 على الدورة وعلى الكتابة", async () => {
  assert.equal((await call(`/api/courses/${courseId}/overview`, { cookie: teacher1 })).status, 404);
  const w = await call(`/api/courses/${courseId}/sessions`, { method: "POST", cookie: teacher1, body: { heldOn: day(0), attendance: [] } });
  assert.equal(w.status, 404);
});

await test("لجنة الاختبارات تقرأ ولا تكتب", async () => {
  assert.equal((await call(`/api/courses/${courseId}/overview`, { cookie: committee })).status, 200);
  const w = await call(`/api/courses/${courseId}/sessions`, { method: "POST", cookie: committee, body: { heldOn: day(0), attendance: [] } });
  assert.equal(w.status, 403);
});

await test("مركز آخر لا يرى الدورة", async () => {
  assert.equal((await call(`/api/courses/${courseId}/overview`, { cookie: otherAdmin })).status, 404);
});

let sessionId;
await test("الشيخ يسجّل لقاءً مع الحضور", async () => {
  const r = await call(`/api/courses/${courseId}/sessions`, {
    method: "POST", cookie: teacher2,
    body: { heldOn: day(-1), coveredTopic: "النون الساكنة", nextTopic: "الميم الساكنة", homework: "حفظ القاعدة", attendance: [{ studentId: umar.id, status: "present" }, { studentId: layan.id, status: "absent" }] }
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  sessionId = r.data.id;
});

await test("لقاء مكرّر بنفس التاريخ = 409", async () => {
  const r = await call(`/api/courses/${courseId}/sessions`, { method: "POST", cookie: teacher2, body: { heldOn: day(-1), attendance: [] } });
  assert.equal(r.status, 409);
});

await test("حضور طالب من خارج الدورة = 400", async () => {
  const outsider = (await call("/api/students?pageSize=100", { cookie: admin })).data.students.find((x) => x.id !== umar.id && x.id !== layan.id);
  if (!outsider) return;
  const r = await call(`/api/courses/${courseId}/sessions`, { method: "POST", cookie: teacher2, body: { heldOn: day(-2), attendance: [{ studentId: outsider.id, status: "present" }] } });
  assert.equal(r.status, 400);
});

await test("تعديل اللقاء يستبدل الحضور", async () => {
  const r = await call(`/api/courses/${courseId}/sessions/${sessionId}`, {
    method: "PUT", cookie: teacher2,
    body: { heldOn: day(-1), coveredTopic: "النون الساكنة", nextTopic: "الميم الساكنة", homework: "حفظ القاعدة", attendance: [{ studentId: umar.id, status: "late" }, { studentId: layan.id, status: "excused" }] }
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const o = (await call(`/api/courses/${courseId}/overview`, { cookie: teacher2 })).data;
  assert.equal(o.sessions[0].attendance[umar.id], "late");
});

await test("ملاحظة مع إشعار تصل ولي الأمر", async () => {
  const r = await call(`/api/courses/${courseId}/notes`, { method: "POST", cookie: teacher2, body: { studentId: umar.id, note: "يحتاج مراجعة الإدغام", notify: true } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const n = (await call("/api/notifications", { cookie: wali })).data.items;
  assert.ok(n.some((x) => x.kind === "ajkam_note"));
});

await test("إعلان اختبار وواجب", async () => {
  const r = await call(`/api/courses/${courseId}/events`, { method: "POST", cookie: teacher2, body: { kind: "exam", title: "اختبار النون", dueOn: day(7) } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
});

await test("ولي الأمر يرى دورة ابنه: الدرس القادم والحضور والملاحظة والإعلان", async () => {
  const r = await call(`/api/courses/portal/${umar.id}`, { cookie: wali });
  assert.equal(r.status, 200);
  const c = r.data.courses.find((x) => x.id === courseId);
  assert.ok(c);
  assert.equal(c.latest.nextTopic, "الميم الساكنة");
  assert.equal(c.notes.length, 1);
  assert.equal(c.events.length, 1);
  assert.equal(c.attendance[0].status, "late");
});

await test("ولي الأمر لا يرى دورات ابن غيره (404) ولا يصل إلى شاشة الكادر (403)", async () => {
  assert.equal((await call(`/api/courses/portal/${layan.id}`, { cookie: wali })).status, 404);
  assert.equal((await call(`/api/courses/${courseId}/overview`, { cookie: wali })).status, 403);
});

await test("حذف الدورة يحذف لقاءاتها وبياناتها", async () => {
  assert.equal((await call(`/api/courses/${courseId}`, { method: "DELETE", cookie: admin })).status, 200);
  assert.equal((await call(`/api/courses/${courseId}/overview`, { cookie: admin })).status, 404);
});

console.log(`\n${passed} اختباراً ناجحاً`);
