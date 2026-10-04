import { describe, expect, it } from "vitest";
import { pushInBackground } from "../../worker/lib/push";

/** قاعدة وهمية يتأخر استعلام الاشتراكات فيها حتى نحرّره يدوياً: تحاكي كثرة المشتركين وبطء الإرسال. */
function slowDb() {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const queries: string[] = [];
  const db = {
    prepare(sql: string) {
      queries.push(sql);
      return { bind: () => ({ all: async () => { await gate; return { results: [] }; } }) };
    }
  };
  return { db: db as unknown as D1Database, release, queries };
}

const env = (db: D1Database) => ({ DB: db, VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv", VAPID_SUBJECT: "mailto:test@example.com" });

describe("pushInBackground", () => {
  it("يعيد الرد قبل انتهاء الإرسال ويسلّم المهمة إلى waitUntil", async () => {
    const { db, release, queries } = slowDb();
    const jobs: Promise<unknown>[] = [];
    const c = { env: env(db), executionCtx: { waitUntil: (p: Promise<unknown>) => { jobs.push(p); } } };
    let returned = false;
    const call = pushInBackground(c as never, "center", ["u1"], { title: "t" }).then(() => { returned = true; });
    await call;
    expect(returned).toBe(true);
    expect(jobs).toHaveLength(1);
    expect(queries).toHaveLength(1);
    release();
    await Promise.all(jobs);
  });

  it("بلا executionCtx (اختبارات) ينتظر الإرسال حتى ينتهي", async () => {
    const { db, release } = slowDb();
    const c = { env: env(db), get executionCtx(): never { throw new Error("no execution context"); } };
    let done = false;
    const call = pushInBackground(c as never, "center", ["u1"], { title: "t" }).then(() => { done = true; });
    await Promise.resolve();
    expect(done).toBe(false);
    release();
    await call;
    expect(done).toBe(true);
  });

  it("بلا مفاتيح VAPID لا يفعل شيئاً ولا يرمي", async () => {
    const { db, queries } = slowDb();
    const c = { env: { DB: db }, executionCtx: { waitUntil: () => undefined } };
    await expect(pushInBackground(c as never, "center", ["u1"], { title: "t" })).resolves.toBeUndefined();
    expect(queries).toHaveLength(0);
  });
});
