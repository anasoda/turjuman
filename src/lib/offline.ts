// العمل دون إنترنت:
//  - قراءات GET تُخزَّن آخر نسخة ناجحة في IndexedDB وتُخدَم منها عند انقطاع الشبكة.
//  - كتابات العمل اليومي والكشف الشهري تُحفظ في «صندوق الصادر» وتُرسل تلقائياً عند عودة الاتصال.
//  - قاعدة التعارض: آخر حفظ يغلب. التسميع اليومي upsert بحسب (الطالب، اليوم)، والسرد/الاختبار يحملان معرّفاً من الجهاز فلا يتكرران عند إعادة الإرسال.
//  - عند تسجيل الخروج تُمسح النسخ المخزَّنة؛ أما الصندوق فيبقى لكن لا يُرسل إلا لصاحبه.

const DB_NAME = "turjuman-v2";
const CACHE = "cache";
const OUTBOX = "outbox";

export interface OutboxItem {
  id?: number;
  userId: string;
  method: "POST" | "PUT";
  path: string;
  body: unknown;
  createdAt: number;
  status?: "rejected";
  error?: string;
  /** سبب تعثّر الإرسال المؤقت (انتهاء الجلسة/عطل الخادم/الشبكة) — السجل يبقى معلّقاً ويُعاد إرساله */
  stalled?: string;
  stalledAt?: number;
}

export interface SyncState {
  online: boolean;
  pending: number;
  rejected: number;
  syncing: boolean;
  /** آخر رسائل تعذّر إرسالها (رُفضت من الخادم) — تُعرض ثم تُمسح */
  failures: string[];
  servedFromCache: boolean;
}

let dbPromise: Promise<IDBDatabase> | null = null;
function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(CACHE)) db.createObjectStore(CACHE, { keyPath: "k" });
        if (!db.objectStoreNames.contains(OUTBOX)) db.createObjectStore(OUTBOX, { keyPath: "id", autoIncrement: true });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(store, mode).objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/* ---------------- كاش القراءة ---------------- */
export const cachePut = (key: string, data: unknown) => tx(CACHE, "readwrite", (s) => s.put({ k: key, data, at: Date.now() })).catch(() => undefined);
export async function cacheGet<T>(key: string): Promise<T | undefined> {
  try {
    const row = await tx<{ data: T } | undefined>(CACHE, "readonly", (s) => s.get(key));
    return row?.data;
  } catch {
    return undefined;
  }
}
export const cacheClear = () => tx(CACHE, "readwrite", (s) => s.clear()).catch(() => undefined);
export const cacheDelete = (key: string) => tx(CACHE, "readwrite", (s) => s.delete(key)).catch(() => undefined);
export const cacheKeys = (): Promise<string[]> => tx<IDBValidKey[]>(CACHE, "readonly", (s) => s.getAllKeys()).then((keys) => keys.map(String)).catch(() => []);

/* ---------------- صندوق الصادر ---------------- */
export const outboxAdd = (item: Omit<OutboxItem, "id">) => tx(OUTBOX, "readwrite", (s) => s.add(item));
export const outboxAll = (): Promise<OutboxItem[]> => tx<OutboxItem[]>(OUTBOX, "readonly", (s) => s.getAll()).catch(() => []);
export const outboxDelete = (id: number) => tx(OUTBOX, "readwrite", (s) => s.delete(id));
export const outboxPut = (item: OutboxItem) => tx(OUTBOX, "readwrite", (s) => s.put(item));

