// اختبار تكاملي للدفعة 2 (§15.7 و§15.8): ولي أمر كيان مستقل + بيانات إجبارية + حلقة اختيارية
// + كشف الإخوة تلقائياً + حساب اختياري باسم مستخدم/كلمة مرور = رقم الهوية + بوابة ولي الأمر.
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
async function login(centerId, username, password = PASSWORD) {
  return call("/api/auth/login", { method: "POST", body: { centerId, username, password } });
}
async function session(centerId, username, password = PASSWORD) {
  const r = await login(centerId, username, password);
  assert.equal(r.status, 200, `دخول ${username}: ${JSON.stringify(r.data)}`);
  return r.cookie;
}
async function test(name, fn) {
  try { await fn(); passed++; console.log("✓", name); } catch (e) { console.error("✗", name, "\n   ", e.message); process.exitCode = 1; }
}

const G = "tarjuman-gaza-01";
const admin = await session(G, "admin");
const teacher = await session(G, "gaza.teacher1");
const circles = (await call("/api/circles", { cookie: admin })).data.circles;
// حلقة المعلّم نفسه لا أوّل حلقة ذكور: البذرة فيها أكثر من حلقة ذكور (إحداها لمدير المرحلة)،
// واختبار الإشعار أدناه يتطلب أن يكون `teacher` هو معلّم هذه الحلقة.
const male = (await call("/api/circles", { cookie: teacher })).data.circles.find((c) => c.active) ?? circles.find((c) => c.category === "male" && c.active);
const female = circles.find((c) => c.category === "female" && c.active);
const stamp = Date.now().toString().slice(-7);
// أرقام هوية فريدة لكل تشغيل (9 أرقام)
const nid = (n) => "7" + stamp + String(n);
const waPhone = "0599" + stamp.slice(0, 6);
const guardianNid = "6" + stamp + "0";

const guardianData = (over = {}) => ({ name: "أب الاختبار", relation: "father", callPhone: waPhone, waCc: "970", waNational: waPhone, nationalId: "", ...over });
const importRow = (name, id, over = {}) => ({
  name, nationalId: id, birth: "2011-01-02", phoneCc: "970", phoneNational: "",
  guardianName: "والد الاستيراد", guardianRelation: "father", guardianCallPhone: waPhone, guardianWaCc: "970", guardianWaNational: waPhone, guardianNationalId: guardianNid,
  direction: "descending", lastAyah: 0, monthlyPlanPages: 10, ajkamCourse: "", joinedAt: "", ...over
});

let manualStudentId = "";
let manualGuardianId = "";
let importedIds = [];
let importGuardianId = "";

await test("إضافة طالب بولي أمر جديد وبلا حلقة (الحلقة اختيارية)", async () => {
  const body = { name: "طالب بلا حلقة للاختبار", nationalId: nid(1), birth: "2012-03-04", gender: "male", circleId: null, guardian: guardianData({ waNational: waPhone + "1", callPhone: waPhone + "1" }) };
  const r = await call("/api/students", { method: "POST", cookie: admin, body });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  manualStudentId = r.data.id;
  manualGuardianId = r.data.guardianId;
  const one = (await call(`/api/students/${manualStudentId}`, { cookie: admin })).data.student;
  assert.equal(one.circleId, null, "بلا حلقة");
  assert.equal(one.userId, null, "لا حساب للطالب");
  assert.equal(one.guardians.length, 1);
  assert.equal(one.guardians[0].hasAccount, false, "ولي الأمر بلا حساب — اختياري");
  assert.equal(one.guardians[0].callPhone, waPhone + "1");
});

await test("بيانات ولي الأمر إجبارية: الطالب بلا ولي يُرفض", async () => {
  const r = await call("/api/students", { method: "POST", cookie: admin, body: { name: "طالب بلا ولي أمر", nationalId: nid(2), birth: "2012-03-04", gender: "male" } });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  const partial = await call("/api/students", { method: "POST", cookie: admin, body: { name: "طالب بولي ناقص", nationalId: nid(2), birth: "2012-03-04", gender: "male", guardian: { name: "أب", relation: "father", callPhone: "", waCc: "970", waNational: "", nationalId: "" } } });
  assert.equal(partial.status, 400, "رقم الاتصال والواتساب إجباريان");
});

