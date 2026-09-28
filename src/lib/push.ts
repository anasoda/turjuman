import { api } from "./api";

export const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

const publicKeyBytes = (key: string) => Uint8Array.from(atob(key.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0));

async function saveSubscription(publicKey: string, registration: ServiceWorkerRegistration, current?: PushSubscription | null): Promise<void> {
  const key = publicKeyBytes(publicKey);
  let subscription = current ?? await registration.pushManager.getSubscription();
  const oldKey = subscription?.options.applicationServerKey;
  if (subscription && (!oldKey || !key.every((byte, i) => byte === new Uint8Array(oldKey)[i]) || oldKey.byteLength !== key.length)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  const serialized = subscription.toJSON();
  if (!serialized.endpoint || !serialized.keys?.p256dh || !serialized.keys?.auth) throw new Error("لم تكتمل بيانات الاشتراك في التنبيهات");
  await api("/api/notifications/subscribe", { method: "POST", body: { endpoint: serialized.endpoint, keys: serialized.keys } });
}

export async function pushSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  return registration?.pushManager.getSubscription() ?? null;
}

export async function enablePush(): Promise<void> {
  if (!pushSupported()) throw new Error("هذا المتصفح لا يدعم تنبيهات الهاتف");
  const { publicKey } = await api<{ publicKey: string }>("/api/notifications/push-key");
  if (!publicKey) throw new Error("تنبيهات الهاتف لم تُضبط على الخادم بعد");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("اسمح للتطبيق بإظهار التنبيهات من إعدادات المتصفح");
  const registration = await navigator.serviceWorker.getRegistration() ?? await navigator.serviceWorker.register("/sw.js");
  await saveSubscription(publicKey, registration);
}

/** يعيد ربط اشتراك الجهاز الموجود بالخادم، ويجدده إذا تغيّر مفتاح VAPID. */
export async function restorePush(): Promise<boolean> {
  if (!pushSupported() || Notification.permission !== "granted") return false;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!registration || !subscription) return false;
  const { publicKey } = await api<{ publicKey: string }>("/api/notifications/push-key");
  if (!publicKey) return false;
  await saveSubscription(publicKey, registration, subscription);
  return true;
}

export async function disablePush(): Promise<void> {
  const subscription = await pushSubscription();
  if (!subscription) return;
  try { await api("/api/notifications/unsubscribe", { method: "POST", body: { endpoint: subscription.endpoint } }); }
  finally { await subscription.unsubscribe(); }
}
