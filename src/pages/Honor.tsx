import { useState } from "react";
import { monthIso } from "../lib/format";
import { useFetch } from "../lib/hooks";

interface HonorData { month: string; top: Array<{ name: string; circleName: string | null; pages: number; planPages: number; percent: number }>; huffaz: Array<{ name: string; circleName: string | null }> }

/** لوحة الشرف: المتفوّقون في خطتهم الشهرية وحفّاظ القرآن — للطلاب الذين وافق أهلهم فقط. */
export function Honor() {
  const [month, setMonth] = useState(monthIso());
  const { data, error } = useFetch<HonorData>(`/api/honor?month=${month}`);
  return (
    <main className="page">
      <div className="page-head"><div><h1>لوحة الشرف</h1><p>بموافقة أولياء الأمور</p></div></div>
      <input className="input" type="month" value={month} onChange={(e) => setMonth(e.target.value || monthIso())} aria-label="الشهر" />
      {error && <div className="error-box">{error}</div>}
      <section className="list">
        <h2>المتفوّقون هذا الشهر</h2>
        {data?.top.map((r, i) => (
          <div key={r.name} className="card row-card" style={{ cursor: "default" }}>
            <span className="avatar">{i + 1}</span>
            <span className="grow"><b>{r.name}</b><small>{r.circleName ?? "—"} · {r.pages} من {r.planPages} صفحة</small></span>
            <span className="chip">{r.percent}%</span>
          </div>
        ))}
        {data && !data.top.length && <div className="empty">لا يوجد متفوّقون معلنون لهذا الشهر بعد.</div>}
      </section>
      <section className="list">
        <h2>حفّاظ القرآن الكريم</h2>
        {data?.huffaz.map((r) => <div key={r.name} className="card row-card" style={{ cursor: "default" }}><span className="grow"><b>{r.name}</b><small>{r.circleName ?? "—"}</small></span><span className="chip gold">حافظ</span></div>)}
        {data && !data.huffaz.length && <div className="empty">لا يوجد حفّاظ معلنون بعد.</div>}
      </section>
    </main>
  );
}
