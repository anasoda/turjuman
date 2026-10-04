import { useEffect, useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import type { Role } from "@shared/constants";
import { useMe, useSession } from "../lib/session";
import { Icons, useUi } from "./ui";
import { clearFailures, getSyncState, subscribeSync, type SyncState } from "../lib/offline";
import { api, flushNow } from "../lib/api";
import { disablePush } from "../lib/push";
import { getTheme, setTheme } from "../lib/theme";
import { NOTIFICATIONS_EVENT } from "../pages/Notifications";
import type { CenterInfo } from "../lib/types";
import { PasswordSheet } from "../pages/More";

export function Brand({ center }: { center: CenterInfo }) {
  return (
    <div className="brand">
      <span className="brand-mark"><img src={center.logo || "/brand/logo-512.webp"} alt="" /></span>
      <span style={{ minWidth: 0 }}>
        <b>{center.name}</b>
        <small>{center.subtitle}</small>
      </span>
    </div>
  );
}

interface NavItem { to: string; label: string; icon: React.ReactNode; end?: boolean }

function navFor(role: Role): NavItem[] {
  const home: NavItem = { to: "/app", label: "الرئيسية", icon: Icons.home, end: true };
  const more: NavItem = { to: "/app/more", label: "المزيد", icon: Icons.more };
  switch (role) {
    case "admin":
    case "secretary":
      return [home, { to: "/app/students", label: "الطلاب", icon: Icons.users }, { to: "/app/circles", label: "الحلقات", icon: Icons.circle }, { to: "/app/staff", label: "الكادر", icon: Icons.staff }, more];
    case "teacher":
      return [home, { to: "/app/daily", label: "التسميع", icon: Icons.book }, { to: "/app/students", label: "طلابي", icon: Icons.users }, { to: "/app/reports", label: "الكشف", icon: Icons.circle }, more];
    case "stage_manager":
      return [home, { to: "/app/daily", label: "التسميع", icon: Icons.book }, { to: "/app/students", label: "طلاب مرحلتي", icon: Icons.users }, { to: "/app/staff-attendance", label: "حضور المعلمين", icon: Icons.staff }, more];
    case "exam_committee":
      return [home, { to: "/app/tests", label: "الاختبارات", icon: Icons.book }, { to: "/app/students", label: "الطلاب", icon: Icons.users }, more];
    case "student":
    case "guardian":
      return [home, more];
  }
}

/** مؤشر حالة الحفظ: دون إنترنت / بانتظار الإرسال / جارٍ الإرسال / متصل. الضغط يفرض إرسال ما هو معلّق. */
function SyncPill() {
  const { toast } = useUi();
  const [s, setS] = useState<SyncState>(getSyncState());
  useEffect(() => subscribeSync(setS), []);
  useEffect(() => {
    if (!s.failures.length) return;
    s.failures.forEach((f) => toast(`تعذّر إرسال سجل محفوظ: ${f}`, "err"));
    clearFailures();
  }, [s.failures, toast]);
  const label = s.syncing ? "جارٍ المزامنة…" : s.rejected ? `${s.rejected} يحتاج مراجعة · ${s.pending} معلّق` : !s.online ? (s.pending ? `دون إنترنت · ${s.pending} معلّق` : "دون إنترنت") : s.pending ? `${s.pending} بانتظار الإرسال` : "متصل";
  return (
    <button type="button" className={`sync-pill ${!s.online || s.pending || s.rejected ? "warn" : ""}`} onClick={() => void flushNow()} aria-label={label} title={s.rejected ? `${label} · راجع السجلات من صفحة المزيد` : s.servedFromCache ? `تُعرض آخر بيانات محفوظة على الجهاز · ${label}` : `${label} · اضغط لإرسال ما هو معلّق`}>
      {label}
    </button>
  );
}

/** جرس الإشعارات: عدد غير المقروء (يُحدَّث كل دقيقة وعند العودة للتبويب وعند تغيّر الإشعارات). */
function Bell() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const load = () => { api<{ unread: number }>("/api/notifications/count").then((r) => setN(r.unread)).catch(() => undefined); };
    load();
    const t = window.setInterval(load, 60_000);
    window.addEventListener(NOTIFICATIONS_EVENT, load);
    document.addEventListener("visibilitychange", load);
    return () => { window.clearInterval(t); window.removeEventListener(NOTIFICATIONS_EVENT, load); document.removeEventListener("visibilitychange", load); };
  }, []);
  return (
    <Link to="/app/notifications" className="bell" aria-label={n ? `الإشعارات (${n} غير مقروء)` : "الإشعارات"}>
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0" /></svg>
      {n > 0 && <b>{n > 9 ? "9+" : n}</b>}
    </Link>
  );
}

