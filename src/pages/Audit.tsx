import { useDebounced, useFetch, useUrlState } from "../lib/hooks";

interface Entry { id: number; action: string; entity: string; entityId: string; details: string; createdAt: number; userName: string | null }

const ACTIONS: Record<string, string> = {
  create: "إنشاء", update: "تعديل", delete: "حذف", archive: "أرشفة", restore: "استرجاع", move: "نقل",
  reset_password: "تعيين كلمة مرور", change_password: "تغيير كلمة مرور", provision: "إنشاء مركز"
};
const ENTITIES: Record<string, string> = { student: "طالب", staff: "كادر", circle: "حلقة", settings: "الإعدادات", center: "هوية المركز", user: "حساب", ...{} };

/** سجل التعديلات: من عدّل ماذا ومتى، مع بحث. */
export function AuditLog() {
  const [q, setQ] = useUrlState("q");
  const dq = useDebounced(q);
  const { data, error, loading } = useFetch<{ entries: Entry[] }>(`/api/audit?q=${encodeURIComponent(dq)}`);
  return (
    <main className="page">
      <div className="page-head"><div><h1>سجل التعديلات</h1><p>آخر 50 عملية</p></div></div>
      <input className="input" placeholder="ابحث بالاسم أو نوع العملية أو التفاصيل" value={q} onChange={(e) => setQ(e.target.value)} aria-label="بحث" />
      {error && <div className="error-box">{error}</div>}
      <div className="list">
        {data?.entries.map((e) => (
          <div className="card" key={e.id}>
            <b>{ACTIONS[e.action] ?? e.action} — {ENTITIES[e.entity] ?? e.entity}</b>
            <div className="muted" style={{ fontSize: ".88rem" }}>
              {e.userName ?? "النظام"} · {new Date(e.createdAt).toLocaleString("ar-EG-u-nu-latn", { dateStyle: "medium", timeStyle: "short" })}
            </div>
            {e.details && <div style={{ fontSize: ".9rem" }}>{e.details}</div>}
          </div>
        ))}
        {!loading && !data?.entries.length && <div className="empty">لا توجد عمليات مطابقة.</div>}
      </div>
    </main>
  );
}
