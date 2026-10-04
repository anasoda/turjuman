// اختبار تكاملي للدفعة 4 (§15.5 و§14.2): المعلّم يدرّس أكثر من حلقة (هجرة 0009).
// يفحص أن القيد رُفع فعلاً، وأن نطاق المعلّم صار اتحاد حلقاته في كل المسارات.
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
const teacher = await session(G, "obai.teacher1"); // البذرة تسند إليه حلقتين
const other = await session(G, "obai.teacher3");

const all = (await call("/api/circles", { cookie: admin })).data.circles;
const stamp = Date.now().toString().slice(-7);
const nid = (n) => "8" + stamp + String(n);
const TODAY = new Date().toISOString().slice(0, 10);

let mine = [];
await test("المعلّم يرى حلقاته كلها (أكثر من واحدة)", async () => {
  const r = await call("/api/circles", { cookie: teacher });
  assert.equal(r.status, 200);
  mine = r.data.circles;
  assert.ok(mine.length >= 2, `توقعتُ حلقتين على الأقل، وجدتُ ${mine.length}`);
});

await test("المعلّم يعدّل اسم حلقته فقط؛ المرحلة والفئة والتفعيل للإدارة (البند 5)", async () => {
  const c0 = mine[0];
  const full = (over) => ({ name: c0.name, category: c0.category, levelKey: c0.levelKey, active: c0.active, primaryTeacherId: c0.primaryTeacherId, assistantTeacherId: c0.assistantTeacherId, ...over });
  const put = (cookie, over) => call(`/api/circles/${c0.id}`, { method: "PUT", cookie, body: full(over) });
  const levels = (await call("/api/auth/me", { cookie: admin })).data.settings.levels.map((l) => l.key);
  const otherLevel = levels.find((k) => k !== c0.levelKey);
  assert.ok(otherLevel, "يلزم مرحلتان في البذرة");
  const renamed = `${c0.name} معدّلة`;
  assert.equal((await put(teacher, { name: renamed })).status, 200, "المعلّم يغيّر الاسم");
  assert.equal((await put(teacher, { name: renamed, levelKey: otherLevel })).status, 403, "المعلّم لا يغيّر المرحلة");
  assert.equal((await put(teacher, { name: renamed, active: !c0.active })).status, 403, "المعلّم لا يعطّل الحلقة");
  assert.equal((await put(teacher, { name: renamed, category: c0.category === "male" ? "female" : "male" })).status, 403, "المعلّم لا يغيّر الفئة");
  assert.equal((await put(other, { name: "اسم من معلّم آخر" })).status, 404, "حلقة غير حلقته");
  const after = (await call("/api/circles", { cookie: admin })).data.circles.find((x) => x.id === c0.id);
  assert.equal(after.name, renamed);
  assert.equal(after.levelKey, c0.levelKey);
  assert.equal(after.active, c0.active);
  // الإدارة تبقى كما كانت: تغيّر المرحلة ثم تعيدها
  assert.equal((await put(admin, { name: renamed, levelKey: otherLevel })).status, 200, "الإدارة تغيّر المرحلة");
  assert.equal((await put(admin, { name: c0.name })).status, 200, "إعادة الوضع الأصلي");
});

