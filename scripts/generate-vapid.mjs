import { generateKeyPairSync } from "node:crypto";

// شغّله محلياً مرة واحدة، ثم احفظ القيم كأسرار Wrangler ولا تضعها في المستودع.
const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const key = privateKey.export({ format: "jwk" });
const publicKey = Buffer.concat([Buffer.from([4]), Buffer.from(key.x, "base64url"), Buffer.from(key.y, "base64url")]).toString("base64url");
process.stdout.write(`VAPID_PUBLIC_KEY=${publicKey}\nVAPID_PRIVATE_KEY=${key.d}\n`);
