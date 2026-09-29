// @ts-expect-error Tests run in Node; the Worker tsconfig deliberately omits Node types.
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import type { Context } from "hono";
import type { AppEnv, AuthCtx } from "../../worker/env";
import { datedRecordScope, studentForDate } from "../../worker/lib/access";

const { DatabaseSync } = createRequire((import.meta as { url: string }).url)("node:sqlite");
const db = new DatabaseSync(":memory:");
db.exec(`
  CREATE TABLE students (id TEXT, center_id TEXT, name TEXT, gender TEXT, circle_id TEXT,
    direction TEXT, last_surah INTEGER, last_ayah INTEGER, monthly_plan_pages INTEGER,
    archived_at INTEGER, user_id TEXT);
  CREATE TABLE student_transfers (student_id TEXT, from_circle_id TEXT, to_circle_id TEXT, effective_from TEXT);
  CREATE TABLE circles (id TEXT, center_id TEXT, level_key TEXT);
  CREATE TABLE daily_records (student_id TEXT, center_id TEXT, date TEXT);
  CREATE TABLE sard_records (student_id TEXT, center_id TEXT, date TEXT);
  INSERT INTO circles VALUES ('old', 'center-a', 'primary'), ('new', 'center-a', 'prep'), ('foreign', 'center-b', 'primary');
  INSERT INTO students VALUES ('student', 'center-a', 'طالب', 'male', 'new', 'descending', 114, 0, 5, NULL, NULL);
  INSERT INTO students VALUES ('other', 'center-b', 'آخر', 'male', 'foreign', 'descending', 114, 0, 5, NULL, NULL);
  INSERT INTO student_transfers VALUES ('student', 'old', 'new', '2026-09-15');
  INSERT INTO daily_records VALUES ('student', 'center-a', '2026-09-14'), ('student', 'center-a', '2026-09-16');
  INSERT INTO sard_records VALUES ('student', 'center-a', '2026-09-14'), ('student', 'center-a', '2026-09-16');
`);

function context(role: AuthCtx["role"], circleIds: string[] = [], stages: string[] = []): Context<AppEnv> {
  const auth: AuthCtx = { role, circleIds, stages, centerId: "center-a", userId: "user", displayName: "مستخدم" };
  const binding = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          const stmt = db.prepare(sql);
          return {
            async first() { return stmt.get(...args as []) ?? null; },
            async all() { return { results: stmt.all(...args as []) }; }
          };
        }
      };
    }
  };
  return { get: () => auth, env: { DB: binding } } as unknown as Context<AppEnv>;
}

async function recordDates(c: Context<AppEnv>, table: "daily_records" | "sard_records") {
  const alias = table === "daily_records" ? "d" : "r";
  const scope = datedRecordScope(c, alias);
  const stmt = db.prepare(`SELECT ${alias}.date FROM ${table} ${alias} JOIN students s ON s.id = ${alias}.student_id
    WHERE ${alias}.center_id = ?${scope.sql} ORDER BY ${alias}.date`);
  return stmt.all("center-a", ...scope.binds).map((row: { date: unknown }) => row.date);
}

describe("صلاحية السجلات بعد انتقال الطالب", () => {
  it("يمنح المعلّم القديم تاريخ حلقته فقط مع رقم الحلقة التاريخي", async () => {
    const old = context("teacher", ["old"]);
    expect((await studentForDate(old, "student", "2026-09-14")).circleId).toBe("old");
    await expect(studentForDate(old, "student", "2026-09-16")).rejects.toMatchObject({ status: 404 });
    expect(await recordDates(old, "daily_records")).toEqual(["2026-09-14"]);
    expect(await recordDates(old, "sard_records")).toEqual(["2026-09-14"]);
  });

  it("يمنع المعلّم الجديد من تاريخ ما قبل انتقال الطالب", async () => {
    const current = context("teacher", ["new"]);
    await expect(studentForDate(current, "student", "2026-09-14")).rejects.toMatchObject({ status: 404 });
    expect((await studentForDate(current, "student", "2026-09-16")).circleId).toBe("new");
    expect(await recordDates(current, "daily_records")).toEqual(["2026-09-16"]);
  });

  it("يحترم مرحلة مدير المرحلة أو حلقته المسندة، وعزل المركز", async () => {
    const manager = context("stage_manager", [], ["primary"]);
    expect((await studentForDate(manager, "student", "2026-09-14")).circleId).toBe("old");
    await expect(studentForDate(manager, "student", "2026-09-16")).rejects.toMatchObject({ status: 404 });
    await expect(studentForDate(manager, "other", "2026-09-14")).rejects.toMatchObject({ status: 404 });
    expect(await recordDates(manager, "sard_records")).toEqual(["2026-09-14"]);
    expect((await studentForDate(context("stage_manager", ["new"], ["primary"]), "student", "2026-09-16")).circleId).toBe("new");
  });
});
