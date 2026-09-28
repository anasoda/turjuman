import { afterEach, expect, it, vi } from "vitest";

const api = vi.hoisted(() => vi.fn());
vi.mock("../../src/lib/api", () => ({ api }));
import { restorePush } from "../../src/lib/push";

afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });

it("restores an existing browser subscription on the server", async () => {
  const key = Uint8Array.from([4, ...Array(64).fill(1)]);
  const publicKey = btoa(String.fromCharCode(...key));
  const subscription = {
    options: { applicationServerKey: key.buffer },
    toJSON: () => ({ endpoint: "https://fcm.googleapis.com/fcm/send/test", keys: { p256dh: "client-key", auth: "client-auth" } })
  };
  const registration = { pushManager: { getSubscription: vi.fn().mockResolvedValue(subscription), subscribe: vi.fn() } };
  vi.stubGlobal("navigator", { serviceWorker: { getRegistration: vi.fn().mockResolvedValue(registration) } });
  vi.stubGlobal("window", { PushManager: class {}, Notification: class {} });
  vi.stubGlobal("Notification", { permission: "granted" });
  api.mockResolvedValueOnce({ publicKey }).mockResolvedValueOnce({ ok: true });

  expect(await restorePush()).toBe(true);
  expect(registration.pushManager.subscribe).not.toHaveBeenCalled();
  expect(api).toHaveBeenCalledWith("/api/notifications/subscribe", expect.objectContaining({ method: "POST" }));
});

it("replaces a subscription made with an old VAPID key", async () => {
  const key = Uint8Array.from([4, ...Array(64).fill(2)]);
  const publicKey = btoa(String.fromCharCode(...key));
  const current = { options: { applicationServerKey: Uint8Array.from([4, ...Array(64).fill(1)]).buffer }, unsubscribe: vi.fn().mockResolvedValue(true) };
  const replacement = { toJSON: () => ({ endpoint: "https://fcm.googleapis.com/fcm/send/new", keys: { p256dh: "client-key", auth: "client-auth" } }) };
  const registration = { pushManager: { getSubscription: vi.fn().mockResolvedValue(current), subscribe: vi.fn().mockResolvedValue(replacement) } };
  vi.stubGlobal("navigator", { serviceWorker: { getRegistration: vi.fn().mockResolvedValue(registration) } });
  vi.stubGlobal("window", { PushManager: class {}, Notification: class {} });
  vi.stubGlobal("Notification", { permission: "granted" });
  api.mockResolvedValueOnce({ publicKey }).mockResolvedValueOnce({ ok: true });

  expect(await restorePush()).toBe(true);
  expect(current.unsubscribe).toHaveBeenCalled();
  expect(registration.pushManager.subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: key });
});
