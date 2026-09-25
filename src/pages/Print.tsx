import { useParams, useSearchParams } from "react-router-dom";
import { DIRECTION_LABELS, type Direction } from "@shared/constants";
import { completedJuz, type Position } from "@shared/quran";
import { ATTENDANCE_LABELS, fmtDay, fmtPos, fmtPosPage, TEST_STATUS_LABELS, TEST_TYPE_LABELS, type Attendance } from "../lib/format";
import { useFetch } from "../lib/hooks";
import { useMe } from "../lib/session";
import type { Student } from "../lib/types";

interface Summary {
  student: { id: string; name: string; direction: Direction; lastSurah: number; lastAyah: number; monthlyPlanPages: number; memorizedParts: number; circleName: string | null };
  month: { month: string; pages: number; planPages: number; percent: number; present: number; absent: number; excused: number };
  daily: Array<{ date: string; attendance: Attendance; fromSurah: number | null; fromAyah: number | null; toSurah: number | null; toAyah: number | null; pages: number; grade: string; note: string }>;
  tests: Array<{ id: string; kind: string; status: string; testType: string; parts: number; rangeText: string; testDate: string | null; score: number | null; passed: number | null }>;
  sard: Array<{ id: string; date: string; stage: string; verses: number; mistakes: number; alerts: number; score: number; band: string }>;
  reports: Array<{ month: string; startSurah: number; startAyah: number; endSurah: number; endAyah: number; pages: number; planPages: number }>;
}

