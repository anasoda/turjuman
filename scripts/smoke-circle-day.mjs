// متابعة الحلقات في يوم وتنبيه المحفّظ: الأرقام، الصلاحيات، نطاق مدير المرحلة، الحماية من التكرار، والعزل.
import assert from "node:assert/strict";

const base = process.env.API_BASE || "http://127.0.0.1:8787";
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hebron", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const shift = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const weekday = (date) => new Date(`${date}T00:00:00Z`).getUTCDay();
// أحدث يومين سابقين (أو اليوم) داخل جدول البذرة: الأحد إلى الخميس
const schoolDays = [];
for (let d = today; schoolDays.length < 2; d = shift(d, -1)) if (weekday(d) <= 4) schoolDays.push(d);
const [dayA, dayB] = schoolDays;

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
const teacher1 = await login("obai-01", "obai.teacher1");
const stage = await login("obai-01", "obai.stage1");
const otherCenter = await login("test-center-02", "admin");

const view = async (date, cookie = admin) => (await call(`/api/circle-day?date=${date}`, "GET", undefined, cookie));
const first = await view(dayA);
assert.equal(first.status, 200, JSON.stringify(first.data));
const fajr = first.data.circles.find((c) => c.name === "حلقة الفجر");
const noor = first.data.circles.find((c) => c.name === "حلقة النور");
assert.ok(fajr && noor, "حلقات البذرة");
assert.ok(fajr.teachers.length >= 2, "المعلّم الأساسي والمساعد");

// تسجيل حفظ لطالب في الفجر ← يظهر في الأرقام
const guardianId = (await call("/api/students", "GET", undefined, admin)).data.students.find((s) => s.guardianId)?.guardianId;
const created = await call("/api/students", "POST", {
  nationalId: String(Math.floor(100000000 + Math.random() * 900000000)), name: "طالب تجربة متابعة الحلقات",
  birth: "2013-01-02", gender: "male", circleId: fajr.id, guardianId, direction: "descending", lastSurah: 114, lastAyah: 0
}, admin);
assert.equal(created.status, 201, JSON.stringify(created.data));
const rec = await call("/api/daily", "POST", { studentId: created.data.id, date: dayA, attendance: "present", from: { surah: 114, ayah: 1 }, to: { surah: 114, ayah: 6 }, grade: "", review: null, next: null, note: "" }, admin);
assert.equal(rec.status, 201, JSON.stringify(rec.data));
const after = (await view(dayA)).data;
const fajrAfter = after.circles.find((c) => c.id === fajr.id);
assert.ok(fajrAfter.recorded >= 1 && fajrAfter.present >= 1, JSON.stringify(fajrAfter));
assert.ok(fajrAfter.hifzStudents >= 1 && fajrAfter.hifzPages >= 1, "الحفظ والصفحات");
assert.ok(["partial", "complete"].includes(fajrAfter.status));
assert.ok(after.totals.hifzStudents >= 1 && after.totals.hifzPages >= 1 && after.totals.students >= after.totals.recorded);
assert.equal(after.circles.find((c) => c.id === noor.id).recorded, 0);

// الصلاحيات والتحقق
assert.equal((await view(dayA, teacher1)).status, 403);
assert.equal((await call(`/api/circle-day?date=${dayA}`)).status, 401);
assert.equal((await call("/api/circle-day?date=غلط", "GET", undefined, admin)).status, 400);
assert.equal((await call("/api/circle-day/remind", "POST", { circleId: fajr.id, date: dayA }, teacher1)).status, 403);
assert.equal((await call("/api/circle-day/remind", "POST", { circleId: fajr.id, date: shift(today, 1) }, admin)).status, 400, "لا تنبيه عن يوم لم يأتِ");

// نطاق مدير المرحلة: الفجر والسلام (ابتدائية) لا النور (تلقين)
const staged = (await view(dayA, stage)).data.circles.map((c) => c.id);
assert.ok(staged.includes(fajr.id) && !staged.includes(noor.id));
assert.ok(staged.every((id) => after.circles.some((c) => c.id === id)));
assert.equal((await call("/api/circle-day/remind", "POST", { circleId: noor.id, date: dayA }, stage)).status, 403, "حلقة خارج مراحله");

// التنبيه: يصل لمعلّمي الحلقة، ولا يتكرر قبل ساعة، ويظهر وقته في الشاشة
const sent = await call("/api/circle-day/remind", "POST", { circleId: fajr.id, date: dayA, note: "نرجو الاستكمال اليوم" }, admin);
assert.equal(sent.status, 200, JSON.stringify(sent.data));
assert.equal(sent.data.notified, fajr.teachers.length);
const inbox = (await call("/api/notifications", "GET", undefined, teacher1)).data.items;
const got = inbox.find((n) => n.kind === "record_reminder" && n.link.includes(fajr.id));
assert.ok(got, "وصل الإشعار للمعلّم الأساسي");
assert.ok(got.body.includes("نرجو الاستكمال اليوم") && got.link.includes(`date=${dayA}`));
assert.equal((await call("/api/circle-day/remind", "POST", { circleId: fajr.id, date: dayA }, admin)).status, 409, "ضغط مزدوج");
assert.ok((await view(dayA)).data.circles.find((c) => c.id === fajr.id).remindedAt);
// يوم آخر للحلقة نفسها وبمدير المرحلة (حلقته ضمن نطاقه)
assert.equal((await call("/api/circle-day/remind", "POST", { circleId: fajr.id, date: dayB }, stage)).status, 200);

// حصة ملغاة: تظهر ملغاة ولا تُنبَّه
const cancel = await call("/api/cancellations", "POST", { circleId: noor.id, date: today, reason: "اختبار الإلغاء" }, admin);
assert.equal(cancel.status, 201, JSON.stringify(cancel.data));
const cancelled = (await view(today)).data.circles.find((c) => c.id === noor.id);
assert.equal(cancelled.status, "cancelled");
assert.equal(cancelled.cancelReason, "اختبار الإلغاء");
assert.equal((await call("/api/circle-day/remind", "POST", { circleId: noor.id, date: today }, admin)).status, 409);

// العزل بين المراكز
const foreign = await view(dayA, otherCenter);
assert.equal(foreign.status, 200);
assert.ok(!foreign.data.circles.some((c) => c.id === fajr.id));
assert.equal((await call("/api/circle-day/remind", "POST", { circleId: fajr.id, date: dayA }, otherCenter)).status, 404);
console.log("✓ متابعة الحلقات في يوم وتنبيه المحفّظ: الأرقام والصلاحيات والنطاق والتكرار والعزل");
