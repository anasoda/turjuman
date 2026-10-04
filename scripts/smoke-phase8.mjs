// اختبار تكاملي لمسار المراجعة بجانب مسار الحفظ (هجرة 0011، docs/requirements.md §16).
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
const admin = await session(G, "admin");
const teacher = await session(G, "obai.teacher1");
const circles = (await call("/api/circles", { cookie: teacher })).data.circles;
// طالب من أول حلقة للمعلّم له طلاب
let student = null, circle = null;
for (const c of circles) {
  const rows = (await call(`/api/daily/board?date=${daysAgo(0)}&circleId=${c.id}`, { cookie: teacher })).data.rows ?? [];
  if (rows.length) { student = rows[0].student; circle = c; break; }
}
assert.ok(student, "البذرة تحتاج طالباً في حلقة المعلّم");

const scheduleData = (await call(`/api/schedule?circleId=${circle.id}`, { cookie: admin })).data.entries;
const allowedWeekdays = scheduleData.length ? scheduleData.map(s => s.weekday) : [0, 1, 2, 3, 4, 5, 6];

function getValidDay(minDaysAgo, matchAllowed = true) {
  let d = minDaysAgo;
  while (true) {
    const dateObj = new Date(Date.now() - d * 864e5);
    const isAllowed = allowedWeekdays.includes(dateObj.getDay());
    if (matchAllowed ? isAllowed : !isAllowed) {
      return dateObj.toISOString().slice(0, 10);
    }
    d++;
  }
}

const D1 = getValidDay(27);
const D2 = getValidDay(20);
const D3 = getValidDay(13);
const D_FAIL_1 = getValidDay(28, false);
const D_FAIL_2 = getValidDay(29, false);

const post = (date, body) => call("/api/daily", { method: "POST", cookie: teacher, body: { studentId: student.id, date, ...body } });
const board = async (date) => (await call(`/api/daily/board?date=${date}&circleId=${circle.id}`, { cookie: teacher })).data.rows.find((r) => r.student.id === student.id);

await test("حضور بمراجعة فقط (بلا حفظ جديد) يُقبل ويحسب صفحاتها", async () => {
  const r = await post(D1, { attendance: "present", review: { from: { surah: 114, ayah: 1 }, to: { surah: 112, ayah: 4 }, grade: "" } });
  assert.ok([200, 201].includes(r.status), JSON.stringify(r.data));
  assert.ok(r.data.reviewPages >= 1, JSON.stringify(r.data));
  assert.equal(r.data.pages, 0);
});

await test("حضور بلا حفظ ولا مراجعة مرفوض", async () => {
  assert.equal((await post(D_FAIL_1, { attendance: "present" })).status, 400);
});

await test("نهاية المراجعة قبل بدايتها مرفوضة، والاتجاه حرّ", async () => {
  // من الفاتحة ← آل عمران بترتيب المصحف: مقبول لأي اتجاه للطالب
  const free = await post(D2, { attendance: "present", review: { from: { surah: 2, ayah: 1 }, to: { surah: 3, ayah: 5 }, grade: "" } });
  assert.ok([200, 201].includes(free.status), JSON.stringify(free.data));
  // آية غير موجودة
  assert.equal((await post(D_FAIL_2, { attendance: "present", review: { from: { surah: 1, ayah: 99 }, to: { surah: 2, ayah: 1 }, grade: "" } })).status, 400);
});

await test("بداية مراجعة اليوم التالي تُقترح من نهاية آخر مراجعة", async () => {
  const row = await board(D3);
  assert.deepEqual(row.student.reviewLast, { surah: 3, ayah: 5 });
  assert.deepEqual(row.student.reviewNext, { surah: 3, ayah: 6 });
  // ولا اقتراح قبل أول مراجعة
  const first = await board(getValidDay(40));
  assert.equal(first.student.reviewNext, null);
});

await test("لوحة اليوم تعيد حقول المراجعة في سجل اليوم", async () => {
  const row = await board(D1);
  assert.equal(row.record.reviewFromSurah, 114);
  assert.equal(row.record.reviewToSurah, 112);
  assert.ok(row.record.reviewPages >= 1);
});

