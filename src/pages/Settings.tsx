import { useState, type FormEvent } from "react";
import type { CenterSettings, Level, SardBand } from "@shared/settings";
import { Field, useAction } from "../components/ui";
import { api } from "../lib/api";
import { useMe, useSession } from "../lib/session";

/** إعدادات المركز (للمدير): كل ما قرّره المالك أنه يُضبط من هنا لا من الكود. */
export function SettingsPage() {
  const { settings } = useMe();
  const { reload } = useSession();
  const { busy, run } = useAction();
  const [s, setS] = useState<CenterSettings>(settings);
  const set = <K extends keyof CenterSettings>(k: K, v: CenterSettings[K]) => setS((prev) => ({ ...prev, [k]: v }));
  const num = (v: string) => (v === "" ? 0 : Number(v));

  const setLevel = (i: number, patch: Partial<Level>) => set("levels", s.levels.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const setBand = (i: number, patch: Partial<SardBand>) => set("sardBands", s.sardBands.map((b, j) => (j === i ? { ...b, ...patch } : b)));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await run(() => api("/api/settings", { method: "PUT", body: s }), "تم حفظ الإعدادات")) await reload();
  };

  return (
    <main className="page">
      <div className="page-head"><div><h1>الإعدادات</h1><p>كل ما هنا يغيّر سلوك المركز فوراً</p></div></div>
      <form className="form-grid" onSubmit={submit}>
        <section className="card form-grid">
          <h2>الحلقات والتقارير</h2>
          <div className="form-grid two">
            <Field label="أقصى عدد طلاب في الحلقة"><input type="number" min={1} max={100} value={s.maxStudentsPerCircle} onChange={(e) => set("maxStudentsPerCircle", num(e.target.value))} /></Field>
            <Field label="يوم فتح الكشف الشهري للمعلّم" hint="من هذا اليوم في الشهر (1–28)"><input type="number" min={1} max={28} value={s.monthlyReportOpenDay} onChange={(e) => set("monthlyReportOpenDay", num(e.target.value))} /></Field>
          </div>
        </section>

        <section className="card form-grid">
          <h2>مستويات الحلقات</h2>
          {s.levels.map((l, i) => (
            <div className="repeat-row" key={l.key}>
              <Field label={`المرحلة ${i + 1}`}><input value={l.label} onChange={(e) => setLevel(i, { label: e.target.value })} required /></Field>
              <button className="btn ghost danger small" type="button" disabled={s.levels.length <= 1} onClick={() => set("levels", s.levels.filter((_, j) => j !== i))}>حذف</button>
            </div>
          ))}
          <button className="btn ghost small" type="button" style={{ justifySelf: "start" }} onClick={() => set("levels", [...s.levels, { key: `lvl_${Date.now().toString(36)}`, label: "" }])}>＋ إضافة مرحلة</button>
        </section>

        <section className="card form-grid">
          <h2>السرد</h2>
          <div className="form-grid two">
            <Field label="درجة البداية"><input type="number" min={1} value={s.sardStartScore} onChange={(e) => set("sardStartScore", num(e.target.value))} /></Field>
            <Field label="خصم الخطأ الواحد"><input type="number" min={0} step="0.25" value={s.sardDeductMistake} onChange={(e) => set("sardDeductMistake", num(e.target.value))} /></Field>
            <Field label="خصم التنبيه الواحد"><input type="number" min={0} step="0.25" value={s.sardDeductAlert} onChange={(e) => set("sardDeductAlert", num(e.target.value))} /></Field>
          </div>
          <h3>تقسيمة الدرجات</h3>
          <p className="muted" style={{ margin: 0 }}>كل تقدير يبدأ من الدرجة المكتوبة. يجب أن يوجد تقدير يبدأ من صفر.</p>
          {[...s.sardBands].sort((a, b) => b.min - a.min).map((b) => {
            const i = s.sardBands.indexOf(b);
            return (
              <div className="repeat-row" key={i} style={{ gridTemplateColumns: "110px 1fr auto" }}>
                <Field label="من درجة"><input type="number" min={0} step="0.5" value={b.min} onChange={(e) => setBand(i, { min: num(e.target.value) })} /></Field>
                <Field label="التقدير"><input value={b.label} onChange={(e) => setBand(i, { label: e.target.value })} required /></Field>
                <button className="btn ghost danger small" type="button" disabled={s.sardBands.length <= 1} onClick={() => set("sardBands", s.sardBands.filter((_, j) => j !== i))}>حذف</button>
              </div>
            );
          })}
          <button className="btn ghost small" type="button" style={{ justifySelf: "start" }} onClick={() => set("sardBands", [...s.sardBands, { min: 0, label: "" }])}>＋ إضافة تقدير</button>
        </section>

        <section className="card form-grid">
          <h2>الاختبارات والتسميع</h2>
          <Field label="أدنى علامة نجاح في الاختبار"><input type="number" min={0} value={s.minPassScore} onChange={(e) => set("minPassScore", num(e.target.value))} /></Field>
          <Field label="مقياس تقييم التسميع اليومي" hint="افصل بين التقديرات بفاصلة، من الأعلى إلى الأدنى">
            <input value={s.recitationGrades.join("، ")} onChange={(e) => set("recitationGrades", e.target.value.split(/[,،]/).map((x) => x.trim()).filter(Boolean))} />
          </Field>
        </section>

        <section className="card form-grid">
          <h2>أرقام التواصل</h2>
          <Field label="مقدمة الدولة للجوال" hint="بلا + ولا أصفار. تُستعمل لأيقونتي الاتصال والواتساب (فلسطين 970).">
            <input value={s.phonePrefix ?? "970"} onChange={(e) => set("phonePrefix", e.target.value.replace(/[^0-9]/g, "").slice(0, 5))} inputMode="numeric" dir="ltr" />
          </Field>
          <small className="muted">مثال: الرقم 0591234567 يصبح في واتساب <b dir="ltr">{(s.phonePrefix ?? "970") + "591234567"}</b></small>
        </section>

        <section className="card form-grid">
          <h2>التاريخ الهجري</h2>
          <Field label="تعديل التاريخ الهجري المعروض" hint="التطبيق يتبع تقويم أم القرى؛ إن اختلف عن تقويم غزة فعدّله هنا بيوم أو يومين.">
            <select value={s.hijriOffset ?? 0} onChange={(e) => set("hijriOffset", Number(e.target.value))}>
              {[-2, -1, 0, 1, 2].map((d) => <option key={d} value={d}>{d === 0 ? "بلا تعديل" : d > 0 ? `+${d} يوم (تقديم)` : `${d} يوم (تأخير)`}</option>)}
            </select>
          </Field>
          <small className="muted">اليوم حسب الإعداد الحالي: <b>{new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura-nu-latn", { day: "numeric", month: "long", year: "numeric" }).format(new Date(Date.now() + (s.hijriOffset ?? 0) * 86_400_000))}</b></small>
        </section>

        <button className="btn" disabled={busy}>حفظ الإعدادات</button>
      </form>
    </main>
  );
}