/** صفحات الطباعة للطالب: تقرير شامل، شهادة تقدير، بطاقة تعريف. تُفتح ثم «طباعة / PDF». */
export function PrintStudent() {
  const { id = "" } = useParams();
  const [sp] = useSearchParams();
  const type = sp.get("type") ?? "report";
  const { center } = useMe();
  const summary = useFetch<Summary>(`/api/reports/student/${id}`);
  const detail = useFetch<{ student: Student }>(`/api/students/${id}`);
  if (summary.error || detail.error) return <main className="page"><div className="error-box">{summary.error || detail.error}</div></main>;
  if (!summary.data || !detail.data) return <main className="page"><p className="muted">جارٍ التحميل…</p></main>;
  const s = summary.data.student;
  const st = detail.data.student;
  const last: Position = { surah: s.lastSurah, ayah: s.lastAyah };
  const juz = completedJuz(s.direction, last);
  const today = new Date().toLocaleDateString("ar-EG-u-nu-latn", { dateStyle: "long" });
  const Head = () => (
    <header style={{ display: "flex", alignItems: "center", gap: 12, borderBottom: "2px solid var(--green)", paddingBottom: 10, marginBottom: 12 }}>
      <span className="brand-mark" style={{ width: 52, height: 52, background: "var(--gold-soft)" }}>{center.logo ? <img src={center.logo} alt="" /> : "📖"}</span>
      <div style={{ flex: 1 }}><h1 style={{ color: "var(--green)" }}>{center.name}</h1><small className="muted">{center.subtitle}</small></div>
      {st.photo && <img src={st.photo} alt="" style={{ width: 64, height: 64, borderRadius: 12, objectFit: "cover" }} />}
    </header>
  );

  return (
    <main className="page print-sheet">
      <div className="actions no-print"><button className="btn" type="button" onClick={() => window.print()}>طباعة / حفظ PDF</button></div>

      {type === "certificate" && (
        <section className="card" style={{ textAlign: "center", padding: 32, border: "3px double var(--gold)" }}>
          <Head />
          <h1 style={{ fontSize: "2rem", color: "var(--gold)", margin: "18px 0" }}>شهادة تقدير</h1>
          <p style={{ fontSize: "1.2rem" }}>تشهد إدارة {center.name} بأن الطالب</p>
          <h2 style={{ fontSize: "1.8rem", color: "var(--green)", margin: "10px 0" }}>{s.name}</h2>
          <p style={{ fontSize: "1.2rem" }}>{s.circleName ? `من حلقة «${s.circleName}»` : ""} قد أتمّ حفظ <b>{juz}</b> {juz <= 10 ? "أجزاء" : "جزءاً"} من كتاب الله تعالى</p>
          <p style={{ fontSize: "1.1rem" }}>نسأل الله أن يبارك فيه وأن يجعل القرآن ربيع قلبه.</p>
          <p className="muted" style={{ marginTop: 40 }}>{today}</p>
        </section>
      )}

      {type === "card" && (
        <section className="card" style={{ maxWidth: 380, margin: "0 auto", border: "2px solid var(--green)" }}>
          <Head />
          <h2>{s.name}</h2>
          <dl className="kv" style={{ marginTop: 8 }}>
            <dt>الحلقة</dt><dd>{s.circleName ?? "—"}</dd>
            <dt>رقم الهوية</dt><dd dir="ltr" style={{ textAlign: "end" }}>{st.nationalId}</dd>
            <dt>المحفوظ</dt><dd>{juz} جزءاً</dd>
          </dl>
        </section>
      )}

      {type === "report" && (
        <section className="card">
          <Head />
          <h2>تقرير الطالب: {s.name}</h2>
          <p className="muted" style={{ margin: "2px 0 10px" }}>{s.circleName ?? "بلا حلقة"} · {DIRECTION_LABELS[s.direction]} · {today}</p>
          <dl className="kv">
            <dt>المحفوظ</dt><dd>{juz} جزءاً مكتملاً</dd>
            <dt>آخر موضع</dt><dd>{s.lastAyah ? fmtPosPage(last) : "لم يبدأ"}</dd>
            <dt>الخطة الشهرية</dt><dd>{s.monthlyPlanPages} صفحة</dd>
            <dt>إنجاز {summary.data.month.month}</dt><dd>{summary.data.month.pages} صفحة ({summary.data.month.percent}%)</dd>
            <dt>الحضور هذا الشهر</dt><dd>حضور {summary.data.month.present} · غياب {summary.data.month.absent} · بعذر {summary.data.month.excused}</dd>
          </dl>
          <h3 style={{ marginTop: 14 }}>آخر التسميع</h3>
          <table style={{ width: "100%", fontSize: ".85rem" }}><tbody>{summary.data.daily.slice(0, 12).map((d) => <tr key={d.date}><td>{fmtDay(d.date)}</td><td>{ATTENDANCE_LABELS[d.attendance]}</td><td>{d.fromSurah ? `${fmtPos({ surah: d.fromSurah, ayah: d.fromAyah! })} ← ${fmtPos({ surah: d.toSurah!, ayah: d.toAyah! })}` : "—"}</td><td>{d.pages ? `${d.pages} ص` : ""}</td><td>{d.grade}</td></tr>)}</tbody></table>
          <h3 style={{ marginTop: 14 }}>الاختبارات</h3>
          <table style={{ width: "100%", fontSize: ".85rem" }}><tbody>{summary.data.tests.map((t) => <tr key={t.id}><td>{t.kind === "trial" ? "تجريبي" : "رسمي"}</td><td>{TEST_TYPE_LABELS[t.testType]} {t.parts}</td><td>{t.rangeText || "—"}</td><td>{t.testDate ?? "—"}</td><td>{t.status === "completed" ? `${t.score} ${t.passed ? "(ناجح)" : ""}` : TEST_STATUS_LABELS[t.status]}</td></tr>)}{!summary.data.tests.length && <tr><td className="muted">لا توجد اختبارات</td></tr>}</tbody></table>
          <h3 style={{ marginTop: 14 }}>السرد</h3>
          <table style={{ width: "100%", fontSize: ".85rem" }}><tbody>{summary.data.sard.slice(0, 8).map((r) => <tr key={r.id}><td>{r.date}</td><td>{r.stage === "trial" ? "تجريبي" : "نهائي"}</td><td>{r.mistakes} خطأ · {r.alerts} تنبيه</td><td>{r.band} ({r.score})</td></tr>)}{!summary.data.sard.length && <tr><td className="muted">لا توجد سرود</td></tr>}</tbody></table>
        </section>
      )}
    </main>
  );
}