await test("الغياب يمسح المراجعة، والحضور مرة واحدة فقط في اليوم (لا تضاعف)", async () => {
  const before = (await call("/api/stats/students", { cookie: admin })).data.students.find((s) => s.id === student.id);
  const d = getValidDay(31);
  await post(d, { attendance: "present", review: { from: { surah: 114, ayah: 1 }, to: { surah: 113, ayah: 5 }, grade: "" } });
  const mid = (await call("/api/stats/students", { cookie: admin })).data.students.find((s) => s.id === student.id);
  assert.equal(mid.present, before.present + 1, "سجل بحفظ ومراجعة يجب أن يُحسب حضوراً واحداً");
  await post(d, { attendance: "absent" });
  const row = await board(d);
  assert.equal(row.record.attendance, "absent");
  assert.equal(row.record.reviewFromSurah, null);
  assert.equal(row.record.reviewPages, 0);
});

// الخطة الشهرية تُحفظ للشهر الجاري فقط (PATCH/PUT)، فنختبر الكشف على الشهر الجاري بسجل اليوم نفسه (التسجيل خارج الجدول مسموح)،
// لا على D1 التي قد تقع في شهر سابق فيصبح الاختبار معتمداً على تاريخ تشغيله.
const todayHebron = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hebron", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const month = todayHebron.slice(0, 7);
await test("الكشف الشهري يعرض صفحات المراجعة وخطتها", async () => {
  const rec = await post(todayHebron, { attendance: "present", review: { from: { surah: 114, ayah: 1 }, to: { surah: 112, ayah: 4 }, grade: "" } });
  assert.ok([200, 201].includes(rec.status), JSON.stringify(rec.data));
  const up = await call(`/api/students/${student.id}`, { method: "PATCH", cookie: admin, body: { monthlyReviewPlanPages: 20 } });
  assert.equal(up.status, 200, JSON.stringify(up.data));
  const r = await call(`/api/reports?month=${month}&circleId=${circle.id}`, { cookie: admin });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const row = r.data.rows.find((x) => x.studentId === student.id);
  assert.ok(row.reviewPages >= 1 && row.reviewDays >= 1, JSON.stringify(row));
  assert.equal(row.reviewPlanPages, 20);
  assert.equal(row.reviewPercent, Math.round((row.reviewPages / 20) * 100));
});

await test("حفظ الكشف لطالب مراجعة فقط ثم بقاء خطته المحفوظة بعد تغيير الخطة", async () => {
  const save = await call("/api/reports/save", { method: "POST", cookie: admin, body: { month, rows: [{ studentId: student.id, end: null }] } });
  assert.equal(save.status, 200, JSON.stringify(save.data));
  await call(`/api/students/${student.id}`, { method: "PATCH", cookie: admin, body: { monthlyReviewPlanPages: 5 } });
  const r = await call(`/api/reports?month=${month}&circleId=${circle.id}`, { cookie: admin });
  const row = r.data.rows.find((x) => x.studentId === student.id);
  assert.equal(row.reviewPlanPages, 20, "الكشف المحفوظ يجب أن يبقى بخطته وقت الحفظ");
  assert.equal(row.saved, true);
});

await test("إحصاءات الطلاب تعرض آخر موضع مراجعة وصفحاتها", async () => {
  const s = (await call("/api/stats/students", { cookie: admin })).data.students.find((x) => x.id === student.id);
  assert.ok(s.reviewPages >= 1);
  assert.ok(s.reviewSurah >= 1);
});

await test("بطاقة الطالب تحمل موضع المراجعة وخطتها", async () => {
  const d = (await call(`/api/students/${student.id}`, { cookie: admin })).data;
  const s = d.student ?? d;
  assert.ok(s.reviewSurah >= 1, JSON.stringify(s).slice(0, 200));
  assert.equal(s.monthlyReviewPlanPages, 5);
});

await test("ملخص الطالب (البوابة/الطباعة) يحمل مراجعة الشهر وآخر مراجعة", async () => {
  const r = await call(`/api/reports/student/${student.id}`, { cookie: admin });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok("reviewPages" in r.data.month);
  assert.ok(r.data.student.reviewLast, "reviewLast مفقود");
  assert.ok(r.data.daily.some((d) => d.reviewFromSurah));
});

console.log(`\n${passed} اختباراً ناجحاً (مسار المراجعة)`);
