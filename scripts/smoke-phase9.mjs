// اختبار تكاملي: انتقال الطلاب بين الحلقات (هجرة 0013).
// القاعدة: يُرتَّب النقل من اليوم 25 ويسري من أول الشهر التالي؛ قبل ذلك يستطيع المدير وحده النقل الفوري بسبب مكتوب.
// وسجلات ما قبل النقل تبقى منسوبة للحلقة القديمة. الاختبار لا يعتمد على تاريخ تشغيله: يتفرّع حسب اليوم من الشهر.
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
async function session(centerId, username) {
  const r = await call("/api/auth/login", { method: "POST", body: { centerId, username, password: PASSWORD } });
  assert.equal(r.status, 200, `دخول ${username}: ${JSON.stringify(r.data)}`);
  return r.cookie;
}
async function test(name, fn) {
  try { await fn(); passed++; console.log("✓", name); } catch (e) { console.error("✗", name, "\n   ", e.message); process.exitCode = 1; }
}

const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hebron", year: "numeric", month: "2-digit", day: "2-digit" });
const iso = (d) => fmt.format(d);
const today = iso(new Date());
const daysAgo = (n) => iso(new Date(Date.now() - n * 86400000));
const day = Number(today.slice(8, 10));
const arrangeWindow = day >= 25;
const firstOfNext = (() => { const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7)); return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`; })();
const prevMonth = (() => { const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7)); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`; })();

const G = "obai-01";
const admin = await session(G, "admin");
const secretary = await session(G, "obai.secretary");
{
  const cur = (await call("/api/settings", { cookie: admin })).data.settings;
  assert.equal((await call("/api/settings", { method: "PUT", cookie: admin, body: { ...cur, maxStudentsPerCircle: 80 } })).status, 200);
}
const circles = (await call("/api/circles", { cookie: admin })).data.circles;
const fajr = circles.find((c) => c.name === "حلقة الفجر");
const yaqeen = circles.find((c) => c.name === "حلقة اليقين");
const salam = circles.find((c) => c.name === "حلقة السلام");
const noor = circles.find((c) => c.name === "حلقة النور");
assert.ok(fajr && yaqeen && salam && noor, "البذرة تحتاج الحلقات الأربع");

await call(`/api/schedule/${fajr.id}`, { method: "PUT", cookie: admin, body: { entries: [] } });
await call(`/api/schedule/${yaqeen.id}`, { method: "PUT", cookie: admin, body: { entries: [] } });

