import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Field } from "../components/ui";
import { centerQuery } from "../lib/api";
import { useFetch } from "../lib/hooks";
import { useSession } from "../lib/session";
import type { CenterInfo } from "../lib/types";
import { CENTER_NAME, LOGO_FALLBACK } from "./Landing";

/** بوابة الدخول الوحيدة لكل الأدوار: اسم مستخدم وكلمة مرور فقط. */
export function Login() {
  const { login } = useSession();
  const center = useFetch<{ center: CenterInfo }>(`/api/public/center?${centerQuery()}`);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      await login(String(f.get("username") || ""), String(f.get("password") || ""));
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذّر تسجيل الدخول");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="card login-card" onSubmit={submit}>
        <div className="login-head">
          <div className="hero-logo"><img src={center.data?.center.logo || LOGO_FALLBACK} alt="" /></div>
          <b>{center.data?.center.name || CENTER_NAME}</b>
          <h1>أهلاً بك، سجّل دخولك للمتابعة</h1>
        </div>
        <Field label="اسم المستخدم">
          <input name="username" autoComplete="username" required autoCapitalize="none" dir="ltr" />
        </Field>
        <Field label="كلمة المرور">
          <input name="password" type="password" autoComplete="current-password" required dir="ltr" />
        </Field>
        {error && <div className="error-box" role="alert">{error}</div>}
        <button className="btn gold" disabled={busy} style={{ minHeight: 52, fontSize: "1.05rem" }}>{busy ? "يرجى الانتظار…" : "دخول"}</button>
        <small className="muted" style={{ textAlign: "center" }}>نسيت كلمة المرور؟ اطلب من إدارة المركز إعادة تعيينها.</small>
        <Link to="/" className="muted" style={{ textAlign: "center" }}>العودة إلى الصفحة الرئيسية</Link>
      </form>
    </div>
  );
}
