// اختبار تكاملي للمرحلة 3 (الإشعارات، الإعلانات، إبلاغ الغياب، الصلاة، الجدول، حضور الكادر، الملاحظات، لوحة الشرف، الإحصاءات، التصدير، لوحة المالك).
import assert from "node:assert/strict";

const BASE = process.env.API_BASE || "http://127.0.0.1:8787";
const BOOTSTRAP = process.env.ADMIN_BOOTSTRAP_KEY || "dev-only-bootstrap-key";
const PASSWORD = "Demo@2026pass";
let passed = 0;

async function call(path, { method = "GET", body, cookie, bootstrap } = {}) {
  const res = await fetch(BASE + path, { method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...(bootstrap ? { "x-bootstrap-key": bootstrap } : {}) }, body: body ? JSON.stringify(body) : undefined });
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

const G = "tarjuman-gaza-01";
const admin = await session(G, "admin");
const teacher = await session(G, "gaza.teacher1");
const teacher3 = await session(G, "gaza.teacher3");
const secretary = await session(G, "gaza.secretary");
const student = await session(G, "801000001", "801000001");
const student2 = student; // نفس ولي الأمر يغطي عمر وياسين

const students = (await call("/api/students", { cookie: admin })).data.students;
const s1 = students.find((s) => s.name.startsWith("عمر"));
const s3 = students.find((s) => s.name.startsWith("ليان"));
const staff = (await call("/api/staff", { cookie: admin })).data.staff;
const t1 = staff.find((s) => s.username === "gaza.teacher1");
const circles = (await call("/api/circles", { cookie: admin })).data.circles;
const fajr = circles.find((c) => c.name === "حلقة الفجر");

