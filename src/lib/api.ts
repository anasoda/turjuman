import { getCenterId } from "./center";
import { cacheClear, cacheGet, cachePut, enqueue, flushOutbox, isQueueable, refreshPending, setSyncState, type OutboxItem } from "./offline";

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export const SESSION_EXPIRED_EVENT = "tq-session-expired";

interface Options {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
}

export interface Queued { ok: true; queued: true }
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
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    }
    throw new ApiError(data.error || "حدث خطأ غير متوقع", res.status);
  }
  return data as T;
}

// /api/auth/me لا يرتبط بمعرّف مستخدم: يُقرأ عند فتح التطبيق قبل معرفة المستخدم
const cacheKey = (path: string) => (path === "/api/auth/me" ? `${getCenterId()}:me` : `${getCenterId()}:${currentUserId}:${path}`);

/** قراءة: من الخادم أولاً (وتُخزَّن)، وعند انقطاع الشبكة من آخر نسخة محفوظة. */
async function cachedGet<T>(path: string): Promise<T> {
  try {
    const data = await request<T>(path, "GET", undefined);
    setSyncState({ online: true, servedFromCache: false });
    void cachePut(cacheKey(path), data);
    return data;
  } catch (e) {
    if (e instanceof ApiError && e.status === 0) {
      const cached = await cacheGet<T>(cacheKey(path));
      if (cached !== undefined) {
        setSyncState({ online: false, servedFromCache: true });
        return cached;
      }
    }
    throw e;
  }
}

/** كتابة ميدانية: تُرسل الآن، وإن انقطعت الشبكة تُحفظ في صندوق الصادر وتُرسل لاحقاً. */
async function queueablePost<T>(path: string, body: unknown): Promise<T | Queued> {
  const payload = path === "/api/daily" ? body : { id: crypto.randomUUID(), ...(body as object) };
  if (navigator.onLine) {
    try {
      return await request<T>(path, "POST", payload);
    } catch (e) {
      // انقطاع الشبكة أو انتهاء الجلسة: يُحفظ محلياً ويُرسل بعد عودة الاتصال/الدخول
      if (!(e instanceof ApiError && (e.status === 0 || e.status === 401))) throw e;
    }
  }
  await enqueue(currentUserId, path, payload);
  setSyncState({ online: false });
  return { ok: true, queued: true };
}

export async function api<T = unknown>(path: string, opts: Options = {}): Promise<T> {
  const method = opts.method ?? (opts.body === undefined ? "GET" : "POST");
  if (method === "GET") return cachedGet<T>(path);
  if (isQueueable(method, path)) return (await queueablePost<T>(path, opts.body)) as T;
  return request<T>(path, method, opts.body);
}

export const centerQuery = () => `centerId=${encodeURIComponent(getCenterId())}`;

/* ---------------- تشغيل المزامنة ---------------- */
async function sendItem(item: OutboxItem): Promise<{ status: number; error?: string }> {
  const res = await fetch(item.path, { method: item.method, credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(item.body) });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return { status: res.status, error: data.error };
}

export const flushNow = (): Promise<void> => (currentUserId ? flushOutbox(currentUserId, sendItem) : Promise.resolve());

let started = false;
/** يبدأ مراقبة الاتصال وإرسال الصندوق (مرة واحدة لكل تحميل للصفحة). */
export function startSync() {
  void refreshPending(currentUserId);
  void flushNow();
  if (started) return;
  started = true;
  window.addEventListener("online", () => { setSyncState({ online: true }); void flushNow(); });
  window.addEventListener("offline", () => setSyncState({ online: false }));
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && navigator.onLine) void flushNow(); });
  window.setInterval(() => { if (navigator.onLine) void flushNow(); }, 20_000);
}

/** عند تسجيل الخروج: تُمسح النسخ المخزَّنة (لا تبقى بيانات على جهاز مشترك). */
export async function clearLocalData() {
  await cacheClear();
  setApiUser("");
  setSyncState({ pending: 0, servedFromCache: false, failures: [] });
}
