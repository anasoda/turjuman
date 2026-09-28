import { countPages, countUniquePages, countVerses, furthest, isValidRange, nextStart, pagesOfRange, planPercent, rangeDirection, type Position } from "@shared/quran";
import type { Direction } from "@shared/constants";
import { cacheGet, outboxAll, type OutboxItem } from "./offline";
import { applyPendingSession, applyPendingTests, type OfflineTestRow } from "./offline-exams";
import { getCenterId } from "./center";
import type { MeResponse, Student } from "./types";

type DailyInput = { studentId: string; date: string; attendance: string; from: Position | null; to: Position | null; grade: string; review: { from: Position; to: Position; grade: string } | null; note: string };
type StaffInput = { userId: string; date: string; status: string; note: string };
type ReportInput = { month: string; rows: Array<{ studentId: string; end: Position | null }> };
type DailySource = { student_id: string; date: string; attendance: string; from_surah: number | null; from_ayah: number | null; to_surah: number | null; to_ayah: number | null; verses: number; review_from_surah: number | null; review_from_ayah: number | null; review_to_surah: number | null; review_to_ayah: number | null };
type ReportRow = { studentId: string; direction: Direction; planPages: number; reviewPlanPages: number; saved: boolean; daily?: DailySource[]; start: Position | null; end: Position | null; present: number; absent: number; late: number; excused: number; verses: number; pages: number; percent: number; reviewPages: number; reviewPercent: number; reviewDays: number };

const position = (surah: number | null, ayah: number | null): Position | null => surah && ayah ? { surah, ayah } : null;
const body = <T>(item: OutboxItem): T => item.body as T;

/** عرض حفظ اليوم المعلّق في اللوحة نفسها حتى قبل وصوله للخادم. */
function dailyBoard<T>(data: T, date: string, items: OutboxItem[]): T {
  const board = data as { rows?: Array<{ student: { id: string; direction: Direction; lastSurah: number; lastAyah: number; nextStart: Position | null; reviewNext: Position | null; reviewLast: Position | null }; record: Record<string, unknown> | null }> };
  if (!board.rows) return data;
  const pending = new Map<string, DailyInput>();
  const earlier = new Map<string, DailyInput[]>();
  for (const item of items) if (item.path === "/api/daily") {
    const entry = body<DailyInput>(item);
    if (entry.date === date) pending.set(entry.studentId, entry);
    if (entry.date < date) earlier.set(entry.studentId, [...(earlier.get(entry.studentId) ?? []), entry]);
  }
  return { ...board, rows: board.rows.map((row) => {
    let student = row.student;
    for (const previous of (earlier.get(student.id) ?? []).sort((a, b) => a.date.localeCompare(b.date))) {
      if (previous.to && (previous.attendance === "present" || previous.attendance === "late")) {
        const last = furthest(student.direction, { surah: student.lastSurah, ayah: student.lastAyah }, previous.to);
        student = { ...student, lastSurah: last.surah, lastAyah: last.ayah, nextStart: nextStart(student.direction, last) };
      }
      if (previous.review && (previous.attendance === "present" || previous.attendance === "late")) {
        const dir = rangeDirection(student.direction, previous.review.from, previous.review.to);
        student = { ...student, reviewLast: previous.review.to, reviewNext: dir ? nextStart(dir, previous.review.to) : student.reviewNext };
      }
    }
    const entry = pending.get(row.student.id);
    if (!entry) return { ...row, student };
    const dir = student.direction;
    const attended = entry.attendance === "present" || entry.attendance === "late";
    const from = attended ? entry.from : null, to = attended ? entry.to : null;
    const review = attended ? entry.review : null;
    const reviewDir = review ? rangeDirection(dir, review.from, review.to) : null;
    return { ...row, student, record: {
      ...row.record, id: row.record?.id ?? `pending:${row.student.id}:${date}`, studentId: row.student.id, date,
      attendance: entry.attendance, direction: dir, fromSurah: from?.surah ?? null, fromAyah: from?.ayah ?? null,
      toSurah: to?.surah ?? null, toAyah: to?.ayah ?? null,
      verses: from && to ? countVerses(dir, from, to) : 0, pages: from && to ? countPages(dir, from, to) : 0,
      grade: entry.grade, note: entry.note,
      reviewFromSurah: review?.from.surah ?? null, reviewFromAyah: review?.from.ayah ?? null,
      reviewToSurah: review?.to.surah ?? null, reviewToAyah: review?.to.ayah ?? null,
      reviewPages: review && reviewDir ? countPages(reviewDir, review.from, review.to) : 0,
      reviewGrade: review?.grade ?? "", pending: true
    } };
  }) } as T;
}

function staffDay<T>(data: T, date: string, items: OutboxItem[]): T {
  const day = data as { rows?: Array<{ id: string; status: string | null; note: string | null }> };
  if (!day.rows) return data;
  const pending = new Map<string, StaffInput>();
  for (const item of items) if (item.path === "/api/staff-attendance") {
    const entry = body<StaffInput>(item);
    if (entry.date === date) pending.set(entry.userId, entry);
  }
  return { ...day, rows: day.rows.map((row) => {
    const entry = pending.get(row.id);
    return entry ? { ...row, status: entry.status, note: entry.note, pending: true } : row;
  }) } as T;
}

