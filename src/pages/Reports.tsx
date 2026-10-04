import { useState } from "react";
import type { Direction } from "@shared/constants";
import { countPages, isValidRange, planPercent, type Position } from "@shared/quran";
import { PositionPicker } from "../components/PositionPicker";
import { Sheet, useAction, useUi } from "../components/ui";
import { api } from "../lib/api";
import { fmtPosPage, monthIso } from "../lib/format";
import { useFetch, useUrlState } from "../lib/hooks";
import { downloadXlsx } from "../lib/xlsx-write";
import { useMe } from "../lib/session";
import type { Circle } from "../lib/types";

interface Row {
  studentId: string; name: string; direction: Direction; planPages: number; present: number; late: number; absent: number; excused: number;
  verses: number; pages: number; start: Position | null; end: Position | null; percent: number; saved: boolean;
  reviewPages: number; reviewPlanPages: number; reviewPercent: number; reviewDays: number; pending?: boolean;
}
interface Report { month: string; circleId: string | null; circleName: string | null; locked: boolean; message: string; openDay: number; rows: Row[] }

/** الكشف الشهري: يُولَّد تلقائياً من التسميع اليومي، ويعدَّل نهاية الحفظ يدوياً ثم يُحفظ. */
export function Reports() {
  const { user } = useMe();
  const [month, setMonth] = useUrlState("month", monthIso());
  // /api/circles محصورة بالدور، فالمعلّم يستقبل حلقاته ومنها يختار (§15.5)
  const circles = useFetch<{ circles: Circle[] }>("/api/circles");
  const [circleId, setCircleId] = useUrlState("circle");
  const active = circles.data?.circles.filter((c) => c.active) ?? [];
  const mine = active.find((c) => c.primaryTeacherId === user.id || c.assistantTeacherId === user.id);
  const effective = circleId || mine?.id || active[0]?.id || "";
  const path = effective ? `/api/reports?month=${month}&circleId=${effective}` : null;
  const report = useFetch<Report>(path);
  const [edits, setEdits] = useState<Record<string, Position>>({});
  const [editing, setEditing] = useState<Row | null>(null);
  const { busy, run } = useAction();
  const { toast } = useUi();
  const canSave = user.role !== "exam_committee";
  const data = report.data;

  const view = (r: Row) => {
    const end = edits[r.studentId] ?? r.end;
    const pages = edits[r.studentId] && r.start ? countPages(r.direction, r.start, edits[r.studentId]) : r.pages;
    return { end, pages, percent: planPercent(pages, r.planPages) };
  };

  const save = async () => {
    if (!data) return;
    const rows = data.rows.filter((r) => (edits[r.studentId] ?? r.end) || r.reviewDays > 0)
      .map((r) => ({ studentId: r.studentId, end: edits[r.studentId] ?? r.end }));
    if (!rows.length) return toast("لا توجد بيانات للحفظ في هذا الشهر", "err");
    if (await run(() => api("/api/reports/save", { method: "POST", body: { month, rows } }), "تم حفظ الكشف الشهري")) { setEdits({}); void report.reload(); }
  };

  const exportExcel = () => {
    if (!data) return;
    downloadXlsx(`الكشف-الشهري-${month}`, ["الطالب", "الحضور", "التأخر", "الغياب", "بعذر", "بداية الحفظ", "نهاية الحفظ", "صفحات الحفظ", "خطة الحفظ", "إنجاز الحفظ %", "أيام المراجعة", "صفحات المراجعة", "خطة المراجعة", "إنجاز المراجعة %"],
      data.rows.map((r) => {
        const v = view(r);
        return [r.name, r.present, r.late, r.absent, r.excused, r.start && v.pages ? fmtPosPage(r.start) : "", v.end && v.pages ? fmtPosPage(v.end) : "", v.pages, r.planPages, v.percent, r.reviewDays, r.reviewPages, r.reviewPlanPages, r.reviewPercent];
      }), "الكشف الشهري");
  };

  return (
    <main className="page">
      <div className="page-head"><div><h1>الكشف الشهري</h1><p>{data?.circleName ?? ""}</p></div></div>
      <div className="search-row">
        <input className="input" type="month" value={month} onChange={(e) => { setMonth(e.target.value || monthIso()); setEdits({}); }} aria-label="الشهر" />
        {active.length > 1 && (
          <select className="input" value={effective} onChange={(e) => { setCircleId(e.target.value); setEdits({}); }} aria-label="الحلقة">
            {active.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
      </div>
      {report.error && <div className="error-box">{report.error}</div>}
      {data?.locked && <div className="card" style={{ background: "var(--gold-soft)" }}>{data.message}</div>}
      {data && !data.locked && data.rows.length > 0 && <div className="actions"><button className="btn ghost small" type="button" onClick={exportExcel}>تصدير الكشف Excel</button></div>}
      <div className="list">
        {data?.rows.map((r) => {
          const v = view(r);
          return (
            <div key={r.studentId} className="card">
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <b style={{ flex: 1 }}>{r.name}</b>
                {r.saved && !r.pending && !edits[r.studentId] && <span className="chip">محفوظ</span>}
                {edits[r.studentId] && <span className="chip gold">معدَّل</span>}
                {r.pending && <span className="chip gold">بانتظار المزامنة</span>}
              </div>
              <div className="muted" style={{ fontSize: ".9rem" }}>
                {r.start && v.end && v.pages > 0 ? `الحفظ: ${fmtPosPage(r.start)} ← ${fmtPosPage(v.end)}` : "لا حفظ جديد مسجَّل هذا الشهر"}
              </div>
              <div className="muted" style={{ fontSize: ".85rem" }}>حضور {r.present} · تأخر {r.late} · غياب {r.absent} · بعذر {r.excused} · {r.verses} آية</div>
              <div style={{ marginTop: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: ".88rem" }}><span>الحفظ: {v.pages} من {r.planPages} صفحة</span><b>{v.percent}%</b></div>
                <div style={{ height: 8, borderRadius: 4, background: "var(--line)", overflow: "hidden" }}><div style={{ height: "100%", width: `${Math.min(100, v.percent)}%`, background: v.percent >= 100 ? "var(--ok)" : "var(--green-2)" }} /></div>
              </div>
              <div style={{ marginTop: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: ".88rem" }}><span>المراجعة: {r.reviewPages} من {r.reviewPlanPages} صفحة · {r.reviewDays} يوم</span><b>{r.reviewPercent}%</b></div>
                <div className="progress"><i style={{ width: `${Math.min(100, r.reviewPercent)}%` }} /></div>
              </div>
              {canSave && r.start && <button className="btn ghost small" type="button" style={{ marginTop: 8 }} onClick={() => setEditing(r)}>تعديل نهاية الحفظ</button>}
            </div>
          );
        })}
        {data && !data.locked && !data.rows.length && <div className="empty">لا يوجد طلاب في هذه الحلقة.</div>}
      </div>
      {canSave && data && !data.locked && data.rows.length > 0 && <button className="btn" type="button" disabled={busy} onClick={() => void save()}>حفظ الكشف الشهري</button>}
      {editing && <EditEnd row={editing} current={edits[editing.studentId] ?? editing.end!} onClose={() => setEditing(null)} onApply={(p) => { setEdits((e) => ({ ...e, [editing.studentId]: p })); setEditing(null); }} />}
    </main>
  );
}

function EditEnd({ row, current, onClose, onApply }: { row: Row; current: Position; onClose: () => void; onApply: (p: Position) => void }) {
  const [end, setEnd] = useState<Position>(current);
  const valid = row.start ? isValidRange(row.direction, row.start, end) : false;
  return (
    <Sheet title={`نهاية حفظ ${row.name}`} onClose={onClose}>
      <p className="muted" style={{ margin: 0 }}>البداية: {fmtPosPage(row.start)} — النهاية لا تسبق البداية وفق اتجاه الطالب.</p>
      <PositionPicker label="النهاية" value={end} onChange={setEnd} />
      {!valid && <div className="error-box">النهاية تسبق البداية.</div>}
      {valid && row.start && <div className="card" style={{ background: "var(--green-soft)" }}><b>{countPages(row.direction, row.start, end)} صفحة</b></div>}
      <button className="btn" type="button" disabled={!valid} onClick={() => onApply(end)}>تطبيق</button>
    </Sheet>
  );
}
