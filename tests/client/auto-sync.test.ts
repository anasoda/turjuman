import "fake-indexeddb/auto";
import { expect, it, vi } from "vitest";

const listeners = new Map<string, Array<(event: Event) => void>>();
vi.stubGlobal("window", {
  location: { href: "http://localhost/" }, history: { replaceState() {} },
  addEventListener(type: string, listener: (event: Event) => void) { listeners.set(type, [...(listeners.get(type) ?? []), listener]); },
  dispatchEvent(event: Event) { for (const listener of listeners.get(event.type) ?? []) listener(event); return true; },
  setInterval() { return 1; }
});
vi.stubGlobal("document", { visibilityState: "visible", addEventListener() {} });
vi.stubGlobal("navigator", { onLine: false });

const { setApiUser, startSync, SYNC_UPDATED_EVENT } = await import("../../src/lib/api");
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const waitForSync = () => new Promise<void>((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("لم تكتمل المزامنة التلقائية")), 3000);
  listeners.set(SYNC_UPDATED_EVENT, [...(listeners.get(SYNC_UPDATED_EVENT) ?? []), () => { clearTimeout(timeout); resolve(); }]);
});

it("يحدّث بيانات الجهاز تلقائياً عند عودة الاتصال بلا زر تجهيز", async () => {
  const paths: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (path: string) => {
    paths.push(path);
    return json(path === "/api/auth/me" ? { user: { id: "u-auto" }, center: { id: "obai-01" } }
      : path === "/api/circles" ? { circles: [] }
      : path.startsWith("/api/students?") && path.includes("pageSize=100&page=") ? { students: [], total: 0 }
      : { rows: [] });
  }));
  setApiUser("u-auto");
  startSync("admin");
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(paths).toHaveLength(0);
  const completed = waitForSync();
  vi.stubGlobal("navigator", { onLine: true });
  window.dispatchEvent(new Event("online"));
  await completed;
  expect(paths).toContain("/api/circles");
  expect(paths).toContain("/api/staff-attendance?date=" + new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hebron", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()));
});
