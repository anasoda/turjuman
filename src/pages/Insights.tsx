import { useMemo, useState } from "react";
import { CATEGORY_LABELS, DIRECTION_LABELS, GENDER_LABELS, type Direction, type Gender } from "@shared/constants";
import { ageOf, downloadFile, toCsv } from "../lib/download";
import { useFetch } from "../lib/hooks";
import { useMe } from "../lib/session";
import { countAr, STUDENTS_AR } from "../lib/format";

interface MonthRow { month: string; present: number; absent: number; excused: number; pages: number; sard: number; tests: number; testsPassed: number }
interface StudentRow { id: string; name: string; nationalId: string; birth: string; gender: Gender; memorizedParts: number; direction: Direction; monthlyPlanPages: number; circleId: string | null; circleName: string | null; levelKey: string | null; present: number; absent: number; pages: number; tests: number }
interface TeacherRow { id: string; name: string; active: number; nationalId: string | null; birth: string | null; gender: Gender | null; qualification: string | null; ajkamCourse: string | null; memorizedParts: number | null; circleName: string | null; studentCount: number | null }

const TABS = [["trend", "اتجاه المركز"], ["students", "تقارير الطلاب"], ["teachers", "تقارير المعلّمين"]] as const;

/** الإحصاءات والتقارير: رسوم للاتجاه، وجداول قابلة للتصفية والتصدير (CSV/Excel) والطباعة. */
export function Insights() {
  const { user } = useMe();
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("trend");
  return (
    <main className="page">
      <div className="page-head"><div><h1>الإحصاءات والتقارير</h1><p>{user.role === "exam_committee" ? "للاطلاع" : "تصدير وطباعة"}</p></div></div>
      <div className="tabs no-print" role="tablist">
        {TABS.filter(([k]) => k !== "teachers" || user.role !== "exam_committee").map(([k, label]) => <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(k)}>{label}</button>)}
      </div>
      {tab === "trend" && <Trend />}
      {tab === "students" && <StudentsReport />}
      {tab === "teachers" && <TeachersReport />}
    </main>
  );
}

