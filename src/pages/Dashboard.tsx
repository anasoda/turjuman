import { useState } from "react";
import { Link } from "react-router-dom";
import { ROLE_LABELS } from "@shared/constants";
import { useFetch } from "../lib/hooks";
import { useMe } from "../lib/session";
import type { Circle, GuardianChild } from "../lib/types";
import { StudentPortal } from "./StudentPortal";
import { ScheduleCard } from "./ScheduleAbsence";
import { PrayerCard } from "../components/PrayerCard";
import { Icons } from "../components/ui";
import type { PrayerDay } from "@shared/prayer";

/** بطاقة الصلاة في أعلى الرئيسية؛ وإن لم تُرفع المواعيد بعد يُنبَّه المدير مع رابط الرفع. */
function PrayerSection() {
  const { user } = useMe();
  const { data, loading } = useFetch<{ days: PrayerDay[] }>("/api/prayer");
  if (data?.days.length) return <PrayerCard days={data.days} />;
  if (loading || user.role !== "admin") return null;
  return (
    <Link className="card row-card setup" to="/app/prayer">
      <span className="ico-badge gold" aria-hidden="true">{Icons.moon}</span>
      <span className="grow"><b>أضف مواعيد الصلاة</b><small>ارفع ملف CSV لتظهر «الصلاة القادمة» هنا وفي الصفحة الرئيسية للزوار</small></span>
      <span className="chev" aria-hidden="true">‹</span>
    </Link>
  );
}

const hijri = new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura-nu-latn", { day: "numeric", month: "long", year: "numeric" });
const greg = new Intl.DateTimeFormat("ar-EG-u-nu-latn", { weekday: "long", day: "numeric", month: "long" });

/** بطاقة الترحيب: تحية بحسب الوقت + التاريخ الهجري والميلادي. */
function Welcome() {
  const { user, settings } = useMe();
  const h = new Date().getHours();
  const hello = h < 12 ? "صباح الخير" : "مساء الخير";
  const now = new Date();
  return (
    <section className="welcome">
      <small>{hello} 🌿</small>
      <h1>{user.displayName}</h1>
      <small>{ROLE_LABELS[user.role]}</small>
      <div className="dates"><span>{hijri.format(new Date(now.getTime() + (settings.hijriOffset ?? 0) * 86_400_000))}</span><span>{greg.format(now)}</span></div>
    </section>
  );
}

type TileColor = "" | "primary" | "gold" | "teal" | "sky" | "rose" | "plum" | "amber";
function Tile({ to, icon, title, sub, color = "" }: { to: string; icon: React.ReactNode; title: string; sub: string; color?: TileColor }) {
  return (
    <Link className={`tile ${color}`} to={to}>
      <span className="ico" aria-hidden="true">{icon}</span>
      <b>{title}</b>
      <small>{sub}</small>
    </Link>
  );
}

/** الرئيسية بحسب الدور. */
export function Dashboard() {
  const { user } = useMe();
  return (
    <main className="page">
      <Welcome />
      <PrayerSection />
      {user.role === "student" ? <StudentPortal /> : user.role === "guardian" ? <GuardianHome /> : user.role === "teacher" ? <TeacherHome /> : <StaffHome />}
    </main>
  );
}

/** بوابة ولي الأمر: تبويب لكل ابن، وبداخله بوابة الطالب نفسها. */
function GuardianHome() {
  const { data, error, loading } = useFetch<{ children: GuardianChild[] }>("/api/guardians/children");
  const [picked, setPicked] = useState("");
  if (error) return <div className="error-box">{error}</div>;
  if (loading) return <p className="muted">جارٍ التحميل…</p>;
  const kids = data?.children ?? [];
  if (!kids.length) {
    return (
      <section className="card">
        <h3>لا أبناء مرتبطون بحسابك</h3>
        <p className="muted" style={{ margin: 0 }}>راجع إدارة المركز لربط أبنائك بحسابك.</p>
      </section>
    );
  }
  const current = kids.some((k) => k.id === picked) ? picked : kids[0].id;
  return (
    <>
      {kids.length > 1 && (
        <div className="tabs" role="tablist" aria-label="الأبناء">
          {kids.map((k) => (
            <button key={k.id} type="button" aria-pressed={k.id === current} onClick={() => setPicked(k.id)}>{k.name.split(" ")[0]}</button>
          ))}
        </div>
      )}
      <StudentPortal key={current} studentId={current} />
    </>
  );
}

