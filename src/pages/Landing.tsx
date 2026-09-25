import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { centerQuery } from "../lib/api";
import { useFetch } from "../lib/hooks";
import type { CenterInfo } from "../lib/types";
import { PrayerCard } from "../components/PrayerCard";
import { Icons, StarRing } from "../components/ui";
import type { PrayerDay } from "@shared/prayer";

interface PublicStats { huffaz: number; circles: number; students: number; sardStudents: number; activeCourses: number }

export const LOGO_FALLBACK = "/brand/logo-512.webp";
export const CENTER_NAME = "مركز أبي بن كعب";
export const CENTER_SUB = "لتعليم وتحفيظ القرآن الكريم والسنة النبوية";

/** عدّاد يصعد من الصفر إلى القيمة عند الظهور. */
function CountUp({ to }: { to: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!to) return setN(0);
    const start = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / 1100);
      setN(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to]);
  return <>{n}</>;
}

const PROGRAMS: [string, string, React.ReactNode][] = [
  ["حفظ القرآن الكريم", "تسميع يومي بمتابعة المحفّظ، وخطة شهرية لكل طالب بحسب قدرته.", Icons.book],
  ["السرد والمراجعة", "سرد الأجزاء المحفوظة لتثبيتها، مع درجات تبيّن مستوى الإتقان.", Icons.mic],
  ["الاختبارات", "اختبارات تجريبية ورسمية تعتمدها لجنة الاختبارات في المركز.", Icons.award],
  ["دورات أحكام التجويد", "دورات لتعليم أحكام التلاوة وتحسين الأداء.", Icons.scroll]
];

/** الصفحة الترحيبية لمركز أبي بن كعب. */
export function Landing() {
  const center = useFetch<{ center: CenterInfo }>(`/api/public/center?${centerQuery()}`);
  const stats = useFetch<PublicStats>(`/api/public/stats?${centerQuery()}`);
  const prayer = useFetch<{ days: PrayerDay[] }>(`/api/public/prayer?${centerQuery()}`);

  const c = center.data?.center;
  const s = stats.data;
  const cards: [string, number, React.ReactNode][] = [
    ["طالب وطالبة", s?.students ?? 0, Icons.users],
    ["حافظ للقرآن", s?.huffaz ?? 0, Icons.award],
    ["حلقة تحفيظ", s?.circles ?? 0, Icons.circle],
    ["من الساردين", s?.sardStudents ?? 0, Icons.mic]
  ];
  const hasStats = cards.some(([, n]) => n > 0);
  const wa = c?.whatsapp.replace(/[^\d]/g, "");
  const name = c?.name || CENTER_NAME;
  const sub = c?.subtitle || CENTER_SUB;

  return (
    <div className="landing">
      <header className="hero">
        <span className="hero-orb" aria-hidden="true" />
        <div className="hero-bar">
          <span className="mini">{name}</span>
          <Link className="btn small light" to="/login">{Icons.login}دخول</Link>
        </div>
        <div className="hero-emblem">
          <span className="ring"><StarRing /></span>
          <div className="hero-logo"><img src={c?.logo || LOGO_FALLBACK} alt={name} /></div>
        </div>
        <h1>{name}</h1>
        <p className="sub">{sub}</p>
        <span className="hadith">«خيرُكم من تعلّم القرآنَ وعلّمه»</span>
        <div className="hero-cta">
          <Link className="btn gold" to="/login">{Icons.login}دخول الطلاب والكادر</Link>
          {(c?.phone || wa) && <a className="btn light" href="#contact">{Icons.chat}تواصل معنا</a>}
        </div>
      </header>

      <main className="landing-body">

        {prayer.data?.days.length ? <PrayerCard days={prayer.data.days} /> : null}

        {hasStats && (
          <section aria-label="إنجازات المركز" className="stat-grid">
            {cards.map(([label, n, icon]) => (
              <div className="card stat" key={label}>
                <span className="stat-ico" aria-hidden="true">{icon}</span>
                <b><CountUp to={n} /></b>
                <small>{label}</small>
              </div>
            ))}
          </section>
        )}

        <section aria-label="برامج المركز" style={{ display: "grid", gap: 14 }}>
          <h2 className="section-title">برامج المركز</h2>
          <div className="programs">
            {PROGRAMS.map(([title, text, icon]) => (
              <article className="program" key={title}>
                <span className="ico" aria-hidden="true">{icon}</span>
                <h3>{title}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </section>

        {(c?.phone || wa) && (
          <section id="contact" className="card contact" aria-label="التواصل">
            <h2>تواصل معنا</h2>
            <p className="muted" style={{ margin: 0 }}>للتسجيل والاستفسار عن الحلقات والبرامج</p>
            <div className="contact-actions">
              {wa && <a className="btn wa" href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer">{Icons.chat}واتساب</a>}
              {c?.phone && <a className="btn ghost" href={`tel:${c.phone.replace(/\s/g, "")}`}>{Icons.phone}<span dir="ltr">{c.phone}</span></a>}
            </div>
          </section>
        )}
      </main>
      <footer className="landing-foot">
        <b>{name}</b>
        <span>{sub}</span>
        <small style={{ opacity: 0.7 }}>© {new Date().getFullYear()}</small>
      </footer>
    </div>
  );
}