await test("إسناد حلقة ثالثة للمعلّم نفسه يُقبل (رُفع قيد الحلقة الواحدة)", async () => {
  const r = await call("/api/circles", {
    method: "POST", cookie: admin,
    body: { name: `حلقة اختبار ${stamp}`, category: "male", levelKey: "primary", active: true, primaryTeacherId: mine[0].primaryTeacherId, assistantTeacherId: null }
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  await call(`/api/circles/${r.data.id}`, { method: "DELETE", cookie: admin });
});

await test("لا يزال ممنوعاً: نفس المعلّم أساسياً ومساعداً في حلقة واحدة", async () => {
  const id = mine[0].primaryTeacherId;
  const r = await call("/api/circles", {
    method: "POST", cookie: admin,
    body: { name: `حلقة مكررة ${stamp}`, category: "male", levelKey: "primary", active: true, primaryTeacherId: id, assistantTeacherId: id }
  });
  assert.equal(r.status, 400, JSON.stringify(r.data));
});

const added = [];
await test("يضيف طلاباً إلى كلٍّ من حلقتيه", async () => {
  for (let i = 0; i < 2; i++) {
    const r = await call("/api/students", {
      method: "POST", cookie: teacher,
      body: {
        name: `طالب حلقة رقم ${i} اختبار`, nationalId: nid(i), birth: "2012-02-03", gender: mine[i].category, circleId: mine[i].id,
        guardian: { name: `ولي أمر اختبار ${i} هنا`, relation: "father", callPhone: "059" + stamp, waCc: "970", waNational: "059" + stamp, nationalId: "" }
      }
    });
    assert.equal(r.status, 201, `الحلقة ${i}: ${JSON.stringify(r.data)}`);
    added.push(r.data.id);
  }
});

await test("قائمة «طلابي» تجمع طلاب حلقتيه", async () => {
  const r = await call("/api/students?pageSize=100", { cookie: teacher });
  assert.equal(r.status, 200);
  const ids = new Set(r.data.students.map((s) => s.id));
  assert.ok(added.every((id) => ids.has(id)), "لم تجمع القائمة طلاب الحلقتين");
  const allowed = new Set(mine.map((c) => c.id));
  assert.ok(r.data.students.every((s) => allowed.has(s.circleId)), "ظهر طالب خارج حلقاته");
});

await test("لوحة التسميع تعمل على كل حلقة من حلقتيه", async () => {
  for (const c of mine.slice(0, 2)) {
    const r = await call(`/api/daily/board?date=${TODAY}&circleId=${c.id}`, { cookie: teacher });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.circleId, c.id, "اللوحة فتحت على حلقة أخرى");
  }
});

await test("بلا circleId تُفتح اللوحة على أولى حلقاته لا على لا شيء", async () => {
  const r = await call(`/api/daily/board?date=${TODAY}`, { cookie: teacher });
  assert.equal(r.status, 200);
  assert.ok(mine.some((c) => c.id === r.data.circleId), "لم تُفتح على إحدى حلقاته");
});

await test("حلقة معلّم آخر: اللوحة فارغة ولا تتسرّب", async () => {
  const notMine = all.find((c) => !mine.some((m) => m.id === c.id));
  assert.ok(notMine, "البذرة تحتاج حلقة لمعلّم آخر");
  const r = await call(`/api/daily/board?date=${TODAY}&circleId=${notMine.id}`, { cookie: teacher });
  assert.equal(r.status, 200);
  assert.equal(r.data.circleId, null, "تسرّبت حلقة ليست له");
  assert.equal(r.data.rows.length, 0);
});

await test("الكشف الشهري يفتح على أي من حلقتيه", async () => {
  for (const c of mine.slice(0, 2)) {
    const r = await call(`/api/reports?month=${TODAY.slice(0, 7)}&circleId=${c.id}`, { cookie: teacher });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.circleId, c.id);
  }
});

await test("جدول الحلقات يعرض جداول حلقاته كلها", async () => {
  const r = await call("/api/schedule", { cookie: teacher });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const allowed = new Set(mine.map((c) => c.id));
  assert.ok(r.data.entries.every((e) => allowed.has(e.circleId)), "ظهر جدول حلقة ليست له");
});

await test("معلّم آخر لا يرى طلاب حلقتيه", async () => {
  const r = await call("/api/students?pageSize=100", { cookie: other });
  assert.equal(r.status, 200);
  const ids = new Set(r.data.students.map((s) => s.id));
  assert.ok(!added.some((id) => ids.has(id)), "تسرّب طالب إلى معلّم آخر");
  for (const id of added) {
    assert.equal((await call(`/api/students/${id}`, { cookie: other })).status, 404, "بطاقة طالب تسرّبت");
  }
});

await test("قائمة الكادر لا تكرّر المعلّم بعدد حلقاته", async () => {
  const r = await call("/api/staff", { cookie: admin });
  assert.equal(r.status, 200);
  const ids = r.data.staff.map((s) => s.id);
  assert.equal(ids.length, new Set(ids).size, "تكرّر عضو كادر في القائمة");
  const t1 = r.data.staff.find((s) => s.username === "obai.teacher1");
  assert.ok(t1.circles.length >= 2, `حلقات المعلّم في القائمة: ${t1.circles.length}`);
});

await test("كشف المعلّمين لا يكرّرهم ويجمع أسماء حلقاتهم", async () => {
  const r = await call("/api/stats/teachers", { cookie: admin });
  assert.equal(r.status, 200);
  const ids = r.data.teachers.map((t) => t.id);
  assert.equal(ids.length, new Set(ids).size, "تكرّر معلّم في الكشف");
});

console.log(`\n${passed} اختباراً ناجحاً (الدفعة 4)`);