/* ---------------- حالة المزامنة (مشتركة مع الواجهة) ---------------- */
let state: SyncState = { online: typeof navigator === "undefined" ? true : navigator.onLine, pending: 0, rejected: 0, syncing: false, failures: [], servedFromCache: false };
const listeners = new Set<(s: SyncState) => void>();
export const getSyncState = (): SyncState => state;
export function setSyncState(patch: Partial<SyncState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l(state));
}
export function subscribeSync(fn: (s: SyncState) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export const clearFailures = () => setSyncState({ failures: [] });

export async function refreshPending(userId?: string) {
  const all = (await outboxAll()).filter((i) => !userId || i.userId === userId);
  setSyncState({ pending: all.filter((i) => i.status !== "rejected").length, rejected: all.filter((i) => i.status === "rejected").length });
}

export async function retryRejected(id: number, userId: string) {
  const item = (await outboxAll()).find((i) => i.id === id && i.userId === userId && i.status === "rejected");
  if (!item) return;
  await outboxPut({ ...item, status: undefined, error: undefined });
  await refreshPending(userId);
}

export async function discardRejected(id: number, userId: string) {
  const item = (await outboxAll()).find((i) => i.id === id && i.userId === userId && i.status === "rejected");
  if (!item) return;
  await outboxDelete(id);
  await refreshPending(userId);
}

/** المسارات التي تُحفظ في الصندوق عند انقطاع الشبكة. */
export const QUEUEABLE_POST = [/^\/api\/daily$/, /^\/api\/sard$/, /^\/api\/tests\/trial$/, /^\/api\/tests\/propose$/, /^\/api\/tests\/[^/]+\/(approve|reject|session)$/, /^\/api\/staff-attendance$/, /^\/api\/reports\/save$/];
export const isQueueable = (method: string, path: string): boolean =>
  (method === "POST" && QUEUEABLE_POST.some((re) => re.test(path))) || (method === "PUT" && /^\/api\/tests\/[^/]+\/session$/.test(path));

export async function enqueue(userId: string, path: string, body: unknown, method: "POST" | "PUT" = "POST") {
  await outboxAdd({ userId, method, path, body, createdAt: Date.now() });
  await refreshPending(userId);
}

/** ما يقرؤه السجل (يتأخر إن رُفض سجل سابق يكتب فيه) وما يكتبه. الرفض يحجب السجلات المعتمدة عليه فقط، لا الصندوق كله. */
export function dependencies(item: OutboxItem): { reads: string[]; writes: string[] } {
  const body = (item.body ?? {}) as { studentId?: string; date?: string; proposals?: Array<{ id?: string }> };
  if (item.path === "/api/daily") { const key = `daily:${body.studentId}:${body.date}`; return { reads: [key], writes: [key, "daily*"] }; }
  if (item.path === "/api/reports/save") return { reads: ["daily*"], writes: [] };
  if (item.path === "/api/tests/propose") { const keys = (body.proposals ?? []).map((p) => `test:${p.id}`); return keys.length ? { reads: keys, writes: keys } : { reads: ["*"], writes: ["*"] }; }
  const test = /^\/api\/tests\/([^/]+)\/(approve|reject|session)$/.exec(item.path);
  if (test) return { reads: [`test:${test[1]}`], writes: [`test:${test[1]}`] };
  if (item.path === "/api/sard" || item.path === "/api/tests/trial" || item.path === "/api/staff-attendance") { const key = `own:${item.id}`; return { reads: [key], writes: [key] }; }
  return { reads: ["*"], writes: ["*"] };
}

let flushing = false;
/** يرسل صندوق المستخدم الحالي بالترتيب. السجل المرفوض يبقى للمراجعة ويحجب السجلات المعتمدة عليه فقط (نفس الاختبار، أو نفس الطالب واليوم، أو كشف شهري)؛ والبقية تُرسل. */
export async function flushOutbox(userId: string, send: (item: OutboxItem) => Promise<{ status: number; error?: string }>): Promise<void> {
  if (flushing) return;
  flushing = true;
  setSyncState({ syncing: true });
  const blocked = new Set<string>();
  try {
    const items = (await outboxAll()).filter((i) => i.userId === userId).sort((a, b) => a.createdAt - b.createdAt || (a.id ?? 0) - (b.id ?? 0));
    for (const item of items) {
      const dep = dependencies(item);
      if (item.status === "rejected") { dep.writes.forEach((k) => blocked.add(k)); continue; }
      if (blocked.has("*") || dep.reads.some((k) => blocked.has(k))) continue;
      let res: { status: number; error?: string };
      try {
        res = await send(item);
      } catch {
        await outboxPut({ ...item, stalled: "تعذّر الوصول إلى الخادم (الشبكة)", stalledAt: Date.now() });
        setSyncState({ online: false });
        break; // الشبكة غير متاحة
      }
      if (res.status === 401) { await outboxPut({ ...item, stalled: "انتهت الجلسة؛ سجّل الدخول من جديد", stalledAt: Date.now() }); break; } // يبقى الصندوق حتى يعود المستخدم
      if (res.status >= 500) { await outboxPut({ ...item, stalled: `عطل في الخادم (${res.status})${res.error ? `: ${res.error}` : ""}`, stalledAt: Date.now() }); break; } // عطل مؤقت في الخادم
      if (res.status >= 400) {
        const error = res.error || "رفض الخادم أحد السجلات المحفوظة";
        await outboxPut({ ...item, status: "rejected", error });
        setSyncState({ failures: [...state.failures, error] });
        dep.writes.forEach((k) => blocked.add(k));
        continue;
      }
      await outboxDelete(item.id!);
    }
  } finally {
    flushing = false;
    await refreshPending(userId);
    setSyncState({ syncing: false });
  }
}
