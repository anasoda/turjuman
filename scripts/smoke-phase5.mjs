// اختبار تكاملي للدفعة 3 (§15.3): دور مدير المرحلة.
// يفحص حدود الصلاحية فعلياً على الخادم: يرى طلاب مراحله فقط، يسجّل حضور معلّمي مراحله فقط،
// يضيف وينقل داخل مراحله، ويُمنع من الإعدادات والكادر والأرشفة والمراحل الأخرى.
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

const G = "obai-01";
const admin = await session(G, "admin");
const manager = await session(G, "obai.stage1"); // مراحله: primary فقط (بذرة seed-local)

const circles = (await call("/api/circles", { cookie: admin })).data.circles;
const staffList = (await call("/api/staff", { cookie: admin })).data.staff;
const smAccount = staffList.find((s) => s.role === "stage_manager");
assert.ok(smAccount, "البذرة تحتاج حساب مدير مرحلة");
// حلقة يدرّسها مدير المرحلة نفسه (قرار المالك: التعيين فوق حساب المعلّم)
const ownCircle = circles.find((c) => c.primaryTeacherId === smAccount.id || c.assistantTeacherId === smAccount.id);
assert.ok(ownCircle, "البذرة تحتاج حلقة يدرّسها مدير المرحلة");
const primaryCircle = circles.find((c) => c.levelKey === "primary" && c.active && c.id !== ownCircle.id);
// معلّمو المرحلة الابتدائية كلهم (أي معلّم يدرّس حلقة فيها ولو كان يدرّس غيرها في مرحلة أخرى)
const primaryTeachers = new Set(circles.filter((c) => c.levelKey === "primary").flatMap((c) => [c.primaryTeacherId, c.assistantTeacherId]).filter(Boolean));
primaryTeachers.delete(smAccount.id);
// «حلقة أخرى» = من مرحلة أخرى **ومعلّمها لا يدرّس في الابتدائي** — وإلا فمعلّم يدرّس في المرحلتين
// يظهر لمدير الابتدائي بحق، ويفسد اختبار «خارج مرحلته»
const otherCircle = circles.find((c) => c.levelKey !== "primary" && c.active && c.primaryTeacherId && !primaryTeachers.has(c.primaryTeacherId));
assert.ok(primaryCircle && otherCircle, "البذرة تحتاج حلقة primary أخرى وحلقة من مرحلة أخرى بمعلّم لا يدرّس في الابتدائي");

const stamp = Date.now().toString().slice(-7);
const nid = (n) => "7" + stamp + String(n);
const TODAY = new Date().toISOString().slice(0, 10);

await test("الدور الفعلي المشتق = stage_manager", async () => {
  const me = await call("/api/auth/me", { cookie: manager });
  assert.equal(me.status, 200);
  assert.equal(me.data.user.role, "stage_manager");
});

await test("يرى حلقات مرحلته فقط", async () => {
  const r = await call("/api/circles", { cookie: manager });
  assert.equal(r.status, 200);
  assert.ok(r.data.circles.length, "لا حلقات");
  assert.ok(r.data.circles.every((c) => c.levelKey === "primary"), "ظهرت حلقة من مرحلة أخرى");
});

await test("قائمة الطلاب محصورة بحلقات مرحلته", async () => {
  const r = await call("/api/students?pageSize=100", { cookie: manager });
  assert.equal(r.status, 200);
  const allowed = new Set(circles.filter((c) => c.levelKey === "primary").map((c) => c.id));
  assert.ok(r.data.students.every((s) => allowed.has(s.circleId)), "ظهر طالب خارج مرحلته");
});