const PW_BANNER_KEY = "tq_pw_banner_dismissed";

/** تنبيه (بلا إجبار — §15.8): كلمة مرور ولي الأمر ما زالت رقم هويته. يُغلَق للجلسة الحالية ويختفي نهائياً بعد التغيير. */
function PasswordBanner() {
  const { reload } = useSession();
  const [hidden, setHidden] = useState(() => { try { return sessionStorage.getItem(PW_BANNER_KEY) === "1"; } catch { return false; } });
  const [open, setOpen] = useState(false);
  if (hidden) return null;
  const dismiss = () => { try { sessionStorage.setItem(PW_BANNER_KEY, "1"); } catch { /* التخزين غير متاح */ } setHidden(true); };
  return (
    <>
      <div className="pw-banner" role="alert">
        <span className="grow">كلمة مرورك الحالية هي رقم هويتك. لحماية حسابك، اختر كلمة مرور جديدة.</span>
        <button type="button" className="btn gold" onClick={() => setOpen(true)}>غيّرها الآن</button>
        <button type="button" className="pw-banner-close" onClick={dismiss} aria-label="إغلاق التنبيه">×</button>
      </div>
      {open && <PasswordSheet onClose={() => setOpen(false)} onChanged={() => void reload()} />}
    </>
  );
}

/** الهيكل: شريط علوي بهوية المركز + تنقل سفلي (جوال) أو جانبي (شاشة عريضة). */
export function Shell() {
  const { confirm } = useUi();
  const { center, user } = useMe();
  const { logout } = useSession();
  const [theme, setThemeState] = useState(getTheme());

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    setThemeState(next);
  };

  return (
    <div className="shell">
      <header className="topbar">
        <Brand center={center} />
        <div className="topbar-actions">
          <button type="button" className="icon-btn" onClick={toggleTheme} aria-label="تبديل الوضع الليلي/النهاري" style={{ background: "transparent", border: "none", color: "inherit", cursor: "pointer", padding: "8px", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ width: 22, height: 22, display: "inline-block" }}>{theme === "dark" ? Icons.sun : Icons.moon}</span>
          </button>
          <SyncPill />
          <Bell />
          <button type="button" className="icon-btn" onClick={async () => { if (await confirm({ title: "تسجيل الخروج", message: "هل أنت متأكد من الخروج؟", confirmLabel: "خروج", danger: true })) { await disablePush().catch(() => undefined); void logout(); } }} aria-label="تسجيل الخروج" style={{ background: "transparent", border: "none", color: "inherit", cursor: "pointer", padding: "8px", display: "flex", alignItems: "center", justifyContent: "center", marginInlineStart: "4px" }}>
            <span style={{ width: 22, height: 22, display: "inline-block" }}>{Icons.login}</span>
          </button>
        </div>
      </header>
      {user.role === "guardian" && user.mustChangePassword && <PasswordBanner />}
      <Outlet />
      <nav className="bottom-nav" aria-label="التنقل الرئيسي">
        {navFor(user.role).map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? "active" : "")}>
            {n.icon}
            <span>{n.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