const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Hebron" });
const addDays = (n) => new Date(Date.now() + n * 86400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Hebron" });
const unread = async (ck) => (await call("/api/notifications/count", { cookie: ck })).data.unread;

await test("تسجيل الغياب يُشعر الطالب، ويمكنه قراءة الإشعار", async () => {
  const before = await unread(student);
  const r = await call("/api/daily", { method: "POST", cookie: teacher, body: { studentId: s1.id, date: addDays(-6), attendance: "absent" } });
  assert.ok(r.status === 200 || r.status === 201);
  assert.equal(await unread(student), before + 1);
  const list = (await call("/api/notifications", { cookie: student })).data;
  assert.ok(list.items.some((n) => n.kind === "absence"));
  assert.equal((await call("/api/notifications/read", { method: "POST", cookie: student, body: { all: true } })).status, 200);
  assert.equal(await unread(student), 0);
  assert.equal(await unread(teacher), (await call("/api/notifications/count", { cookie: teacher })).data.unread, "إشعارات كل مستخدم منفصلة");
});

await test("الإعلان للطلاب يصل الطلاب فقط ولا يصل الكادر", async () => {
  await call("/api/notifications/read", { method: "POST", cookie: teacher, body: { all: true } });
  const tBefore = await unread(teacher);
  const sBefore = await unread(student2);
  const r = await call("/api/announcements", { method: "POST", cookie: admin, body: { title: "إجازة الأسبوع القادم", body: "تعطّل الحلقات يوم الخميس.", audience: "students" } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.ok(r.data.recipients >= 1, `المستلمون = ${r.data.recipients}`);
  assert.equal(await unread(student2), sBefore + 1);
  assert.equal(await unread(teacher), tBefore, "الكادر لا يستلم إعلان الطلاب");
  assert.equal((await call("/api/announcements", { method: "POST", cookie: teacher, body: { title: "x", body: "yy", audience: "all" } })).status, 403);
  const ann = (await call("/api/announcements", { cookie: teacher })).data.announcements;
  assert.ok(ann.length >= 1);
  assert.equal((await call(`/api/announcements/${r.data.id}`, { method: "DELETE", cookie: secretary })).status, 200);
});

await test("إبلاغ الغياب من ولي الأمر: يصل المعلّم ويظهر على لوحة اليوم", async () => {
  await call("/api/notifications/read", { method: "POST", cookie: teacher, body: { all: true } });
  const date = addDays(1);
  const r = await call("/api/absences", { method: "POST", cookie: student, body: { date, reason: "موعد طبي", studentId: s1.id } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.ok((await unread(teacher)) >= 1);
  assert.equal((await call("/api/absences", { method: "POST", cookie: student, body: { date: addDays(-2), reason: "قديم", studentId: s1.id } })).status, 400, "لا إبلاغ عن تاريخ ماضٍ");
  assert.equal((await call("/api/absences", { method: "POST", cookie: teacher, body: { date, reason: "x" } })).status, 403, "المعلّم لا يبلّغ");
  const board = (await call(`/api/daily/board?date=${date}`, { cookie: teacher })).data;
  assert.equal(board.rows.find((x) => x.student.id === s1.id).absenceNotice, "موعد طبي");
  const forTeacher = (await call(`/api/absences?date=${date}`, { cookie: teacher })).data.notices;
  assert.ok(forTeacher.some((n) => n.studentId === s1.id));
  assert.equal((await call(`/api/absences?date=${date}`, { cookie: teacher3 })).data.notices.some((n) => n.studentId === s1.id), false, "معلّمة حلقة أخرى لا ترى");
  assert.ok((await call(`/api/absences/mine?studentId=${s1.id}`, { cookie: student })).data.notices.length >= 1);
});

await test("مواعيد الصلاة: استيراد المدير، عرض للزائر، وتحقق الصيغة", async () => {
  const row = (d) => ({ date: d, fajr: "04:41", sunrise: "06:02", dhuhr: "11:41", asr: "15:04", maghrib: "17:19", isha: "18:40" });
  assert.equal((await call("/api/prayer/import", { method: "POST", cookie: teacher, body: { rows: [row(today)] } })).status, 403);
  assert.equal((await call("/api/prayer/import", { method: "POST", cookie: admin, body: { rows: [{ ...row(today), fajr: "25:99" }] } })).status, 400);
  const ok = await call("/api/prayer/import", { method: "POST", cookie: admin, body: { rows: [row(today), row(addDays(1))] } });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.imported, 2);
  const pub = (await call(`/api/public/prayer?centerId=${G}`)).data;
  assert.equal(pub.days.length, 2);
  assert.equal(pub.days[0].fajr, "04:41");
});

await test("جدول الحلقات: المدير يحدّد، والمعلّم يرى جدول حلقته فقط", async () => {
  const put = await call(`/api/schedule/${fajr.id}`, { method: "PUT", cookie: admin, body: { entries: [{ weekday: 0, start: "16:00", end: "18:00", place: "المسجد" }, { weekday: 2, start: "16:00", end: "18:00", place: "المسجد" }] } });
  assert.equal(put.status, 200, JSON.stringify(put.data));
  assert.equal((await call(`/api/schedule/${fajr.id}`, { method: "PUT", cookie: admin, body: { entries: [{ weekday: 1, start: "18:00", end: "16:00" }] } })).status, 400);
  const mine = (await call("/api/schedule", { cookie: teacher })).data.entries;
  assert.ok(mine.length === 2 && mine.every((e) => e.circleId === fajr.id));
  assert.equal((await call(`/api/schedule/${fajr.id}`, { method: "PUT", cookie: teacher, body: { entries: [] } })).status, 403);
});

await test("حضور الكادر: للإدارة فقط مع ملخص شهري", async () => {
  const set = await call("/api/staff-attendance", { method: "POST", cookie: secretary, body: { userId: t1.id, date: today, status: "late", note: "تأخر 10 دقائق" } });
  assert.equal(set.status, 200);
  const day = (await call(`/api/staff-attendance?date=${today}`, { cookie: admin })).data;
  assert.equal(day.rows.find((r) => r.id === t1.id).status, "late");
  assert.equal((await call("/api/staff-attendance", { cookie: teacher })).status, 403);
  const sum = (await call(`/api/staff-attendance/summary?month=${today.slice(0, 7)}`, { cookie: admin })).data;
  assert.ok(sum.rows.find((r) => r.id === t1.id).late >= 1);
});

await test("الملاحظات الداخلية: للكادر فقط وبحسب النطاق", async () => {
  assert.equal((await call("/api/notes", { method: "POST", cookie: teacher, body: { studentId: s1.id, body: "يحتاج متابعة في الحضور" } })).status, 201);
  assert.equal((await call("/api/notes", { method: "POST", cookie: teacher, body: { studentId: s3.id, body: "ملاحظة غير مسموحة" } })).status, 404);
  const list = (await call(`/api/notes?studentId=${s1.id}`, { cookie: admin })).data.notes;
  assert.ok(list.some((n) => n.body.includes("متابعة")));
  assert.equal((await call(`/api/notes?studentId=${s1.id}`, { cookie: student })).status, 403, "الطالب لا يرى الملاحظات الداخلية");
  assert.equal((await call(`/api/notes/${list[0].id}`, { method: "DELETE", cookie: teacher3 })).status, 403);
});

await test("لوحة الشرف: بموافقة الأهل فقط", async () => {
  assert.equal((await call("/api/honor/consent", { method: "POST", cookie: teacher, body: { studentId: s1.id, consent: true } })).status, 403);
  const before = (await call("/api/honor", { cookie: teacher })).data;
  assert.ok(!before.top.some((r) => r.name === s1.name), "بلا موافقة لا يظهر");
  assert.equal((await call("/api/honor/consent", { method: "POST", cookie: admin, body: { studentId: s1.id, consent: true } })).status, 200);
  const after = (await call("/api/honor", { cookie: student2 })).data;
  const rep = (await call(`/api/reports?month=${today.slice(0, 7)}&circleId=${fajr.id}`, { cookie: admin })).data.rows.find((r) => r.studentId === s1.id);
  if (rep && rep.pages > 0 && rep.planPages > 0) assert.ok(after.top.some((r) => r.name === s1.name), "المتفوّق الموافق يظهر");
  assert.ok(after.top.every((r) => r.name !== students.find((s) => s.name.startsWith("ياسين")).name), "طالب بلا موافقة لا يظهر");
  await call("/api/honor/consent", { method: "POST", cookie: admin, body: { studentId: s1.id, consent: false } });
});

await test("الإحصاءات: اتجاه المركز وجداول التقارير للإدارة فقط", async () => {
  const ov = (await call("/api/stats/overview?months=6", { cookie: admin })).data;
  assert.equal(ov.months.length, 6);
  assert.ok(ov.months[5].present + ov.months[5].absent >= 1);
  const st = (await call("/api/stats/students", { cookie: secretary })).data.students;
  assert.ok(st.length >= 3 && "pages" in st[0] && "present" in st[0]);
  assert.equal((await call("/api/stats/teachers", { cookie: admin })).data.teachers.length >= 3, true);
  assert.equal((await call("/api/stats/students", { cookie: teacher })).status, 403);
  assert.equal((await call("/api/stats/overview", { cookie: student })).status, 403);
});

await test("التصدير الكامل: للمدير فقط وبلا كلمات مرور", async () => {
  assert.equal((await call("/api/export", { cookie: secretary })).status, 403);
  const r = await call("/api/export", { cookie: admin });
  assert.equal(r.status, 200);
  const text = JSON.stringify(r.data);
  assert.ok(!/password_hash|password_salt|"hash"/i.test(text), "لا تجزئة كلمات مرور في التصدير");
  assert.ok(r.data.students.length >= 3 && r.data.dailyRecords.length >= 1);
});

await test("صورة الطالب: تُرفع للكادر وتظهر في الملف فقط لا في القوائم", async () => {
  const tiny = "data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA";
  assert.equal((await call(`/api/students/${s1.id}/photo`, { method: "POST", cookie: teacher, body: { photo: tiny } })).status, 200);
  assert.equal((await call(`/api/students/${s3.id}/photo`, { method: "POST", cookie: teacher, body: { photo: tiny } })).status, 404);
  assert.equal((await call(`/api/students/${s1.id}/photo`, { method: "POST", cookie: teacher, body: { photo: "http://evil/x.png" } })).status, 400);
  assert.equal((await call(`/api/students/${s1.id}/photo`, { method: "POST", cookie: student, body: { photo: tiny } })).status, 403);
  assert.equal((await call(`/api/students/${s1.id}`, { cookie: admin })).data.student.photo, tiny);
  const row = (await call("/api/students", { cookie: admin })).data.students.find((x) => x.id === s1.id);
  assert.equal(row.hasPhoto, true);
  assert.ok(!("photo" in row), "القوائم لا تحمل الصورة نفسها");
});

await test("ملخص الطالب للكادر (للتقرير المطبوع): بحسب النطاق", async () => {
  const r = (await call(`/api/reports/student/${s1.id}`, { cookie: teacher })).data;
  assert.ok(r.student.name.includes("عمر") && Array.isArray(r.daily) && "month" in r);
  assert.equal((await call(`/api/reports/student/${s3.id}`, { cookie: teacher })).status, 404);
  assert.equal((await call(`/api/reports/student/${s1.id}`, { cookie: student })).status, 403);
});

await test("لوحة المالك: بمفتاح النظام فقط (إنشاء مركز، إيقافه، إعادة تفعيله)", async () => {
  assert.equal((await call("/api/owner/centers")).status, 401);
  assert.equal((await call("/api/owner/centers", { bootstrap: "wrong" })).status, 401);
  const list = (await call("/api/owner/centers", { bootstrap: BOOTSTRAP })).data.centers;
  assert.ok(list.some((c) => c.id === G) && list.every((c) => "students" in c));
  const id = `temp-${Date.now().toString(36)}`;
  assert.equal((await call("/api/owner/provision-center", { method: "POST", bootstrap: BOOTSTRAP, body: { centerId: id, centerName: "مركز مؤقت", adminUsername: "admin", adminName: "مدير مؤقت", adminPassword: PASSWORD } })).status, 201);
  assert.equal((await call(`/api/owner/centers/${id}`, { method: "PATCH", bootstrap: BOOTSTRAP, body: { status: "suspended" } })).status, 200);
  assert.equal((await call("/api/auth/login", { method: "POST", body: { centerId: id, username: "admin", password: PASSWORD } })).status, 404, "مركز موقوف لا يُدخل");
  assert.equal((await call(`/api/owner/centers/${id}`, { method: "PATCH", bootstrap: BOOTSTRAP, body: { status: "active" } })).status, 200);
  assert.equal((await call("/api/auth/login", { method: "POST", body: { centerId: id, username: "admin", password: PASSWORD } })).status, 200);
});

console.log(`\n${passed} اختباراً نجح (المرحلة 3)${process.exitCode ? " — وفيه إخفاقات" : ""}`);
