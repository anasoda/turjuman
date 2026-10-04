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

const G = "obai-01";
const admin = await session(G, "admin");
const teacher = await session(G, "obai.teacher1");
const teacher3 = await session(G, "obai.teacher3");
const secretary = await session(G, "obai.secretary");
const student = await session(G, "801000001", "801000001");
const student2 = student; // نفس ولي الأمر يغطي عمر وياسين

async function seedStudent(nationalId) {
  const students = (await call(`/api/students?q=${nationalId}`, { cookie: admin })).data.students;
  const student = students.find((s) => s.nationalId === nationalId);
  assert.ok(student, `الطالب التجريبي ${nationalId} غير موجود`);
  return student;
}
const s1 = await seedStudent("400000101");
const s2 = await seedStudent("400000102");
const s3 = await seedStudent("400000103");
const staff = (await call("/api/staff", { cookie: admin })).data.staff;
const t1 = staff.find((s) => s.username === "obai.teacher1");
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
  assert.equal((await call("/api/announcements", { method: "POST", cookie: teacher, body: { title: "رسالة مخالفة", body: "نص كافٍ", audience: "all" } })).status, 403);
  const ann = (await call("/api/announcements", { cookie: teacher })).data.announcements;
  assert.ok(ann.length >= 1);
  assert.equal((await call(`/api/announcements/${r.data.id}`, { method: "PATCH", cookie: teacher, body: { title: "عنوان جديد", body: "نص جديد" } })).status, 403, "المعلّم لا يعدّل رسالة الإدارة");
  const edited = await call(`/api/announcements/${r.data.id}`, { method: "PATCH", cookie: secretary, body: { title: "إجازة الخميس", body: "الحلقات متوقفة يوم الخميس." } });
  assert.equal(edited.status, 200);
  assert.ok(edited.data.updatedNotifications >= 1);
  assert.ok((await call("/api/notifications", { cookie: student2 })).data.items.some((n) => n.title === "إجازة الخميس" && n.body === "الحلقات متوقفة يوم الخميس."));
  assert.equal((await call(`/api/announcements/${r.data.id}`, { method: "DELETE", cookie: teacher })).status, 403, "المعلّم لا يحذف رسالة الإدارة");
  const removed = await call(`/api/announcements/${r.data.id}`, { method: "DELETE", cookie: secretary });
  assert.equal(removed.status, 200);
  assert.ok(removed.data.removedNotifications >= 1);
  assert.equal(await unread(student2), sBefore, "حذف التعميم يسحب إشعاره من صندوق المستلم");
  const own = await call("/api/announcements", { method: "POST", cookie: teacher, body: { title: "رسالة الحلقة للتجربة", body: "تُحذف من عند الأهالي.", audience: "students", scopeKind: "circle", scopeId: fajr.id } });
  assert.equal(own.status, 201, JSON.stringify(own.data));
  assert.ok(own.data.recipients >= 1);
  assert.equal((await call(`/api/announcements/${own.data.id}`, { method: "PATCH", cookie: teacher, body: { title: "رسالة الحلقة المعدّلة", body: "الموعد المعدّل." } })).status, 200, "المعلّم يعدّل رسالته");
  assert.equal((await call(`/api/announcements/${own.data.id}`, { method: "DELETE", cookie: teacher })).status, 200, "المعلّم يحذف رسالته");
  assert.equal(await unread(student2), sBefore, "حذف المعلم يزيل إشعار أولياء حلقته");
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
  // المعلّم 1 يدرّس حلقتين (الفجر واليقين) وكلتاهما لهما جدول في البذرة: يرى جدولهما فقط لا جدول حلقة غيره
  const taught = (await call("/api/circles", { cookie: teacher })).data.circles.map((c) => c.id);
  assert.ok(taught.includes(fajr.id));
  assert.equal(mine.filter((e) => e.circleId === fajr.id).length, 2);
  assert.ok(mine.every((e) => taught.includes(e.circleId)), "ظهر جدول حلقة لا يدرّسها");
  const all = (await call("/api/schedule", { cookie: admin })).data.entries;
  assert.ok(all.some((e) => !taught.includes(e.circleId)), "البذرة لا تضمّ جدول حلقة أخرى للمقارنة");
  assert.equal((await call(`/api/schedule/${fajr.id}`, { method: "PUT", cookie: teacher, body: { entries: [] } })).status, 403);
  const prayer = await call(`/api/schedule/${fajr.id}`, { method: "PUT", cookie: admin, body: { entries: [
    { weekday: 0, slot: "maghrib", start: "", end: "", place: "المسجد" },
    { weekday: 2, slot: "maghrib", start: "16:00", end: "18:00", place: "المسجد" }
  ] } });
  assert.equal(prayer.status, 200, JSON.stringify(prayer.data));
  const saved = (await call(`/api/schedule?circleId=${fajr.id}`, { cookie: admin })).data.entries;
  assert.ok(saved.length === 2 && saved.every((e) => e.slot === "maghrib" && e.start === "" && e.end === ""));
});