function StaffHome() {
  const { user } = useMe();
  const manage = user.role === "admin" || user.role === "secretary";
  const stageManager = user.role === "stage_manager"; // §15.3: طلاب مرحلته وحضور معلّميها
  const students = useFetch<{ total: number }>("/api/students?pageSize=1");
  const circles = useFetch<{ circles: Circle[] }>("/api/circles");
  const staff = useFetch<{ staff: { role: string }[] }>(manage ? "/api/staff" : null);
  const activeCircles = circles.data?.circles.filter((c) => c.active).length;
  const teachers = staff.data?.staff.filter((s) => s.role === "teacher").length;
  const nStudents = students.data?.total;
  const loaded = teachers !== undefined && activeCircles !== undefined && nStudents !== undefined;
  const needsSetup = manage && loaded && (!teachers || !activeCircles || !nStudents);

  return (
    <>
      <div className="stats">
        <div className="card stat"><b>{nStudents ?? "—"}</b><small>{stageManager ? "طلاب مرحلتي" : "الطلاب"}</small></div>
        <div className="card stat"><b>{activeCircles ?? "—"}</b><small>الحلقات النشطة</small></div>
        {manage && <div className="card stat"><b>{teachers ?? "—"}</b><small>المعلّمون</small></div>}
      </div>

      {needsSetup && (
        <section className="card setup">
          <h2>ابدأ تجهيز المركز</h2>
          <p className="muted" style={{ margin: 0 }}>ثلاث خطوات ليصبح المركز جاهزاً للعمل:</p>
          <ol className="steps">
            <li className={teachers ? "done" : ""}><span>أضف المعلّمين والمعلّمات</span>{!teachers && <Link className="btn small" to="/app/staff?new=1">إضافة</Link>}</li>
            <li className={activeCircles ? "done" : ""}><span>أنشئ الحلقات وعيّن لكل حلقة معلّمها</span>{!activeCircles && <Link className="btn small" to="/app/circles?new=1">إضافة</Link>}</li>
            <li className={nStudents ? "done" : ""}><span>سجّل الطلاب في حلقاتهم</span>{!nStudents && <Link className="btn small" to="/app/students?new=1">إضافة</Link>}</li>
          </ol>
        </section>
      )}

      <h2 className="section-title">اختصارات</h2>
      <div className="tiles">
        {(manage || stageManager) && <Tile to="/app/students?new=1" icon={Icons.userPlus} title="إضافة طالب" sub="تسجيل طالب جديد وإنشاء حسابه" color="primary" />}
        {manage && <Tile to="/app/circles?new=1" icon={Icons.plus} title="إضافة حلقة" sub="حلقة جديدة بمعلّمها" />}
        {manage && <Tile to="/app/staff?new=1" icon={Icons.staff} title="إضافة معلّم" sub="حساب للمعلّم أو الكادر" color="teal" />}
        {(manage || stageManager) && <Tile to="/app/daily" icon={Icons.check} title="التسميع اليومي" sub="الحضور والتسميع" color="gold" />}
        {stageManager && <Tile to="/app/staff-attendance" icon={Icons.calendar} title="حضور المعلمين" sub="تسجيل حضور معلّمي مرحلتي" color="teal" />}
        <Tile to="/app/reports" icon={Icons.clipboard} title="الكشف الشهري" sub="الإنجاز مقابل الخطة" color="sky" />
        <Tile to="/app/tests" icon={Icons.award} title="الاختبارات" sub="التجريبية والرسمية" color="plum" />
        <Tile to="/app/sard" icon={Icons.mic} title="السرد" sub="سجلات السرد والدرجات" color="amber" />
        <Tile to="/app/insights" icon={Icons.chart} title="الإحصاءات" sub="رسوم وتقارير وتصدير" color="rose" />
        {manage && <Tile to="/app/announcements" icon={Icons.megaphone} title="رسالة للأهالي" sub="إعلان للطلاب أو الكادر" color="teal" />}
      </div>
    </>
  );
}

function TeacherHome() {
  const circles = useFetch<{ circles: Circle[] }>("/api/circles");
  const students = useFetch<{ total: number }>("/api/students?pageSize=1");
  // المعلّم قد يدرّس أكثر من حلقة (§15.5)
  const mine = circles.data?.circles ?? [];
  const circle = mine[0];
  return (
    <>
      <div className="card" style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <span className="tile" style={{ padding: 0, border: 0, boxShadow: "none", background: "none" }}><span className="ico">{Icons.circle}</span></span>
        <div style={{ flex: 1 }}>
          <h2>{circle ? (mine.length > 1 ? `${mine.length} حلقات` : circle.name) : "لم تُسنَد إليك حلقة بعد"}</h2>
          {mine.length > 1
            ? <p className="muted" style={{ margin: 0, fontSize: ".9rem" }}>{mine.map((x) => x.name).join(" · ")}</p>
            : circle && <p className="muted" style={{ margin: 0, fontSize: ".9rem" }}>{circle.primaryTeacherName ? `الأساسي: ${circle.primaryTeacherName}` : ""}{circle.assistantTeacherName ? ` · المساعد: ${circle.assistantTeacherName}` : ""}</p>}
        </div>
        <div className="stat" style={{ textAlign: "center" }}><b>{students.data?.total ?? "—"}</b><small>{mine.length > 1 ? "طلابي" : "طلاب حلقتي"}</small></div>
      </div>

      <h2 className="section-title">اختصارات</h2>
      <div className="tiles">
        <Tile to="/app/daily" icon={Icons.check} title="التسميع اليومي" sub="سجّل حضور وتسميع اليوم" color="primary" />
        <Tile to="/app/students?new=1" icon={Icons.userPlus} title="إضافة طالب" sub="إلى إحدى حلقاتي" />
        <Tile to="/app/sard" icon={Icons.mic} title="السرد" sub="تسجيل سرد جديد" color="amber" />
        <Tile to="/app/tests" icon={Icons.award} title="الاختبارات" sub="تجريبي أو اقتراح رسمي" color="plum" />
        <Tile to="/app/reports" icon={Icons.clipboard} title="الكشف الشهري" sub="إنجاز حلقاتي" color="sky" />
        <Tile to="/app/students" icon={Icons.users} title="طلابي" sub="بطاقات الطلاب" color="teal" />
      </div>

      <ScheduleCard />
    </>
  );
}
