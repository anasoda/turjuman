import { useRef, useState } from "react";
import { useAction } from "../components/ui";
import { saveAsImage } from "../lib/image-export";
import { fmtDay, fmtPos, TEST_TYPE_LABELS } from "../lib/format";
import { useFetch } from "../lib/hooks";

interface Card {
  student: { id: string; name: string; circleName: string | null };
  period: "week" | "month"; from: string; to: string;
  attendance: { sessions: number; present: number; late: number; absent: number; excused: number };
  pages: number; reviewPages: number;
  month: { pages: number; planPages: number; percent: number; reviewPages: number; reviewPlanPages: number; reviewPercent: number };
  next: { date: string; mfs: number | null; mfa: number | null; mts: number | null; mta: number | null; rfs: number | null; rfa: number | null; rts: number | null; rta: number | null; note: string } | null;
  tests: Array<{ kind: string; testType: string; parts: number; rangeText: string; testDate: string | null; score: number | null; passed: number | null }>;
  teacherNote: { date: string; text: string } | null;
}

const range = (a: number | null, b: number | null, c: number | null, d: number | null) =>
  a && b && c && d ? `${fmtPos({ surah: a, ayah: b })} ← ${fmtPos({ surah: c, ayah: d })}` : null;

/** بطاقة المتابعة لولي الأمر (§14.8): أسبوعية/شهرية، تُحفظ صورة PNG. */
export function FollowUpCard({ studentId }: { studentId?: string }) {
  const [period, setPeriod] = useState<"week" | "month">("week");
  const { data, error } = useFetch<Card>(`/api/portal/card?period=${period}${studentId ? `&studentId=${studentId}` : ""}`);
  const ref = useRef<HTMLDivElement>(null);
  const { busy, run } = useAction();
  const memo = data?.next && range(data.next.mfs, data.next.mfa, data.next.mts, data.next.mta);
  const rev = data?.next && range(data.next.rfs, data.next.rfa, data.next.rts, data.next.rta);

  return (
    <div className="card">
      <h3>بطاقة المتابعة</h3>
      <div className="tabs no-image" role="tablist">
        {([["week", "آخر أسبوع"], ["month", "هذا الشهر"]] as const).map(([k, label]) => <button key={k} type="button" aria-pressed={period === k} onClick={() => setPeriod(k)}>{label}</button>)}
      </div>
      {error && <div className="error-box">{error}</div>}
      {!data && !error && <p className="muted">جارٍ التحميل…</p>}
      {data && (
        <>
          <div ref={ref} style={{ padding: 8 }}>
            <b>{data.student.name}</b>
            <div className="muted" style={{ fontSize: ".85rem" }}>{data.student.circleName ?? "بلا حلقة"} · من {fmtDay(data.from)} إلى {fmtDay(data.to)}</div>
            <dl className="kv" style={{ marginTop: 8 }}>
              <dt>الحضور</dt><dd>{data.attendance.sessions ? `حاضر ${data.attendance.present + data.attendance.late} · غائب ${data.attendance.absent} · بعذر ${data.attendance.excused} (من ${data.attendance.sessions} لقاء)` : "لا لقاءات مسجّلة في هذه الفترة"}</dd>
              <dt>حفظ جديد</dt><dd>{data.pages} صفحة</dd>
              <dt>مراجعة</dt><dd>{data.reviewPages} صفحة</dd>
            </dl>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: ".9rem", marginTop: 6 }}><span>الشهر: حفظ {data.month.pages} من {data.month.planPages}</span><b>{data.month.percent}%</b></div>
            <div className="progress"><i style={{ width: `${Math.min(100, data.month.percent)}%` }} /></div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: ".9rem", marginTop: 6 }}><span>الشهر: مراجعة {data.month.reviewPages} من {data.month.reviewPlanPages}</span><b>{data.month.reviewPercent}%</b></div>
            <div className="progress"><i style={{ width: `${Math.min(100, data.month.reviewPercent)}%` }} /></div>
            {data.tests.length > 0 && <>
              <h4 style={{ margin: "10px 0 2px" }}>آخر الاختبارات</h4>
              {data.tests.map((t, i) => <div key={i} style={{ fontSize: ".9rem" }}>{t.kind === "trial" ? "تجريبي" : "رسمي"} — {TEST_TYPE_LABELS[t.testType]} {t.parts} أجزاء{t.rangeText ? ` (${t.rangeText})` : ""}: <b>{t.score}</b> {t.passed ? "ناجح" : "دون النجاح"}{t.testDate ? ` · ${t.testDate}` : ""}</div>)}
            </>}
            {data.next && (memo || rev || data.next.note) && <>
              <h4 style={{ margin: "10px 0 2px" }}>المطلوب في اللقاء القادم</h4>
              {memo && <div style={{ fontSize: ".9rem" }}>حفظ: {memo}</div>}
              {rev && <div style={{ fontSize: ".9rem" }}>مراجعة: {rev}</div>}
              {data.next.note && <div style={{ fontSize: ".9rem" }}>{data.next.note}</div>}
            </>}
            {data.teacherNote && <div style={{ marginTop: 8, fontSize: ".9rem" }}><b>ملاحظة المحفّظ ({fmtDay(data.teacherNote.date)}):</b> {data.teacherNote.text}</div>}
          </div>
          <div className="actions no-image"><button className="btn ghost small" type="button" disabled={busy} onClick={() => { if (ref.current) void run(() => saveAsImage(ref.current!, `متابعة-${data.student.name}-${data.to}`), "تم حفظ صورة البطاقة"); }}>حفظ البطاقة كصورة</button></div>
        </>
      )}
    </div>
  );
}
