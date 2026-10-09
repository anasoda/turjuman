import { Link } from "react-router-dom";
import { needsReminder, type CircleDayStatus } from "@shared/circle-day";
import { useAction, useUi } from "../components/ui";
import { api } from "../lib/api";
import { fmtDay, todayIso } from "../lib/format";
import { useFetch, useUrlState } from "../lib/hooks";

interface CircleRow {
  id: string; name: string; status: CircleDayStatus; students: number; cancelReason: string | null; noSchedule: boolean;
  teachers: Array<{ id: string; name: string; kind: "primary" | "assistant" }>;
  recorded: number; present: number; late: number; absent: number; excused: number; notMemorized: number;
  hifzStudents: number; hifzPages: number; reviewStudents: number; reviewPages: number; remindedAt: number | null;
}
interface DayData {
  date: string; weekday: string; isToday: boolean; circles: CircleRow[];
  totals: { circles: number; pending: number; complete: number; students: number; recorded: number; present: number; late: number; absent: number; excused: number; notMemorized: number;
    hifzStudents: number; hifzPages: number; reviewStudents: number; reviewPages: number };
}

const STATUS: Record<CircleDayStatus, { label: string; chip: string }> = {
  none: { label: "لم يُسجَّل شيء", chip: "chip off" },
  partial: { label: "تسجيل جزئي", chip: "chip gold" },
  complete: { label: "مكتمل", chip: "chip" },
  empty: { label: "بلا طلاب", chip: "chip gold" },
  off: { label: "لا حصة اليوم", chip: "chip gold" },
  cancelled: { label: "حصة ملغاة", chip: "chip gold" }
};
const clock = new Intl.DateTimeFormat("ar-EG-u-nu-latn", { hour: "2-digit", minute: "2-digit" });

function Stat({ value, label, tone = "" }: { value: number | string; label: string; tone?: "" | "bad" }) {
  return (
    <div className="card" style={{ textAlign: "center", padding: "10px 6px" }}>
      <b style={{ fontSize: "1.35rem", color: tone === "bad" ? "var(--danger)" : undefined }}>{value}</b>
      <div className="muted" style={{ fontSize: ".78rem" }}>{label}</div>
    </div>
  );
}

/** متابعة سير الحلقات في يوم: لمن سُجّلت متابعته وكم صفحة، وتنبيه المحفّظ الذي تخلّف عن التسجيل. */
export function CircleDay() {
  const [date, setDate] = useUrlState("date", todayIso());
  const day = useFetch<DayData>(`/api/circle-day?date=${date}`);
  const { busy, run } = useAction();
  const { confirm } = useUi();
  const data = day.data;
  const t = data?.totals;
  const canRemind = date <= todayIso();

  const remind = async (circle: CircleRow) => {
    const names = circle.teachers.map((x) => x.name).join("، ");
    const ok = await confirm({
      title: `تنبيه معلّم ${circle.name}؟`,
      message: `سيصل إشعار إلى ${names || "معلّمي الحلقة"} لاستكمال تسجيل متابعة ${fmtDay(date)} (سُجّل ${circle.recorded} من ${circle.students}).`,
      confirmLabel: "إرسال التنبيه"
    });
    if (ok && await run(() => api("/api/circle-day/remind", { method: "POST", body: { circleId: circle.id, date } }), "أُرسل التنبيه")) void day.reload();
  };

  return (
    <main className="page">
      <div className="page-head"><div><h1>متابعة الحلقات</h1><p>{fmtDay(date)}</p></div></div>
      <div className="search-row">
        <input className="input" type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value || todayIso())} aria-label="التاريخ" />
        {date !== todayIso() && <button className="btn ghost small" type="button" onClick={() => setDate(todayIso())}>اليوم</button>}
      </div>
      {day.error && <div className="error-box">{day.error}</div>}
      {day.loading && !data && <p className="muted">جارٍ التحميل…</p>}

      {t && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(104px, 1fr))", gap: 8 }}>
            <Stat value={`${t.complete}/${t.circles}`} label="حلقات مكتملة" />
            <Stat value={t.pending} label="حلقات تحتاج متابعة" tone={t.pending ? "bad" : ""} />
            <Stat value={`${t.hifzStudents}/${t.students}`} label="طلاب سُجّل حفظهم" />
            <Stat value={t.hifzPages} label="صفحات الحفظ" />
            <Stat value={t.present + t.late} label="حضور" />
            <Stat value={t.absent} label="غياب" tone={t.absent ? "bad" : ""} />
            <Stat value={t.excused} label="بعذر" />
            <Stat value={t.notMemorized} label="مش حافظ" tone={t.notMemorized ? "bad" : ""} />
            <Stat value={t.reviewPages} label="صفحات المراجعة" />
          </div>

          <div className="list">
            {data.circles.map((c) => {
              const pct = c.students ? Math.min(100, Math.round((c.recorded / c.students) * 100)) : 0;
              const st = STATUS[c.status];
              return (
                <div className="card" key={c.id} style={{ display: "grid", gap: 6 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <b style={{ flex: 1 }}>{c.name}</b>
                    <span className={st.chip}>{st.label}</span>
                  </div>
                  <small className="muted">
                    {c.teachers.length ? `المحفّظ: ${c.teachers.map((x) => x.name).join("، ")}` : "بلا معلّم فعّال"}
                    {c.cancelReason ? ` · السبب: ${c.cancelReason}` : ""}
                    {c.noSchedule ? " · لم يُضبط جدول للحلقة" : ""}
                  </small>
                  {c.status !== "cancelled" && c.status !== "off" && c.status !== "empty" && (
                    <>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: ".88rem" }}>
                        <span>سُجّل {c.recorded} من {c.students} طالب</span><b>{pct}%</b>
                      </div>
                      <div className="progress"><i style={{ width: `${pct}%` }} /></div>
                      <div className="muted" style={{ fontSize: ".85rem" }}>
                        حضور {c.present} · تأخر {c.late} · غياب {c.absent} · بعذر {c.excused}{c.notMemorized > 0 && <> · مش حافظ {c.notMemorized}</>}
                      </div>
                      <div style={{ fontSize: ".88rem" }}>
                        الحفظ: <b>{c.hifzStudents}</b> طالب · <b>{c.hifzPages}</b> صفحة
                        {c.reviewStudents > 0 && <span className="muted"> · مراجعة {c.reviewStudents} طالب ({c.reviewPages} صفحة)</span>}
                      </div>
                    </>
                  )}
                  <div className="actions" style={{ alignItems: "center" }}>
                    <Link className="btn ghost small" to={`/app/daily?circle=${c.id}&date=${date}`}>فتح التسميع</Link>
                    {needsReminder(c.status) && canRemind && c.teachers.length > 0 && (
                      <button className="btn small" type="button" disabled={busy} onClick={() => void remind(c)}>تنبيه المحفّظ</button>
                    )}
                    {c.remindedAt && <span className="chip gold">أُرسل تنبيه {clock.format(new Date(c.remindedAt))}</span>}
                  </div>
                </div>
              );
            })}
          </div>
          {!data.circles.length && <div className="empty">لا توجد حلقات فعّالة ضمن نطاقك.</div>}
        </>
      )}
    </main>
  );
}
