import { useMemo, useState } from "react";
import { parsePrayerText, PRAYERS, type PrayerDay } from "@shared/prayer";
import { Field, useAction, useUi } from "../components/ui";
import { api } from "../lib/api";
import { downloadFile } from "../lib/download";
import { useFetch } from "../lib/hooks";
import { countAr, DAYS_AR } from "../lib/format";

/** مواعيد الصلاة (للمدير): الصق جدول المركز فيُحوَّل ويُعاين قبل الحفظ. */
export function PrayerAdmin() {
  const { data, reload } = useFetch<{ days: PrayerDay[]; range: { first: string | null; last: string | null; n: number } }>("/api/prayer");
  const [text, setText] = useState("");
  const [twelve, setTwelve] = useState(true);
  const { busy, run } = useAction();
  const { toast } = useUi();
  const parsed = useMemo(() => (text.trim() ? parsePrayerText(text, new Date().getFullYear(), { twelveHour: twelve }) : null), [text, twelve]);

  const pickFile = async (file?: File) => {
    if (!file) return;
    if (file.size > 500_000) return toast("الملف كبير؛ المتوقع جدول أيام فقط (CSV أو نص)", "err");
    if (/\.xlsx?$/i.test(file.name)) return toast("احفظ الملف بصيغة CSV من Excel (حفظ باسم ← CSV UTF-8) ثم ارفعه", "err");
    setText(await file.text());
    toast(`تمت قراءة «${file.name}»، راجع المعاينة ثم اضغط حفظ`);
  };
  const TEMPLATE_CSV = ["date,fajr,sunrise,dhuhr,asr,maghrib,isha", "2026-10-01,04:38,06:36,12:32,15:55,18:30,19:46"].join("\r\n");
  const template = () => downloadFile("prayer-times-template.csv", TEMPLATE_CSV, "text/csv");

  const save = async () => {
    if (!parsed?.rows.length) return;
    if (await run(() => api("/api/prayer/import", { method: "POST", body: { rows: parsed.rows.slice(0, 400) } }), `تم استيراد ${countAr(parsed.rows.length, DAYS_AR)}`)) { setText(""); void reload(); }
  };

  return (
    <main className="page">
      <div className="page-head"><div><h1>مواعيد الصلاة</h1><p>{data?.range?.n ? `محفوظ ${countAr(data.range.n, DAYS_AR)} (${data.range.first} ← ${data.range.last})` : "لم تُستورد مواعيد بعد"}</p></div></div>
      <section className="card form-grid">
        <h2>استيراد جدول</h2>
        <p className="muted" style={{ margin: 0 }}>ارفع ملف CSV أو الصق الجدول بالأعمدة: التاريخ، الفجر، الشروق، الظهر، العصر، المغرب، العشاء (يقبل فواصل أو تبويب أو أرقاماً عربية). التاريخ: 2026-10-01 أو 01/10/2026 أو 1/10.</p>
        <div className="actions">
          <label className="btn ghost small" style={{ cursor: "pointer" }}>
            رفع ملف CSV
            <input type="file" accept=".csv,.txt,text/csv,text/plain" hidden onChange={(e) => { void pickFile(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
          <button className="btn ghost small" type="button" onClick={template}>تنزيل نموذج CSV</button>
        </div>
        <Field label="نص الجدول"><textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} dir="ltr" placeholder="2026-10-01, 4:41, 6:02, 11:41, 3:04, 5:19, 6:40" /></Field>
        <label className="radio-row"><span style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={twelve} onChange={(e) => setTwelve(e.target.checked)} style={{ width: 18, height: 18 }} />الأوقات بنظام 12 ساعة بلا ص/م (تُحوَّل تلقائياً: العصر والمغرب والعشاء مساءً)</span></label>
        {parsed && (
          <>
            {parsed.errors.length > 0 && <div className="error-box">{parsed.errors.slice(0, 5).map((e) => <div key={e}>{e}</div>)}{parsed.errors.length > 5 && <div>… و{parsed.errors.length - 5} أخطاء أخرى</div>}</div>}
            {parsed.rows.length > 0 && (
              <div className="card" style={{ background: "var(--green-soft)", overflowX: "auto" }}>
                <b>معاينة ({countAr(parsed.rows.length, DAYS_AR)})</b>
                <table style={{ width: "100%", fontSize: ".82rem", marginTop: 6 }} dir="ltr"><thead><tr><th>date</th>{PRAYERS.map(([k]) => <th key={k}>{k}</th>)}</tr></thead>
                  <tbody>{parsed.rows.slice(0, 4).map((r) => <tr key={r.date}><td>{r.date}</td>{PRAYERS.map(([k]) => <td key={k}>{r[k]}</td>)}</tr>)}</tbody></table>
                <small className="muted">تحقق أن الأوقات صحيحة قبل الحفظ.</small>
              </div>
            )}
          </>
        )}
        <button className="btn" type="button" disabled={busy || !parsed?.rows.length} onClick={() => void save()}>حفظ المواعيد</button>
      </section>
    </main>
  );
}
