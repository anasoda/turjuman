import { useNavigate } from "react-router-dom";
import { useAction } from "../components/ui";
import { api } from "../lib/api";
import { useFetch } from "../lib/hooks";
import type { AppNotification } from "../lib/types";

export const NOTIFICATIONS_EVENT = "tq-notifications";

const KIND_LABELS: Record<string, string> = {
  announcement: "إعلان", absence: "غياب", absence_notice: "إبلاغ غياب", test_approved: "اختبار", test_result: "نتيجة اختبار", report: "كشف شهري"
};

/** مركز الإشعارات: الغياب، إعلانات الإدارة، الاختبارات، الكشف الشهري. */
export function Notifications() {
  const { data, error, reload } = useFetch<{ items: AppNotification[]; unread: number }>("/api/notifications");
  const { run } = useAction();
  const nav = useNavigate();
  const changed = () => window.dispatchEvent(new Event(NOTIFICATIONS_EVENT));
  const markAll = async () => {
    if (await run(() => api("/api/notifications/read", { method: "POST", body: { all: true } }))) { await reload(); changed(); }
  };
  const open = async (n: AppNotification) => {
    if (!n.readAt) { await api("/api/notifications/read", { method: "POST", body: { ids: [n.id] } }).catch(() => undefined); changed(); void reload(); }
    if (n.link) nav(n.link);
  };
  return (
    <main className="page">
      <div className="page-head">
        <div><h1>الإشعارات</h1><p>{data?.unread ? `${data.unread} غير مقروء` : "لا جديد"}</p></div>
        {!!data?.unread && <button className="btn ghost small" type="button" onClick={() => void markAll()}>تعليم الكل كمقروء</button>}
      </div>
      {error && <div className="error-box">{error}</div>}
      <div className="list">
        {data?.items.map((n) => (
          <button key={n.id} type="button" className="card row-card" onClick={() => void open(n)} style={n.readAt ? { opacity: 0.75 } : { borderColor: "var(--green)" }}>
            <span className="grow">
              <b>{n.title}</b>
              {n.body && <small style={{ whiteSpace: "pre-wrap" }}>{n.body}</small>}
              <small>{new Date(n.createdAt).toLocaleString("ar-EG-u-nu-latn", { dateStyle: "medium", timeStyle: "short" })}</small>
            </span>
            <span className={`chip ${n.readAt ? "gold" : ""}`}>{KIND_LABELS[n.kind] ?? "إشعار"}</span>
          </button>
        ))}
        {data && !data.items.length && <div className="empty">لا توجد إشعارات.</div>}
      </div>
    </main>
  );
}