await test("اختيار ولي أمر موجود: الطالب الثاني يشارك الأول الولي (له إخوة)", async () => {
  const r = await call("/api/students", {
    method: "POST", cookie: admin,
    body: { name: "أخو الطالب الأول اختبار", nationalId: nid(3), birth: "2013-03-04", gender: "male", circleId: male.id, guardianId: manualGuardianId }
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.guardianId, manualGuardianId);
  const g = (await call("/api/guardians", { cookie: admin })).data.guardians.find((x) => x.id === manualGuardianId);
  assert.equal(g.children.length, 2, "الولي له ابنان الآن");
  const bad = await call("/api/students", { method: "POST", cookie: admin, body: { name: "ولي وهمي اختبار", nationalId: nid(4), birth: "2013-03-04", gender: "male", guardianId: "nope" } });
  assert.equal(bad.status, 400);
});

await test("إضافة ولي أمر جديد بالبيانات نفسها لا تُكرّره: يُكتشف برقم الواتساب", async () => {
  const before = (await call("/api/guardians", { cookie: admin })).data.guardians.length;
  const r = await call("/api/students", {
    method: "POST", cookie: admin,
    body: { name: "ثالث الإخوة اختبار", nationalId: nid(4), birth: "2014-03-04", gender: "male", guardian: guardianData({ waNational: waPhone + "1", callPhone: waPhone + "1" }) }
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.guardianId, manualGuardianId, "نفس الولي وُجد بالواتساب");
  assert.equal((await call("/api/guardians", { cookie: admin })).data.guardians.length, before, "لم يُنشأ ولي مكرَّر");
});

await test("استيراد: الإخوة يُكتشفون تلقائياً ويُربطون بولي واحد، وحساب الولي اختياري", async () => {
  const rows = [
    importRow("أول أبناء الاستيراد", nid(5)),
    importRow("ثاني أبناء الاستيراد", nid(6)),
    importRow("ثالث أبناء الاستيراد", nid(7)),
    importRow("مكرر الهوية اختبار", nid(1)),
    importRow("هوية قصيرة اختبار", "12")
  ];
  const r = await call("/api/students/import", { method: "POST", cookie: admin, body: { circleId: male.id, tempIds: false, createAccounts: false, rows } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.added, 3, JSON.stringify(r.data.results));
  assert.equal(r.data.duplicates, 1);
  assert.equal(r.data.errors, 1);
  assert.equal(r.data.guardiansCreated, 1, "ولي واحد للإخوة الثلاثة");
  assert.equal(r.data.guardiansLinked, 2, "الأخوان الآخران رُبطا به");
  assert.equal(r.data.accountsCreated, 0, "الحساب اختياري ولم يُطلب");
  const list = (await call("/api/guardians", { cookie: admin })).data.guardians;
  const g = list.find((x) => x.nationalId === guardianNid);
  assert.ok(g, "الولي المستورَد ظهر");
  importGuardianId = g.id;
  importedIds = g.children.map((k) => k.id);
  assert.equal(importedIds.length, 3);
  assert.equal(g.hasAccount, false);
});

await test("استيراد بلا حلقة (تُوزَّع لاحقاً) وبلا بيانات ولي يُرفض الصف", async () => {
  const r = await call("/api/students/import", {
    method: "POST", cookie: admin,
    body: {
      circleId: null, tempIds: true, createAccounts: false,
      rows: [
        importRow("طالب بلا حلقة استيراد", "", { guardianNationalId: "", guardianWaNational: waPhone + "9", guardianCallPhone: waPhone + "9", gender: "male" }),
        importRow("طالب بلا ولي استيراد", nid(8), { guardianName: "", guardianWaNational: "", guardianCallPhone: "", guardianNationalId: "" })
      ]
    }
  });
  assert.equal(r.data.added, 1, JSON.stringify(r.data.results));
  assert.equal(r.data.errors, 1, "الصف بلا ولي رُفض");
});

await test("الاستيراد يرفض جنساً لا يطابق فئة الحلقة", async () => {
  const r = await call("/api/students/import", {
    method: "POST", cookie: admin,
    body: { circleId: female.id, tempIds: true, createAccounts: false, rows: [importRow("ذكر في حلقة إناث", "", { gender: "male", guardianNationalId: "" })] }
  });
  assert.equal(r.data.added, 0);
  assert.equal(r.data.errors, 1);
});

await test("المعلّم لا يستورد إلى حلقة غيره", async () => {
  const r = await call("/api/students/import", {
    method: "POST", cookie: teacher,
    body: { circleId: female.id, tempIds: true, createAccounts: false, rows: [importRow("محاولة غير مصرّح بها", "")] }
  });
  assert.equal(r.status, 403, JSON.stringify(r.data));
});

await test("إنشاء حساب لولي موجود: اسم المستخدم وكلمة المرور = رقم الهوية، ولا إجبار على التغيير", async () => {
  const r = await call(`/api/guardians/${importGuardianId}/account`, { method: "POST", cookie: admin, body: {} });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.username, guardianNid);
  const again = await call(`/api/guardians/${importGuardianId}/account`, { method: "POST", cookie: admin, body: {} });
  assert.equal(again.status, 400, "لا حساب ثانٍ");
  // يدخل برقم الهوية اسماً وكلمة مرور معاً
  const wali = await session(G, guardianNid, guardianNid);
  const me = (await call("/api/auth/me", { cookie: wali })).data;
  assert.equal(me.user.role, "guardian", JSON.stringify(me.user));
});

await test("حساب الولي بلا رقم هوية يُرفض (لا اسم مستخدم)", async () => {
  const r = await call(`/api/guardians/${manualGuardianId}/account`, { method: "POST", cookie: admin, body: {} });
  assert.equal(r.status, 400, JSON.stringify(r.data));
});

await test("إنشاء ولي مع حساب دفعة واحدة برقم الهوية", async () => {
  const id = "5" + stamp + "1";
  const r = await call("/api/guardians", { method: "POST", cookie: admin, body: { ...guardianData({ name: "ولي بحساب فوري", nationalId: id, waNational: waPhone + "7", callPhone: waPhone + "7" }), withAccount: true, studentIds: [] } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  await session(G, id, id);
  const dup = await call("/api/guardians", { method: "POST", cookie: admin, body: { ...guardianData({ name: "ولي مكرر الهوية", nationalId: id, waNational: waPhone + "6", callPhone: waPhone + "6" }), withAccount: false, studentIds: [] } });
  assert.equal(dup.status, 409, "الهوية فريدة");
});

await test("ولي الأمر يرى أبناءه فقط (ملخص وأبناء)", async () => {
  const wali = await session(G, guardianNid, guardianNid);
  const kids = (await call("/api/guardians/children", { cookie: wali })).data.children;
  assert.equal(kids.length, 3);
  const one = (await call(`/api/portal/summary?studentId=${kids[1].id}`, { cookie: wali })).data;
  assert.equal(one.student.id, kids[1].id);
  const others = (await call("/api/students?pageSize=100", { cookie: admin })).data.students;
  const notMine = others.find((s) => !kids.some((k) => k.id === s.id));
  assert.equal((await call(`/api/portal/summary?studentId=${notMine.id}`, { cookie: wali })).status, 404);
  assert.equal((await call("/api/students", { cookie: wali })).status, 403);
  assert.equal((await call("/api/guardians", { cookie: wali })).status, 403);
});

await test("ولي الأمر يبلّغ عن غياب ابنه ويصل المعلّم إشعار", async () => {
  const wali = await session(G, guardianNid, guardianNid);
  const kids = (await call("/api/guardians/children", { cookie: wali })).data.children;
  const kid = kids.find((k) => k.circleName) ?? kids[0];
  const before = (await call("/api/notifications/count", { cookie: teacher })).data.unread;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Hebron" });
  const r = await call("/api/absences", { method: "POST", cookie: wali, body: { date: today, reason: "موعد طبي", studentId: kid.id } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.ok((await call("/api/notifications/count", { cookie: teacher })).data.unread > before, "وصل المعلّم إشعار");
});

await test("تسجيل غياب يُشعر ولي الأمر (بحسابه)", async () => {
  const wali = await session(G, guardianNid, guardianNid);
  const kids = (await call("/api/guardians/children", { cookie: wali })).data.children;
  await call("/api/notifications/read", { method: "POST", cookie: wali, body: { all: true } });
  const before = (await call("/api/notifications/count", { cookie: wali })).data.unread;
  const day = new Date(Date.now() - 3 * 86400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Hebron" });
  const r = await call("/api/daily", { method: "POST", cookie: admin, body: { studentId: kids[0].id, date: day, attendance: "absent" } });
  assert.ok(r.status === 200 || r.status === 201, JSON.stringify(r.data));
  assert.equal((await call("/api/notifications/count", { cookie: wali })).data.unread, before + 1);
});

await test("تعديل بيانات ولي الأمر ورقماه المنفصلان", async () => {
  const r = await call(`/api/guardians/${manualGuardianId}`, { method: "PATCH", cookie: admin, body: { callPhone: "0591112222", waCc: "962", waNational: "0791234567" } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const g = (await call("/api/guardians", { cookie: admin })).data.guardians.find((x) => x.id === manualGuardianId);
  assert.equal(g.callPhone, "0591112222");
  assert.equal(g.waCc, "962");
  assert.equal(g.waNational, "0791234567");
});

await test("تعديل أبناء ولي الأمر وإيقاف حسابه", async () => {
  const put = await call(`/api/guardians/${importGuardianId}/children`, { method: "PUT", cookie: admin, body: { studentIds: [importedIds[0]] } });
  assert.equal(put.status, 200, JSON.stringify(put.data));
  const wali = await session(G, guardianNid, guardianNid);
  assert.equal((await call("/api/guardians/children", { cookie: wali })).data.children.length, 1);
  assert.equal((await call(`/api/guardians/${importGuardianId}/active`, { method: "POST", cookie: admin, body: { active: false } })).status, 200);
  assert.equal((await call("/api/auth/me", { cookie: wali })).status, 401, "الجلسة تنتهي بإيقاف الحساب");
  assert.equal((await login(G, guardianNid, guardianNid)).status, 403, "لا يدخل وهو موقوف");
  assert.equal((await call(`/api/guardians/${importGuardianId}/active`, { method: "POST", cookie: admin, body: { active: true } })).status, 200);
});

await test("مقدمة الدولة تُحفظ في الإعدادات", async () => {
  const cur = (await call("/api/settings", { cookie: admin })).data.settings;
  const r = await call("/api/settings", { method: "PUT", cookie: admin, body: { ...cur, phonePrefix: "970" } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await call("/api/settings", { method: "PUT", cookie: admin, body: { ...cur, phonePrefix: "+970" } })).status, 400);
});

console.log(`\nنجحت ${passed} حالة في الدفعة 2`);
