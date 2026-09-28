import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

// بيئة المتصفح المصغّرة التي تحتاجها وحدات الواجهة
const store = new Map<string, string>();
vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) });
vi.stubGlobal("window", { location: { href: "http://localhost/?center=c1" }, history: { replaceState() {} }, dispatchEvent() {}, addEventListener() {} });
vi.stubGlobal("document", { addEventListener() {} });
vi.stubGlobal("navigator", { onLine: true });

const { api, setApiUser, flushNow, isQueued, clearLocalData, syncOfflineData } = await import("../../src/lib/api");
const { outboxAll, getSyncState, cachePut } = await import("../../src/lib/offline");

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(async () => {
  vi.unstubAllGlobals;
  vi.stubGlobal("navigator", { onLine: true });
  await clearLocalData();
  for (const item of await outboxAll()) {
    const { outboxDelete } = await import("../../src/lib/offline");
    await outboxDelete(item.id!);
  }
  setApiUser("u1");
});

describe("العمل دون إنترنت", () => {
  it("الاختبار الرسمي كاملاً: اقتراح واعتماد وجلسة ومسودة ونتيجة ثم مزامنة تلقائية مرتبة", async () => {
    const prefix = "obai-01:u1:";
    await cachePut("obai-01:me", {
      user: { id: "u1", displayName: "اللجنة" },
      settings: { minPassScore: 70, examQuestionSlots: [{ label: "الأول", maxScore: 50 }, { label: "الثاني", maxScore: 50 }] }
    });
    await cachePut(`${prefix}offline:students:active`, { students: [{ id: "s1", name: "أحمد", circleName: "الأولى" }] });
    await cachePut(`${prefix}offline:tests:all`, { tests: [] });
    vi.stubGlobal("navigator", { onLine: false });
    const proposal = await api("/api/tests/propose", { method: "POST", body: { studentIds: ["s1"], testType: "single", parts: 1, range: { kind: "juz", fromJuz: 1, toJuz: 1 } } });
    expect(isQueued(proposal)).toBe(true);
    const proposed = await api<{ tests: Array<{ id: string; status: string; pending: boolean }>; total: number }>("/api/tests?page=1&status=proposed&q=");
    expect(proposed).toMatchObject({ total: 1, tests: [{ status: "proposed", pending: true }] });
    const testId = proposed.tests[0].id;
    expect(isQueued(await api(`/api/tests/${testId}/approve`, { method: "POST", body: { testDate: "2026-09-27", notes: "جاهز" } }))).toBe(true);
    expect((await api<{ tests: Array<{ status: string }> }>("/api/tests?page=1&status=approved&q=")).tests[0].status).toBe("approved");
    expect(isQueued(await api(`/api/tests/${testId}/session`, { method: "POST" }))).toBe(true);
    const session = await api<{ questions: Array<{ id: string; seq: number }>; session: { status: string } }>(`/api/tests/${testId}/session`);
    expect(session.questions).toHaveLength(2);
    expect(session.session.status).toBe("draft");
    const questions = session.questions.map((q) => ({ id: q.id, seq: q.seq, surah: null, ayah: null, warnings: q.seq === 1 ? 2 : 0, errors: 0 }));
    expect(isQueued(await api(`/api/tests/${testId}/session`, { method: "PUT", body: { questions, finalize: false, testDate: "2026-09-27", notes: "مسودة" } }))).toBe(true);
    expect((await api<{ questions: Array<{ warnings: number }> }>(`/api/tests/${testId}/session`)).questions[0].warnings).toBe(2);
    expect(isQueued(await api(`/api/tests/${testId}/session`, { method: "PUT", body: { questions, finalize: true, testDate: "2026-09-27", notes: "نهائي" } }))).toBe(true);
    expect((await api<{ tests: Array<{ score: number; status: string }> }>("/api/tests?page=1&status=completed&q=")).tests[0]).toMatchObject({ status: "completed", score: 99 });
    const sent: Array<{ path: string; method: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (path: string, init: RequestInit) => {
      sent.push({ path, method: String(init.method), body: JSON.parse(String(init.body)) });
      return json(200, { ok: true });
    }));
    await flushNow();
    expect(sent.map((s) => `${s.method} ${s.path}`)).toEqual([
      "POST /api/tests/propose", `POST /api/tests/${testId}/approve`, `POST /api/tests/${testId}/session`,
      `PUT /api/tests/${testId}/session`, `PUT /api/tests/${testId}/session`
    ]);
    expect((sent[0].body.proposals as Array<{ id: string }>)[0].id).toBe(testId);
    expect((sent[4].body.questions as Array<{ seq: number }>)[0].seq).toBe(1);
    expect(await outboxAll()).toHaveLength(0);
  });
  it("لا يعيد هوية مستخدم من الكاش بعد انتهاء الجلسة", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json(200, { user: { id: "u1" } })));
    expect(await api("/api/auth/me")).toEqual({ user: { id: "u1" } });
    await new Promise((r) => setTimeout(r, 20));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json(401, { error: "الجلسة منتهية" })));
    await expect(api("/api/students")).rejects.toThrow("الجلسة منتهية");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(api("/api/auth/me")).rejects.toThrow("تعذّر الاتصال");
  });

  it("قراءة GET: تُخدَم من الكاش عند انقطاع الشبكة", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json(200, { students: [{ id: "s1" }] })));
    expect(await api("/api/students")).toEqual({ students: [{ id: "s1" }] });
    await new Promise((r) => setTimeout(r, 20)); // انتظار حفظ الكاش
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    expect(await api("/api/students")).toEqual({ students: [{ id: "s1" }] });
    expect(getSyncState().servedFromCache).toBe(true);
  });

  it("القراءة بلا كاش وبلا شبكة تفشل برسالة واضحة", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(api("/api/never-fetched")).rejects.toThrow("تعذّر الاتصال");
  });

  it("الكتابة الميدانية تُحفظ في الصندوق عند انقطاع الشبكة ثم تُرسل بالترتيب", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const r1 = await api("/api/daily", { body: { studentId: "s1", date: "2026-09-01", attendance: "absent" } });
    const r2 = await api("/api/sard", { body: { studentId: "s1", date: "2026-09-02" } });
    expect(isQueued(r1) && isQueued(r2)).toBe(true);
    expect((await outboxAll()).map((i) => i.path)).toEqual(["/api/daily", "/api/sard"]);
    expect(getSyncState().pending).toBe(2);

    const sent: Array<{ path: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (path: string, init: RequestInit) => { sent.push({ path, body: JSON.parse(String(init.body)) }); return json(201, { ok: true }); }));
    await flushNow();
    expect(sent.map((s) => s.path)).toEqual(["/api/daily", "/api/sard"]);
    expect(typeof sent[1].body.id).toBe("string"); // معرّف من الجهاز للسرد => لا تكرار عند إعادة الإرسال
    expect(await outboxAll()).toHaveLength(0);
    expect(getSyncState().pending).toBe(0);
  });

  it("ما يرفضه الخادم يبقى للمراجعة ويوقف السجلات التالية", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await api("/api/daily", { body: { a: 1 } });
    await api("/api/daily", { body: { a: 2 } });
    const sender = vi.fn().mockResolvedValueOnce(json(400, { error: "نهاية التسميع يجب ألا تسبق بدايته" })).mockRejectedValueOnce(new TypeError("offline"));
    vi.stubGlobal("fetch", sender);
    await flushNow();
    const left = await outboxAll();
    expect(left).toHaveLength(2);
    expect(left[0].status).toBe("rejected");
    expect((left[1].body as { a: number }).a).toBe(2);
    expect(sender).toHaveBeenCalledTimes(1);
    expect(getSyncState().rejected).toBe(1);
    expect(getSyncState().failures).toContain("نهاية التسميع يجب ألا تسبق بدايته");
  });

  it("حضور الكادر والكشف الشهري يُحفظان ويظهران محلياً قبل المزامنة", async () => {
    const dayPath = "/api/staff-attendance?date=2026-09-27";
    const reportPath = "/api/reports?month=2026-09&circleId=c1";
    vi.stubGlobal("fetch", vi.fn(async (path: string) => json(200, path === dayPath
      ? { rows: [{ id: "teacher1", status: null, note: null }] }
      : { rows: [{ studentId: "s1", direction: "descending", planPages: 10, reviewPlanPages: 0, saved: false, daily: [], start: null, end: null, present: 0, late: 0, absent: 0, excused: 0, verses: 0, pages: 0, percent: 0, reviewPages: 0, reviewPercent: 0, reviewDays: 0 }] })));
    await api(dayPath);
    await api(reportPath);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    expect(isQueued(await api("/api/staff-attendance", { body: { userId: "teacher1", date: "2026-09-27", status: "late", note: "تأخر" } }))).toBe(true);
    expect(isQueued(await api("/api/daily", { body: { studentId: "s1", date: "2026-09-27", attendance: "present", from: { surah: 114, ayah: 1 }, to: { surah: 114, ayah: 3 }, grade: "", review: null, note: "" } }))).toBe(true);
    const day = await api<{ rows: Array<{ status: string; pending: boolean }> }>(dayPath);
    expect(day.rows[0]).toMatchObject({ status: "late", pending: true });
    const report = await api<{ rows: Array<{ present: number; pages: number; pending: boolean }> }>(reportPath);
    expect(report.rows[0]).toMatchObject({ present: 1, pages: 1, pending: true });
    expect(isQueued(await api("/api/reports/save", { body: { month: "2026-09", rows: [{ studentId: "s1", end: { surah: 114, ayah: 3 } }] } }))).toBe(true);
    expect((await api<{ rows: Array<{ saved: boolean; pending: boolean }> }>(reportPath)).rows[0]).toMatchObject({ saved: true, pending: true });
  });

  it("المزامنة التلقائية تجلب اللوحة والكشف وحضور الكادر دون طلب من الواجهة", async () => {
    const paths: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (path: string) => {
      paths.push(path);
      return json(200, path === "/api/auth/me" ? { user: { id: "u1" }, center: { id: "obai-01" } }
        : path === "/api/circles" ? { circles: [{ id: "c1", active: true }] }
        : path.startsWith("/api/students?") && path.includes("pageSize=100&page=") ? { students: [{ id: "s1", name: "أحمد", nationalId: "123", phoneNational: "0591234567", circleId: "c1" }], total: 1 }
        : { rows: [] });
    }));
    await api("/api/notes?studentId=s1");
    paths.length = 0;
    expect(await syncOfflineData("admin", "2026-09-27")).toBeGreaterThan(0);
    expect(paths).toContain("/api/notes?studentId=s1");
    expect(paths).toContain("/api/daily/board?date=2026-09-27&circleId=c1");
    expect(paths).toContain("/api/reports?month=2026-09&circleId=c1");
    expect(paths).toContain("/api/staff-attendance?date=2026-09-27");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    expect(await api("/api/daily/board?date=2026-09-27&circleId=c1")).toEqual({ rows: [] });
    const searched = await api<{ students: Array<{ id: string }>; total: number }>("/api/students?page=1&pageSize=30&q=أحمد");
    expect(searched).toMatchObject({ total: 1, students: [{ id: "s1" }] });
  });

  it("لوحة التسميع تعرض آخر حضور وحفظ معلّقين للطالب نفسه", async () => {
    const path = "/api/daily/board?date=2026-09-27&circleId=c1";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(200, { rows: [{ student: { id: "s1", direction: "descending" }, record: null }] })));
    await api(path);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    await api("/api/daily", { body: { studentId: "s1", date: "2026-09-27", attendance: "absent", from: null, to: null, grade: "", review: null, note: "" } });
    await api("/api/daily", { body: { studentId: "s1", date: "2026-09-27", attendance: "present", from: { surah: 114, ayah: 1 }, to: { surah: 114, ayah: 4 }, grade: "جيد", review: null, note: "" } });
    const board = await api<{ rows: Array<{ record: { attendance: string; verses: number; pages: number; pending: boolean } }> }>(path);
    expect(board.rows[0].record).toMatchObject({ attendance: "present", verses: 4, pages: 1, pending: true });
  });

  it("انتهاء الجلسة (401) يوقف الإرسال ويُبقي الصندوق", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await api("/api/daily", { body: { a: 1 } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(401, { error: "الجلسة منتهية" })));
    await flushNow();
    expect(await outboxAll()).toHaveLength(1);
  });

  it("لا يُرسل صندوق مستخدم لمستخدم آخر", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await api("/api/daily", { body: { a: 1 } });
    setApiUser("u2");
    const spy = vi.fn().mockResolvedValue(json(201, { ok: true }));
    vi.stubGlobal("fetch", spy);
    await flushNow();
    expect(spy).not.toHaveBeenCalled();
    expect(await outboxAll()).toHaveLength(1);
  });

  it("أخطاء التحقق (400) لا تُحفظ في الصندوق بل تظهر فوراً", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(400, { error: "بيانات غير صالحة" })));
    await expect(api("/api/daily", { body: { a: 1 } })).rejects.toThrow("بيانات غير صالحة");
    expect(await outboxAll()).toHaveLength(0);
  });
});
