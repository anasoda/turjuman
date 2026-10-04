import { describe, expect, it } from "vitest";
import { childrenOf } from "../../worker/routes/guardians";

/** D1 يرفض أكثر من 100 معامل ربط في الاستعلام الواحد؛ هذه القاعدة تحاكي الحدّ وتسجّل الاستعلامات. */
function fakeDb(limit = 100) {
  const calls: number[] = [];
  const db = {
    prepare() {
      return {
        bind(...args: unknown[]) {
          if (args.length > limit) throw new Error(`too many SQL variables (${args.length})`);
          calls.push(args.length);
          const guardianIds = args.slice(0, -1) as string[];
          return { all: async () => ({ results: guardianIds.map((guardianId) => ({ guardianId, id: `s-${guardianId}`, name: "طالب", direction: "descending", lastSurah: 114, lastAyah: 0, archivedAt: null, circleName: null })) }) };
        }
      };
    }
  };
  return { db: db as unknown as D1Database, calls };
}

describe("childrenOf", () => {
  it("يقسّم 300 ولي أمر إلى استعلامات أقل من حدّ D1 ويعيد كل الأبناء", async () => {
    const { db, calls } = fakeDb();
    const ids = Array.from({ length: 300 }, (_, i) => `g${i}`);
    const rows = await childrenOf(db, "center", ids);
    expect(rows).toHaveLength(300);
    expect(Math.max(...calls)).toBeLessThanOrEqual(100);
    expect(calls.length).toBeGreaterThan(1);
  });

  it("قائمة فارغة بلا استعلام", async () => {
    const { db, calls } = fakeDb();
    expect(await childrenOf(db, "center", [])).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});
