// اختبار تكاملي للمرحلة 2 (التسميع والسرد والاختبارات والكشف والدورات وبوابة الطالب).
// يتطلب: خادم التطوير يعمل + npm run db:seed:local. الاستخدام: npm run test:api (يشغّل المرحلتين).
import assert from "node:assert/strict";

const BASE = process.env.API_BASE || "http://127.0.0.1:8787";
const PASSWORD = "Demo@2026pass";
let passed = 0;

async function call(path, { method = "GET", body, cookie } = {}) {
  const res = await fetch(BASE + path, { method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
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
const committee = await session(G, "obai.committee");

const circles = (await call("/api/circles", { cookie: admin })).data.circles;
const fajr = circles.find((c) => c.name === "حلقة الفجر");
async function seedStudent(nationalId) {
  const students = (await call(`/api/students?q=${nationalId}`, { cookie: admin })).data.students;
  const student = students.find((s) => s.nationalId === nationalId);
  assert.ok(student, `الطالب التجريبي ${nationalId} غير موجود`);
  return student;
}
const s1 = await seedStudent("400000101"); // اتجاه تنازلي
const s2 = await seedStudent("400000102"); // اتجاه تصاعدي
const s3 = await seedStudent("400000103"); // حلقة أخرى

const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Hebron" });
const daysAgo = (n) => new Date(Date.now() - n * 86400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Hebron" });
const getStudent = async (id) => (await call(`/api/students/${id}`, { cookie: admin })).data.student;
const nextOf = async (id, ck) => (await call(`/api/daily/board?date=${today}`, { cookie: ck })).data.rows.find((r) => r.student.id === id).student.nextStart;

await test("التسميع اليومي: البداية تلقائية، الحساب حسب الاتجاه، ويتقدّم آخر موضع", async () => {
  const start = await nextOf(s1.id, teacher);
  assert.ok(start && start.surah >= 1);
  const ok = await call("/api/daily", { method: "POST", cookie: teacher, body: { studentId: s1.id, date: daysAgo(1), attendance: "present", from: start, to: start, grade: "ممتاز", note: "أداء جيد" } });
  assert.ok(ok.status === 200 || ok.status === 201, JSON.stringify(ok.data));
  assert.equal(ok.data.verses, 1);
  assert.ok(ok.data.pages >= 1);
  const after = await getStudent(s1.id);
  assert.deepEqual({ surah: after.lastSurah, ayah: after.lastAyah }, start);
  const bad = await call("/api/daily", { method: "POST", cookie: teacher, body: { studentId: s1.id, date: daysAgo(2), attendance: "present", from: { surah: 100, ayah: 1 }, to: { surah: 101, ayah: 1 } } });
  assert.equal(bad.status, 400, "تنازلي: 101 بعد 100 عودة إلى الوراء");
  assert.equal((await call("/api/daily", { method: "POST", cookie: teacher, body: { studentId: s1.id, date: daysAgo(3), attendance: "present", from: start, to: start, grade: "تقييم غير موجود" } })).status, 400);
});

await test("التسميع: الغياب بلا نطاق، والاتجاه التصاعدي لطالب آخر", async () => {
  const absent = await call("/api/daily", { method: "POST", cookie: teacher, body: { studentId: s1.id, date: daysAgo(4), attendance: "absent" } });
  assert.ok(absent.status === 200 || absent.status === 201);
  const start2 = await nextOf(s2.id, teacher);
  const asc = await call("/api/daily", { method: "POST", cookie: teacher, body: { studentId: s2.id, date: daysAgo(1), attendance: "present", from: start2, to: start2, grade: "جيد" } });
  assert.ok(asc.status === 200 || asc.status === 201, JSON.stringify(asc.data));
  const back = await call("/api/daily", { method: "POST", cookie: teacher, body: { studentId: s2.id, date: daysAgo(2), attendance: "present", from: { surah: 5, ayah: 1 }, to: { surah: 4, ayah: 1 } } });
  assert.equal(back.status, 400, "تصاعدي: النهاية لا تسبق البداية");
});

await test("التسميع: لا لطالب حلقة أخرى، ولا للجنة، ولا لتاريخ مستقبلي", async () => {
  assert.equal((await call("/api/daily", { method: "POST", cookie: teacher, body: { studentId: s3.id, date: today, attendance: "absent" } })).status, 404);
  assert.equal((await call("/api/daily", { method: "POST", cookie: committee, body: { studentId: s1.id, date: today, attendance: "absent" } })).status, 403);
  assert.equal((await call("/api/daily", { method: "POST", cookie: teacher, body: { studentId: s1.id, date: "2999-01-01", attendance: "absent" } })).status, 400);
});

await test("السرد: الدرجة والتقدير من إعدادات المركز", async () => {
  const r = await call("/api/sard", { method: "POST", cookie: teacher, body: { studentId: s1.id, date: today, stage: "trial", from: { surah: 114, ayah: 1 }, to: { surah: 113, ayah: 3 }, mistakes: 2, alerts: 1 } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.score, 97.5);
  assert.equal(r.data.band, "ممتاز جداً");
  assert.equal((await call("/api/sard", { method: "POST", cookie: teacher, body: { studentId: s1.id, date: today, stage: "final", from: { surah: 113, ayah: 1 }, to: { surah: 114, ayah: 1 }, mistakes: 0, alerts: 0 } })).status, 400, "نهاية قبل البداية");
  assert.equal((await call("/api/sard", { method: "POST", cookie: teacher, body: { studentId: s3.id, date: today, stage: "trial", from: { surah: 114, ayah: 1 }, to: { surah: 114, ayah: 2 }, mistakes: 0, alerts: 0 } })).status, 404);
  const list = (await call("/api/sard", { cookie: admin })).data;
  assert.ok(list.total >= 1 && list.records[0].band);
  assert.ok((await call(`/api/public/stats?centerId=${G}`)).data.sardStudents >= 1);
});

await test("إعادة الإرسال بنفس المعرّف (بعد انقطاع الشبكة) لا تكرّر السرد ولا الاختبار", async () => {
  const sardBody = { id: crypto.randomUUID(), studentId: s1.id, date: today, stage: "trial", from: { surah: 114, ayah: 1 }, to: { surah: 114, ayah: 2 }, mistakes: 0, alerts: 0 };
  const before = (await call("/api/sard", { cookie: admin })).data.total;
  assert.equal((await call("/api/sard", { method: "POST", cookie: teacher, body: sardBody })).status, 201);
  const again = await call("/api/sard", { method: "POST", cookie: teacher, body: sardBody });
  assert.equal(again.status, 200);
  assert.equal(again.data.duplicate, true);
  assert.equal((await call("/api/sard", { cookie: admin })).data.total, before + 1);
  const testBody = { id: crypto.randomUUID(), studentId: s1.id, date: today, testType: "single", parts: 2, rangeText: "", score: 80 };
  assert.equal((await call("/api/tests/trial", { method: "POST", cookie: teacher, body: testBody })).status, 201);
  assert.equal((await call("/api/tests/trial", { method: "POST", cookie: teacher, body: testBody })).data.duplicate, true);
});

await test("الاختبار التجريبي: بلا تقييد للعلامة، والنجاح من الإعدادات", async () => {
  const low = await call("/api/tests/trial", { method: "POST", cookie: teacher, body: { studentId: s1.id, date: today, testType: "single", parts: 3, rangeText: "", score: 55 } });
  assert.equal(low.status, 201);
  assert.equal(low.data.passed, false);
  const high = await call("/api/tests/trial", { method: "POST", cookie: teacher, body: { studentId: s1.id, date: today, testType: "chain", parts: 5, rangeText: "عمّ – الأحقاف", score: 96 } });
  assert.equal(high.data.passed, true);
  const ranged = await call("/api/tests/trial", { method: "POST", cookie: teacher, body: { studentId: s1.id, date: today, testType: "single", parts: 1, range: { kind: "juz", fromJuz: 2, toJuz: 4 }, score: 90 } });
  assert.equal(ranged.status, 201, JSON.stringify(ranged.data));
  const stored = (await call("/api/tests?kind=trial&pageSize=50", { cookie: teacher })).data.tests.find((t) => t.id === ranged.data.id);
  assert.equal(stored.parts, 3);
  assert.equal(stored.rangeKind, "juz");
  assert.equal(stored.rangeFromJuz, 2);
  assert.equal(stored.rangeToJuz, 4);
  assert.equal((await call("/api/tests/trial", { method: "POST", cookie: teacher, body: { studentId: s3.id, date: today, testType: "single", parts: 1, score: 90 } })).status, 404);
});

await test("الاختبار الرسمي: اقتراح المحفّظ ← اعتماد اللجنة ← نتيجة", async () => {
  const p = await call("/api/tests/propose", { method: "POST", cookie: teacher, body: { studentIds: [s1.id], testType: "chain", parts: 3, rangeText: "نطاق حر: النمل – المؤمنون" } });
  assert.equal(p.status, 201, JSON.stringify(p.data));
  assert.equal((await call("/api/tests/propose", { method: "POST", cookie: teacher, body: { studentIds: [s1.id], testType: "single", parts: 1 } })).status, 409, "اقتراح مكرر");
  assert.equal((await call("/api/tests/propose", { method: "POST", cookie: teacher, body: { studentIds: [s3.id], testType: "single", parts: 1 } })).status, 404, "طالب من حلقة أخرى");
  const proposed = (await call("/api/tests?status=proposed", { cookie: committee })).data.tests.find((t) => t.studentId === s1.id);
  assert.ok(proposed && proposed.rangeText.includes("نطاق حر"));
  assert.equal((await call(`/api/tests/${proposed.id}/approve`, { method: "POST", cookie: teacher, body: {} })).status, 403, "المعلّم لا يعتمد");
  assert.equal((await call(`/api/tests/${proposed.id}/result`, { method: "POST", cookie: committee, body: { score: 88, testDate: today } })).status, 400, "النتيجة قبل الاعتماد");
  assert.equal((await call(`/api/tests/${proposed.id}/approve`, { method: "POST", cookie: committee, body: { testDate: today } })).status, 200);
  assert.equal((await call(`/api/tests/${proposed.id}/result`, { method: "POST", cookie: committee, body: { score: 88, testDate: today } })).status, 400, "الإدخال اليدوي ممنوع");
  const started = await call(`/api/tests/${proposed.id}/session`, { method: "POST", cookie: committee });
  assert.equal(started.status, 201, JSON.stringify(started.data));
  assert.equal((await call(`/api/tests/${proposed.id}/session`, { method: "POST", cookie: committee })).data.existing, true);
  const session = (await call(`/api/tests/${proposed.id}/session`, { cookie: committee })).data;
  assert.equal(session.test.studentId, s1.id);
  assert.equal(session.questions.reduce((n, q) => n + q.maxScore, 0), 100);
  const questions = session.questions.map((q, i) => ({ id: q.id, surah: null, ayah: null, warnings: i === 0 ? 1 : 0, errors: i === 0 ? 2 : 0 }));
  assert.equal((await call(`/api/tests/${proposed.id}/session`, { method: "PUT", cookie: teacher, body: { questions } })).status, 403, "المعلم لا يقيّم");
  assert.equal((await call(`/api/tests/${proposed.id}/session`, { method: "PUT", cookie: committee, body: { questions: questions.slice(1) } })).status, 400, "كل الأسئلة مطلوبة");
  const draft = await call(`/api/tests/${proposed.id}/session`, { method: "PUT", cookie: committee, body: { questions } });
  assert.equal(draft.status, 200, JSON.stringify(draft.data));
  assert.equal((await call(`/api/tests/${proposed.id}/session`, { cookie: committee })).data.session.status, "draft");
  const done = await call(`/api/tests/${proposed.id}/session`, { method: "PUT", cookie: committee, body: { questions, finalize: true, testDate: today } });
  assert.equal(done.status, 200, JSON.stringify(done.data));
  assert.equal(done.data.totalScore, 97.5);
  assert.equal(done.data.passed, true);
  assert.equal((await call(`/api/tests/${proposed.id}/session`, { cookie: teacher })).data.session.status, "completed");
  assert.equal((await call(`/api/tests/${proposed.id}/session`, { method: "PUT", cookie: committee, body: { questions, finalize: true, testDate: today } })).status, 200, "إعادة الإرسال تعطي 200");
  assert.equal((await call(`/api/tests/${proposed.id}/session`, { method: "PUT", cookie: committee, body: { questions: questions.map(q => ({...q, errors: q.errors + 1})), finalize: true, testDate: today } })).status, 409, "تغيير البيانات بعد الإنهاء يعطي 409");
  const mine = (await call("/api/tests?kind=official", { cookie: teacher })).data;
  assert.ok(mine.tests.every((t) => t.studentId !== s3.id));
  assert.ok((await call(`/api/tests?q=${encodeURIComponent("عمّ")}`, { cookie: admin })).data.total >= 1, "بحث بنطاق الاختبار");
});

await test("رفض الاقتراح ولا يُعتمد بعد الرفض", async () => {
  assert.equal((await call("/api/tests/propose", { method: "POST", cookie: teacher, body: { studentIds: [s2.id], testType: "single", parts: 2 } })).status, 201);
  const t = (await call("/api/tests?status=proposed", { cookie: committee })).data.tests.find((x) => x.studentId === s2.id);
  assert.equal((await call(`/api/tests/${t.id}/reject`, { method: "POST", cookie: committee, body: { notes: "غير جاهز" } })).status, 200);
  assert.equal((await call(`/api/tests/${t.id}/approve`, { method: "POST", cookie: committee, body: {} })).status, 400);
});

await test("الكشف الشهري: توليد تلقائي، تعديل يدوي، وقفل يوم الفتح للمعلّم فقط", async () => {
  const month = today.slice(0, 7);
  const rep = (await call(`/api/reports?month=${month}&circleId=${fajr.id}`, { cookie: admin })).data;
  const row = rep.rows.find((r) => r.studentId === s1.id);
  assert.ok(row && row.pages >= 1 && row.start && row.end && row.percent >= 0);
  const settings = (await call("/api/settings", { cookie: admin })).data.settings;
  const day = Number(today.slice(8, 10));
  if (day < 28) {
    await call("/api/settings", { method: "PUT", cookie: admin, body: { ...settings, monthlyReportOpenDay: 28 } });
    assert.equal((await call(`/api/reports?month=${month}`, { cookie: teacher })).data.locked, true);
    assert.equal((await call("/api/reports/save", { method: "POST", cookie: teacher, body: { month, rows: [{ studentId: s1.id, end: row.end }] } })).status, 403);
    assert.equal((await call(`/api/reports?month=${month}&circleId=${fajr.id}`, { cookie: admin })).data.locked, false, "المدير بلا قيد");
    await call("/api/settings", { method: "PUT", cookie: admin, body: settings });
  }
  if (day >= settings.monthlyReportOpenDay) assert.equal((await call(`/api/reports?month=${month}`, { cookie: teacher })).data.locked, false);
  assert.equal((await call("/api/reports?month=2020-01", { cookie: teacher })).data.locked, false, "الأشهر السابقة مفتوحة");
  assert.equal((await call("/api/reports?month=2999-01", { cookie: teacher })).data.locked, true, "شهر مستقبلي");
  const save = await call("/api/reports/save", { method: "POST", cookie: admin, body: { month, rows: [{ studentId: s1.id, end: row.end }] } });
  assert.equal(save.status, 200, JSON.stringify(save.data));
  assert.equal((await call(`/api/reports?month=${month}&circleId=${fajr.id}`, { cookie: admin })).data.rows.find((r) => r.studentId === s1.id).saved, true);
  assert.equal((await call("/api/reports/save", { method: "POST", cookie: admin, body: { month, rows: [{ studentId: s1.id, end: { surah: 114, ayah: 6 } }] } })).status, 400, "نهاية قبل البداية وفق الاتجاه");
});

await test("الكشف التلقائي لا يرجع نهايته عند تسميع مراجعة أقدم في يوم لاحق", async () => {
  const stamp = Date.now().toString().slice(-8);
  const created = await call("/api/students", { method: "POST", cookie: admin, body: {
    name: "طالب اختبار مراجعة الكشف", nationalId: `8${stamp}`, birth: "2012-01-01", gender: "male", circleId: fajr.id,
    direction: "descending", lastSurah: 114, lastAyah: 0, guardianId: s1.guardianId
  } });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const studentId = created.data.id;
  try {
    const previousMonth = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 2, 10)).toISOString().slice(0, 7);
    const first = await call("/api/daily", { method: "POST", cookie: admin, body: { studentId, date: `${previousMonth}-10`, attendance: "present", from: { surah: 114, ayah: 1 }, to: { surah: 114, ayah: 6 } } });
    const review = await call("/api/daily", { method: "POST", cookie: admin, body: { studentId, date: `${previousMonth}-11`, attendance: "present", from: { surah: 114, ayah: 1 }, to: { surah: 114, ayah: 2 } } });
    assert.ok([200, 201].includes(first.status) && [200, 201].includes(review.status));
    const report = (await call(`/api/reports?month=${previousMonth}&circleId=${fajr.id}`, { cookie: admin })).data.rows.find((r) => r.studentId === studentId);
    assert.deepEqual(report.end, { surah: 114, ayah: 6 });
  } finally {
    await call(`/api/students/${studentId}/archive`, { method: "POST", cookie: admin, body: { reason: "نهاية اختبار الكشف" } });
  }
});

await test("مراجعة فقط لحافظ كامل: تظهر لولي الأمر وتُحفظ في الكشف بلا صفحات حفظ وهمية", async () => {
  const stamp = Date.now().toString().slice(-8);
  const created = await call("/api/students", { method: "POST", cookie: admin, body: {
    name: "طالب اختبار مراجعة فقط", nationalId: `7${stamp}`, birth: "2012-01-01", gender: "male", circleId: fajr.id,
    direction: "descending", lastSurah: 1, lastAyah: 7, monthlyPlanPages: 0, monthlyReviewPlanPages: 20, guardianId: s1.guardianId
  } });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const studentId = created.data.id;
  try {
    const month = today.slice(0, 7);
    const review = await call("/api/daily", { method: "POST", cookie: teacher, body: {
      studentId, date: `${month}-01`, attendance: "present", from: null, to: null,
      review: { from: { surah: 2, ayah: 1 }, to: { surah: 2, ayah: 5 }, grade: "جيد" }
    } });
    assert.equal(review.status, 201, JSON.stringify(review.data));
    assert.ok(review.data.reviewPages > 0);
    const board = (await call(`/api/daily/board?circleId=${fajr.id}&date=${month}-02`, { cookie: teacher })).data;
    assert.deepEqual(board.rows.find((r) => r.student.id === studentId).student.reviewNext, { surah: 2, ayah: 6 });
    const before = (await call(`/api/reports?month=${month}&circleId=${fajr.id}`, { cookie: admin })).data.rows.find((r) => r.studentId === studentId);
    assert.equal(before.pages, 0);
    assert.equal(before.reviewPages, review.data.reviewPages);
    assert.equal(before.reviewDays, 1);
    const saved = await call("/api/reports/save", { method: "POST", cookie: admin, body: { month, rows: [{ studentId, end: null }] } });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    const after = (await call(`/api/reports?month=${month}&circleId=${fajr.id}`, { cookie: admin })).data.rows.find((r) => r.studentId === studentId);
    assert.equal(after.saved, true);
    assert.equal(after.pages, 0);
    assert.equal(after.reviewPages, review.data.reviewPages);
    const wali = await session(G, "801000001", "801000001");
    const portal = (await call(`/api/portal/summary?studentId=${studentId}`, { cookie: wali })).data;
    assert.deepEqual(portal.student.reviewLast, { surah: 2, ayah: 5 });
    assert.equal(portal.month.reviewPages, review.data.reviewPages);
    assert.equal(portal.reports.find((r) => r.month === month).pages, 0);
  } finally {
    await call(`/api/students/${studentId}/archive`, { method: "POST", cookie: admin, body: { reason: "نهاية اختبار المراجعة" } });
  }
});

await test("دورات الأحكام: المدير يديرها والزائر يرى عددها", async () => {
  const c = await call("/api/courses", { method: "POST", cookie: admin, body: { name: "دورة تأهيلية تجريبية", startsOn: today, endsOn: null, status: "active", studentIds: [s1.id, s2.id] } });
  assert.equal(c.status, 201, JSON.stringify(c.data));
  assert.equal((await call("/api/courses", { method: "POST", cookie: teacher, body: { name: "دورة", status: "active", studentIds: [] } })).status, 403);
  assert.ok((await call(`/api/public/stats?centerId=${G}`)).data.activeCourses >= 1);
  const detail = (await call(`/api/courses/${c.data.id}`, { cookie: teacher })).data;
  assert.equal(detail.students.length, 2, "المعلّم يرى طلاب حلقته في الدورة");
  assert.equal((await call(`/api/courses/${c.data.id}`, { method: "PUT", cookie: admin, body: { name: "دورة تأهيلية تجريبية", startsOn: today, endsOn: today, status: "ended", studentIds: [s1.id] } })).status, 200);
  assert.equal((await call(`/api/courses/${c.data.id}`, { method: "DELETE", cookie: admin })).status, 200);
});

await test("بوابة ولي الأمر: يرى ملف ابنه فقط", async () => {
  const wali = await session(G, "801000001", "801000001");
  const p = (await call(`/api/portal/summary?studentId=${s1.id}`, { cookie: wali })).data;
  assert.ok(p.student.name.includes("عمر"));
  assert.ok(p.daily.length >= 1 && p.sard.length >= 1);
  assert.ok(p.tests.every((t) => ["approved", "completed"].includes(t.status)));
  assert.ok(p.month.month === today.slice(0, 7) && typeof p.month.percent === "number");
  assert.equal((await call("/api/portal/summary", { cookie: teacher })).status, 403);
  assert.equal((await call(`/api/daily?studentId=${s1.id}`, { cookie: wali })).status, 403);
  assert.equal((await call(`/api/portal/summary?studentId=${s3.id}`, { cookie: wali })).status, 404);
});

console.log(`\n${passed} اختباراً نجح (المرحلة 2)${process.exitCode ? " — وفيه إخفاقات" : ""}`);
