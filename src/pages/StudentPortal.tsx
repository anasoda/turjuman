import { useState } from "react";
import { DIRECTION_LABELS, type Direction } from "@shared/constants";
import { completedJuz, type Position } from "@shared/quran";
import { ATTENDANCE_LABELS, fmtDay, fmtPos, fmtPosPage, TEST_STATUS_LABELS, TEST_TYPE_LABELS, type Attendance } from "../lib/format";
import { useFetch } from "../lib/hooks";
import { AbsenceReport, ScheduleCard } from "./ScheduleAbsence";
import { countAr, PARTS_AR } from "../lib/format";

interface Summary {
  student: { id: string; name: string; direction: Direction; lastSurah: number; lastAyah: number; monthlyPlanPages: number; memorizedParts: number; circleName: string | null; nextStart: Position | null };
  month: { month: string; pages: number; planPages: number; percent: number; present: number; absent: number; excused: number };
  daily: Array<{ date: string; attendance: Attendance; fromSurah: number | null; fromAyah: number | null; toSurah: number | null; toAyah: number | null; verses: number; pages: number; grade: string; note: string }>;
  tests: Array<{ id: string; kind: string; status: string; testType: string; parts: number; rangeText: string; testDate: string | null; score: number | null; passed: number | null; notes: string }>;
  sard: Array<{ id: string; date: string; stage: string; fromSurah: number; fromAyah: number; toSurah: number; toAyah: number; verses: number; mistakes: number; alerts: number; score: number; band: string }>;
  reports: Array<{ month: string; startSurah: number; startAyah: number; endSurah: number; endAyah: number; pages: number; planPages: number }>;
}

const TABS = [["daily", "الحضور والتسميع"], ["tests", "الاختبارات"], ["sard", "السرد"], ["reports", "الكشف الشهري"]] as const;

/** بوابة الطالب/ولي الأمر: للاطلاع فقط. ولي الأمر يمرّر معرّف الابن. */
export function StudentPortal({ studentId }: { studentId?: string } = {}) {
  const { data, error } = useFetch<Summary>(`/api/portal/summary${studentId ? `?studentId=${studentId}` : ""}`);
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("daily");
  if (error) return <div className="error-box">{error}</div>;
  if (!data) return <p className="muted">جارٍ التحميل…</p>;
  const { student: s, month: m } = data;
  const last: Position = { surah: s.lastSurah, ayah: s.lastAyah };
  const pos = (a: number | null, b: number | null) => (a && b ? fmtPos({ surah: a, ayah: b }) : "—");

  return (
    <>
      <div className="card">
        <h2>{studentId ? s.name : "مسيرة الحفظ"}</h2>
        <p className="muted" style={{ margin: 0 }}>{s.circleName ?? "بلا حلقة"} · {DIRECTION_LABELS[s.direction]}</p>
        <dl className="kv" style={{ marginTop: 10 }}>
          <dt>المحفوظ</dt><dd>{countAr(completedJuz(s.direction, last), PARTS_AR)} مكتملة</dd>
          <dt>آخر موضع</dt><dd>{s.lastAyah ? fmtPosPage(last) : "لم يبدأ بعد"}</dd>
          <dt>التالي</dt><dd>{s.nextStart ? fmtPos(s.nextStart) : "أتمّ المسار"}</dd>
        </dl>
      </div>

      <div className="card">
        <h3>إنجاز هذا الشهر</h3>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: ".92rem", marginTop: 4 }}><span>{m.pages} من {m.planPages} صفحة</span><b>{m.percent}%</b></div>
        <div className="progress"><i style={{ width: `${Math.min(100, m.percent)}%` }} /></div>
        <small className="muted">حضور {m.present} · غياب {m.absent} · بعذر {m.excused}</small>
      </div>

      <AbsenceReport studentId={studentId} />
      <ScheduleCard studentId={studentId} />

      <div className="tabs" role="tablist">{TABS.map(([k, label]) => <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(k)}>{label}</button>)}</div>

      <div className="list">
        {tab === "daily" && data.daily.map((d) => (
          <div key={d.date} className="card">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><b>{fmtDay(d.date)}</b><span className={`chip ${d.attendance === "absent" ? "off" : ""}`}>{ATTENDANCE_LABELS[d.attendance]}</span></div>
            {d.attendance !== "absent" && <div className="muted" style={{ fontSize: ".9rem" }}>{pos(d.fromSurah, d.fromAyah)} ← {pos(d.toSurah, d.toAyah)} · {d.pages} صفحة{d.grade ? ` · ${d.grade}` : ""}</div>}
            {d.note && <div style={{ fontSize: ".9rem" }}>ملاحظة المحفّظ: {d.note}</div>}
          </div>
        ))}
        {tab === "tests" && data.tests.map((t) => (
          <div key={t.id} className="card">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><b>{t.kind === "trial" ? "اختبار تجريبي" : "اختبار رسمي"} — {TEST_TYPE_LABELS[t.testType]} {t.parts} أجزاء</b><span className="chip">{TEST_STATUS_LABELS[t.status]}</span></div>
            <div className="muted" style={{ fontSize: ".9rem" }}>{t.rangeText || "—"} · {t.testDate ?? "موعده لم يُحدَّد"}</div>
            {t.status === "completed" && <div><b>{t.score}</b> {t.passed ? <span className="chip">ناجح</span> : <span className="chip off">دون النجاح</span>}</div>}
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
            <div className="muted" style={{ fontSize: ".9rem" }}>{fmtPosPage({ surah: r.startSurah, ayah: r.startAyah })} ← {fmtPosPage({ surah: r.endSurah, ayah: r.endAyah })}</div>
            <div>{r.pages} من {r.planPages} صفحة</div>
          </div>
        ))}
        {((tab === "daily" && !data.daily.length) || (tab === "tests" && !data.tests.length) || (tab === "sard" && !data.sard.length) || (tab === "reports" && !data.reports.length)) && <div className="empty">لا توجد سجلات بعد.</div>}
      </div>
    </>
  );
}
