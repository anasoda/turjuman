import { useState } from "react";
import { DIRECTION_LABELS, type Direction } from "@shared/constants";
import { Field, Sheet, useUi } from "../components/ui";
import { api } from "../lib/api";
import { downloadFile } from "../lib/download";
import { useMe } from "../lib/session";
import type { Circle } from "../lib/types";
import { buildImportRows, detectMapping, FIELDS, looksLikeHeader, readSheet, templateCsv, type BuiltRow, type FieldKey } from "../lib/sheet";

interface RowResult { index: number; name: string; status: "added" | "duplicate" | "error"; message: string }
interface ImportResponse { added: number; duplicates: number; errors: number; guardiansCreated: number; guardiansLinked: number; accountsCreated: number; results: RowResult[] }

const CHUNK = 50;

/** استيراد دفعة طلاب إلى حلقة واحدة من ملف Excel (xlsx) أو CSV. */
export function StudentImport({ circles, onClose, onDone }: { circles: Circle[]; onClose: () => void; onDone: () => void }) {
  const { user } = useMe();
  const { toast } = useUi();
  const usable = circles.filter((c) => c.active);
  // بلا حلقة: للإداريين فقط (الطالب بلا حلقة خارج نطاق المعلّم ومدير المرحلة)
  const canUnassigned = user.role === "admin" || user.role === "secretary";
  const [circleId, setCircleId] = useState(usable[0]?.id ?? "");
  const [createAccounts, setCreateAccounts] = useState(false);
  const [fileName, setFileName] = useState("");
  const [cells, setCells] = useState<string[][] | null>(null);
  const [header, setHeader] = useState(true);
  const [mapping, setMapping] = useState<Array<FieldKey | "">>([]);
  const [direction, setDirection] = useState<Direction>("descending");
  const [plan, setPlan] = useState(10);
  const [tempIds, setTempIds] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<ImportResponse | null>(null);
  const [error, setError] = useState("");

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError("");
    setDone(null);
    try {
      const rows = await readSheet(file);
      if (!rows.length) throw new Error("الملف فارغ");
      const isHeader = looksLikeHeader(rows[0]);
      const width = Math.max(...rows.slice(0, 20).map((r) => r.length));
      const padded = Array.from({ length: width }, (_, i) => rows[0][i] ?? "");
      setCells(rows);
      setHeader(isHeader);
      setMapping(detectMapping(padded, isHeader));
      setFileName(file.name);
      if (!isHeader) toast("لم نجد صف عناوين — تحقّق من ربط الأعمدة أدناه", "err");
    } catch (e) {
      setCells(null);
      setError(e instanceof Error ? e.message : "تعذّر قراءة الملف");
    }
  };

  const built: BuiltRow[] = cells ? buildImportRows(cells, mapping, { header, defaultDirection: direction, defaultPlan: plan }) : [];
  const ready = built.filter((r) => !r.problem);
  const circle = usable.find((c) => c.id === circleId);

  const run = async () => {
    if (!ready.length) return;
    setBusy(true);
    const all: ImportResponse = { added: 0, duplicates: 0, errors: 0, guardiansCreated: 0, guardiansLinked: 0, accountsCreated: 0, results: [] };
    try {
      for (let i = 0; i < ready.length; i += CHUNK) {
        const part = ready.slice(i, i + CHUNK);
        const r = await api<ImportResponse>("/api/students/import", {
          method: "POST",
          body: { circleId: circleId || null, tempIds, createAccounts, rows: part.map((p) => ({ ...p.student, gender: p.student.gender ?? undefined })) }
        });
        all.added += r.added;
        all.duplicates += r.duplicates;
        all.errors += r.errors;
        all.guardiansCreated += r.guardiansCreated ?? 0;
        all.guardiansLinked += r.guardiansLinked ?? 0;
        all.accountsCreated += r.accountsCreated ?? 0;
        all.results.push(...r.results.map((x) => ({ ...x, index: x.index + i })));
      }
      setDone(all);
      if (all.added) onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذّر الاستيراد");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    const bad = done.results.filter((r) => r.status !== "added");
    return (
      <Sheet title="نتيجة الاستيراد" onClose={onClose}>
        <div className="stat-row">
          <div className="stat"><b>{done.added}</b><small>أُضيفوا</small></div>
          <div className="stat"><b>{done.duplicates}</b><small>مكرّرون</small></div>
          <div className="stat"><b>{done.errors}</b><small>أخطاء</small></div>
        </div>
        {(done.guardiansCreated > 0 || done.guardiansLinked > 0) && (
          <div className="stat-row" style={{ marginTop: 6 }}>
            <div className="stat"><b>{done.guardiansCreated}</b><small>أولياء أمر أُنشئوا</small></div>
            <div className="stat"><b>{done.guardiansLinked}</b><small>رُبطوا بولي موجود</small></div>
            <div className="stat"><b>{done.accountsCreated}</b><small>حسابات دخول</small></div>
          </div>
        )}
        {!!bad.length && (
          <div className="list" style={{ marginTop: 10 }}>
            {bad.slice(0, 60).map((r, i) => (
              <div key={i} className="card" style={{ padding: "8px 12px" }}>
                <b>{r.name || `سطر ${r.index + 1}`}</b>
                <small className="muted">{r.message}</small>
              </div>
            ))}
          </div>
        )}
        <button className="btn" type="button" onClick={onClose}>إغلاق</button>
      </Sheet>
    );
  }

  return (
    <Sheet title="استيراد طلاب من ملف Excel" onClose={onClose}>
      <div className="form-grid">
        <p className="muted" style={{ margin: 0 }}>
          ارفع ملف Excel (xlsx) أو CSV يحتوي صفاً لكل طالب. الإجباري: اسم الطالب وهويته وميلاده، واسم ولي الأمر وصلته ورقم اتصاله وواتسابه. يُكتشف الإخوة تلقائياً (بهوية الولي ثم رقم الواتساب) ويُربطون بولي واحد.
        </p>
        <button className="btn ghost small" type="button" onClick={() => downloadFile("نموذج-استيراد-الطلاب.csv", templateCsv(), "text/csv")}>
          تنزيل نموذج جاهز (يُفتح في Excel)
        </button>

        <Field label="الحلقة" hint={circle ? `فئة الحلقة: ${circle.category === "male" ? "ذكور" : "إناث"} — الحالي ${circle.studentCount}` : undefined}>
          <select value={circleId} onChange={(e) => setCircleId(e.target.value)} disabled={user.role === "teacher" && usable.length === 1}>
            {canUnassigned && <option value="">بلا حلقة بعد (يُوزَّعون لاحقاً)</option>}
            {usable.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>

        <Field label="ملف الطلاب">
          <input type="file" accept=".xlsx,.csv,.txt" onChange={(e) => void pick(e.target.files?.[0])} />
        </Field>
        {error && <div className="error-box">{error}</div>}

        {cells && (
          <>
            <div className="muted" style={{ fontSize: ".9rem" }}>{fileName} · {built.length} سطراً</div>
            <label className="check"><input type="checkbox" checked={header} onChange={(e) => { setHeader(e.target.checked); setMapping(detectMapping(cells[0], e.target.checked)); }} />السطر الأول عناوين أعمدة</label>

            <fieldset className="mapper">
              <legend className="muted">ربط الأعمدة</legend>
              {mapping.map((key, i) => (
                <label key={i} className="map-row">
                  <span className="muted">{header ? cells[0][i] || `عمود ${i + 1}` : `عمود ${i + 1}`}</span>
                  <select value={key} onChange={(e) => setMapping(mapping.map((k, j) => (j === i ? (e.target.value as FieldKey | "") : k)))}>
                    <option value="">— تجاهل —</option>
                    {FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                  </select>
                </label>
              ))}
            </fieldset>

            <div className="form-grid two">
              <Field label="اتجاه الحفظ الافتراضي" hint="لمن لم يُذكر اتجاهه في الملف">
                <select value={direction} onChange={(e) => setDirection(e.target.value as Direction)}>
                  {(["descending", "ascending"] as Direction[]).map((d) => <option key={d} value={d}>{DIRECTION_LABELS[d]}</option>)}
                </select>
              </Field>
              <Field label="الخطة الشهرية الافتراضية"><input type="number" min={0} max={604} value={plan} onChange={(e) => setPlan(Number(e.target.value))} /></Field>
            </div>
            <label className="check"><input type="checkbox" checked={tempIds} onChange={(e) => setTempIds(e.target.checked)} />توليد رقم هوية مؤقت لمن لا رقم له (يُصحَّح لاحقاً من بطاقة الطالب)</label>
            <label className="check"><input type="checkbox" checked={createAccounts} onChange={(e) => setCreateAccounts(e.target.checked)} />إنشاء حساب دخول لكل ولي أمر جديد له رقم هوية</label>
            {createAccounts && <small className="muted">اسم المستخدم وكلمة المرور الأولية = رقم هوية ولي الأمر، ويستطيع تغييرها لاحقاً. من لا هوية له يُسجَّل بلا حساب.</small>}

            <div className="table-wrap">
              <table className="grid">
                <thead><tr><th>#</th><th>الاسم</th><th>الهوية</th><th>الميلاد</th><th>ولي الأمر</th><th>جواله</th><th>ملاحظة</th></tr></thead>
                <tbody>
                  {built.slice(0, 10).map((r) => (
                    <tr key={r.line} className={r.problem ? "bad" : ""}>
                      <td>{r.line}</td>
                      <td>{r.student.name || "—"}</td>
                      <td dir="ltr">{r.student.nationalId || "—"}</td>
                      <td dir="ltr">{r.student.birth || "—"}</td>
                      <td>{r.student.guardianName || "—"}</td>
                      <td dir="ltr">{r.student.guardianWaNational || r.student.guardianCallPhone || "—"}</td>
                      <td className="muted">{r.problem}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {built.length > 10 && <small className="muted">…و{built.length - 10} سطراً آخر</small>}
            </div>

            <button className="btn" type="button" disabled={busy || !ready.length || (!circleId && !canUnassigned)} onClick={() => void run()}>
              {busy ? "جارٍ الاستيراد…" : `استيراد ${ready.length} طالباً`}
            </button>
          </>
        )}
      </div>
    </Sheet>
  );
}
