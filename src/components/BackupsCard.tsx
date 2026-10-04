import { useAction } from "./ui";
import { api } from "../lib/api";
import { useFetch } from "../lib/hooks";

const fmtSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** النسخ الاحتياطية الدورية المخزّنة على الخادم (R2): قائمة بآخر النسخ وتنزيلها، و«انسخ الآن» لنسخة فورية. */
export function BackupsCard() {
  const { data, error, reload } = useFetch<{ backups: Array<{ name: string; size: number; uploadedAt: string }>; keep: number }>("/api/export/backups");
  const { busy, run } = useAction();
  return (
    <div className="card form-grid">
      <b>النسخ الاحتياطية التلقائية</b>
      {!error && <small className="muted">تُحفظ نسخة كل أسبوع على الخادم تلقائياً (ليلة الجمعة)، ويُبقى آخر {data?.keep ?? 4} نسخ.</small>}
      {error && <small className="muted">{error}. (التصدير اليدوي أعلاه يعمل دائماً.)</small>}
      {data && !data.backups.length && <small className="muted">لا نسخ محفوظة بعد؛ اضغط «انسخ الآن».</small>}
      {data?.backups.map((b) => (
        <div key={b.name} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
          <span>{new Date(b.uploadedAt).toLocaleString("ar-PS")} · {fmtSize(b.size)}</span>
          <a className="btn ghost small" href={`/api/export/backups/${b.name}`} download>تنزيل</a>
        </div>
      ))}
      <div className="actions">
        <button className="btn small" type="button" disabled={busy} onClick={() => void run(async () => { await api("/api/export/backups/run", { method: "POST" }); reload(); }, "حُفظت نسخة جديدة")}>انسخ الآن</button>
      </div>
    </div>
  );
}
