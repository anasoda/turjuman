import { useState } from "react";
import { useAction, useUi } from "../components/ui";
import { api } from "../lib/api";
import { initials, useDebounced, useFetch } from "../lib/hooks";
import type { Student } from "../lib/types";
import { countAr, STUDENTS_AR } from "../lib/format";

/** أرشيف الطلاب: كل من «حُذف» يُنقل هنا مع السبب ويمكن استرجاعه. */
export function Archive() {
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useFetch<{ students: Student[]; total: number }>(`/api/students?archived=1&pageSize=30&page=${page}${dq ? `&q=${encodeURIComponent(dq)}` : ""}`);
  const { run } = useAction();
  const { confirm } = useUi();
  const list = data?.students ?? [];

  const restore = async (s: Student) => {
    if (!(await confirm({ title: `استرجاع ${s.name}؟`, message: "يعود الطالب إلى حلقته ويُفعَّل حسابه.", confirmLabel: "استرجاع" }))) return;
    if (await run(() => api(`/api/students/${s.id}/restore`, { method: "POST", body: {} }), "تم الاسترجاع")) void reload();
  };

  return (
    <main className="page">
      <div className="page-head"><div><h1>أرشيف الطلاب</h1><p>{countAr(data?.total ?? 0, STUDENTS_AR)} في الأرشيف</p></div></div>
      <input className="input" placeholder="ابحث في الأرشيف" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label="بحث" />
      {error && <div className="error-box">{error}</div>}
      <div className="list">
        {list.map((s) => (
          <div key={s.id} className="card row-card" style={{ cursor: "default" }}>
            <span className="avatar">{initials(s.name)}</span>
            <span className="grow">
              <b>{s.name}</b>
              <small>{s.circleName ?? "بلا حلقة"} · السبب: {s.archiveReason || "—"}</small>
              <small>{s.archivedAt ? new Date(s.archivedAt).toLocaleDateString("ar-EG-u-nu-latn") : ""}</small>
            </span>
            <button className="btn ghost small" type="button" onClick={() => void restore(s)}>استرجاع</button>
          </div>
        ))}
        {!loading && !list.length && <div className="empty">الأرشيف فارغ.</div>}
      </div>
      {(data?.total ?? 0) > 30 && <div className="actions">
        <button className="btn ghost" type="button" disabled={loading || page <= 1} onClick={() => setPage(page - 1)}>السابق</button>
        <span className="muted">صفحة {page}</span>
        <button className="btn ghost" type="button" disabled={loading || page * 30 >= (data?.total ?? 0)} onClick={() => setPage(page + 1)}>التالي</button>
      </div>}
    </main>
  );
}
