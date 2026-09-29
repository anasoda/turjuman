// تكامل موضع بداية المراجعة وخطتي الطالب على قاعدة تطوير محلية مزروعة.
import assert from "node:assert/strict";

const base = process.env.API_BASE || "http://127.0.0.1:8787";
async function call(path, method = "GET", body, cookie) {
  const response = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: response.status, data: await response.json().catch(() => ({})), cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "" };
}
async function login(centerId, username) {
  const response = await call("/api/auth/login", "POST", { centerId, username, password: "Demo@2026pass" });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  return response.cookie;
}

const admin = await login("obai-01", "admin");
const teacher = await login("obai-01", "obai.teacher1");
const unrelatedTeacher = await login("obai-01", "obai.teacher3");
const otherCenter = await login("test-center-02", "other.teacher1");
const circles = (await call("/api/circles", "GET", undefined, teacher)).data.circles;
const circle = circles.find((c) => c.category === "male" && c.studentCount < 20);
assert.ok(circle, "لا توجد حلقة ذكور متاحة للمعلّم");
const students = (await call("/api/students", "GET", undefined, admin)).data.students;
const guardianId = students.find((s) => s.guardianId)?.guardianId;
assert.ok(guardianId, "لا يوجد ولي أمر في قاعدة التطوير");

const body = {
  nationalId: String(Math.floor(100000000 + Math.random() * 900000000)),
  name: "طالب فحص موضع المراجعة", birth: "2012-05-10", gender: "male", circleId: circle.id,
  guardianId, direction: "descending", lastSurah: 78, lastAyah: 12,
  reviewStartSurah: 67, reviewStartAyah: 5,
  monthlyPlanPages: 12, monthlyReviewPlanPages: 20
};
const created = await call("/api/students", "POST", body, teacher);
assert.equal(created.status, 201, JSON.stringify(created.data));
const id = created.data.id;
const student = (await call(`/api/students/${id}`, "GET", undefined, teacher)).data.student;
assert.equal(student.reviewSurah, 67);
assert.equal(student.reviewAyah, 5);
assert.equal(student.monthlyPlanPages, 12);
assert.equal(student.monthlyReviewPlanPages, 20);
assert.equal(student.hasReviewRecord, false);

const date = new Date().toISOString().slice(0, 10);
const board = await call(`/api/daily/board?date=${date}&circleId=${circle.id}`, "GET", undefined, teacher);
assert.equal(board.status, 200, JSON.stringify(board.data));
const row = board.data.rows.find((r) => r.student.id === id);
assert.deepEqual(row?.student.reviewLast, { surah: 67, ayah: 5 });
assert.ok(row?.student.reviewNext, "لم يُقترح الموضع التالي للمراجعة");

assert.equal((await call(`/api/students/${id}`, "PATCH", { reviewStartSurah: 2, reviewStartAyah: 287 }, teacher)).status, 400);
assert.equal((await call(`/api/students/${id}`, "PATCH", { reviewStartSurah: 2 }, teacher)).status, 400);
assert.equal((await call(`/api/students/${id}`, "PATCH", { reviewStartSurah: 70, reviewStartAyah: 4, monthlyPlanPages: 15, monthlyReviewPlanPages: 18 }, teacher)).status, 200);
assert.equal((await call(`/api/students/${id}`, "GET", undefined, teacher)).data.student.reviewSurah, 70);
assert.equal((await call(`/api/students/${id}`, "GET", undefined, teacher)).data.student.monthlyReviewPlanPages, 18);
assert.equal((await call(`/api/students/${id}`, "GET", undefined, otherCenter)).status, 404);
assert.equal((await call(`/api/students/${id}`, "PATCH", { reviewStartSurah: 71, reviewStartAyah: 1 }, otherCenter)).status, 404);
assert.equal((await call(`/api/students/${id}`, "GET", undefined, unrelatedTeacher)).status, 404);
assert.equal((await call(`/api/students/${id}`, "PATCH", { reviewStartSurah: 71, reviewStartAyah: 1 }, unrelatedTeacher)).status, 404);
const entries = (await call(`/api/schedule?circleId=${circle.id}`, "GET", undefined, admin)).data.entries;
const allowed = entries.length ? entries.map((e) => e.weekday) : [0, 1, 2, 3, 4, 5, 6];
let offset = 0;
while (!allowed.includes(new Date(Date.now() - offset * 864e5).getDay())) offset++;
const recitationDate = new Date(Date.now() - offset * 864e5).toISOString().slice(0, 10);
const recitation = await call("/api/daily", "POST", {
  studentId: id, date: recitationDate, attendance: "present",
  review: { from: { surah: 70, ayah: 4 }, to: { surah: 70, ayah: 5 }, grade: "" }
}, teacher);
assert.ok([200, 201].includes(recitation.status), JSON.stringify(recitation.data));
const afterReview = (await call(`/api/students/${id}`, "GET", undefined, teacher)).data.student;
assert.equal(afterReview.reviewSurah, 70);
assert.equal(afterReview.reviewAyah, 5);
assert.equal(afterReview.hasReviewRecord, true);
assert.equal((await call(`/api/students/${id}`, "PATCH", { reviewStartSurah: 71, reviewStartAyah: 1 }, teacher)).status, 400);
console.log("✓ موضع المراجعة والخطتان، الاقتراح اليومي، التحقق، وعزل المركز");
