import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { Direction } from "@shared/constants";
import { countVerses, isValidRange, sardBand, sardScore, type Position } from "@shared/quran";
import { PositionPicker } from "../components/PositionPicker";
import { Field, Sheet, useAction, useUi } from "../components/ui";
import { api } from "../lib/api";
import { fmtPos, todayIso } from "../lib/format";
import { useDebounced, useFetch, useUrlPage, useUrlState } from "../lib/hooks";
import { useMe } from "../lib/session";
import type { Student } from "../lib/types";

interface SardRecord {
  id: string; studentId: string; studentName: string; circleName: string | null; date: string; stage: "trial" | "final";
  fromSurah: number; fromAyah: number; toSurah: number; toAyah: number; verses: number; mistakes: number; alerts: number; score: number; band: string; recordedByName: string | null;
}

/** السرد: من آية إلى آية، الدرجة والتقدير تُحسبان من أخطاء وتنبيهات الطالب وإعدادات المركز. */
export function Sard() {
  const { user } = useMe();
  const canWrite = user.role !== "exam_committee";
  const [q, setQ] = useUrlState("q");
  const dq = useDebounced(q);
  const [items, setItems] = useState<SardRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useUrlPage();
  const [adding, setAdding] = useState(false);
  const { confirm } = useUi();
  const { run } = useAction();

  const load = useCallback(async (p: number, replace: boolean) => {
    const r = await api<{ records: SardRecord[]; total: number }>(`/api/sard?page=${p}&q=${encodeURIComponent(dq)}`);
    setItems((prev) => (replace ? r.records : [...prev, ...r.records]));
    setTotal(r.total);
    setPage(p);
  }, [dq]);
  useEffect(() => { void load(1, true); }, [load]);

  const remove = async (r: SardRecord) => {
    if (!(await confirm({ title: `حذف سرد ${r.studentName}؟`, confirmLabel: "حذف", danger: true }))) return;
    if (await confirm({ title: "تأكيد الحذف", message: "هل أنت متأكد؟ لا يمكن التراجع.", confirmLabel: "حذف", danger: true }) && await run(() => api(`/api/sard/${r.id}`, { method: "DELETE" }), "حذف")) void load(1, true);
  };

  return (
    <main className="page">
      <div className="page-head"><div><h1>السرد</h1><p>{total} سجلاً</p></div></div>
      <input className="input" placeholder="ابحث بالطالب أو الحلقة" value={q} onChange={(e) => setQ(e.target.value)} aria-label="بحث" />
      <div className="list">
        {items.map((r) => (
          <div key={r.id} className="card">
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <b style={{ flex: 1 }}>{r.studentName}</b>
              <span className="chip gold">{r.stage === "trial" ? "تجريبي" : "نهائي"}</span>
              <span className="chip">{r.band} · {r.score}</span>
            </div>
            <div className="muted" style={{ fontSize: ".88rem" }}>
              {r.date} · {r.circleName ?? "—"} · {fmtPos({ surah: r.fromSurah, ayah: r.fromAyah })} ← {fmtPos({ surah: r.toSurah, ayah: r.toAyah })} ({r.verses} آية)
            </div>
            <div className="muted" style={{ fontSize: ".88rem" }}>{r.mistakes} خطأ · {r.alerts} تنبيه{r.recordedByName ? ` · ${r.recordedByName}` : ""}</div>
            {canWrite && <button className="btn ghost danger small" type="button" style={{ marginTop: 6 }} onClick={() => void remove(r)}>حذف</button>}
          </div>
        ))}
        {!items.length && <div className="empty">لا توجد سجلات سرد.</div>}
      </div>
      {items.length < total && <button className="btn ghost" type="button" onClick={() => void load(page + 1, false)}>عرض المزيد</button>}
      {canWrite && <button className="fab" type="button" aria-label="تسجيل سرد" onClick={() => setAdding(true)}>＋</button>}
      {adding && <SardForm onClose={() => setAdding(false)} onSaved={() => { setAdding(false); void load(1, true); }} />}
    </main>
  );
}

function SardForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { settings } = useMe();
  const { busy, run } = useAction();
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query);
  const students = useFetch<{ students: Student[] }>(`/api/students?pageSize=100${debounced ? `&q=${encodeURIComponent(debounced)}` : ""}`);
  const [student, setStudent] = useState<Student | null>(null);
  const dir: Direction = student?.direction ?? "descending";
  const [date, setDate] = useState(todayIso());
  const [stage, setStage] = useState<"trial" | "final">("trial");
  const [from, setFrom] = useState<Position>({ surah: 114, ayah: 1 });
  const [to, setTo] = useState<Position>({ surah: 114, ayah: 6 });
  const [mistakes, setMistakes] = useState(0);
  const [alerts, setAlerts] = useState(0);

  const valid = isValidRange(dir, from, to);
  const score = useMemo(() => sardScore(settings, mistakes, alerts), [settings, mistakes, alerts]);
  const band = sardBand(settings, score);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!student) return;
    if (await run(() => api("/api/sard", { method: "POST", body: { studentId: student.id, date, stage, from, to, mistakes, alerts } }), `تم حفظ السرد: ${band} (${score})`)) onSaved();
  };

  return (
    <Sheet title="تسجيل سرد" onClose={onClose}>
      <form className="form-grid" onSubmit={submit}>
        <Field label="الطالب">
          <input className="input" placeholder="ابحث بالاسم أو رقم الهوية" value={query} onChange={(e) => setQuery(e.target.value)} />
          <select required value={student?.id ?? ""} onChange={(e) => { const s = students.data?.students.find((x) => x.id === e.target.value) ?? null; setStudent(s); if (s) { const start: Position = s.direction === "descending" ? { surah: 114, ayah: 1 } : { surah: 1, ayah: 1 }; setFrom(start); setTo(start); } }}>
            <option value="">اختر الطالب</option>
            {student && !students.data?.students.some((s) => s.id === student.id) && <option value={student.id}>{student.name}</option>}
            {students.data?.students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <div className="form-grid two">
          <Field label="تاريخ السرد"><input type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} required /></Field>
          <Field label="المرحلة">
            <select value={stage} onChange={(e) => setStage(e.target.value as "trial" | "final")}><option value="trial">تجريبي (لدى المحفّظ)</option><option value="final">نهائي (لدى المشرف)</option></select>
          </Field>
        </div>
        <PositionPicker label="من" value={from} onChange={setFrom} />
        <PositionPicker label="إلى" value={to} onChange={setTo} />
        {!valid ? <div className="error-box">النهاية يجب ألا تسبق البداية وفق اتجاه حفظ الطالب.</div> : <p className="muted" style={{ margin: 0 }}>{countVerses(dir, from, to)} آية</p>}
        <div className="form-grid two">
          <Field label="عدد الأخطاء" hint={`خصم ${settings.sardDeductMistake} لكل خطأ`}><input type="number" min={0} value={mistakes} onChange={(e) => setMistakes(Math.max(0, Number(e.target.value) || 0))} /></Field>
          <Field label="عدد التنبيهات" hint={`خصم ${settings.sardDeductAlert} لكل تنبيه`}><input type="number" min={0} value={alerts} onChange={(e) => setAlerts(Math.max(0, Number(e.target.value) || 0))} /></Field>
        </div>
        <div className="card" style={{ background: "var(--green-soft)" }}><b>الدرجة: {score} من {settings.sardStartScore}</b> — التقدير: {band}</div>
        <button className="btn" disabled={busy || !valid || !student}>حفظ السرد</button>
      </form>
    </Sheet>
  );
}
