import { afterEach, expect, it, vi } from "vitest";
import { sendPush } from "../../worker/lib/push";
import type { Env } from "../../worker/env";

const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64 = (value: string) => Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const join = (...items: Uint8Array[]) => Uint8Array.from(items.flatMap((item) => [...item]));
const derive = async (key: Uint8Array, salt: Uint8Array, info: Uint8Array, size: number) => {
  const material = await crypto.subtle.importKey("raw", key, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, material, size * 8));
};

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("signs and encrypts a notification that a browser subscription can decrypt", async () => {
  const vapid = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
  const vapidJwk = await crypto.subtle.exportKey("jwk", vapid.privateKey) as JsonWebKey;
  const vapidPublic = new Uint8Array(await crypto.subtle.exportKey("raw", vapid.publicKey) as ArrayBuffer);
  const receiver = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
  const receiverPublic = new Uint8Array(await crypto.subtle.exportKey("raw", receiver.publicKey) as ArrayBuffer);
  const secret = crypto.getRandomValues(new Uint8Array(16));
  const env = { VAPID_PUBLIC_KEY: b64(vapidPublic), VAPID_PRIVATE_KEY: vapidJwk.d, VAPID_SUBJECT: "mailto:admin@example.com" } as Env;
  const db = { prepare: () => ({ bind: () => ({ all: async () => ({ results: [{ id: "one", endpoint: "https://fcm.googleapis.com/fcm/send/demo", p256dh: b64(receiverPublic), authSecret: b64(secret) }] }) }) }) } as unknown as D1Database;
  let request: Request | undefined;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => { request = new Request(input, init); return new Response(null, { status: 201 }); }));
  const delivery = await sendPush(db, env, "center", ["guardian"], { title: "تعميم", body: "موعد جديد", link: "/app" });
  expect(delivery).toEqual({ subscriptions: 1, accepted: 1, failed: 0 });
  expect(request).toBeDefined();
  const authorization = request!.headers.get("Authorization")!;
  const token = authorization.match(/^vapid t=([^,]+), k=/)![1];
  const [head, claims, signature] = token.split(".");
  expect(JSON.parse(dec.decode(fromB64(claims))).aud).toBe("https://fcm.googleapis.com");
  expect(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, vapid.publicKey, fromB64(signature), enc.encode(`${head}.${claims}`))).toBe(true);
  const body = new Uint8Array(await request!.arrayBuffer());
  const salt = body.slice(0, 16);
  const senderLength = body[20];
  const senderPublic = body.slice(21, 21 + senderLength);
  const senderKey = await crypto.subtle.importKey("raw", senderPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: senderKey } as never, receiver.privateKey, 256));
  const ikm = await derive(shared, secret, join(enc.encode("WebPush: info\0"), receiverPublic, senderPublic), 32);
  const contentKey = await derive(ikm, salt, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await derive(ikm, salt, enc.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", contentKey, "AES-GCM", false, ["decrypt"]);
  const plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, body.slice(21 + senderLength)));
  expect(plaintext.at(-1)).toBe(2);
  expect(JSON.parse(dec.decode(plaintext.slice(0, -1)))).toEqual({ title: "تعميم", body: "موعد جديد", link: "/app" });
});
