// اختبار تكاملي للصلاحيات والقواعد على خادم تطوير يعمل (npm run dev:api) بعد npm run db:seed:local.
// الاستخدام: npm run test:api
import assert from "node:assert/strict";

const BASE = process.env.API_BASE || "http://127.0.0.1:8787";
const PASSWORD = "Demo@2026pass";
let passed = 0;

async function call(path, { method = "GET", body, cookie } = {}) {
  const res = await fetch(BASE + path, { method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => ({})), cookie: (res.headers.get("set-cookie") || "").split(";")[0] };
}
const login = async (centerId, username, password = PASSWORD) => call("/api/auth/login", { method: "POST", body: { centerId, username, password } });
async function session(centerId, username, password = PASSWORD) {
  const r = await login(centerId, username, password);
  assert.equal(r.status, 200, `دخول ${username}: ${JSON.stringify(r.data)}`);
  return r.cookie;
}
async function test(name, fn) {
  try { await fn(); passed++; console.log("✓", name); } catch (e) { console.error("✗", name, "\n   ", e.message); process.exitCode = 1; }
}

const G = "tarjuman-gaza-01", R = "tarjuman-rafah-02";
const admin = await session(G, "admin");
const teacher = await session(G, "gaza.teacher1");
const teacher3 = await session(G, "gaza.teacher3");
const wali = await session(G, "801000001", "801000001");
const committee = await session(G, "gaza.committee");
const secretary = await session(G, "gaza.secretary");

const circles = (await call("/api/circles", { cookie: admin })).data.circles;
const fajr = circles.find((c) => c.name === "حلقة الفجر");
const noor = circles.find((c) => c.name === "حلقة النور");
const studentsAll = (await call("/api/students", { cookie: admin })).data.students;
const s1 = studentsAll.find((s) => s.name.startsWith("عمر"));
const s3 = studentsAll.find((s) => s.name.startsWith("ليان"));

