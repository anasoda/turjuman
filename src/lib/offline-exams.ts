import { examRangeDetails, examTotalScore, type ExamRange } from "@shared/exams";
import { getCenterId } from "./center";
import { cacheGet, outboxAll, type OutboxItem } from "./offline";
import type { MeResponse, Student } from "./types";

export interface OfflineTestRow {
  id: string; studentId: string; studentName: string; circleName: string | null;
  kind: "trial" | "official"; status: string; testType: string; parts: number;
  rangeText: string; testDate: string | null; score: number | null; passed: number | null;
  notes: string; createdAt: number; proposedByName: string | null; decidedByName: string | null;
  sessionId: string | null; pending?: boolean;
}

interface Question { id: string; seq: number; label: string; surah: number | null; ayah: number | null; maxScore: number; warnings: number; errors: number; score: number | null }
interface SessionDetails {
  test: { studentName: string; circleName: string | null; testType: string; parts: number; rangeText: string; testDate: string | null; testStatus: string; score: number | null; passed: number | null; notes: string };
  session: { id: string; status: "draft" | "completed"; examinerId: string; createdAt: number; completedAt: number | null };
  questions: Question[];
  pending?: boolean;
}
type ProposalBody = { proposals?: Array<{ studentId: string; id: string }>; testType: string; parts: number; range: ExamRange };
type SessionBody = { questions: Array<{ id: string; seq?: number; surah: number | null; ayah: number | null; warnings: number; errors: number }>; finalize: boolean; testDate: string | null; notes: string };
const base = (userId: string) => `${getCenterId()}:${userId}:`;
const active = (items: OutboxItem[], userId: string) => items.filter((item) => item.userId === userId && item.status !== "rejected");

export function applyPendingTests(rows: OfflineTestRow[], items: OutboxItem[], students: Student[], me: MeResponse): OfflineTestRow[] {
  const byId = new Map(rows.map((row) => [row.id, { ...row }]));
  const studentById = new Map(students.map((student) => [student.id, student]));
  for (const item of items) {
    if (item.path === "/api/tests/propose") {
      const body = item.body as ProposalBody;
      const range = examRangeDetails(body.range);
      for (const proposal of body.proposals ?? []) {
        if (byId.has(proposal.id)) continue;
        const student = studentById.get(proposal.studentId);
        byId.set(proposal.id, {
          id: proposal.id, studentId: proposal.studentId, studentName: student?.name ?? "طالب",
          circleName: student?.circleName ?? null, kind: "official", status: "proposed", testType: body.testType,
          parts: range?.parts ?? body.parts, rangeText: range?.text ?? "", testDate: null, score: null, passed: null,
          notes: "", createdAt: item.createdAt, proposedByName: me.user.displayName, decidedByName: null, sessionId: null, pending: true
        });
      }
      continue;
    }
    const decision = item.path.match(/^\/api\/tests\/([^/]+)\/(approve|reject|session)$/);
    const sessionSave = item.path.match(/^\/api\/tests\/([^/]+)\/session$/);
    const id = decision?.[1] ?? sessionSave?.[1];
    if (!id) continue;
    const row = byId.get(id);
    if (!row) continue;
    if (decision?.[2] === "approve") Object.assign(row, { status: "approved", testDate: (item.body as { testDate?: string | null }).testDate ?? null, notes: (item.body as { notes?: string }).notes ?? "", decidedByName: me.user.displayName, pending: true });
    if (decision?.[2] === "reject") Object.assign(row, { status: "rejected", notes: (item.body as { notes?: string }).notes ?? "", decidedByName: me.user.displayName, pending: true });
    if (decision?.[2] === "session") Object.assign(row, { sessionId: row.sessionId ?? `offline:${id}`, pending: true });
    if (item.method === "PUT" && sessionSave) {
      const body = item.body as SessionBody;
      row.sessionId ??= `offline:${id}`;
      row.pending = true;
      row.testDate = body.testDate;
      row.notes = body.notes;
      if (body.finalize) {
        const slots = me.settings.examQuestionSlots;
        const scored = body.questions.map((q, index) => ({ maxScore: slots[(q.seq ?? index + 1) - 1]?.maxScore ?? 0, warnings: q.warnings, errors: q.errors }));
        row.score = examTotalScore(scored);
        row.passed = row.score >= me.settings.minPassScore ? 1 : 0;
        row.status = "completed";
      }
    }
  }
  return [...byId.values()].sort((a, b) => b.createdAt - a.createdAt);
}

