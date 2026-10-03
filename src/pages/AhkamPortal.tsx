import { ATTENDANCE_LABELS, fmtDay } from "../lib/format";
import { useFetch } from "../lib/hooks";

type Status = keyof typeof ATTENDANCE_LABELS;
interface PortalCourse {
  id: string;
  name: string;
  status: "active" | "ended";
  teacherName: string | null;
  latest: { heldOn: string; coveredTopic: string; nextTopic: string; homework: string } | null;
  events: Array<{ id: string; kind: "homework" | "exam" | "other"; title: string; dueOn: string | null }>;
  attendance: Array<{ heldOn: string; status: Status }>;
  attendancePct: number | null;
  notes: Array<{ id: string; note: string; createdAt: number; authorName: string | null }>;
}
const KIND_LABELS = { homework: "واجب", exam: "اختبار", other: "إعلان" } as const;

/** دورات الأحكام لابن ولي الأمر: موضع اللقاء القادم والواجبات والحضور والملاحظات (للاطلاع فقط). */
export function AhkamCards({ studentId }: { studentId: string }) {
  const { data } = useFetch<{ courses: PortalCourse[] }>(`/api/courses/portal/${studentId}`);
  if (!data?.courses.length) return null;
  return (
    <>
      <h2 className="section-title">دورات الأحكام</h2>
      {data.courses.map((c) => (
        <section key={c.id} className="card">
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <h3 style={{ margin: 0, flex: 1 }}>{c.name}</h3>
            <span className={`chip ${c.status === "ended" ? "gold" : ""}`}>{c.status === "active" ? "جارية" : "منتهية"}</span>
          </div>
          <p className="muted" style={{ margin: "4px 0 8px" }}>{c.teacherName ? `الشيخ: ${c.teacherName}` : ""}{c.attendancePct !== null ? ` · الحضور ${c.attendancePct}٪` : ""}</p>
          <dl className="kv">
            <dt>اللقاء القادم</dt><dd>{c.latest?.nextTopic || "لم يُحدَّد بعد"}</dd>
            {c.latest?.homework && <><dt>الواجب</dt><dd>{c.latest.homework}</dd></>}
            {c.latest?.coveredTopic && <><dt>آخر درس</dt><dd>{c.latest.coveredTopic} ({fmtDay(c.latest.heldOn)})</dd></>}
          </dl>
          {c.events.length > 0 && (
            <ul style={{ margin: "10px 0 0", paddingInlineStart: 18 }}>
              {c.events.map((e) => <li key={e.id}><b>{KIND_LABELS[e.kind]}:</b> {e.title}{e.dueOn ? ` — ${fmtDay(e.dueOn)}` : ""}</li>)}
            </ul>
          )}
          {c.attendance.length > 0 && (
            <p className="muted" style={{ margin: "10px 0 0", fontSize: ".88rem" }}>
              آخر الحضور: {c.attendance.slice(0, 5).map((a) => `${fmtDay(a.heldOn)} ${ATTENDANCE_LABELS[a.status]}`).join(" · ")}
            </p>
          )}
          {c.notes.length > 0 && (
            <>
              <h4 style={{ margin: "12px 0 4px" }}>ملاحظات الشيخ</h4>
              <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                {c.notes.map((n) => <li key={n.id}>{n.note} <small className="muted">({new Date(n.createdAt).toLocaleDateString("ar-EG-u-nu-latn")})</small></li>)}
              </ul>
            </>
          )}
        </section>
      ))}
    </>
  );
}