/* ---------------- الاتجاه: رسوم أعمدة SVG ---------------- */
function Bars({ data, label, color }: { data: Array<{ x: string; y: number }>; label: string; color: string }) {
  const max = Math.max(1, ...data.map((d) => d.y));
  const w = 320, h = 140, pad = 24, bw = (w - pad * 2) / data.length;
  return (
    <figure className="card" style={{ margin: 0 }}>
      <figcaption><b>{label}</b></figcaption>
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label} style={{ width: "100%", height: "auto" }}>
        <line x1={pad} y1={h - 22} x2={w - pad} y2={h - 22} stroke="var(--line)" />
        {data.map((d, i) => {
          const bh = ((h - 50) * d.y) / max;
          const x = pad + i * bw + bw * 0.15;
          return (
            <g key={d.x}>
              <rect x={x} y={h - 22 - bh} width={bw * 0.7} height={Math.max(bh, d.y ? 2 : 0)} rx={4} fill={color} />
              <text x={x + bw * 0.35} y={h - 22 - bh - 4} textAnchor="middle" fontSize="10" fill="var(--ink)">{d.y}</text>
              <text x={x + bw * 0.35} y={h - 8} textAnchor="middle" fontSize="9" fill="var(--muted)">{d.x.slice(5)}</text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

function Trend() {
  const { data, error } = useFetch<{ months: MonthRow[] }>("/api/stats/overview?months=6");
  if (error) return <div className="error-box">{error}</div>;
  if (!data) return <p className="muted">جارٍ التحميل…</p>;
  const m = data.months;
  const rate = (r: MonthRow) => { const t = r.present + r.absent + r.excused; return t ? Math.round(((r.present + r.excused) / t) * 100) : 0; };
  return (
    <>
      <Bars label="الصفحات المنجزة شهرياً" color="var(--green-2)" data={m.map((r) => ({ x: r.month, y: r.pages }))} />
      <Bars label="نسبة الحضور % (مع الأعذار)" color="var(--gold)" data={m.map((r) => ({ x: r.month, y: rate(r) }))} />
      <div className="card" style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", fontSize: ".88rem" }}>
          <thead><tr><th style={{ textAlign: "start" }}>الشهر</th><th>حضور</th><th>غياب</th><th>بعذر</th><th>سرود</th><th>اختبارات</th><th>ناجحة</th></tr></thead>
          <tbody>{m.map((r) => <tr key={r.month} style={{ textAlign: "center" }}><td style={{ textAlign: "start" }}>{r.month}</td><td>{r.present}</td><td>{r.absent}</td><td>{r.excused}</td><td>{r.sard}</td><td>{r.tests}</td><td>{r.testsPassed}</td></tr>)}</tbody>
        </table>
      </div>
    </>
  );
}

/* ---------------- تقارير الطلاب ---------------- */
function StudentsReport() {
  const { settings } = useMe();
  const { data, error } = useFetch<{ students: StudentRow[] }>("/api/stats/students");
  const [q, setQ] = useState("");
  const [gender, setGender] = useState("");
  const [circle, setCircle] = useState("");
  const [level, setLevel] = useState("");
  const [minParts, setMinParts] = useState(0);
  const [maxAge, setMaxAge] = useState(99);
  const [sort, setSort] = useState<"name" | "age" | "parts" | "pages">("name");
  const levelLabel = (k: string | null) => settings.levels.find((l) => l.key === k)?.label ?? "—";

  const rows = useMemo(() => {
    const list = (data?.students ?? []).filter((s) => (!q || s.name.includes(q) || s.nationalId.includes(q)) && (!gender || s.gender === gender) && (!circle || s.circleId === circle) && (!level || s.levelKey === level) && s.memorizedParts >= minParts && ageOf(s.birth) <= maxAge);
    return list.sort((a, b) => sort === "age" ? ageOf(a.birth) - ageOf(b.birth) : sort === "parts" ? b.memorizedParts - a.memorizedParts : sort === "pages" ? b.pages - a.pages : a.name.localeCompare(b.name, "ar"));
  }, [data, q, gender, circle, level, minParts, maxAge, sort]);
  const circles = useMemo(() => [...new Map((data?.students ?? []).filter((s) => s.circleId).map((s) => [s.circleId!, s.circleName!])).entries()], [data]);

  const exportCsv = () => downloadFile("تقرير-الطلاب.csv", toCsv(["الطالب", "الهوية", "العمر", "الجنس", "الحلقة", "المرحلة", "اتجاه الحفظ", "المحفوظ (جزء)", "حضور", "غياب", "الصفحات", "الاختبارات", "الخطة الشهرية"],
    rows.map((s) => [s.name, s.nationalId, ageOf(s.birth), GENDER_LABELS[s.gender], s.circleName ?? "—", levelLabel(s.levelKey), DIRECTION_LABELS[s.direction], s.memorizedParts, s.present, s.absent, s.pages, s.tests, s.monthlyPlanPages])), "text/csv");

  if (error) return <div className="error-box">{error}</div>;
  return (
    <>
      <div className="card form-grid no-print">
        <input className="input" placeholder="بحث بالاسم أو الهوية" value={q} onChange={(e) => setQ(e.target.value)} aria-label="بحث" />
        <div className="form-grid two">
          <select className="input" value={gender} onChange={(e) => setGender(e.target.value)} aria-label="الجنس"><option value="">كل الأجناس</option><option value="male">{GENDER_LABELS.male}</option><option value="female">{GENDER_LABELS.female}</option></select>
          <select className="input" value={circle} onChange={(e) => setCircle(e.target.value)} aria-label="الحلقة"><option value="">كل الحلقات</option>{circles.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
          <select className="input" value={level} onChange={(e) => setLevel(e.target.value)} aria-label="المرحلة"><option value="">كل المستويات</option>{settings.levels.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}</select>
          <select className="input" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="الترتيب"><option value="name">ترتيب بالاسم</option><option value="age">ترتيب بالعمر</option><option value="parts">ترتيب بالحفظ</option><option value="pages">ترتيب بالصفحات</option></select>
          <label className="field"><span>حفظ لا يقل عن (أجزاء)</span><input type="number" min={0} max={30} value={minParts} onChange={(e) => setMinParts(Number(e.target.value) || 0)} /></label>
          <label className="field"><span>العمر حتى</span><input type="number" min={3} max={99} value={maxAge} onChange={(e) => setMaxAge(Number(e.target.value) || 99)} /></label>
        </div>
        <div className="actions"><button className="btn small" type="button" onClick={exportCsv}>تصدير Excel / CSV</button><button className="btn ghost small" type="button" onClick={() => window.print()}>طباعة / PDF</button></div>
      </div>
      <p className="muted" style={{ margin: 0 }}>{countAr(rows.length, STUDENTS_AR)}</p>
      <div className="card" style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", fontSize: ".86rem", minWidth: 560 }}>
          <thead><tr style={{ textAlign: "start" }}><th style={{ textAlign: "start" }}>الطالب</th><th>العمر</th><th>الحلقة / المرحلة</th><th>المحفوظ</th><th>حضور</th><th>غياب</th><th>صفحات</th><th>اختبارات</th></tr></thead>
          <tbody>{rows.map((s) => <tr key={s.id} style={{ textAlign: "center" }}><td style={{ textAlign: "start" }}><b>{s.name}</b><br /><small className="muted">{s.nationalId} · {CATEGORY_LABELS[s.gender]}</small></td><td>{ageOf(s.birth)}</td><td>{s.circleName ?? "—"}<br /><small className="muted">{levelLabel(s.levelKey)}</small></td><td>{s.memorizedParts}</td><td>{s.present}</td><td>{s.absent}</td><td>{s.pages}</td><td>{s.tests}</td></tr>)}</tbody>
        </table>
      </div>
    </>
  );
}

/* ---------------- تقارير المعلّمين ---------------- */
function TeachersReport() {
  const { data, error } = useFetch<{ teachers: TeacherRow[] }>("/api/stats/teachers");
  const [q, setQ] = useState("");
  const rows = (data?.teachers ?? []).filter((t) => !q || t.name.includes(q) || (t.nationalId ?? "").includes(q));
  const exportCsv = () => downloadFile("تقرير-المعلمين.csv", toCsv(["المعلّم", "الهوية", "العمر", "الجنس", "المؤهل", "دورة الأحكام", "الحفظ", "الحلقة", "عدد الطلاب", "الحالة"],
    rows.map((t) => [t.name, t.nationalId, ageOf(t.birth), t.gender ? GENDER_LABELS[t.gender] : "", t.qualification, t.ajkamCourse, t.memorizedParts, t.circleName ?? "—", t.studentCount ?? 0, t.active ? "فعال" : "موقوف"])), "text/csv");
  if (error) return <div className="error-box">{error}</div>;
  return (
    <>
      <div className="card form-grid no-print">
        <input className="input" placeholder="بحث بالاسم أو الهوية" value={q} onChange={(e) => setQ(e.target.value)} aria-label="بحث" />
        <div className="actions"><button className="btn small" type="button" onClick={exportCsv}>تصدير Excel / CSV</button><button className="btn ghost small" type="button" onClick={() => window.print()}>طباعة / PDF</button></div>
      </div>
      <div className="card" style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", fontSize: ".86rem", minWidth: 520 }}>
          <thead><tr><th style={{ textAlign: "start" }}>المعلّم</th><th>العمر</th><th>المؤهل</th><th>الحفظ</th><th>الحلقة</th><th>الطلاب</th><th>الحالة</th></tr></thead>
          <tbody>{rows.map((t) => <tr key={t.id} style={{ textAlign: "center" }}><td style={{ textAlign: "start" }}><b>{t.name}</b><br /><small className="muted">{t.nationalId}</small></td><td>{ageOf(t.birth)}</td><td>{t.qualification}</td><td>{t.memorizedParts}</td><td>{t.circleName ?? "—"}</td><td>{t.studentCount ?? 0}</td><td>{t.active ? "فعال" : "موقوف"}</td></tr>)}</tbody>
        </table>
      </div>
    </>
  );
}
