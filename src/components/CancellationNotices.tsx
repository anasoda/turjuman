import { fmtDay } from "../lib/format";
import { useFetch } from "../lib/hooks";

/** تنبيه ولي الأمر/الطالب بالحصص الملغاة الجارية والقادمة لحلقات الأبناء (§14.6). */
export function CancellationNotices({ studentName }: { studentName?: string }) {
  const { data } = useFetch<{ cancellations: Array<{ id: string; circleName: string; date: string; reason: string; students: string[] }> }>("/api/cancellations/mine");
  const list = (data?.cancellations ?? []).filter((x) => !studentName || x.students.includes(studentName));
  if (!list.length) return null;
  return (
    <div className="error-box" role="status" style={{ marginBottom: 12 }}>
      <b>حصص ملغاة</b>
      {list.map((x) => (
        <div key={x.id} style={{ marginTop: 6 }}>
          {fmtDay(x.date)} — {x.circleName}{x.students.length ? ` (${x.students.join("، ")})` : ""}
          <div>السبب: {x.reason}</div>
        </div>
      ))}
    </div>
  );
}
