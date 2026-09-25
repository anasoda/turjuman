import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { MIN_PASSWORD } from "@shared/constants";
import { Field, Icons, Sheet, useAction } from "../components/ui";
import { api } from "../lib/api";
import { downloadFile } from "../lib/download";
import { useMe, useSession } from "../lib/session";
import { getTheme, setTheme, type ThemeMode } from "../lib/theme";

interface InstallEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }

/** «المزيد»: باقي القوائم بحسب الدور + المظهر + تثبيت التطبيق + كلمة المرور + الخروج. */
export function More() {
  const { user } = useMe();
  const { logout } = useSession();
  const [pw, setPw] = useState(false);
  const [theme, setThemeState] = useState<ThemeMode>(getTheme());
  const [installEvt, setInstallEvt] = useState<InstallEvent | null>(null);
  const { run } = useAction();
  const admin = user.role === "admin";
  const staffish = admin || user.role === "secretary";
  // مدير المرحلة (§15.3): حضور المعلمين وطلاب مرحلته وإحصاءاتها، بلا إعدادات ولا كادر ولا أرشفة
  const stageManager = user.role === "stage_manager";
  const notStudent = user.role !== "student" && user.role !== "guardian";

  useEffect(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); setInstallEvt(e as InstallEvent); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  const install = async () => { if (!installEvt) return; await installEvt.prompt(); setInstallEvt(null); };
  const backup = () => run(async () => {
    const data = await api<unknown>("/api/export");
    downloadFile(`نسخة-احتياطية-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 1), "application/json");
  }, "تم تجهيز النسخة الاحتياطية");

  type Color = "" | "gold" | "teal" | "sky" | "rose" | "plum" | "amber";
  const link = (to: string, title: string, sub: string, icon: React.ReactNode, color: Color = "") => (
    <Link className="card row-card" to={to}><span className={`ico-badge ${color}`} aria-hidden="true">{icon}</span><span className="grow"><b>{title}</b><small>{sub}</small></span><span className="chev" aria-hidden="true">‹</span></Link>
  );

  return (
    <main className="page">
      <h1>المزيد</h1>
      <h2 className="section-title">المتابعة</h2>
      <div className="list">
        {(staffish || stageManager || user.role === "teacher") && link("/app/daily", "التسميع اليومي", "الحضور والتسميع لكل طالب", Icons.check)}
        {notStudent && link("/app/reports", "الكشف الشهري", "الإنجاز مقابل الخطة الشهرية", Icons.clipboard, "sky")}
        {notStudent && link("/app/sard", "السرد", "سجلات السرد والدرجات", Icons.mic, "amber")}
        {notStudent && link("/app/tests", "الاختبارات", "التجريبية والرسمية", Icons.award, "plum")}
        {notStudent && link("/app/courses", "دورات الأحكام", "الدورات الجارية والمنتهية", Icons.scroll, "teal")}
        {(staffish || stageManager || user.role === "exam_committee") && link("/app/insights", "الإحصاءات والتقارير", stageManager ? "أرقام مرحلتك وجداولها" : "رسوم الاتجاه، جداول، تصدير وطباعة", Icons.chart, "rose")}
        {notStudent && link("/app/announcements", "رسائل الإدارة", staffish ? "أرسل إعلاناً للأهالي أو الكادر" : "إعلانات الإدارة", Icons.megaphone, "gold")}
        {link("/app/honor", "لوحة الشرف", "المتفوّقون والحفّاظ", Icons.award, "gold")}
      </div>
      {(staffish || stageManager) && <h2 className="section-title">الإدارة</h2>}
      <div className="list">
        {(staffish || stageManager) && link("/app/staff-attendance", stageManager ? "حضور معلمي مرحلتي" : "حضور الكادر", "تسجيل يومي وملخص شهري", Icons.calendar, "teal")}
        {stageManager && link("/app/circles", "حلقات مرحلتي", "الحلقات ومواعيدها", Icons.circle, "sky")}
        {staffish && link("/app/guardians", "أولياء الأمور", "حساب لولي الأمر يتابع به أبناءه", Icons.staff, "gold")}
        {staffish && link("/app/archive", "أرشيف الطلاب", "الطلاب المنقطعون أو المتخرجون", Icons.users, "sky")}
        {admin && link("/app/prayer", "مواعيد الصلاة", "رفع جدول المواعيد (CSV)", Icons.moon, "plum")}
        {admin && link("/app/settings", "الإعدادات", "المستويات والدرجات وحدود الحلقات", Icons.more, "amber")}
        {admin && link("/app/center", "هوية المركز", "الاسم والشعار والتواصل", Icons.home, "gold")}
        {admin && link("/app/audit", "سجل التعديلات", "من عدّل ماذا ومتى", Icons.clipboard, "rose")}
        {admin && <button className="card row-card" type="button" onClick={() => void backup()}><span className="ico-badge" aria-hidden="true">{Icons.book}</span><span className="grow"><b>نسخة احتياطية كاملة</b><small>تنزيل كل بيانات المركز (بلا كلمات مرور)</small></span></button>}
      </div>
      <h2 className="section-title">حسابي</h2>
      <div className="list">
        {installEvt && <button className="card row-card" type="button" onClick={() => void install()}><span className="ico-badge gold" aria-hidden="true">{Icons.plus}</span><span className="grow"><b>تثبيت التطبيق على الجهاز</b><small>أيقونة على الشاشة الرئيسية</small></span></button>}
        <div className="card">
          <b>المظهر</b>
          <div className="radio-row" style={{ marginTop: 8 }} role="radiogroup" aria-label="المظهر">
            {([["system", "تلقائي"], ["light", "فاتح"], ["dark", "ليلي"]] as Array<[ThemeMode, string]>).map(([k, label]) => (
              <label key={k} style={{ minWidth: 80 }}><input type="radio" name="theme" checked={theme === k} onChange={() => { setTheme(k); setThemeState(k); }} />{label}</label>
            ))}
          </div>
        </div>
        <button className="card row-card" type="button" onClick={() => setPw(true)}><span className="ico-badge teal" aria-hidden="true">{Icons.staff}</span><span className="grow"><b>تغيير كلمة المرور</b><small>حسابي: {user.username}</small></span></button>
        <button className="card row-card" type="button" onClick={() => void logout()}><span className="ico-badge rose" aria-hidden="true">{Icons.login}</span><span className="grow"><b>تسجيل الخروج</b></span></button>
      </div>
      {pw && <PasswordSheet onClose={() => setPw(false)} />}
    </main>
  );
}

function PasswordSheet({ onClose }: { onClose: () => void }) {
  const { busy, run } = useAction();
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (f.get("newPassword") !== f.get("confirm")) return void (await run(async () => { throw new Error("تأكيد كلمة المرور غير مطابق"); }));
    const ok = await run(() => api("/api/auth/change-password", { method: "POST", body: { oldPassword: f.get("oldPassword"), newPassword: f.get("newPassword") } }), "تم تغيير كلمة المرور");
    if (ok) onClose();
  };
  return (
    <Sheet title="تغيير كلمة المرور" onClose={onClose}>
      <form className="form-grid" onSubmit={submit}>
        <Field label="كلمة المرور الحالية"><input name="oldPassword" type="password" autoComplete="current-password" required dir="ltr" /></Field>
        <Field label="كلمة المرور الجديدة" hint={`${MIN_PASSWORD} خانات على الأقل`}><input name="newPassword" type="password" autoComplete="new-password" minLength={MIN_PASSWORD} required dir="ltr" /></Field>
        <Field label="تأكيد كلمة المرور الجديدة"><input name="confirm" type="password" autoComplete="new-password" minLength={MIN_PASSWORD} required dir="ltr" /></Field>
        <button className="btn" disabled={busy}>حفظ</button>
      </form>
    </Sheet>
  );
}
