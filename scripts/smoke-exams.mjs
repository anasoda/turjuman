// دورة الاختبار الرسمي على D1 محلية بعد البذرة: اقتراح ← اعتماد ← جلسة ← مسودة ← نتيجة.
import assert from "node:assert/strict";

const BASE = process.env.API_BASE || "http://127.0.0.1:8787";
const centerId = "obai-01";
const password = "Demo@2026pass";
const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Hebron" });
async function call(path, { method = "GET", body, cookie } = {}) {
  const res = await fetch(BASE + path, { method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, data: await res.json().catch(() => ({})), cookie: (res.headers.get("set-cookie") || "").split(";")[0] };
}
async function login(username) {
  const res = await call("/api/auth/login", { method: "POST", body: { centerId, username, password } });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  return res.cookie;
}

const teacher = await login("obai.teacher1");
const committee = await login("obai.committee");
const students = (await call("/api/students?pageSize=100", { cookie: teacher })).data.students;
const open = (await call("/api/tests?pageSize=50", { cookie: teacher })).data.tests.filter((t) => t.kind === "official" && ["proposed", "approved"].includes(t.status));
const student = students.find((s) => !open.some((t) => t.studentId === s.id));
assert.ok(student, "لا يوجد طالب متاح للاختبار");
const created = [];
try {
  const trial = await call("/api/tests/trial", { method: "POST", cookie: teacher, body: { studentId: student.id, date: today, testType: "single", parts: 1, range: { kind: "juz", fromJuz: 2, toJuz: 4 }, score: 90 } });
  assert.equal(trial.status, 201, JSON.stringify(trial.data));
  created.push(trial.data.id);
  const savedTrial = (await call("/api/tests?kind=trial&pageSize=50", { cookie: teacher })).data.tests.find((t) => t.id === trial.data.id);
  assert.equal(savedTrial.parts, 3);
  assert.equal(savedTrial.rangeKind, "juz");
  assert.equal(savedTrial.rangeFromJuz, 2);
  assert.equal(savedTrial.rangeToJuz, 4);

  const proposalId = crypto.randomUUID();
  const proposalBody = { studentIds: [student.id], proposals: [{ studentId: student.id, id: proposalId }], testType: "chain", parts: 1, range: { kind: "surah", fromSurah: 1, toSurah: 2 } };
  const propose = await call("/api/tests/propose", { method: "POST", cookie: teacher, body: proposalBody });
  assert.equal(propose.status, 201, JSON.stringify(propose.data));
  assert.equal((await call("/api/tests/propose", { method: "POST", cookie: teacher, body: proposalBody })).status, 201, "إعادة إرسال الاقتراح لا تكرره");
  const official = (await call("/api/tests?status=proposed&pageSize=50", { cookie: committee })).data.tests.find((t) => t.studentId === student.id);
  assert.ok(official);
  assert.equal(official.id, proposalId);
  created.push(official.id);
  assert.equal(official.rangeKind, "surah");
  assert.equal(official.parts, 3);
  assert.equal(official.rangeFromSurah, 1);
  assert.equal(official.rangeToSurah, 2);
  assert.equal((await call(`/api/tests/${official.id}/session`, { method: "POST", cookie: committee })).status, 400);
  assert.equal((await call(`/api/tests/${official.id}/approve`, { method: "POST", cookie: committee, body: { testDate: today } })).status, 200);
  assert.equal((await call(`/api/tests/${official.id}/approve`, { method: "POST", cookie: committee, body: { testDate: today } })).status, 200, "إعادة الاعتماد لا تكرر التنبيه");
  assert.equal((await call(`/api/tests/${official.id}/result`, { method: "POST", cookie: committee, body: { score: 90, testDate: today } })).status, 400);
  const start = await call(`/api/tests/${official.id}/session`, { method: "POST", cookie: committee });
  assert.equal(start.status, 201, JSON.stringify(start.data));
  assert.equal((await call(`/api/tests/${official.id}/session`, { method: "POST", cookie: committee })).data.sessionId, start.data.sessionId);
  const session = (await call(`/api/tests/${official.id}/session`, { cookie: committee })).data;
  assert.equal(session.test.studentId, student.id);
  assert.equal(session.questions.reduce((sum, q) => sum + q.maxScore, 0), 100);
  const questions = session.questions.map((q, i) => ({ id: `offline:${official.id}:${q.seq}`, seq: q.seq, surah: i === 1 ? 2 : null, ayah: i === 1 ? 255 : null, warnings: i === 0 ? 1 : 0, errors: i === 0 ? 2 : 0 }));
  assert.equal((await call(`/api/tests/${official.id}/session`, { method: "PUT", cookie: teacher, body: { questions } })).status, 403);
  const outsideRange = questions.map((q, i) => i === 1 ? { ...q, surah: 114, ayah: 1 } : q);
  assert.equal((await call(`/api/tests/${official.id}/session`, { method: "PUT", cookie: committee, body: { questions: outsideRange } })).status, 400, "موضع السؤال خارج النطاق");
  const badAyah = questions.map((q, i) => i === 1 ? { ...q, surah: 1, ayah: 99 } : q);
  assert.equal((await call(`/api/tests/${official.id}/session`, { method: "PUT", cookie: committee, body: { questions: badAyah } })).status, 400, "رقم الآية غير صالح");
  const draft = await call(`/api/tests/${official.id}/session`, { method: "PUT", cookie: committee, body: { questions } });
  assert.equal(draft.status, 200, JSON.stringify(draft.data));
  assert.equal(draft.data.totalScore, 97.5);
  const savedDraft = (await call(`/api/tests/${official.id}/session`, { cookie: committee })).data;
  assert.equal(savedDraft.questions[0].surah, null);
  assert.equal("text" in savedDraft.questions[0], false);
  assert.equal(savedDraft.questions[1].ayah, 255);
  const finish = await call(`/api/tests/${official.id}/session`, { method: "PUT", cookie: committee, body: { questions, finalize: true, testDate: today } });
  assert.equal(finish.status, 200, JSON.stringify(finish.data));
  assert.equal(finish.data.totalScore, 97.5);
  assert.equal((await call(`/api/tests/${official.id}/session`, { cookie: teacher })).data.session.status, "completed");
  assert.equal((await call(`/api/tests/${official.id}/session`, { method: "PUT", cookie: committee, body: { questions, finalize: true, testDate: today } })).status, 200, "إعادة إرسال النتيجة لا تكرر الإشعار");
  console.log("✓ دورة الاختبار الكاملة والنطاق والنتيجة والصلاحيات");
} finally {
  const admin = await login("admin");
  for (const id of created) {
    const deleted = await call(`/api/tests/${id}`, { method: "DELETE", cookie: admin });
    assert.equal(deleted.status, 200, `تنظيف الاختبار ${id}: ${JSON.stringify(deleted.data)}`);
  }
}

// نسبة الاختبار لحلقة الطالب وقت التسجيل لا حلقته الحالية (هجرة 0021؛ نفس خلل السرد في 0020)
await (async () => {
  const admin = await login("admin");
  const circles = (await call("/api/circles", { cookie: admin })).data.circles;
  const fajr = circles.find((c) => c.name === "حلقة الفجر");
  const yaqeen = circles.find((c) => c.name === "حلقة اليقين");
  assert.ok(fajr && yaqeen, "البذرة تحتاج حلقتي الفجر واليقين");
  const stamp = Date.now().toString().slice(-6);
  const ph = `0599${stamp}`;
  const created2 = await call("/api/students", {
    method: "POST", cookie: admin,
    body: {
      nationalId: `9${stamp}01`, name: "طالب نسبة اختبار للحلقة", birth: "2012-01-01", gender: "male", circleId: fajr.id,
      direction: "descending", lastSurah: 114, lastAyah: 0, monthlyPlanPages: 5,
      guardian: { name: "ولي نسبة اختبار", relation: "father", callPhone: ph, waCc: "970", waNational: ph, nationalId: "" }
    }
  });
  assert.equal(created2.status, 201, JSON.stringify(created2.data));
  const sid = created2.data.id;
  const testIds = [];
  try {
    const trial = await call("/api/tests/trial", { method: "POST", cookie: admin, body: { studentId: sid, date: today, testType: "single", parts: 1, range: { kind: "juz", fromJuz: 1, toJuz: 1 }, score: 80 } });
    assert.equal(trial.status, 201, JSON.stringify(trial.data));
    testIds.push(trial.data.id);
    const listed = (await call("/api/tests?kind=trial&pageSize=50", { cookie: admin })).data.tests.find((t) => t.id === trial.data.id);
    assert.equal(listed.circleName, fajr.name, "الاختبار يُنسَب لحلقة الطالب وقت التسجيل");

    const day = Number(today.slice(8, 10));
    if (day < 25) {
      const moved = await call(`/api/students/${sid}/move`, { method: "POST", cookie: admin, body: { circleId: yaqeen.id, reason: "اختبار نسبة السجلات" } });
      assert.equal(moved.status, 200, JSON.stringify(moved.data));
      assert.equal(moved.data.immediate, true, JSON.stringify(moved.data));
      const afterMove = (await call("/api/tests?kind=trial&pageSize=50", { cookie: admin })).data.tests.find((t) => t.id === trial.data.id);
      assert.equal(afterMove.circleName, fajr.name, "الاختبار القديم يبقى منسوباً للحلقة القديمة بعد نقل فوري");
      console.log("✓ نسبة الاختبار التاريخية تصمد أمام النقل الفوري");
    } else {
      console.log(`… تخطي فحص النقل الفوري لنسبة الاختبار (اليوم ${day} ضمن نافذة الترتيب لا الفوري؛ راجع smoke-phase9 لتغطية النقل المرتَّب)`);
    }
  } finally {
    for (const id of testIds) await call(`/api/tests/${id}`, { method: "DELETE", cookie: admin });
    await call(`/api/students/${sid}/archive`, { method: "POST", cookie: admin, body: { reason: "تنظيف اختبار نسبة السجلات" } });
  }
})();
