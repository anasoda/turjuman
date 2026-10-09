import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { DIRECTION_LABELS, type Direction } from "@shared/constants";
import { planPace } from "@shared/pace";
import type { Position } from "@shared/quran";
import { Sheet, useAction } from "../components/ui";
import { saveAsImage } from "../lib/image-export";
import { ATTENDANCE_LABELS, fmtDay, fmtPos, fmtPosPage, monthIso, todayIso, TEST_STATUS_LABELS, TEST_TYPE_LABELS, type Attendance } from "../lib/format";
import { useFetch } from "../lib/hooks";
import { useMe } from "../lib/session";
import { SURAHS } from "@shared/quran-data";
import { AbsenceReport, ScheduleCard } from "./ScheduleAbsence";
import { AhkamCards } from "./AhkamPortal";
import { FollowUpCard } from "./FollowUpCard";

interface Summary {
  student: { id: string; name: string; direction: Direction; lastSurah: number; lastAyah: number; circleName: string | null; nextStart: Position | null; reviewLast: Position | null };
  month: { month: string; pages: number; planPages: number; percent: number; present: number; absent: number; excused: number; notMemorized: number; reviewPages: number; reviewPlanPages: number; reviewPercent: number };
  daily: Array<{ date: string; attendance: Attendance; fromSurah: number | null; fromAyah: number | null; toSurah: number | null; toAyah: number | null; verses: number; pages: number; grade: string; note: string; reviewFromSurah: number | null; reviewFromAyah: number | null; reviewToSurah: number | null; reviewToAyah: number | null; reviewPages: number; reviewGrade: string }>;
  tests: Array<{ id: string; kind: string; status: string; testType: string; parts: number; rangeText: string; testDate: string | null; score: number | null; passed: number | null; notes: string }>;
  sard: Array<{ id: string; date: string; stage: string; fromSurah: number; fromAyah: number; toSurah: number; toAyah: number; verses: number; mistakes: number; alerts: number; score: number; band: string }>;
  reports: Array<{ month: string; startSurah: number; startAyah: number; endSurah: number; endAyah: number; pages: number; planPages: number; reviewPages: number; reviewPlanPages: number }>;
}

const TABS = [["daily", "الحضور والتسميع"], ["tests", "الاختبارات"], ["sard", "السرد"], ["reports", "الكشف الشهري"]] as const;