let myStudentId = "";
await test("يضيف طالباً إلى حلقة مرحلته", async () => {
  const r = await call("/api/students", {
    method: "POST", cookie: manager,
    body: {
      name: "طالب مدير المرحلة الأول", nationalId: nid(1), birth: "2012-03-04", gender: primaryCircle.category, circleId: primaryCircle.id,
      guardian: { name: "ولي أمر المرحلة", relation: "father", callPhone: "0599" + stamp.slice(0, 6), waCc: "970", waNational: "0599" + stamp.slice(0, 6), nationalId: "" }
    }
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  myStudentId = r.data.id;
});

await test("يُمنع من الإضافة إلى حلقة خارج مرحلته", async () => {
  const r = await call("/api/students", {
    method: "POST", cookie: manager,
    body: {
      name: "طالب خارج المرحلة كليا", nationalId: nid(2), birth: "2012-03-04", gender: otherCircle.category, circleId: otherCircle.id,
      guardian: { name: "ولي أمر آخر هنا", relation: "father", callPhone: "0598" + stamp.slice(0, 6), waCc: "970", waNational: "0598" + stamp.slice(0, 6), nationalId: "" }
    }
  });
  assert.equal(r.status, 403, JSON.stringify(r.data));
});

await test("يُمنع من إضافة طالب بلا حلقة (لا ينتمي إلى مرحلة)", async () => {
  const r = await call("/api/students", {
    method: "POST", cookie: manager,
    body: {
      name: "طالب بلا حلقة اطلاقا", nationalId: nid(3), birth: "2012-03-04", gender: "male", circleId: null,
      guardian: { name: "ولي أمر ثالث هنا", relation: "father", callPhone: "0597" + stamp.slice(0, 6), waCc: "970", waNational: "0597" + stamp.slice(0, 6), nationalId: "" }
    }
  });
  assert.equal(r.status, 403, JSON.stringify(r.data));
});

await test("يعدّل بيانات طالب مرحلته كاملةً (لا كالمعلّم)", async () => {
  const r = await call(`/api/students/${myStudentId}`, { method: "PATCH", cookie: manager, body: { name: "طالب مدير المرحلة المعدل" } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
});

await test("لا ينقل طالباً إلى حلقة خارج مرحلته", async () => {
  const r = await call(`/api/students/${myStudentId}/move`, { method: "POST", cookie: manager, body: { circleId: otherCircle.id } });
  assert.equal(r.status, 403, JSON.stringify(r.data));
});

let outsideStudentId = "";
await test("طالب خارج مرحلته يظهر كأنه غير موجود", async () => {
  const all = (await call("/api/students?pageSize=100", { cookie: admin })).data.students;
  const outside = all.find((s) => s.circleId && s.circleId === otherCircle.id);
  assert.ok(outside, "البذرة تحتاج طالباً في حلقة أخرى");
  outsideStudentId = outside.id;
  const r = await call(`/api/students/${outsideStudentId}`, { cookie: manager });
  assert.equal(r.status, 404, JSON.stringify(r.data));
});

await test("لا يعدّل طالباً خارج مرحلته", async () => {
  const r = await call(`/api/students/${outsideStudentId}`, { method: "PATCH", cookie: manager, body: { name: "محاولة تعديل ممنوعة" } });
  assert.equal(r.status, 404, JSON.stringify(r.data));
});

await test("لا يحذف مدير المرحلة ملاحظة لطالب خارج نطاقه", async () => {
  const body = `ملاحظة خارج المرحلة ${Date.now()}`;
  assert.equal((await call("/api/notes", { method: "POST", cookie: admin, body: { studentId: outsideStudentId, body } })).status, 201);
  const notes = (await call(`/api/notes?studentId=${outsideStudentId}`, { cookie: admin })).data.notes;
  const note = notes.find((n) => n.body === body);
  assert.ok(note, "لم تُنشأ الملاحظة التجريبية");
  const denied = await call(`/api/notes/${note.id}`, { method: "DELETE", cookie: manager });
  assert.equal(denied.status, 404, JSON.stringify(denied.data));
  assert.ok((await call(`/api/notes?studentId=${outsideStudentId}`, { cookie: admin })).data.notes.some((n) => n.id === note.id));
  assert.equal((await call(`/api/notes/${note.id}`, { method: "DELETE", cookie: admin })).status, 200);
});

await test("حضور الكادر: يرى معلّمي مرحلته فقط ولا يرى نفسه", async () => {
  const r = await call("/api/staff-attendance", { cookie: manager });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.rows.length, "لا صفوف حضور");
  assert.ok(r.data.rows.every((row) => primaryTeachers.has(row.id)), "ظهر عضو كادر لا يدرّس في مرحلته");
  assert.ok(primaryTeachers.size === r.data.rows.length, "نقص معلّم من معلّمي مرحلته");
  // قرار المالك: حضوره يسجّله مدير المركز، فلا يسجّله هو لنفسه
  assert.ok(!r.data.rows.some((row) => row.id === smAccount.id), "ظهر مدير المرحلة في كشف حضوره");
});

await test("مدير المركز يرى مدير المرحلة ويسجّل حضوره", async () => {
  const r = await call("/api/staff-attendance", { cookie: admin });
  assert.equal(r.status, 200);
  assert.ok(r.data.rows.some((row) => row.id === smAccount.id), "مدير المرحلة غائب عن كشف المدير");
  const w = await call("/api/staff-attendance", { method: "POST", cookie: admin, body: { userId: smAccount.id, date: TODAY, status: "present", note: "" } });
  assert.equal(w.status, 200, JSON.stringify(w.data));
});

await test("«بعذر» و«متأخر» تتطلبان ملاحظة؛ «حاضر» و«غائب» لا", async () => {
  const target = primaryCircle.primaryTeacherId;
  for (const status of ["excused", "late"]) {
    const bad = await call("/api/staff-attendance", { method: "POST", cookie: admin, body: { userId: target, date: TODAY, status, note: "" } });
    assert.equal(bad.status, 400, `${status} بلا ملاحظة قُبل`);
  }
  const ok = await call("/api/staff-attendance", { method: "POST", cookie: admin, body: { userId: target, date: TODAY, status: "excused", note: "مراجعة طبية" } });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const rows = (await call(`/api/staff-attendance?date=${TODAY}`, { cookie: admin })).data.rows;
  const row = rows.find((x) => x.id === target);
  assert.equal(row.status, "excused");
  assert.equal(row.note, "مراجعة طبية", "لم تُحفظ الملاحظة");
  const plain = await call("/api/staff-attendance", { method: "POST", cookie: admin, body: { userId: target, date: TODAY, status: "present", note: "" } });
  assert.equal(plain.status, 200, "«حاضر» بلا ملاحظة رُفض");
});

await test("يدرّس حلقته: يضيف طالباً إليها ويسجّل تسميعه", async () => {
  const add = await call("/api/students", {
    method: "POST", cookie: manager,
    body: {
      name: "طالب حلقة مدير المرحلة", nationalId: nid(4), birth: "2012-05-06", gender: ownCircle.category, circleId: ownCircle.id,
      guardian: { name: "ولي أمر حلقته هنا", relation: "father", callPhone: "0596" + stamp.slice(0, 6), waCc: "970", waNational: "0596" + stamp.slice(0, 6), nationalId: "" }
    }
  });
  assert.equal(add.status, 201, JSON.stringify(add.data));
  const rec = await call("/api/daily", {
    method: "POST", cookie: manager,
    body: { studentId: add.data.id, date: TODAY, attendance: "present", from: { surah: 114, ayah: 1 }, to: { surah: 114, ayah: 6 }, grade: "", notes: "" }
  });
  assert.ok(rec.status === 200 || rec.status === 201, JSON.stringify(rec.data));
  const board = await call(`/api/daily/board?date=${TODAY}&circleId=${ownCircle.id}`, { cookie: manager });
  assert.equal(board.status, 200, JSON.stringify(board.data));
  assert.ok(board.data.rows.some((x) => x.student.id === add.data.id && x.record), "لم يظهر السجل في لوحة حلقته");
});

await test("يسجّل حضور معلّم مرحلته", async () => {
  const r = await call("/api/staff-attendance", { method: "POST", cookie: manager, body: { userId: primaryCircle.primaryTeacherId, date: TODAY, status: "present", note: "" } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
});

await test("لا يسجّل حضور معلّم خارج مرحلته", async () => {
  const outsideTeacher = otherCircle.primaryTeacherId;
  assert.ok(outsideTeacher, "البذرة تحتاج معلّماً للحلقة الأخرى");
  const r = await call("/api/staff-attendance", { method: "POST", cookie: manager, body: { userId: outsideTeacher, date: TODAY, status: "present", note: "" } });
  assert.equal(r.status, 404, JSON.stringify(r.data));
});

await test("إحصاءات الطلاب محصورة بمرحلته", async () => {
  const r = await call("/api/stats/students", { cookie: manager });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.students.every((s) => s.levelKey === "primary"), "ظهر طالب من مرحلة أخرى في الإحصاءات");
});

await test("ممنوع: الإعدادات والكادر والأرشفة وسجل التعديلات", async () => {
  for (const [path, opts] of [
    ["/api/settings", { method: "PUT", body: { maxStudentsPerCircle: 20 } }],
    ["/api/staff", {}],
    ["/api/audit", {}],
    ["/api/guardians", {}],
    [`/api/students/${myStudentId}/archive`, { method: "POST", body: { reason: "تجربة" } }]
  ]) {
    const r = await call(path, { ...opts, cookie: manager });
    assert.equal(r.status, 403, `${path} أعاد ${r.status}`);
  }
});

await test("السكرتير لا يدير حساب مدير المرحلة", async () => {
  const secretary = await session(G, "obai.secretary");
  const sm = smAccount;
  const r = await call(`/api/staff/${sm.id}`, { method: "PATCH", cookie: secretary, body: { displayName: "محاولة تعديل من السكرتير" } });
  assert.equal(r.status, 404, JSON.stringify(r.data));
});

await test("المدير يبدّل مراحل مدير المرحلة", async () => {
  const sm = smAccount;
  assert.deepEqual(sm.stages, ["primary"]);
  const r = await call(`/api/staff/${sm.id}`, { method: "PATCH", cookie: admin, body: { stages: ["primary", otherCircle.levelKey] } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  // تغيير المراحل يرفع session_version فتنتهي الجلسة القديمة
  const stale = await call("/api/circles", { cookie: manager });
  assert.equal(stale.status, 401, "الجلسة القديمة لم تنتهِ بعد تغيير المراحل");
  // وبجلسة جديدة يرى المرحلتين
  const fresh = await session(G, "obai.stage1");
  const seen = new Set((await call("/api/circles", { cookie: fresh })).data.circles.map((c) => c.levelKey));
  assert.ok(seen.has("primary") && seen.has(otherCircle.levelKey), "لم يرَ المرحلة المضافة");
  await call(`/api/staff/${sm.id}`, { method: "PATCH", cookie: admin, body: { stages: ["primary"] } });
});

console.log(`\n${passed} اختباراً ناجحاً`);
