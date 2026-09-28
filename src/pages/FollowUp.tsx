import { useState } from "react";
import { useFetch } from "../lib/hooks";
import { StudentPortal } from "./StudentPortal";

interface StudentRow { id: string; name: string; circleName: string | null }

/** شاشة متابعة مشتركة للكادر؛ /api/students يطبق نطاق المعلّم ومدير المرحلة. */
export function FollowUp() {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [picked, setPicked] = useState<StudentRow | null>(null);
  const { data, error } = useFetch<{ students: StudentRow[]; total: number }>(`/api/students?page=${page}&pageSize=30&q=${encodeURIComponent(query)}`);
  return <main className="page">
    <div className="page-head"><div><h1>متابعة الطلاب</h1><p>الحضور والحفظ والاختبارات لكل طالب ضمن نطاقك</p></div></div>
    <input className="input" aria-label="ابحث عن طالب" placeholder="ابحث باسم الطالب" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); setPicked(null); }} />
    {error && <div className="error-box">{error}</div>}
    {picked ? <><button className="btn ghost small" type="button" onClick={() => setPicked(null)}>العودة إلى الطلاب</button><StudentPortal key={picked.id} studentId={picked.id} /></> : <>
      <div className="list">{data?.students.map((student) => <button className="card row-card" type="button" key={student.id} onClick={() => setPicked(student)}><span className="grow"><b>{student.name}</b><small>{student.circleName ?? "بلا حلقة"}</small></span><span className="chev">‹</span></button>)}</div>
      {data && !data.students.length && <div className="empty">لا يوجد طلاب.</div>}
      {data && data.total > 30 && <div className="actions"><button className="btn ghost small" type="button" disabled={page === 1} onClick={() => setPage(page - 1)}>السابق</button><span>{page}</span><button className="btn ghost small" type="button" disabled={page * 30 >= data.total} onClick={() => setPage(page + 1)}>التالي</button></div>}
    </>}
  </main>;
}