/** بوابة الطالب/ولي الأمر: للاطلاع فقط. ولي الأمر يمرّر معرّف الابن. */
export function StudentPortal({ studentId }: { studentId?: string } = {}) {
  const [searchParams] = useSearchParams();
  const { user } = useMe();
  const staffView = user.role !== "student" && user.role !== "guardian";
  const { data, error } = useFetch<Summary>(staffView && studentId ? `/api/reports/student/${studentId}` : `/api/portal/summary${studentId ? `?studentId=${studentId}` : ""}`);
  const [tab, setTab] = useState<(typeof TABS)[number][0]>(searchParams.get("tab") === "tests" ? "tests" : "daily");
  const [detailId, setDetailId] = useState<string | null>(null);
  useEffect(() => {
    const wanted = searchParams.get("testId");
    if (wanted && data?.tests.some((test) => test.id === wanted)) { setTab("tests"); setDetailId(wanted); }
  }, [data, searchParams]);
  const progressRef = useRef<HTMLDivElement>(null);
  const { busy, run } = useAction();
  if (error) return <div className="error-box">{error}</div>;
  if (!data) return <p className="muted">جارٍ التحميل…</p>;
  const { student: s, month: m } = data;
  const pace = m.month === monthIso() ? planPace(m.planPages, m.pages, todayIso()) : null;
  const last: Position = { surah: s.lastSurah, ayah: s.lastAyah };
  const pos = (a: number | null, b: number | null) => (a && b ? fmtPos({ surah: a, ayah: b }) : "—");

  return (
    <>
      <div ref={progressRef}>
      <div className="card">
        <h2>{studentId ? s.name : "مسيرة الحفظ"}</h2>
        <p className="muted" style={{ margin: 0 }}>{s.circleName ?? "بلا حلقة"} · {DIRECTION_LABELS[s.direction]}</p>
        <dl className="kv" style={{ marginTop: 10 }}>
          <dt>الحفظ الجديد حتى</dt><dd>{s.lastAyah ? fmtPosPage(last) : "لم يبدأ بعد"}</dd>
          <dt>موضع المراجعة</dt><dd>{s.reviewLast ? fmtPosPage(s.reviewLast) : "لا مراجعة مسجّلة بعد"}</dd>
          <dt>الحفظ التالي</dt><dd>{s.nextStart ? fmtPos(s.nextStart) : "أتمّ المسار"}</dd>
        </dl>
      </div>

      <div className="card">
        <h3>إنجاز هذا الشهر</h3>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: ".92rem", marginTop: 4 }}><span>الحفظ: {m.pages} من {m.planPages} صفحة</span><b>{m.percent}%</b></div>
        <div className="progress"><i style={{ width: `${Math.min(100, m.percent)}%` }} /></div>
        {pace && pace.status !== "early" && (
          <small className="muted" style={{ display: "block", marginTop: 4 }}>
            {pace.status === "done" ? "ما شاء الله، أُنجزت خطة هذا الشهر" : pace.status === "ahead" ? `على الوتيرة المتوقعة (المتوقع حتى اليوم نحو ${pace.expectedPages} صفحة)` : `المتوقع حتى اليوم نحو ${pace.expectedPages} صفحة، والباقي يُستدرك بإذن الله`}
          </small>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: ".92rem", marginTop: 10 }}><span>المراجعة: {m.reviewPages} من {m.reviewPlanPages} صفحة</span><b>{m.reviewPercent}%</b></div>
        <div className="progress"><i style={{ width: `${Math.min(100, m.reviewPercent)}%` }} /></div>
        <small className="muted">حضور {m.present} · غياب {m.absent} · بعذر {m.excused}{m.notMemorized > 0 && ` · مش حافظ ${m.notMemorized}`}</small>
      </div>
      </div>
      <div className="actions"><button className="btn ghost small" type="button" disabled={busy} onClick={() => { if (progressRef.current) void run(() => saveAsImage(progressRef.current!, `إنجاز-${s.name}-${m.month}`), "تم حفظ صورة الإنجاز"); }}>تصدير الإنجاز كصورة</button></div>

      {!staffView && <FollowUpCard studentId={studentId} />}
      {!staffView && <AbsenceReport studentId={studentId} />}
      {!staffView && <ScheduleCard studentId={studentId} />}
      {user.role === "guardian" && studentId && <AhkamCards studentId={studentId} />}

      <div className="tabs" role="tablist">{TABS.map(([k, label]) => <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(k)}>{label}</button>)}</div>

      <div className="list">
        {tab === "daily" && data.daily.map((d) => (
          <div key={d.date} className="card">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><b>{fmtDay(d.date)}</b><span className={`chip ${d.attendance === "absent" ? "off" : ""}`}>{ATTENDANCE_LABELS[d.attendance]}</span></div>
            {d.reviewFromSurah && <div className="muted" style={{ fontSize: ".9rem" }}>المراجعة: {pos(d.reviewFromSurah, d.reviewFromAyah)} ← {pos(d.reviewToSurah, d.reviewToAyah)} · {d.reviewPages} صفحة{d.reviewGrade ? ` · ${d.reviewGrade}` : ""}</div>}
            {d.fromSurah && <div className="muted" style={{ fontSize: ".9rem" }}>الحفظ: {pos(d.fromSurah, d.fromAyah)} ← {pos(d.toSurah, d.toAyah)} · {d.pages} صفحة{d.grade ? ` · ${d.grade}` : ""}</div>}
            {d.note && <div style={{ fontSize: ".9rem" }}>ملاحظة المحفّظ: {d.note}</div>}
          </div>
        ))}
        {tab === "tests" && data.tests.map((t) => (
          <div key={t.id} className="card">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><b>{t.kind === "trial" ? "اختبار تجريبي" : "اختبار رسمي"} — {TEST_TYPE_LABELS[t.testType]} {t.parts} أجزاء</b><span className="chip">{TEST_STATUS_LABELS[t.status]}</span></div>
            <div className="muted" style={{ fontSize: ".9rem" }}>{t.rangeText || "—"} · {t.testDate ?? "موعده لم يُحدَّد"}</div>
            {t.status === "completed" && <div><b>{t.score}</b> {t.passed ? <span className="chip">ناجح</span> : <span className="chip off">دون النجاح</span>}</div>}
            {t.notes && <div>ملاحظات المختبر: {t.notes}</div>}
            {(user.role === "guardian" || (staffView && t.kind === "official" && t.status === "completed")) && <button className="btn ghost small" type="button" onClick={() => setDetailId(t.id)}>تفاصيل الاختبار</button>}
          </div>
        ))}
        {tab === "sard" && data.sard.map((r) => (
          <div key={r.id} className="card">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><b>{r.date}</b><span className="chip">{r.band} · {r.score}</span></div>
            <div className="muted" style={{ fontSize: ".9rem" }}>{fmtPos({ surah: r.fromSurah, ayah: r.fromAyah })} ← {fmtPos({ surah: r.toSurah, ayah: r.toAyah })} · {r.mistakes} خطأ · {r.alerts} تنبيه</div>
          </div>
        ))}
        {tab === "reports" && data.reports.map((r) => (
          <div key={r.month} className="card">
            <b>{r.month}</b>
            {r.pages > 0 && <div className="muted" style={{ fontSize: ".9rem" }}>الحفظ: {fmtPosPage({ surah: r.startSurah, ayah: r.startAyah })} ← {fmtPosPage({ surah: r.endSurah, ayah: r.endAyah })}</div>}
            <div>الحفظ: {r.pages} من {r.planPages} صفحة</div>
            <div>المراجعة: {r.reviewPages} من {r.reviewPlanPages} صفحة</div>
          </div>
        ))}
        {((tab === "daily" && !data.daily.length) || (tab === "tests" && !data.tests.length) || (tab === "sard" && !data.sard.length) || (tab === "reports" && !data.reports.length)) && <div className="empty">لا توجد سجلات بعد.</div>}
      </div>
      {detailId && <GuardianTestDetails id={detailId} staffView={staffView} onClose={() => setDetailId(null)} />}
    </>
  );
}