export function applyPendingSession(details: SessionDetails, testId: string, items: OutboxItem[], minPassScore: number): SessionDetails {
  const result: SessionDetails = { ...details, test: { ...details.test }, session: { ...details.session }, questions: details.questions.map((q) => ({ ...q })) };
  for (const item of items) if (item.method === "PUT" && item.path === `/api/tests/${testId}/session`) {
    const body = item.body as SessionBody;
    for (const [index, question] of result.questions.entries()) {
      const edit = body.questions.find((q) => q.id === question.id || q.seq === question.seq);
      if (!edit) continue;
      result.questions[index] = { ...question, surah: edit.surah, ayah: edit.ayah, warnings: edit.warnings, errors: edit.errors };
    }
    result.test.testDate = body.testDate;
    result.test.notes = body.notes;
    if (body.finalize) {
      result.session.status = "completed";
      result.test.testStatus = "completed";
      result.test.score = examTotalScore(result.questions.map((q) => ({ maxScore: q.maxScore, warnings: q.warnings, errors: q.errors })));
      result.test.passed = result.test.score >= minPassScore ? 1 : 0;
    }
    result.pending = true;
  }
  return result;
}

export async function offlineExamGet<T>(path: string, userId: string): Promise<T | undefined> {
  if (!userId) return undefined;
  const url = new URL(path, "https://local.invalid");
  if (url.pathname !== "/api/tests" && !/^\/api\/tests\/[^/]+\/session$/.test(url.pathname)) return undefined;
  const me = await cacheGet<MeResponse>(`${getCenterId()}:me`);
  const all = await cacheGet<{ tests: OfflineTestRow[] }>(`${base(userId)}offline:tests:all`);
  if (!me || !all) return undefined;
  const items = active(await outboxAll(), userId);
  const students = (await cacheGet<{ students: Student[] }>(`${base(userId)}offline:students:active`))?.students ?? [];
  const rows = applyPendingTests(all.tests, items, students, me);
  if (url.pathname === "/api/tests") {
    const status = url.searchParams.get("status") ?? "";
    const kind = url.searchParams.get("kind") ?? "";
    const studentId = url.searchParams.get("studentId") ?? "";
    const q = (url.searchParams.get("q") ?? "").toLocaleLowerCase();
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(url.searchParams.get("pageSize")) || 20));
    const filtered = rows.filter((row) => (!status || row.status === status) && (!kind || row.kind === kind)
      && (!studentId || row.studentId === studentId) && (!q || `${row.studentName} ${row.rangeText}`.toLocaleLowerCase().includes(q)));
    return { tests: filtered.slice((page - 1) * pageSize, page * pageSize), total: filtered.length, page, pageSize } as T;
  }
  const testId = url.pathname.split("/")[3];
  const row = rows.find((test) => test.id === testId);
  if (!row) return undefined;
  const cached = await cacheGet<SessionDetails>(`${base(userId)}${path}`);
  if (cached) return applyPendingSession(cached, testId, items, me.settings.minPassScore) as T;
  if (!row.sessionId) return undefined;
  const questions: Question[] = me.settings.examQuestionSlots.map((slot, index) => ({ id: `offline:${testId}:${index + 1}`, seq: index + 1, label: slot.label, surah: null, ayah: null, maxScore: slot.maxScore, warnings: 0, errors: 0, score: null }));
  const details: SessionDetails = {
    test: { studentName: row.studentName, circleName: row.circleName, testType: row.testType, parts: row.parts, rangeText: row.rangeText, testDate: row.testDate, testStatus: row.status, score: row.score, passed: row.passed, notes: row.notes },
    session: { id: row.sessionId, status: "draft", examinerId: userId, createdAt: Date.now(), completedAt: null }, questions, pending: true
  };
  return applyPendingSession(details, testId, items, me.settings.minPassScore) as T;
}
