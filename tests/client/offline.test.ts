import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

// بيئة المتصفح المصغّرة التي تحتاجها وحدات الواجهة
const store = new Map<string, string>();
vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) });
vi.stubGlobal("window", { location: { href: "http://localhost/?center=c1" }, history: { replaceState() {} }, dispatchEvent() {}, addEventListener() {} });
vi.stubGlobal("document", { addEventListener() {} });
vi.stubGlobal("navigator", { onLine: true });

const { api, setApiUser, flushNow, isQueued, clearLocalData } = await import("../../src/lib/api");
const { outboxAll, getSyncState } = await import("../../src/lib/offline");

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

  it("ما يرفضه الخادم يُحذف من الصندوق ويُبلَّغ به، وانقطاع الشبكة يُبقي الباقي", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await api("/api/daily", { body: { a: 1 } });
    await api("/api/daily", { body: { a: 2 } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json(400, { error: "نهاية التسميع يجب ألا تسبق بدايته" })).mockRejectedValueOnce(new TypeError("offline")));
    await flushNow();
    const left = await outboxAll();
    expect(left).toHaveLength(1);
    expect((left[0].body as { a: number }).a).toBe(2);
    expect(getSyncState().failures).toContain("نهاية التسميع يجب ألا تسبق بدايته");
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
