// بيانات تجريبية للتطوير المحلي فقط. يتطلب تشغيل الخادم: npm run dev:api
// الاستخدام: npm run db:seed:local
// يُنشئ مركزين (turjuman-gaza-01, turjuman-rafah-02) وحسابات وحلقات وطلاباً عبر الـ API نفسه،
// فيمرّ كل شيء عبر نفس التحقق والصلاحيات.

const BASE = process.env.API_BASE || "http://127.0.0.1:8787";
const BOOTSTRAP = process.env.ADMIN_BOOTSTRAP_KEY || "dev-only-bootstrap-key";
const PASSWORD = "Demo@2026pass";

async function call(path, { method = "GET", body, cookie, bootstrap } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...(bootstrap ? { "x-bootstrap-key": BOOTSTRAP } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, cookie: (res.headers.get("set-cookie") || "").split(";")[0] };
}

async function must(label, p) {
  const r = await p;
  if (r.status >= 400) {
    if (r.status === 409) { console.log(`= ${label} (موجود)`); return r; }
    throw new Error(`${label}: ${r.status} ${JSON.stringify(r.data)}`);
  }
  console.log(`+ ${label}`);
  return r;
}

async function seedCenter(centerId, centerName, prefix) {
  await must(`مركز ${centerName}`, call("/api/owner/provision-center", { method: "POST", bootstrap: true, body: { centerId, centerName, adminUsername: "admin", adminName: `مدير ${centerName}`, adminPassword: PASSWORD } }));
  const login = await call("/api/auth/login", { method: "POST", body: { centerId, username: "admin", password: PASSWORD } });
  if (login.status !== 200) throw new Error("فشل دخول المدير: " + JSON.stringify(login.data));
  const cookie = login.cookie;

  const staff = (role, username, displayName, nid, gender) => ({
    role, username, password: PASSWORD, displayName, nationalId: nid, phone: "0591234567", waCc: "970", waNational: "", birth: "1990-04-12", gender,
    email: "", address: "غزة", qualification: "بكالوريوس", ajkamCourse: "عليا", memorizedParts: 30
  });
  const t1 = await must("معلّم 1", call("/api/staff", { method: "POST", cookie, body: staff("teacher", `${prefix}.teacher1`, "أحمد حسن محمد النجار", "400000001", "male") }));
  const t2 = await must("معلّم 2 (مساعد)", call("/api/staff", { method: "POST", cookie, body: staff("teacher", `${prefix}.teacher2`, "خالد يوسف علي الحداد", "400000002", "male") }));
  const t3 = await must("معلّمة", call("/api/staff", { method: "POST", cookie, body: staff("teacher", `${prefix}.teacher3`, "سلمى خالد محمود أبو عودة", "400000003", "female") }));
  await must("سكرتير", call("/api/staff", { method: "POST", cookie, body: staff("secretary", `${prefix}.secretary`, "نور محمود سعيد العطار", "400000004", "female") }));
  await must("لجنة الاختبار", call("/api/staff", { method: "POST", cookie, body: staff("exam_committee", `${prefix}.committee`, "عبد الله ناصر إبراهيم شاهين", "400000005", "male") }));
  // مدير المرحلة الابتدائية (§15.3): يرى حلقة الفجر فقط (primary) لا حلقة النور (talqeen)
  const sm = await must("مدير مرحلة", call("/api/staff", { method: "POST", cookie, body: { ...staff("stage_manager", `${prefix}.stage1`, "سامي رائد حسن المصري", "400000006", "male"), stages: ["primary"] } }));

  const c1 = await must("حلقة الفجر", call("/api/circles", { method: "POST", cookie, body: { name: "حلقة الفجر", category: "male", levelKey: "primary", active: true, primaryTeacherId: t1.data.id ?? null, assistantTeacherId: t2.data.id ?? null } }));
  const c2 = await must("حلقة النور", call("/api/circles", { method: "POST", cookie, body: { name: "حلقة النور", category: "female", levelKey: "talqeen", active: true, primaryTeacherId: t3.data.id ?? null, assistantTeacherId: null } }));
  // مدير المرحلة يدرّس حلقة في مرحلته أيضاً (قرار المالك: التعيين فوق حساب المعلّم)
  await must("حلقة مدير المرحلة", call("/api/circles", { method: "POST", cookie, body: { name: "حلقة السلام", category: "male", levelKey: "primary", active: true, primaryTeacherId: sm.data.id ?? null, assistantTeacherId: null } }));
  // معلّم 1 يدرّس حلقة ثانية (هجرة 0009: رُفع قيد «حلقة واحدة لكل معلّم»)
  await must("حلقة ثانية لمعلّم 1", call("/api/circles", { method: "POST", cookie, body: { name: "حلقة اليقين", category: "male", levelKey: "prep_secondary", active: true, primaryTeacherId: t1.data.id ?? null, assistantTeacherId: null } }));

  // الطالبان 1 و2 أخوان يشتركان في ولي أمر واحد (بحسابه: اسم المستخدم وكلمة المرور = رقم الهوية §15.8).
  // الطالبة 3 لها ولي آخر بلا حساب — ولي الأمر كيان مستقل عن الحساب (§15.7).
  const wali = await must("ولي أمر (أبو عمر وياسين) بحساب", call("/api/guardians", {
    method: "POST", cookie,
    body: { name: "علي محمد بركات", relation: "father", callPhone: "0599000001", waCc: "970", waNational: "0599000001", nationalId: "801000001", withAccount: true, studentIds: [] }
  }));
  const wali2 = await must("ولي أمر الطالبة 3 (بلا حساب)", call("/api/guardians", {
    method: "POST", cookie,
    body: { name: "محمود سعيد عوض", relation: "father", callPhone: "0599000003", waCc: "970", waNational: "0599000003", nationalId: "", withAccount: false, studentIds: [] }
  }));
  const student = (n, name, gender, circleId, dir, surah, ayah, plan, guardianId) => ({
    nationalId: `40000010${n}`, name, birth: "2012-05-10", gender, circleId, direction: dir,
    lastSurah: surah, lastAyah: ayah, ajkamCourse: "نورانية", monthlyPlanPages: plan, joinedAt: "2025-09-01",
    phoneCc: "970", phoneNational: n === 1 ? "0591000001" : "", guardianId
  });
  if (c1.data.id && wali.data.id) {
    await must("طالب 1", call("/api/students", { method: "POST", cookie, body: student(1, "عمر علي محمد بركات", "male", c1.data.id, "descending", 78, 12, 20, wali.data.id) }));
    await must("طالب 2 (أخوه)", call("/api/students", { method: "POST", cookie, body: student(2, "ياسين علي محمد بركات", "male", c1.data.id, "ascending", 2, 40, 15, wali.data.id) }));
  }
  if (c2.data.id && wali2.data.id) await must("طالبة 3", call("/api/students", { method: "POST", cookie, body: student(3, "ليان محمود سعيد عوض", "female", c2.data.id, "descending", 87, 5, 10, wali2.data.id) }));
}

await seedCenter("tarjuman-gaza-01", "مركز ترجمان القرآن", "gaza");
await seedCenter("tarjuman-rafah-02", "مركز الفرقان لتحفيظ القرآن", "rafah");
console.log(`\nتم. كل الحسابات كلمة مرورها: ${PASSWORD}`);
console.log("مثال: admin / gaza.teacher1 / gaza.secretary / gaza.committee / gaza.stage1 / gaza.student1 / 801000001 (ولي أمر بحساب: اسم المستخدم = كلمة المرور = رقم هويته)  — مركز tarjuman-gaza-01");
