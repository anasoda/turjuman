import type { Direction } from "../../shared/constants";
import { countUniquePages, pagesOfRange, rangeDirection } from "../../shared/quran";

export interface PlanHistoryRow {
  month: string;
  /** هل وُضعت خطة لهذا الشهر (صف في student_monthly_plans) */
  set: boolean;
  /** هل للشهر كشف شهري محفوظ (منجزه وخطته ثابتان وقت الحفظ) */
  saved: boolean;
  planPages: number;
  reviewPlanPages: number;
  pages: number;
  reviewPages: number;
}

interface DailyLite {
  date: string; attendance: string;
  from_surah: number | null; from_ayah: number | null; to_surah: number | null; to_ayah: number | null;
  review_from_surah: number | null; review_from_ayah: number | null; review_to_surah: number | null; review_to_ayah: number | null;
}

const nextMonthOf = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1)).toISOString().slice(0, 7);

/**
 * خطة كل شهر ومنجزه الفعلي لطالب واحد في ثلاثة استعلامات مهما كثرت الأشهر (حدّ الاستعلامات في الطلب الواحد).
 * نفس قواعد الكشف الشهري (`buildReportRows`): الصفحات الفريدة من أيام الحضور، والكشف المحفوظ يغلب المحسوب.
 */
export async function planHistory(db: D1Database, centerId: string, student: { id: string; direction: Direction }, months: string[]): Promise<PlanHistoryRow[]> {
  if (!months.length) return [];
  const sorted = [...months].sort();
  const marks = sorted.map(() => "?").join(",");
  const [plans, saved, daily] = await Promise.all([
    db.prepare(`SELECT month, memorize_pages AS memorizePages, review_pages AS reviewPages FROM student_monthly_plans WHERE center_id = ? AND student_id = ? AND month IN (${marks})`)
      .bind(centerId, student.id, ...sorted).all<{ month: string; memorizePages: number; reviewPages: number }>(),
    db.prepare(`SELECT month, pages, plan_pages AS planPages, review_pages AS reviewPages, review_plan_pages AS reviewPlanPages FROM monthly_reports WHERE center_id = ? AND student_id = ? AND month IN (${marks})`)
      .bind(centerId, student.id, ...sorted).all<{ month: string; pages: number; planPages: number; reviewPages: number; reviewPlanPages: number }>(),
    db.prepare(`SELECT date, attendance, from_surah, from_ayah, to_surah, to_ayah, review_from_surah, review_from_ayah, review_to_surah, review_to_ayah
                  FROM daily_records WHERE center_id = ? AND student_id = ? AND date >= ? AND date < ?`)
      .bind(centerId, student.id, `${sorted[0]}-01`, `${nextMonthOf(sorted[sorted.length - 1])}-01`).all<DailyLite>()
  ]);
  const planBy = new Map(plans.results.map((r) => [r.month, r]));
  const savedBy = new Map(saved.results.map((r) => [r.month, r]));

  return months.map((month) => {
    const mine = daily.results.filter((d) => d.date.startsWith(`${month}-`));
    const ranges = mine.filter((d) => d.attendance !== "absent" && d.from_surah && d.to_surah)
      .map((d) => ({ from: { surah: d.from_surah!, ayah: d.from_ayah! }, to: { surah: d.to_surah!, ayah: d.to_ayah! } }));
    const reviewSet = new Set<number>();
    for (const d of mine.filter((x) => x.attendance !== "absent" && x.attendance !== "excused" && x.review_from_surah && x.review_to_surah)) {
      const f = { surah: d.review_from_surah!, ayah: d.review_from_ayah! };
      const t = { surah: d.review_to_surah!, ayah: d.review_to_ayah! };
      const dir = rangeDirection(student.direction, f, t);
      if (dir) for (const p of pagesOfRange(dir, f, t)) reviewSet.add(p);
    }
    const plan = planBy.get(month);
    const sv = savedBy.get(month);
    return {
      month, set: !!plan, saved: !!sv,
      planPages: sv ? sv.planPages : plan?.memorizePages ?? 0,
      reviewPlanPages: sv ? sv.reviewPlanPages : plan?.reviewPages ?? 0,
      pages: sv ? sv.pages : countUniquePages(student.direction, ranges),
      reviewPages: sv ? sv.reviewPages : reviewSet.size
    };
  });
}