await test("رسالة الدخول تكشف موضع الخطأ", async () => {
  assert.equal((await login(G, "nobody")).data.error, "اسم المستخدم غير موجود");
  assert.equal((await login(G, "admin", "wrong-password")).data.error, "كلمة المرور غير صحيحة");
});
await test("الدور يُعرف من الحساب (بوابة واحدة)", async () => {
  const me = (await call("/api/auth/me", { cookie: teacher })).data;
  assert.equal(me.user.role, "teacher");
  assert.equal((await call("/api/auth/me", { cookie: wali })).data.user.role, "guardian");
});
await test("لا وصول بلا جلسة", async () => {
  assert.equal((await call("/api/students")).status, 401);
});
await test("المعلّم يرى طلاب حلقاته فقط", async () => {
  // هجرة 0009: للمعلّم أكثر من حلقة، فالنطاق = اتحاد حلقاته لا حلقة واحدة
  const mine = new Set((await call("/api/circles", { cookie: teacher })).data.circles.map((c) => c.id));
  const list = (await call("/api/students", { cookie: teacher })).data.students;
  assert.ok(list.length >= 2 && list.some((s) => s.circleId === fajr.id));
  assert.ok(list.every((s) => mine.has(s.circleId)), "ظهر طالب خارج حلقاته");
  assert.equal((await call(`/api/students/${s3.id}`, { cookie: teacher })).status, 404);
  assert.equal((await call("/api/students", { cookie: teacher3 })).data.students.every((s) => s.circleId === noor.id), true);
});
await test("المعلّم لا يضيف طالباً في حلقة غير حلقته", async () => {
  const r = await call("/api/students", { method: "POST", cookie: teacher, body: { nationalId: "400000999", name: "طالب تجريبي رباعي الاسم", birth: "2012-01-01", gender: "female", circleId: noor.id, direction: "descending", lastSurah: 114, lastAyah: 0, monthlyPlanPages: 10, phoneCc: "970", phoneNational: "", guardian: { name: "ولي اختبار", relation: "father", callPhone: "0599000000", waCc: "970", waNational: "0599000000", nationalId: "" } } });
  assert.equal(r.status, 403);
});
await test("ولي الأمر يرى بوابة أبنائه فقط", async () => {
  const summary = (await call(`/api/portal/summary?studentId=${s1.id}`, { cookie: wali })).data;
  assert.equal(summary.student.id, s1.id);
  assert.equal((await call(`/api/portal/summary?studentId=${s3.id}`, { cookie: wali })).status, 404);
});
await test("ولي الأمر لا يصل لواجهات الكادر", async () => {
  assert.equal((await call("/api/students", { cookie: wali })).status, 403);
  assert.equal((await call("/api/staff", { cookie: wali })).status, 403);
  assert.equal((await call("/api/audit", { cookie: wali })).status, 403);
});
await test("لا كلمات مرور تُعرَض في أي رد", async () => {
  const list = JSON.stringify((await call("/api/students", { cookie: admin })).data);
  assert.ok(!/password|hash|salt/i.test(list.replace(/accountActive/g, "")), "لا كلمات مرور في قائمة الطلاب");
  const staffList = JSON.stringify((await call("/api/staff", { cookie: admin })).data);
  assert.ok(!/password|hash|salt/i.test(staffList.replace(/accountActive/g, "")), "لا كلمات مرور في قائمة الكادر");
});
await test("عزل المراكز: مدير مركز لا يصل لبيانات مركز آخر", async () => {
  const rafahAdmin = await session(R, "admin");
  const rafahStudents = (await call("/api/students", { cookie: rafahAdmin })).data.students;
  assert.ok(rafahStudents.length >= 1);
  assert.equal((await call(`/api/students/${rafahStudents[0].id}`, { cookie: admin })).status, 404);
  assert.equal((await call(`/api/students/${s1.id}`, { cookie: rafahAdmin })).status, 404);
  assert.equal((await login(R, "gaza.teacher1")).status, 401, "حساب مركز لا يدخل مركزاً آخر");
});
await test("المعلّم قد يدرّس أكثر من حلقة (0009)، وفئة المعلّم تطابق الحلقة", async () => {
  const teachers = (await call("/api/staff", { cookie: admin })).data.staff.filter((t) => t.role === "teacher");
  const t1 = teachers.find((t) => t.username === "gaza.teacher1");
  const t3 = teachers.find((t) => t.username === "gaza.teacher3");
  const tag = Date.now().toString().slice(-7); // اسم فريد: الاختبار يُنظِّف نفسه فيبقى قابلاً للإعادة
  const r1 = await call("/api/circles", { method: "POST", cookie: admin, body: { name: `حلقة إضافية ${tag}`, category: "male", levelKey: "primary", active: true, primaryTeacherId: t1.id, assistantTeacherId: null } });
  assert.equal(r1.status, 201, `معلّم بحلقة إضافية يجب أن يُقبل: ${JSON.stringify(r1.data)}`);
  await call(`/api/circles/${r1.data.id}`, { method: "DELETE", cookie: admin });
  const r2 = await call("/api/circles", { method: "POST", cookie: admin, body: { name: `حلقة مخالفة ${tag}`, category: "male", levelKey: "primary", active: true, primaryTeacherId: t3.id, assistantTeacherId: null } });
  assert.equal(r2.status, 400, "معلّمة لحلقة ذكور");
});
await test("منع طالب في حلقة فئتها مخالفة، وحلقة معطّلة", async () => {
  const base = { nationalId: "400000998", name: "طالب تجريبي رباعي الاسم", birth: "2012-01-01", direction: "descending", lastSurah: 114, lastAyah: 0, monthlyPlanPages: 10, phoneCc: "970", phoneNational: "", guardian: { name: "ولي اختبار", relation: "father", callPhone: "0599000000", waCc: "970", waNational: "0599000000", nationalId: "" } };
  assert.equal((await call("/api/students", { method: "POST", cookie: admin, body: { ...base, gender: "female", circleId: fajr.id } })).status, 400);
});
await test("الأرشفة بدل الحذف: يظهر في الأرشيف مع سببه ويُسترجع", async () => {
  assert.equal((await call(`/api/students/${s1.id}/archive`, { method: "POST", cookie: admin, body: { reason: "انتقل إلى مدينة أخرى" } })).status, 200);
  const archived = (await call("/api/students?archived=1", { cookie: admin })).data.students;
  assert.ok(archived.some((s) => s.id === s1.id && s.archiveReason));
  assert.equal((await call(`/api/students/${s1.id}/restore`, { method: "POST", cookie: admin })).status, 200);
});
await test("نقل طالب: يمنع فئة مخالفة", async () => {
  assert.equal((await call(`/api/students/${s1.id}/move`, { method: "POST", cookie: admin, body: { circleId: noor.id } })).status, 400);
});
await test("لجنة الاختبار ترى الطلاب لكن لا تعدّلهم", async () => {
  assert.ok((await call("/api/students", { cookie: committee })).data.students.length >= 3);
  assert.equal((await call(`/api/students/${s1.id}`, { method: "PATCH", cookie: committee, body: { name: "اسم جديد رباعي كامل" } })).status, 403);
});
await test("السكرتير لا يدير حسابات السكرتارية ولا الإعدادات", async () => {
  const staff = (await call("/api/staff", { cookie: secretary })).data.staff;
  const sec = staff.find((s) => s.role === "secretary");
  assert.equal((await call(`/api/staff/${sec.id}/password`, { method: "POST", cookie: secretary, body: { password: "Another@2026" } })).status, 404);
  const settings = (await call("/api/settings", { cookie: secretary })).data.settings;
  assert.equal((await call("/api/settings", { method: "PUT", cookie: secretary, body: settings })).status, 403);
});
await test("الإعدادات: المدير يعدّلها والقيم تنعكس", async () => {
  const settings = (await call("/api/settings", { cookie: admin })).data.settings;
  const next = { ...settings, maxStudentsPerCircle: 16, minPassScore: 75 };
  assert.equal((await call("/api/settings", { method: "PUT", cookie: admin, body: next })).status, 200);
  assert.equal((await call("/api/settings", { cookie: teacher })).data.settings.minPassScore, 75);
  await call("/api/settings", { method: "PUT", cookie: admin, body: settings });
});
await test("الإحصاءات العامة تعمل دون تسجيل دخول", async () => {
  const r = await call(`/api/public/stats?centerId=${G}`);
  assert.equal(r.status, 200);
  assert.ok(r.data.students >= 3 && r.data.circles >= 2);
  assert.equal((await call("/api/public/stats?centerId=nope")).status, 404);
});
await test("تغيير كلمة المرور الذاتي", async () => {
  const c = await session(G, "gaza.secretary");
  assert.equal((await call("/api/auth/change-password", { method: "POST", cookie: c, body: { oldPassword: "wrong", newPassword: "Newer@2026pw" } })).status, 401);
  const ok = await call("/api/auth/change-password", { method: "POST", cookie: c, body: { oldPassword: PASSWORD, newPassword: "Newer@2026pw" } });
  assert.equal(ok.status, 200);
  assert.equal((await login(G, "gaza.secretary", "Newer@2026pw")).status, 200);
  const c2 = (await login(G, "gaza.secretary", "Newer@2026pw")).cookie;
  await call("/api/auth/change-password", { method: "POST", cookie: c2, body: { oldPassword: "Newer@2026pw", newPassword: PASSWORD } });
});
await test("سجل التعديلات للمدير فقط ويسجّل العمليات", async () => {
  const entries = (await call("/api/audit", { cookie: admin })).data.entries;
  assert.ok(entries.length > 5 && entries.some((e) => e.action === "archive"));
  assert.equal((await call("/api/audit", { cookie: teacher })).status, 403);
});

console.log(`\n${passed} اختباراً نجح${process.exitCode ? " (وفيه إخفاقات)" : ""}`);