const stamp = Date.now().toString().slice(-6);
const ph = (n) => "0599" + stamp.slice(0, 5) + n;
const newStudent = async (n, circleId, name) => {
  const r = await call("/api/students", {
    method: "POST", cookie: admin,
    body: {
      nationalId: `8${stamp}${String(n).padStart(2, "0")}`, name, birth: "2012-03-04", gender: "male", circleId, direction: "descending", lastSurah: 114, lastAyah: 0, monthlyPlanPages: 5,
      guardian: { name: "ولي انتقال اختبار", relation: "father", callPhone: ph(n), waCc: "970", waNational: ph(n), nationalId: "" }
    }
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.id;
};
const board = async (date, circleId) => (await call(`/api/daily/board?date=${date}&circleId=${circleId}`, { cookie: admin })).data.rows ?? [];
const inBoard = async (date, circleId, id) => (await board(date, circleId)).find((r) => r.student.id === id);
const inReport = async (month, circleId, id) => ((await call(`/api/reports?month=${month}&circleId=${circleId}`, { cookie: admin })).data.rows ?? []).some((r) => r.studentId === id);
const one = async (id) => (await call(`/api/students/${id}`, { cookie: admin })).data.student;

const S = await newStudent(1, fajr.id, "طالب انتقال بين الحلقات");
const oldDay = daysAgo(3);
await test("تسميع قبل النقل يُسجَّل في الحلقة القديمة", async () => {
  const r = await call("/api/daily", { method: "POST", cookie: admin, body: { studentId: S, date: oldDay, attendance: "present", review: { from: { surah: 114, ayah: 1 }, to: { surah: 112, ayah: 4 }, grade: "" } } });
  assert.ok([200, 201].includes(r.status), JSON.stringify(r.data));
  assert.ok(await inBoard(oldDay, fajr.id, S));
});

await test("تغيير حلقة طالب له حلقة عبر التعديل مرفوض (يمرّ عبر النقل)", async () => {
  const r = await call(`/api/students/${S}`, { method: "PATCH", cookie: admin, body: { circleId: yaqeen.id } });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  assert.equal((await one(S)).circleId, fajr.id);
});

await test("النقل إلى الحلقة نفسها أو إلى حلقة فئة مخالفة مرفوض", async () => {
  assert.equal((await call(`/api/students/${S}/move`, { method: "POST", cookie: admin, body: { circleId: fajr.id, reason: "لا شيء" } })).status, 400);
  assert.equal((await call(`/api/students/${S}/move`, { method: "POST", cookie: admin, body: { circleId: noor.id, reason: "فئة مخالفة" } })).status, 400);
});

if (arrangeWindow) {
  await test(`اليوم ${day} (نافذة الترتيب): السكرتير يرتّب النقل ويسري من أول الشهر التالي`, async () => {
    const r = await call(`/api/students/${S}/move`, { method: "POST", cookie: secretary, body: { circleId: yaqeen.id } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.immediate, false);
    assert.equal(r.data.effectiveFrom, firstOfNext);
  });
  await test("قبل سريانه: الطالب وسجلاته باقيان في الحلقة الحالية", async () => {
    assert.equal((await one(S)).circleId, fajr.id);
    assert.ok(await inBoard(today, fajr.id, S), "يظهر في حلقته الحالية");
    assert.equal(await inBoard(today, yaqeen.id, S), undefined, "لا يظهر في الجديدة بعد");
    assert.ok(await inReport(today.slice(0, 7), fajr.id, S), "كشف هذا الشهر في حلقته الحالية");
    assert.equal(await inReport(today.slice(0, 7), yaqeen.id, S), false);
  });
  await test("البطاقة تُظهر النقل المرتَّب وموعد سريانه", async () => {
    const p = (await one(S)).pendingTransfer;
    assert.ok(p, "نقل معلّق");
    assert.equal(p.toCircleId, yaqeen.id);
    assert.equal(p.effectiveFrom, firstOfNext);
    assert.ok(await inBoard(oldDay, fajr.id, S), "تاريخ ما قبل النقل يبقى للقديمة");
  });
  await test("ترتيب جديد يحلّ محلّ المعلّق (واحد فقط)", async () => {
    const r = await call(`/api/students/${S}/move`, { method: "POST", cookie: admin, body: { circleId: salam.id } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const p = (await one(S)).pendingTransfer;
    assert.equal(p.toCircleId, salam.id, "الترتيب الأخير هو المعلّق");
    assert.equal((await one(S)).circleId, fajr.id, "لا يزال في حلقته حتى أول الشهر");
  });
} else {
  await test(`اليوم ${day} (قبل النافذة): السكرتير ممنوع من النقل (403)`, async () => {
    const r = await call(`/api/students/${S}/move`, { method: "POST", cookie: secretary, body: { circleId: yaqeen.id, reason: "محاولة" } });
    assert.equal(r.status, 403, JSON.stringify(r.data));
    assert.equal((await one(S)).circleId, fajr.id);
  });
  await test("المدير بلا سبب مكتوب مرفوض (400)", async () => {
    assert.equal((await call(`/api/students/${S}/move`, { method: "POST", cookie: admin, body: { circleId: yaqeen.id } })).status, 400);
  });
  await test("المدير بسبب مكتوب: نقل فوري، وما قبله يبقى للحلقة القديمة", async () => {
    const r = await call(`/api/students/${S}/move`, { method: "POST", cookie: admin, body: { circleId: yaqeen.id, reason: "انتقال سكن الأسرة" } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.immediate, true);
    assert.equal((await one(S)).circleId, yaqeen.id);
    assert.ok(await inBoard(today, yaqeen.id, S), "اليوم في الجديدة");
    assert.equal(await inBoard(today, fajr.id, S), undefined, "اليوم ليس في القديمة");
    const old = await inBoard(oldDay, fajr.id, S);
    assert.ok(old, "تسميع ما قبل النقل يبقى في لوحة الحلقة القديمة");
    assert.ok(old.record, "وسجله محفوظ");
    assert.equal(await inBoard(oldDay, yaqeen.id, S), undefined, "ولا يظهر في الجديدة بأثر رجعي");
  });
}

await test("كشف الشهر السابق يبقى في الحلقة القديمة بعد أي ترتيب أو نقل", async () => {
  assert.ok(await inReport(prevMonth, fajr.id, S));
  assert.equal(await inReport(prevMonth, yaqeen.id, S), false);
});

await test("طالب بلا حلقة يُوزَّع فوراً (ليس نقلاً) بلا قيد النافذة", async () => {
  const id = await newStudent(2, null, "طالب بلا حلقة للتوزيع");
  const r = await call(`/api/students/${id}/move`, { method: "POST", cookie: secretary, body: { circleId: fajr.id } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.immediate, true);
  assert.equal((await one(id)).circleId, fajr.id);
});

console.log(`\n${passed} اختباراً ناجحاً (انتقال الطلاب)`);
