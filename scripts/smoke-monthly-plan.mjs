// فحص عزل الخطة حسب الشهر على D1 محلية مزروعة، في نافذة الأيام الخمسة الأخيرة.
import assert from "node:assert/strict";

const base = process.env.API_BASE || "http://127.0.0.1:8787";
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hebron", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const current = today.slice(0, 7);
const next = new Date(Date.UTC(Number(current.slice(0, 4)), Number(current.slice(5, 7)), 1)).toISOString().slice(0, 7);
const later = new Date(Date.UTC(Number(next.slice(0, 4)), Number(next.slice(5, 7)), 1)).toISOString().slice(0, 7);
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
const teacher = await login("obai-01", "obai.teacher1");
const otherTeacher = await login("obai-01", "obai.teacher3");
const otherCenter = await login("test-center-02", "other.teacher1");
const circles = (await call("/api/circles", "GET", undefined, teacher)).data.circles;
const circle = circles.find((c) => c.category === "male" && c.studentCount < 20);
assert.ok(circle, "لا توجد حلقة متاحة");
const guardianId = (await call("/api/students", "GET", undefined, admin)).data.students.find((s) => s.guardianId)?.guardianId;
assert.ok(guardianId);
const created = await call("/api/students", "POST", {
  nationalId: String(Math.floor(100000000 + Math.random() * 900000000)), name: "طالب تجربة الخطة الشهرية",
  birth: "2013-01-02", gender: "male", circleId: circle.id, guardianId,
  direction: "descending", lastSurah: 114, lastAyah: 0, monthlyPlanPages: 10, monthlyReviewPlanPages: 4
}, teacher);
assert.equal(created.status, 201, JSON.stringify(created.data));
const id = created.data.id;
const path = (month) => `/api/students/${id}/plan?month=${month}`;
assert.equal((await call(path(current), "GET", undefined, teacher)).data.monthlyPlanPages, 10);
assert.equal((await call(path(next), "GET", undefined, teacher)).data.monthlyPlanPages, 0);
const set = await call(`/api/students/${id}/plan`, "PUT", { month: next, monthlyPlanPages: 22, monthlyReviewPlanPages: 15 }, teacher);
assert.equal(set.status, 200, JSON.stringify(set.data));
assert.equal((await call(path(next), "GET", undefined, teacher)).data.monthlyReviewPlanPages, 15);
assert.equal((await call(path(current), "GET", undefined, teacher)).data.monthlyPlanPages, 10);
const sep = await call(`/api/reports?month=${current}&circleId=${circle.id}`, "GET", undefined, admin);
const oct = await call(`/api/reports?month=${next}&circleId=${circle.id}`, "GET", undefined, admin);
assert.equal(sep.data.rows.find((r) => r.studentId === id)?.planPages, 10);
assert.equal(oct.data.rows.find((r) => r.studentId === id)?.planPages, 22);
assert.equal(oct.data.rows.find((r) => r.studentId === id)?.reviewPlanPages, 15);
const board = await call(`/api/daily/board?date=${next}-01&circleId=${circle.id}`, "GET", undefined, teacher);
assert.equal(board.status, 200, JSON.stringify(board.data));
assert.equal(board.data.rows.find((r) => r.student.id === id)?.student.monthlyReviewPlanPages, 15);
assert.equal((await call(path(next), "GET", undefined, otherTeacher)).status, 404);
assert.equal((await call(`/api/students/${id}/plan`, "PUT", { month: next, monthlyPlanPages: 5, monthlyReviewPlanPages: 5 }, otherCenter)).status, 404);
assert.equal((await call(`/api/students/${id}/plan`, "PUT", { month: later, monthlyPlanPages: 5, monthlyReviewPlanPages: 5 }, teacher)).status, 400);
console.log("✓ خطة كل شهر مستقلة، نافذة الإدخال، الكشف، وعزل المحفّظ والمركز");
