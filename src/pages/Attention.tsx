import { Link } from "react-router-dom";
import { useFetch } from "../lib/hooks";
import { useMe } from "../lib/session";

type Reason =
  | { kind: "absence"; count: number }
  | { kind: "noRecite"; days: number; never: boolean }
  | { kind: "planLag"; lagPct: number; expectedPages: number; pages: number; planPages: number };
interface Row { id: string; name: string; circleName: string; lastReciteDate: string | null; reasons: Reason[] }
export interface FollowUpData {
  month: string;
  thresholds: { absenceCount: number; noReciteDays: number; planLagPct: number };
  total: number;
  students: Row[];
}

function reasonText(r: Reason): string {
  if (r.kind === "absence") return `غاب ${r.count} ${r.count === 1 ? "مرة" : "مرات"} هذا الشهر`;
  if (r.kind === "noRecite") return r.never ? `لم يسمّع منذ التحاقه (${r.days} يوماً)` : `لم يسمّع منذ ${r.days} يوماً`;
  return `متأخر ${r.lagPct}% عن الخطة: أنجز ${r.pages} من ${r.expectedPages} صفحة متوقعة`;
}

/** بطاقة الرئيسية: عدد الطلاب الذين يحتاجون متابعة ضمن نطاق المستخدم، ورابط القائمة. */
export function AttentionCard() {
  const { data } = useFetch<FollowUpData>("/api/stats/follow-up");
  if (!data) return null;
  const n = data.students.length;
  return (
    <Link className="card row-card" to="/app/attention">
      <span className={`chip${n ? " off" : ""}`}>{n}</span>
      <span className="grow"><b>طلاب يحتاجون متابعة</b><small>{n ? "غياب متكرر أو تأخر عن الخطة أو انقطاع عن التسميع" : "لا أحد يحتاج متابعة الآن"}</small></span>
      <span className="chev" aria-hidden="true">‹</span>
    </Link>
  );
}

/** «طلاب يحتاجون متابعة» (§14.7): الأسباب والحدود من إعدادات المدير، والنطاق بحسب الدور. */
export function Attention() {
  const { user } = useMe();
  const { data, error, loading } = useFetch<FollowUpData>("/api/stats/follow-up");
  const th = data?.thresholds;
  return (
    <main className="page">
      <div className="page-head"><div><h1>طلاب يحتاجون متابعة</h1><p>حسب الحدود المضبوطة في الإعدادات</p></div></div>
      {error && <div className="error-box">{error}</div>}
      {th && (
        <p className="muted" style={{ margin: 0 }}>
          يظهر الطالب عند: {th.absenceCount} غيابات في الشهر، أو {th.noReciteDays} أيام بلا تسميع، أو تأخر {th.planLagPct}% عن الخطة الشهرية.
          {user.role === "admin" && <> <Link to="/app/settings">تعديل الحدود</Link></>}
        </p>
      )}
      {loading && <p className="muted">جارٍ التحميل…</p>}
      <div className="list">
        {data?.students.map((s) => (
          <div className="card row-card" style={{ cursor: "default", alignItems: "flex-start" }} key={s.id}>
            <span className="grow">
              <b>{s.name}</b>
              <small>{s.circleName}</small>
              <span style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                {s.reasons.map((r) => <span className="chip off" key={r.kind}>{reasonText(r)}</span>)}
              </span>
            </span>
          </div>
        ))}
      </div>
      {data && !data.students.length && <div className="empty">لا يوجد طالب يحتاج متابعة ضمن {data.total} طالباً في نطاقك.</div>}
    </main>
  );
}