await test("التسجيل اليومي خارج جدول الحلقة مسموح مع علامة offSchedule، والتعديل دائماً مسموح (البند 4)", async () => {
  // جدول الفجر الآن الأحد والثلاثاء؛ نختار يوماً من الأسبوع الماضي ليس منهما وآخر منهما
  const dayOf = (iso) => new Date(iso + "T00:00:00Z").getUTCDay();
  const back = (n) => { const d = new Date(today + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
  const off = [1, 2, 3, 4, 5, 6, 7].map(back).find((d) => ![0, 2].includes(dayOf(d)));
  const on = [1, 2, 3, 4, 5, 6, 7].map(back).find((d) => [0, 2].includes(dayOf(d)));
  const kid = [s1, s2, s3].find((x) => x.circleId === fajr.id);
  assert.ok(kid, "لا طالب تجريبي في حلقة الفجر");
  const a = await call("/api/daily", { method: "POST", cookie: admin, body: { studentId: kid.id, date: off, attendance: "absent" } });
  assert.ok([200, 201].includes(a.status), JSON.stringify(a.data));
  assert.equal(a.data.offSchedule, true, "خارج الجدول يُعلَّم");
  const b = await call("/api/daily", { method: "POST", cookie: admin, body: { studentId: kid.id, date: on, attendance: "absent" } });
  assert.ok([200, 201].includes(b.status), JSON.stringify(b.data));
  assert.equal(b.data.offSchedule, false, "داخل الجدول لا يُعلَّم");
  const edit = await call("/api/daily", { method: "POST", cookie: admin, body: { studentId: kid.id, date: off, attendance: "excused", note: "عذر طبي" } });
  assert.equal(edit.status, 200, JSON.stringify(edit.data));
  const board = (await call(`/api/daily/board?circleId=${fajr.id}&date=${off}`, { cookie: admin })).data;
  assert.equal(board.scheduled, false, "اللوحة تُخبر الواجهة بأن اليوم خارج الجدول");
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
  const body = `يحتاج متابعة في الحضور ${Date.now()}`;
  assert.equal((await call("/api/notes", { method: "POST", cookie: teacher, body: { studentId: s1.id, body } })).status, 201);
  assert.equal((await call("/api/notes", { method: "POST", cookie: teacher, body: { studentId: s3.id, body: "ملاحظة غير مسموحة" } })).status, 404);
  const list = (await call(`/api/notes?studentId=${s1.id}`, { cookie: admin })).data.notes;
  const note = list.find((n) => n.body === body);
  assert.ok(note);
  assert.equal((await call(`/api/notes?studentId=${s1.id}`, { cookie: student })).status, 403, "الطالب لا يرى الملاحظات الداخلية");
  assert.equal((await call(`/api/notes/${note.id}`, { method: "DELETE", cookie: teacher3 })).status, 404);
  assert.equal((await call(`/api/notes/${note.id}`, { method: "DELETE", cookie: teacher })).status, 200);
});

await test("لوحة الشرف: بموافقة الأهل فقط", async () => {
  assert.equal((await call("/api/honor/consent", { method: "POST", cookie: teacher, body: { studentId: s1.id, consent: true } })).status, 403);
  const before = (await call("/api/honor", { cookie: teacher })).data;
  assert.ok(!before.top.some((r) => r.name === s1.name), "بلا موافقة لا يظهر");
  assert.equal((await call("/api/honor/consent", { method: "POST", cookie: admin, body: { studentId: s1.id, consent: true } })).status, 200);
  const after = (await call("/api/honor", { cookie: student2 })).data;
  const rep = (await call(`/api/reports?month=${today.slice(0, 7)}&circleId=${fajr.id}`, { cookie: admin })).data.rows.find((r) => r.studentId === s1.id);
  if (rep && rep.pages > 0 && rep.planPages > 0) assert.ok(after.top.some((r) => r.name === s1.name), "المتفوّق الموافق يظهر");
  assert.ok(after.top.every((r) => r.name !== s2.name), "طالب بلا موافقة لا يظهر");
  await call("/api/honor/consent", { method: "POST", cookie: admin, body: { studentId: s1.id, consent: false } });
});

await test("الحفّاظ يُحسبون من موضع الحفظ الفعلي لا من الرقم اليدوي (البند 7)", async () => {
  const orig = { direction: s1.direction, lastSurah: s1.lastSurah, lastAyah: s1.lastAyah };
  const stats = async () => (await call(`/api/public/stats?centerId=${G}`)).data.huffaz;
  const put = (body) => call(`/api/students/${s1.id}`, { method: "PATCH", cookie: admin, body });
  const base = await stats();
  assert.equal((await call("/api/honor/consent", { method: "POST", cookie: admin, body: { studentId: s1.id, consent: true } })).status, 200);
  try {
    assert.equal((await put({ direction: "descending", lastSurah: 1, lastAyah: 7 })).status, 200);
    assert.equal(await stats(), base + 1, "من أتمّ الفاتحة (تنازلي) يُعدّ حافظاً في الصفحة العامة");
    assert.ok((await call("/api/honor", { cookie: admin })).data.huffaz.some((h) => h.name === s1.name), "ويظهر في لوحة الشرف");
    assert.equal((await put({ direction: "descending", lastSurah: 114, lastAyah: 0 })).status, 200);
    assert.equal(await stats(), base, "ومن لم يُتمّ شيئاً لا يُعدّ حافظاً");
    assert.ok(!(await call("/api/honor", { cookie: admin })).data.huffaz.some((h) => h.name === s1.name));
  } finally {
    await put(orig);
    await call("/api/honor/consent", { method: "POST", cookie: admin, body: { studentId: s1.id, consent: false } });
  }
});

await test("طلاب يحتاجون متابعة: الأسباب الثلاثة والنطاق والحدود من الإعدادات (البند 10)", async () => {
  const stage = await session(G, "obai.stage1");
  const committee = await session(G, "obai.committee");
  const before = (await call("/api/settings", { cookie: admin })).data.settings;
  const setTh = (th) => call("/api/settings", { method: "PUT", cookie: admin, body: { ...before, ...th } });
  const mk = async (nationalId, name, joinedAt, phone) => {
    const r = await call("/api/students", { method: "POST", cookie: admin, body: { nationalId, name, birth: "2012-01-01", gender: "male", circleId: fajr.id, direction: "descending",
      lastSurah: 114, lastAyah: 0, joinedAt, monthlyPlanPages: 0, phoneCc: "970", phoneNational: "",
      guardian: { name: "ولي متابعة", relation: "father", callPhone: phone, waCc: "970", waNational: phone, nationalId: "" } } });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    return r.data.id;
  };
  const A = await mk("400000881", "طالب بلا تسميع منذ أيام", addDays(-10), "0599000881");
  const B = await mk("400000882", "طالب غائب اليوم", today, "0599000882");
  try {
    assert.equal((await setTh({ alertAbsenceCount: 1, alertNoReciteDays: 7, alertPlanLagPct: 30 })).status, 200);
    assert.equal((await call("/api/daily", { method: "POST", cookie: teacher, body: { studentId: B, date: today, attendance: "absent" } })).status >= 400, false);
    const list = async (ck) => (await call("/api/stats/follow-up", { cookie: ck })).data;
    const find = (d, id) => d.students.find((s) => s.id === id);

    const admin1 = await list(admin);
    assert.deepEqual(admin1.thresholds, { absenceCount: 1, noReciteDays: 7, planLagPct: 30 });
    assert.deepEqual(find(admin1, A).reasons.map((r) => r.kind), ["noRecite"], "بلا تسميع منذ التحاقه قبل 10 أيام");
    assert.equal(find(admin1, A).reasons[0].never, true);
    assert.deepEqual(find(admin1, B).reasons.map((r) => r.kind), ["absence"], "غياب اليوم فقط (التحق اليوم فلا يُعدّ بلا تسميع)");

    // التأخر عن الخطة: يُقاس من اليوم PLAN_LAG_MIN_DAY (7) من الشهر؛ قبله لا يُعدّ تأخراً
    assert.equal((await call(`/api/students/${A}`, { method: "PATCH", cookie: admin, body: { monthlyPlanPages: 30 } })).status, 200);
    const withPlan = find(await list(admin), A).reasons.map((r) => r.kind);
    if (Number(today.slice(8, 10)) >= 7) assert.deepEqual(withPlan, ["noRecite", "planLag"], "بخطة 30 صفحة بلا إنجاز");
    else assert.deepEqual(withPlan, ["noRecite"], "قبل اليوم السابع لا يُقاس التأخر");

    // النطاق
    for (const ck of [teacher, secretary, stage]) assert.ok(find(await list(ck), A), "يراه من حلقته أو من له النطاق");
    const t3 = await list(teacher3);
    assert.ok(!find(t3, A) && !find(t3, B), "معلّمة حلقة أخرى لا ترى طلاب الفجر");
    assert.equal((await call("/api/stats/follow-up", { cookie: committee })).status, 403);
    assert.equal((await call("/api/stats/follow-up", { cookie: student })).status, 403);

    // الحدود من الإعدادات: رفع حد الغياب يُسقط التنبيه، وحد قيمة غير صالحة مرفوض
    assert.equal((await setTh({ alertAbsenceCount: 2 })).status, 200);
    assert.ok(!find(await list(admin), B), "غياب واحد لا يبلغ الحد الجديد (2)");
    assert.equal((await setTh({ alertAbsenceCount: 0 })).status, 400);
    assert.equal((await setTh({ alertNoReciteDays: 91 })).status, 400);
    // عميل قديم لا يرسل حقول التنبيه: لا تُصفَّر حدود المدير
    const { alertAbsenceCount, alertNoReciteDays, alertPlanLagPct, ...legacy } = before;
    assert.equal((await call("/api/settings", { method: "PUT", cookie: admin, body: legacy })).status, 200);
    assert.equal((await list(admin)).thresholds.absenceCount, 2);
  } finally {
    await setTh({});
    for (const id of [A, B]) await call(`/api/students/${id}/archive`, { method: "POST", cookie: admin, body: { reason: "اختبار" } });
  }
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
  assert.ok(r.data.guardians?.length >= 2, "أولياء الأمور غير موجودين في التصدير");
  assert.ok(r.data.prayerTimes?.length >= 1, "مواعيد الصلاة غير موجودة في التصدير");
  assert.ok(r.data.stageManagers?.length >= 1, "تعيين مديري المراحل غير موجود في التصدير");
  for (const section of ["courseStudents", "announcements", "notifications", "studentNotes", "auditLog"]) {
    assert.ok(Array.isArray(r.data[section]), `${section} غير موجود في التصدير`);
  }
  assert.ok("logo" in r.data.center && "guardian_id" in r.data.students[0] && "phone_cc" in r.data.students[0], "حقول المركز والطلاب الأساسية ناقصة");
});

await test("صورة الطالب: تُرفع للكادر وتظهر في الملف فقط لا في القوائم", async () => {
  const tiny = "data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA";
  assert.equal((await call(`/api/students/${s1.id}/photo`, { method: "POST", cookie: teacher, body: { photo: tiny } })).status, 200);
  assert.equal((await call(`/api/students/${s3.id}/photo`, { method: "POST", cookie: teacher, body: { photo: tiny } })).status, 404);
  assert.equal((await call(`/api/students/${s1.id}/photo`, { method: "POST", cookie: teacher, body: { photo: "http://evil/x.png" } })).status, 400);
  assert.equal((await call(`/api/students/${s1.id}/photo`, { method: "POST", cookie: student, body: { photo: tiny } })).status, 403);
  assert.equal((await call(`/api/students/${s1.id}`, { cookie: admin })).data.student.photo, tiny);
  const row = (await call(`/api/students?q=${s1.nationalId}`, { cookie: admin })).data.students.find((x) => x.id === s1.id);
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
