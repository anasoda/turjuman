import { getCenterId } from "./center";
import { cacheClear, cacheDelete, cacheGet, cacheKeys, cachePut, enqueue, flushOutbox, getSyncState, isQueueable, refreshPending, setSyncState, type OutboxItem } from "./offline";
import { overlayPending } from "./offline-view";
import { offlineExamGet, type OfflineTestRow } from "./offline-exams";
import { todayIso } from "./format";
import type { MeResponse, Student } from "./types";

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export const SESSION_EXPIRED_EVENT = "tq-session-expired";
export const SYNC_UPDATED_EVENT = "tq-sync-updated";

interface Options {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
}

/** `reason: "login"` = حُفظ لأن الجلسة انتهت (لا لانقطاع الشبكة) ويُرسل بعد تسجيل الدخول */
export interface Queued { ok: true; queued: true; reason?: "offline" | "login" }
export const isQueued = (r: unknown): r is Queued => !!r && typeof r === "object" && (r as Queued).queued === true;

let currentUserId = "";
/** المستخدم الحالي: يربط الكاش وصندوق الصادر بصاحبهما. */
export function setApiUser(id: string) {
  currentUserId = id;
}

/** طلب واحد بلا تخزين: يرمي ApiError برسالة عربية (status 0 = تعذّر الاتصال). */
async function request<T>(path: string, method: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch {
    throw new ApiError("تعذّر الاتصال بالخادم، تحقق من الإنترنت", 0);
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/api/auth/login") && !path.startsWith("/api/auth/change-password")) {
      await cacheClear();
      setSyncState({ servedFromCache: false });
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    }
    throw new ApiError(data.error || "حدث خطأ غير متوقع", res.status);
  }
  return data as T;
}

// /api/auth/me لا يرتبط بمعرّف مستخدم: يُقرأ عند فتح التطبيق قبل معرفة المستخدم
const cacheKeyFor = (path: string, userId: string) => (path === "/api/auth/me" ? `${getCenterId()}:me` : `${getCenterId()}:${userId}:${path}`);
const cacheKey = (path: string) => cacheKeyFor(path, currentUserId);

/** قائمة الطلاب المحلية تغطي البحث والتصفية والترقيم حتى لو لم يُفتح المسار نفسه سابقاً. */
async function offlineStudentList<T>(path: string): Promise<T | undefined> {
  const url = new URL(path, "https://local.invalid");
  if (url.pathname !== "/api/students" || !currentUserId) return undefined;
  const archived = url.searchParams.get("archived") === "1";
  const source = await cacheGet<{ students: Student[] }>(cacheKey(`offline:students:${archived ? "archived" : "active"}`));
  if (!source) return undefined;
  const query = (url.searchParams.get("q") ?? "").trim().toLocaleLowerCase();
  const circleId = url.searchParams.get("circleId") ?? "";
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize")) || 30));
  const rows = source.students.filter((student) => (!circleId || student.circleId === circleId)
    && (!query || [student.name, student.nationalId, student.phoneNational].some((value) => value?.toLocaleLowerCase().includes(query))));
  return { students: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize } as T;
}

/** قراءة: من الخادم أولاً (وتُخزَّن)، وعند انقطاع الشبكة من آخر نسخة محفوظة. */
async function cachedGet<T>(path: string): Promise<T> {
  try {
    const data = await request<T>(path, "GET", undefined);
    setSyncState({ online: true, servedFromCache: false });
    await cachePut(cacheKey(path), data);
    return overlayPending(path, data, currentUserId);
  } catch (e) {
    if (e instanceof ApiError && e.status === 0) {
      const exam = await offlineExamGet<T>(path, currentUserId);
      if (exam !== undefined) {
        setSyncState({ online: false, servedFromCache: true });
        return exam;
      }
      const cached = await cacheGet<T>(cacheKey(path));
      if (cached !== undefined) {
        setSyncState({ online: false, servedFromCache: true });
        return overlayPending(path, cached, currentUserId);
      }
      const derived = await offlineStudentList<T>(path);
      if (derived !== undefined) {
        setSyncState({ online: false, servedFromCache: true });
        return overlayPending(path, derived, currentUserId);
      }
    }
    throw e;
  }
}

/** كتابة ميدانية: تُرسل الآن، وإن انقطعت الشبكة تُحفظ في صندوق الصادر وتُرسل لاحقاً. */
async function queueableWrite<T>(path: string, method: "POST" | "PUT", body: unknown): Promise<T | Queued> {
  const payload = path === "/api/tests/propose"
    ? { ...(body as object), proposals: (body as { studentIds: string[] }).studentIds.map((studentId) => ({ studentId, id: crypto.randomUUID() })) }
    : path === "/api/daily" || method === "PUT" ? body : { id: crypto.randomUUID(), ...(body as object) };
  let reason: "offline" | "login" = "offline";
  if (navigator.onLine) {
    try {
      return await request<T>(path, method, payload);
    } catch (e) {
      // انقطاع الشبكة أو انتهاء الجلسة: يُحفظ محلياً ويُرسل بعد عودة الاتصال/الدخول
      if (!(e instanceof ApiError && (e.status === 0 || e.status === 401))) throw e;
      if (e.status === 401) reason = "login";
    }
  }
  await enqueue(currentUserId, path, payload, method);
  // انتهاء الجلسة ليس انقطاعاً: لا نعلن «بلا إنترنت» والاتصال سليم
  if (reason === "offline") setSyncState({ online: false });
  return { ok: true, queued: true, reason };
}

