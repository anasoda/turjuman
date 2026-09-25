import { useState, type FormEvent } from "react";
import { Brand } from "../components/Shell";
import { Field, useAction, useUi } from "../components/ui";
import { api } from "../lib/api";
import { useMe, useSession } from "../lib/session";

/** يصغّر صورة الشعار إلى 512px ويضغطها WebP قبل الرفع. */
function compressLogo(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 512 / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      const out = canvas.toDataURL("image/webp", 0.82);
      out.length > 600_000 ? reject(new Error("تعذّر ضغط الشعار للحجم المناسب، اختر صورة أبسط")) : resolve(out);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("تعذّر قراءة صورة الشعار")); };
    img.src = url;
  });
}

/** هوية المركز: الاسم والوصف والشعار وأرقام التواصل (تظهر في الصفحة العامة). */
export function CenterIdentity() {
  const { center } = useMe();
  const { reload } = useSession();
  const { toast } = useUi();
  const { busy, run } = useAction();
  const [logo, setLogo] = useState(center.logo);

  const pick = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 4 * 1024 * 1024) return toast("اختر صورة لا يتجاوز حجمها 4 ميجابايت", "err");
    try { setLogo(await compressLogo(file)); toast("تم تجهيز الشعار، اضغط حفظ"); } catch (e) { toast(e instanceof Error ? e.message : "تعذّر تجهيز الشعار", "err"); }
  };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = { name: String(f.get("name")), subtitle: String(f.get("subtitle")), phone: String(f.get("phone")), whatsapp: String(f.get("whatsapp")), logo };
    if (await run(() => api("/api/center", { method: "PUT", body }), "تم حفظ هوية المركز")) await reload();
  };

  return (
    <main className="page">
      <div className="page-head"><div><h1>هوية المركز</h1><p>تظهر في كل الصفحات وفي الصفحة العامة</p></div></div>
      <form className="card form-grid" onSubmit={submit}>
        <div style={{ background: "var(--green)", color: "#fff", padding: 12, borderRadius: 12 }}><Brand center={{ ...center, logo }} /></div>
        <Field label="اسم المركز"><input name="name" required minLength={3} defaultValue={center.name} /></Field>
        <Field label="الوصف المختصر"><input name="subtitle" defaultValue={center.subtitle} /></Field>
        <div className="form-grid two">
          <Field label="هاتف المركز"><input name="phone" defaultValue={center.phone} inputMode="tel" dir="ltr" /></Field>
          <Field label="واتساب"><input name="whatsapp" defaultValue={center.whatsapp} inputMode="tel" dir="ltr" /></Field>
        </div>
        <Field label="شعار المركز" hint="يُصغَّر ويُضغط تلقائياً. الحد الأقصى للملف 4 ميجابايت.">
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => void pick(e.target.files?.[0])} />
        </Field>
        <div className="actions">
          <button className="btn" disabled={busy}>حفظ</button>
          {logo && <button className="btn ghost danger" type="button" onClick={() => setLogo("")}>إزالة الشعار</button>}
        </div>
      </form>
    </main>
  );
}
