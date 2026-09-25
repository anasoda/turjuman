// العمل دون إنترنت:
//  - قراءات GET تُخزَّن آخر نسخة ناجحة في IndexedDB وتُخدَم منها عند انقطاع الشبكة.
//  - الكتابات الميدانية (التسميع اليومي، السرد، الاختبار التجريبي) تُحفظ في «صندوق الصادر» وتُرسل تلقائياً عند عودة الاتصال.
//  - قاعدة التعارض: آخر حفظ يغلب. التسميع اليومي upsert بحسب (الطالب، اليوم)، والسرد/الاختبار يحملان معرّفاً من الجهاز فلا يتكرران عند إعادة الإرسال.
//  - عند تسجيل الخروج تُمسح النسخ المخزَّنة؛ أما الصندوق فيبقى لكن لا يُرسل إلا لصاحبه.

const DB_NAME = "turjuman-v2";
const CACHE = "cache";
const OUTBOX = "outbox";

export interface OutboxItem {
  id?: number;
  userId: string;
  method: "POST";
  path: string;
  body: unknown;
  createdAt: number;
}

export interface SyncState {
  online: boolean;
  pending: number;
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

/* ---------------- صندوق الصادر ---------------- */
export const outboxAdd = (item: Omit<OutboxItem, "id">) => tx(OUTBOX, "readwrite", (s) => s.add(item));
export const outboxAll = (): Promise<OutboxItem[]> => tx<OutboxItem[]>(OUTBOX, "readonly", (s) => s.getAll()).catch(() => []);
export const outboxDelete = (id: number) => tx(OUTBOX, "readwrite", (s) => s.delete(id));

/* ---------------- حالة المزامنة (مشتركة مع الواجهة) ---------------- */
let state: SyncState = { online: typeof navigator === "undefined" ? true : navigator.onLine, pending: 0, syncing: false, failures: [], servedFromCache: false };
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
  const all = await outboxAll();
  setSyncState({ pending: userId ? all.filter((i) => i.userId === userId).length : all.length });
}

/** المسارات التي تُحفظ في الصندوق عند انقطاع الشبكة. */
export const QUEUEABLE = [/^\/api\/daily$/, /^\/api\/sard$/, /^\/api\/tests\/trial$/];
export const isQueueable = (method: string, path: string): boolean => method === "POST" && QUEUEABLE.some((re) => re.test(path));

export async function enqueue(userId: string, path: string, body: unknown) {
  await outboxAdd({ userId, method: "POST", path, body, createdAt: Date.now() });
  await refreshPending(userId);
}

let flushing = false;
/** يرسل صندوق المستخدم الحالي بالترتيب. يتوقف عند انقطاع الشبكة أو انتهاء الجلسة، ويحذف ما يرفضه الخادم (400/403/404/409) مع إبلاغ. */
export async function flushOutbox(userId: string, send: (item: OutboxItem) => Promise<{ status: number; error?: string }>): Promise<void> {
  if (flushing) return;
  flushing = true;
  setSyncState({ syncing: true });
  try {
    const items = (await outboxAll()).filter((i) => i.userId === userId).sort((a, b) => a.createdAt - b.createdAt);
    for (const item of items) {
      let res: { status: number; error?: string };
      try {
        res = await send(item);
      } catch {
        setSyncState({ online: false });
        break; // الشبكة غير متاحة
      }
      if (res.status === 401) break; // الجلسة انتهت؛ يبقى الصندوق حتى يعود المستخدم
      if (res.status >= 500) break; // عطل مؤقت في الخادم
      await outboxDelete(item.id!);
      if (res.status >= 400) setSyncState({ failures: [...state.failures, res.error || "رفض الخادم أحد السجلات المحفوظة"] });
    }
  } finally {
    flushing = false;
    await refreshPending(userId);
    setSyncState({ syncing: false });
  }
}