function reportRow(row: ReportRow, dailyItems: OutboxItem[]): ReportRow {
  if (!row.daily || !dailyItems.length) return row;
  const records = new Map(row.daily.map((r) => [r.date, r]));
  for (const item of dailyItems) {
    const entry = body<DailyInput>(item);
    if (entry.studentId !== row.studentId) continue;
    const attended = entry.attendance === "present" || entry.attendance === "late";
    const from = attended ? entry.from : null, to = attended ? entry.to : null;
    const review = attended ? entry.review : null;
    records.set(entry.date, {
      student_id: row.studentId, date: entry.date, attendance: entry.attendance,
      from_surah: from?.surah ?? null, from_ayah: from?.ayah ?? null, to_surah: to?.surah ?? null, to_ayah: to?.ayah ?? null,
      verses: from && to ? countVerses(row.direction, from, to) : 0,
      review_from_surah: review?.from.surah ?? null, review_from_ayah: review?.from.ayah ?? null,
      review_to_surah: review?.to.surah ?? null, review_to_ayah: review?.to.ayah ?? null
    });
  }
  const all = [...records.values()].sort((a, b) => a.date.localeCompare(b.date));
  const done = all.filter((d) => d.attendance !== "absent" && d.from_surah && d.to_surah);
  const ranges = done.map((d) => ({ from: position(d.from_surah, d.from_ayah)!, to: position(d.to_surah, d.to_ayah)! }));
  let start = ranges[0]?.from ?? null, end = ranges[0]?.to ?? null;
  for (const range of ranges.slice(1)) {
    if (start && isValidRange(row.direction, range.from, start)) start = range.from;
    if (end) end = furthest(row.direction, end, range.to);
  }
  const reviewed = all.filter((d) => d.attendance !== "absent" && d.attendance !== "excused" && d.review_from_surah && d.review_to_surah);
  const reviewSet = new Set<number>();
  for (const d of reviewed) {
    const from = position(d.review_from_surah, d.review_from_ayah)!;
    const to = position(d.review_to_surah, d.review_to_ayah)!;
    const dir = rangeDirection(row.direction, from, to);
    if (dir) for (const page of pagesOfRange(dir, from, to)) reviewSet.add(page);
  }
  const pages = row.saved ? row.pages : countUniquePages(row.direction, ranges);
  const reviewPages = row.saved ? row.reviewPages : reviewSet.size;
  return {
    ...row, daily: all, start: row.saved ? row.start : start, end: row.saved ? row.end : end,
    present: all.filter((d) => d.attendance === "present").length,
    late: all.filter((d) => d.attendance === "late").length,
    absent: all.filter((d) => d.attendance === "absent").length,
    excused: all.filter((d) => d.attendance === "excused").length,
    verses: done.reduce((n, d) => n + d.verses, 0), pages, percent: planPercent(pages, row.planPages),
    reviewPages, reviewPercent: planPercent(reviewPages, row.reviewPlanPages), reviewDays: reviewed.length,
    pending: true
  } as ReportRow;
}

function monthlyReport<T>(data: T, month: string, items: OutboxItem[]): T {
  const report = data as { rows?: ReportRow[] };
  if (!report.rows) return data;
  const daily = items.filter((item) => item.path === "/api/daily" && body<DailyInput>(item).date.startsWith(`${month}-`));
  const saved = items.filter((item) => item.path === "/api/reports/save" && body<ReportInput>(item).month === month);
  return { ...report, rows: report.rows.map((source) => {
    let row = reportRow(source, daily);
    for (const item of saved) {
      const entry = body<ReportInput>(item).rows.find((r) => r.studentId === row.studentId);
      if (!entry) continue;
      const end = entry.end ?? row.end;
      const pages = entry.end && row.start ? countPages(row.direction, row.start, entry.end) : row.pages;
      row = { ...row, end, pages, percent: planPercent(pages, row.planPages), saved: true, pending: true } as ReportRow;
    }
    return row;
  }) } as T;
}

export async function overlayPending<T>(path: string, data: T, userId: string): Promise<T> {
  if (!userId) return data;
  const items = (await outboxAll()).filter((item) => item.userId === userId && item.status !== "rejected");
  if (!items.length) return data;
  const url = new URL(path, "https://local.invalid");
  if (url.pathname === "/api/tests") {
    const me = await cacheGet<MeResponse>(`${getCenterId()}:me`);
    if (!me) return data;
    const students = (await cacheGet<{ students: Student[] }>(`${getCenterId()}:${userId}:offline:students:active`))?.students ?? [];
    const list = data as { tests?: OfflineTestRow[]; total?: number };
    if (!list.tests) return data;
    const status = url.searchParams.get("status") ?? "";
    const q = (url.searchParams.get("q") ?? "").toLocaleLowerCase();
    const rows = applyPendingTests(list.tests, items, students, me).filter((row) => (!status || row.status === status) && (!q || `${row.studentName} ${row.rangeText}`.toLocaleLowerCase().includes(q)));
    return { ...data, tests: rows, total: Math.max(list.total ?? rows.length, rows.length) } as T;
  }
  const session = url.pathname.match(/^\/api\/tests\/([^/]+)\/session$/);
  if (session) {
    const me = await cacheGet<MeResponse>(`${getCenterId()}:me`);
    return me ? applyPendingSession(data as Parameters<typeof applyPendingSession>[0], session[1], items, me.settings.minPassScore) as T : data;
  }
  if (url.pathname === "/api/daily/board") return dailyBoard(data, url.searchParams.get("date") ?? "", items);
  if (url.pathname === "/api/staff-attendance") return staffDay(data, url.searchParams.get("date") ?? "", items);
  if (url.pathname === "/api/reports") return monthlyReport(data, url.searchParams.get("month") ?? "", items);
  return data;
}