function GuardianTestDetails({ id, staffView, onClose }: { id: string; staffView: boolean; onClose: () => void }) {
  const { data, error } = useFetch<{ test: { kind: string; status?: string; testStatus?: string; rangeText: string; testDate: string | null; score: number | null; passed: number | null; notes: string; examinerName: string | null }; questions: Array<{ seq: number; label: string; surah: number | null; ayah: number | null; maxScore: number; warnings: number; errors: number; score: number | null }> }>(staffView ? `/api/tests/${id}/session` : `/api/portal/tests/${id}`);
  return <Sheet title="تفاصيل الاختبار" onClose={onClose}>
    {error && <div className="error-box">{error}</div>}
    {!data && !error && <p className="muted">جارٍ التحميل…</p>}
    {data && <div className="list">
      <div className="card"><b>{data.test.kind === "trial" ? "اختبار تجريبي" : "اختبار رسمي"}</b><div>{data.test.rangeText || "—"}</div><div>التاريخ: {data.test.testDate || "لم يُحدّد بعد"}</div>{(data.test.status ?? data.test.testStatus) === "completed" && <div>العلامة: <b>{data.test.score}{data.test.kind === "official" ? " / 100" : ""}</b> · {data.test.passed ? "ناجح" : "دون النجاح"}</div>}{data.test.examinerName && <div>المختبر: {data.test.examinerName}</div>}{data.test.notes && <p>ملاحظات الاختبار: {data.test.notes}</p>}</div>
      {data.questions.map((q) => <div className="card" key={q.seq}><b>{q.seq}. {q.label}</b><div>{q.surah ? `سورة ${SURAHS[q.surah - 1]?.[0] ?? q.surah}${q.ayah ? `، الآية ${q.ayah}` : ""}` : "الموضع غير محدّد"}</div><div>العلامة: {q.score ?? "—"} / {q.maxScore} · التنبيهات: {q.warnings} · الأخطاء: {q.errors}</div></div>)}
    </div>}
  </Sheet>;
}
