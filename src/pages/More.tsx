import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { MIN_PASSWORD } from "@shared/constants";
import { Field, Icons, Sheet, useAction, useUi } from "../components/ui";
import { api, flushNow } from "../lib/api";
import { downloadFile } from "../lib/download";
import { useMe, useSession } from "../lib/session";
import { getTheme, setTheme, type ThemeMode } from "../lib/theme";
import { discardRejected, outboxAll, retryRejected, subscribeSync, type OutboxItem } from "../lib/offline";
import { disablePush, enablePush, pushSupported, restorePush } from "../lib/push";

interface InstallEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }

/** «المزيد»: باقي القوائم بحسب الدور + المظهر + تثبيت التطبيق + كلمة المرور + الخروج. */
export function More() {
  const { confirm } = useUi();
  const { user } = useMe();
  const { logout, reload } = useSession();
  const [pw, setPw] = useState(false);
  const [theme, setThemeState] = useState<ThemeMode>(getTheme());
  const [installEvt, setInstallEvt] = useState<InstallEvent | null>(null);
  const [pushOn, setPushOn] = useState(false);
  const [rejected, setRejected] = useState<OutboxItem[]>([]);
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
  useEffect(() => { void restorePush().then(setPushOn).catch(() => setPushOn(false)); }, []);
  useEffect(() => {
    const load = () => { void outboxAll().then((items) => setRejected(items.filter((item) => item.userId === user.id && item.status === "rejected"))); };
    load();
    return subscribeSync(load);
  }, [user.id]);

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
        {notStudent && link("/app/follow-up", "متابعة الطلاب", "الحضور والحفظ وتفاصيل الاختبار", Icons.users, "teal")}
        {notStudent && link("/app/courses", "دورات الأحكام", "الدورات الجارية والمنتهية", Icons.scroll, "teal")}
        {(staffish || stageManager || user.role === "exam_committee") && link("/app/insights", "الإحصاءات والتقارير", stageManager ? "أرقام مرحلتك وجداولها" : "رسوم الاتجاه، جداول، تصدير وطباعة", Icons.chart, "rose")}
        {notStudent && link("/app/announcements", "الرسائل والتعاميم", staffish ? "أرسل للأهالي أو الكادر" : stageManager ? "أرسل لأولياء المرحلة أو الحلقة" : user.role === "teacher" ? "أرسل لأولياء الحلقة" : "إعلانات الإدارة", Icons.megaphone, "gold")}
        {link("/app/honor", "لوحة الشرف", "المتفوّقون والحفّاظ", Icons.award, "gold")}
      </div>
      {(staffish || stageManager) && <h2 className="section-title">الإدارة</h2>}
      <div className="list">
        {(staffish || stageManager) && link("/app/staff-attendance", stageManager ? "حضور معلمي مرحلتي" : "حضور الكادر", "تسجيل يومي وملخص شهري", Icons.calendar, "teal")}
        {stageManager && link("/app/circles", "حلقات مرحلتي", "الحلقات ومواعيدها", Icons.circle, "sky")}
        {(staffish || user.role === "teacher") && link("/app/guardians", "أولياء الأمور", "بيانات أولياء طلاب حلقته", Icons.staff, "gold")}
        {staffish && link("/app/archive", "أرشيف الطلاب", "الطلاب المنقطعون أو المتخرجون", Icons.users, "sky")}
        {admin && link("/app/prayer", "مواعيد الصلاة", "رفع جدول المواعيد (CSV)", Icons.moon, "plum")}
        {admin && link("/app/settings", "الإعدادات", "المستويات والدرجات وحدود الحلقات", Icons.more, "amber")}
        {admin && link("/app/center", "هوية المركز", "الاسم والشعار والتواصل", Icons.home, "gold")}
        {admin && link("/app/audit", "سجل التعديلات", "من عدّل ماذا ومتى", Icons.clipboard, "rose")}
        {admin && <button className="card row-card" type="button" onClick={() => void backup()}><span className="ico-badge" aria-hidden="true">{Icons.book}</span><span className="grow"><b>نسخة احتياطية كاملة</b><small>تنزيل كل بيانات المركز (بلا كلمات مرور)</small></span></button>}
      </div>
      <h2 className="section-title">حسابي</h2>
      <div className="list">
        {rejected.length > 0 && <div className="card form-grid">
          <b>سجلات تحتاج مراجعة</b>
          <small className="muted">أوقفنا المزامنة عند أول سجل رفضه الخادم حتى لا يُرسل كشف يعتمد على بيانات ناقصة.</small>
          {rejected.map((item) => <div className="card" key={item.id}>
            <b>{item.path === "/api/daily" ? "تسميع يومي" : item.path === "/api/staff-attendance" ? "حضور الكادر" : item.path === "/api/reports/save" ? "كشف شهري" : item.path === "/api/sard" ? "سرد" : "اختبار تجريبي"}</b>
            <small className="muted" style={{ display: "block" }}>{new Date(item.createdAt).toLocaleString("ar-PS")} · {item.error}</small>
            <div className="actions">
              <button className="btn small" type="button" onClick={() => void run(async () => { await retryRejected(item.id!, user.id); await flushNow(); })}>إعادة المحاولة</button>
              <button className="btn ghost danger small" type="button" onClick={() => void (async () => {
                if (await confirm({ title: "حذف السجل المرفوض من الجهاز؟", message: "لن يُرسل هذا السجل إلى الخادم.", confirmLabel: "حذف", danger: true })) { await discardRejected(item.id!, user.id); await flushNow(); }
              })()}>حذف من الجهاز</button>
            </div>
          </div>)}
        </div>}
        {installEvt && <button className="card row-card" type="button" onClick={() => void install()}><span className="ico-badge gold" aria-hidden="true">{Icons.plus}</span><span className="grow"><b>تثبيت التطبيق على الجهاز</b><small>أيقونة على الشاشة الرئيسية</small></span></button>}
        {pushSupported() && <button className="card row-card" type="button" onClick={() => void run(async () => { if (pushOn) await disablePush(); else await enablePush(); setPushOn(!pushOn); }, pushOn ? "أُوقفت تنبيهات الهاتف" : "فُعّلت تنبيهات الهاتف")}><span className="ico-badge gold" aria-hidden="true">{Icons.megaphone}</span><span className="grow"><b>تنبيهات الهاتف</b><small>{pushOn ? "مفعّلة · اضغط لإيقافها" : "اضغط لتفعيل تنبيهات الرسائل والاختبارات"}</small></span></button>}
        {pushOn && <button className="card row-card" type="button" onClick={() => void run(async () => {
          const result = await api<{ subscriptions: number; accepted: number; failed: number }>("/api/notifications/test-push", { method: "POST" });
          if (!result.subscriptions) throw new Error("لم يُحفظ اشتراك هذا الهاتف على الخادم");
          if (!result.accepted) throw new Error("لم تقبل خدمة الهاتف التنبيه التجريبي");
        }, "أُرسل التنبيه التجريبي إلى هاتفك")}><span className="ico-badge teal" aria-hidden="true">{Icons.megaphone}</span><span className="grow"><b>إرسال تنبيه تجريبي</b><small>تحقق من ظهور التنبيه على هذا الهاتف</small></span></button>}
        <div className="card">
          <b>المظهر</b>
          <div className="radio-row" style={{ marginTop: 8 }} role="radiogroup" aria-label="المظهر">
            {([["system", "تلقائي"], ["light", "فاتح"], ["dark", "ليلي"]] as Array<[ThemeMode, string]>).map(([k, label]) => (
              <label key={k} style={{ minWidth: 80 }}><input type="radio" name="theme" checked={theme === k} onChange={() => { setTheme(k); setThemeState(k); }} />{label}</label>
            ))}
          </div>
        </div>
        <button className="card row-card" type="button" onClick={() => setPw(true)}><span className="ico-badge teal" aria-hidden="true">{Icons.staff}</span><span className="grow"><b>تغيير كلمة المرور</b><small>حسابي: {user.username}</small></span></button>
        <button className="card row-card" type="button" onClick={async () => { if (await confirm({ title: "تسجيل الخروج", message: "هل أنت متأكد من الخروج؟", confirmLabel: "خروج", danger: true })) { await disablePush().catch(() => undefined); void logout(); } }}><span className="ico-badge rose" aria-hidden="true">{Icons.login}</span><span className="grow"><b>تسجيل الخروج</b></span></button>
      </div>
      {pw && <PasswordSheet onClose={() => setPw(false)} onChanged={() => void reload()} />}
    </main>
  );
}

export function PasswordSheet({ onClose, onChanged }: { onClose: () => void; onChanged?: () => void }) {
  const { busy, run } = useAction();
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (f.get("newPassword") !== f.get("confirm")) return void (await run(async () => { throw new Error("تأكيد كلمة المرور غير مطابق"); }));
    const ok = await run(() => api("/api/auth/change-password", { method: "POST", body: { oldPassword: f.get("oldPassword"), newPassword: f.get("newPassword") } }), "تم تغيير كلمة المرور");
    if (ok) { onChanged?.(); onClose(); }
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