export async function api<T = unknown>(path: string, opts: Options = {}): Promise<T> {
  const method = opts.method ?? (opts.body === undefined ? "GET" : "POST");
  if (method === "GET") return cachedGet<T>(path);
  if (isQueueable(method, path)) return (await queueableWrite<T>(path, method as "POST" | "PUT", opts.body)) as T;
  return request<T>(path, method, opts.body);
}

export const centerQuery = () => `centerId=${encodeURIComponent(getCenterId())}`;

/** يحدّث تلقائياً كل المسارات المقروءة سابقاً والبيانات الأساسية المتاحة لهذا الدور. */
export async function syncOfflineData(role: string, date = todayIso()): Promise<number> {
  const userId = currentUserId;
  if (!userId || !navigator.onLine) return 0;
  const month = date.slice(0, 7);
  const days = Array.from({ length: 7 }, (_, offset) => new Date(Date.parse(`${date}T12:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10));
  const months = [...new Set(days.map((day) => day.slice(0, 7)))];
  let updated = 0;
  const onlineGet = async <T>(path: string): Promise<T> => {
    const data = await request<T>(path, "GET", undefined);
    if (currentUserId === userId) { await cachePut(cacheKeyFor(path, userId), data); updated++; }
    return data;
  };
  const session = await onlineGet<MeResponse>("/api/auth/me");
  if (session.user.id !== userId || session.center.id !== getCenterId()) {
    await cacheClear();
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    throw new ApiError("تغيّر الحساب؛ سجّل الدخول من جديد", 401);
  }
  const canStudents = ["admin", "secretary", "teacher", "stage_manager", "exam_committee"].includes(role);
  const canDaily = ["admin", "secretary", "teacher", "stage_manager"].includes(role);
  const canStaff = ["admin", "secretary", "stage_manager"].includes(role);
  const prefix = `${getCenterId()}:${userId}:`;
  const paths = new Set((await cacheKeys()).filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length))
    .filter((path) => path.startsWith("/api/") && path !== "/api/export"));
  const add = (...items: string[]) => items.forEach((path) => paths.add(path));
  add("/api/prayer", "/api/notifications", "/api/notifications/count", `/api/honor?month=${month}`);

  if (canStudents) {
    const circles = await onlineGet<{ circles: Array<{ id: string; active: boolean }> }>("/api/circles");
    add("/api/circles", "/api/students?pageSize=100", "/api/students?pageSize=1",
      "/api/students?page=1&pageSize=30", "/api/students?page=1&pageSize=30&q=",
      "/api/courses", "/api/announcements", "/api/sard?page=1&q=", "/api/tests?page=1&status=&q=",
      "/api/settings", "/api/schedule");
    if (role === "exam_committee") add("/api/tests?page=1&status=proposed&q=");
    if (canDaily) add("/api/absences", "/api/announcements/scopes");
    for (const circle of circles.circles.filter((c) => c.active)) {
      if (canDaily) for (const day of days) add(`/api/daily/board?date=${day}&circleId=${circle.id}`);
      for (const reportMonth of months) add(`/api/reports?month=${reportMonth}&circleId=${circle.id}`);
    }
    // تحميل قائمة الطلاب كلها يسمح بالبحث والتصفية محلياً حتى لطلب لم يُفتح سابقاً.
    for (const archived of role === "admin" || role === "secretary" ? [false, true] : [false]) {
      const students: Student[] = [];
      for (let page = 1; ; page++) {
        const path = `/api/students?${archived ? "archived=1&" : ""}pageSize=100&page=${page}`;
        const result = await onlineGet<{ students: Student[]; total: number }>(path);
        students.push(...result.students);
        if (students.length >= result.total || !result.students.length) break;
      }
      if (currentUserId === userId) await cachePut(cacheKeyFor(`offline:students:${archived ? "archived" : "active"}`, userId), { students });
    }
    const tests: OfflineTestRow[] = [];
    for (let page = 1; ; page++) {
      const result = await onlineGet<{ tests: OfflineTestRow[]; total: number }>(`/api/tests?page=${page}&pageSize=50`);
      tests.push(...(result.tests ?? []));
      if (tests.length >= (result.total ?? 0) || !result.tests?.length) break;
    }
    if (currentUserId === userId) await cachePut(cacheKeyFor("offline:tests:all", userId), { tests });
    for (const test of tests) if (test.kind === "official" && test.status === "approved" && test.sessionId) add(`/api/tests/${test.id}/session`);
  } else if (role === "guardian") {
    const children = await onlineGet<{ children: Array<{ id: string }> }>("/api/guardians/children");
    add("/api/guardians/children", "/api/portal/summary");
    for (const child of children.children) add(`/api/portal/summary?studentId=${child.id}`, `/api/absences/mine?studentId=${child.id}`, `/api/schedule?studentId=${child.id}`);
  }
  if (role === "admin" || role === "secretary") add("/api/staff", "/api/guardians", "/api/guardians/orphans", "/api/stats/overview?months=6", "/api/stats/students", "/api/stats/teachers", "/api/students?archived=1&pageSize=30&page=1");
  if (role === "teacher") add("/api/guardians");
  if (role === "stage_manager" || role === "exam_committee") add("/api/stats/overview?months=6", "/api/stats/students");
  if (canStaff) {
    for (const day of days) add(`/api/staff-attendance?date=${day}`);
    for (const reportMonth of months) add(`/api/staff-attendance/summary?month=${reportMonth}`);
  }
  if (role === "admin") add("/api/audit?q=", "/api/stats/teachers");

  const queue = [...paths];
  let authFailed = false;
  let networkFailed = false;
  const worker = async () => {
    while (queue.length && !authFailed && currentUserId === userId) {
      const path = queue.shift()!;
      try { await onlineGet(path); }
      catch (error) {
        if (error instanceof ApiError && error.status === 401) { authFailed = true; throw error; }
        if (error instanceof ApiError && error.status === 0) networkFailed = true;
        if (error instanceof ApiError && (error.status === 403 || error.status === 404)) await cacheDelete(cacheKeyFor(path, userId));
      }
    }
  };
  const results = await Promise.allSettled(Array.from({ length: Math.min(4, queue.length) }, () => worker()));
  if (authFailed) {
    await cacheClear();
    throw results.find((result): result is PromiseRejectedResult => result.status === "rejected")?.reason;
  }
  if (networkFailed) throw new ApiError("انقطع الاتصال أثناء المزامنة", 0);
  return updated;
}

/* ---------------- تشغيل المزامنة ---------------- */
async function sendItem(item: OutboxItem): Promise<{ status: number; error?: string }> {
  const res = await fetch(item.path, { method: item.method, credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(item.body) });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return { status: res.status, error: data.error };
}

export const flushNow = async (): Promise<void> => {
  if (!currentUserId) return;
  const before = getSyncState().pending;
  await flushOutbox(currentUserId, sendItem);
  if (getSyncState().pending < before) window.dispatchEvent(new Event(SYNC_UPDATED_EVENT));
};

let started = false;
let currentRole = "";
let lastPullAt = 0;
let lastPullDate = "";
let pulling: Promise<void> | null = null;

/** يرسل السجلات أولاً ثم يحدّث تلقائياً نسخة الجهاز. */
async function reconcile(force = false): Promise<void> {
  if (pulling || !currentUserId || !navigator.onLine) return pulling ?? Promise.resolve();
  const userId = currentUserId;
  const wasDisconnected = !getSyncState().online;
  pulling = (async () => {
    try {
      await flushNow();
      if (currentUserId !== userId) return;
      const date = todayIso();
      if (!force && !wasDisconnected && date === lastPullDate && Date.now() - lastPullAt < 5 * 60_000) return;
      setSyncState({ syncing: true });
      const updated = await syncOfflineData(currentRole, date);
      if (currentUserId !== userId) return;
      if (updated) {
        lastPullAt = Date.now();
        lastPullDate = date;
        setSyncState({ online: true, servedFromCache: false });
        window.dispatchEvent(new Event(SYNC_UPDATED_EVENT));
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 0) setSyncState({ online: false });
      if (error instanceof ApiError && error.status === 401) { setApiUser(""); currentRole = ""; }
    } finally {
      setSyncState({ syncing: false });
      pulling = null;
    }
  })();
  return pulling;
}

/** يبدأ المزامنة تلقائياً بعد الدخول، وعند الاتصال أو العودة للتطبيق، وبفحص دوري. */
export function startSync(role: string) {
  currentRole = role;
  void refreshPending(currentUserId).then(() => reconcile(true));
  if (started) return;
  started = true;
  window.addEventListener("online", () => { setSyncState({ online: true }); void reconcile(true); });
  window.addEventListener("offline", () => setSyncState({ online: false }));
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void reconcile(); });
  window.setInterval(() => { void reconcile(); }, 20_000);
}

/** عند تسجيل الخروج: تُمسح النسخ المخزَّنة (لا تبقى بيانات على جهاز مشترك). */
export async function clearLocalData() {
  setApiUser("");
  currentRole = "";
  lastPullAt = 0;
  await cacheClear();
  setSyncState({ pending: 0, rejected: 0, servedFromCache: false, failures: [] });
}
