import { useEffect, useState } from "react";
import { formatCountdown, nextPrayer, PRAYERS, toMinutes, type PrayerDay } from "@shared/prayer";

const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hebron", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
export function hebronNow(): { date: string; time: string } {
  const p = Object.fromEntries(fmt.formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

/** 12 ساعة بالعربية: 04:26 ← 4:26 ص، 18:54 ← 6:54 م (أوضح لأهل المركز من صيغة 24). */
function fmt12(hhmm: string): { time: string; suffix: string } {
  const [h, m] = hhmm.split(":").map(Number);
  return { time: `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")}`, suffix: h < 12 ? "ص" : "م" };
}

/** بطاقة الصلاة القادمة: عدّ تنازلي كبير + أوقات اليوم كلها (بتوقيت المركز). */
export function PrayerCard({ days }: { days: PrayerDay[] }) {
  const [now, setNow] = useState(hebronNow());
  useEffect(() => { const t = window.setInterval(() => setNow(hebronNow()), 20_000); return () => window.clearInterval(t); }, []);
  const today = days.find((d) => d.date === now.date);
  const next = nextPrayer(days, now.date, now.time);
  if (!today && !next) return null;
  // بعد العشاء تُعرض أوقات الغد (حيث الصلاة القادمة) بدل أوقات يوم انتهى
  const day = (next && days.find((d) => d.date === next.date)) || today;

  // نسبة ما مضى بين الصلاة السابقة والقادمة (لشريط التقدّم)
  let progress = 0;
  if (next && today) {
    const times = PRAYERS.map(([k]) => toMinutes(today[k]));
    const cur = toMinutes(now.time);
    const passed = times.filter((t) => t <= cur);
    const from = passed.length ? passed[passed.length - 1] : 0;
    const span = next.date === today.date ? toMinutes(next.time) - from : 1440 - from + toMinutes(next.time);
    progress = span > 0 ? Math.min(100, Math.round(((cur - from) / span) * 100)) : 0;
  }
  const n = next ? fmt12(next.time) : null;

  return (
    <section className="card prayer-card" aria-label="مواعيد الصلاة">
      {next && n ? (
        <div className="prayer-next">
          <div className="pn-label">
            <span className="dot" aria-hidden="true" />
            {next.date === now.date ? "الصلاة القادمة" : "صلاة الغد"}
          </div>
          <div className="pn-name">{next.label}</div>
          <div className="pn-time" dir="ltr">{n.time}<small>{n.suffix}</small></div>
          <div className="pn-left">بعد {formatCountdown(next.minutesLeft)}</div>
          <div className="pn-bar" aria-hidden="true"><i style={{ width: `${progress}%` }} /></div>
        </div>
      ) : (
        <div className="prayer-next"><div className="pn-name">انتهت صلوات اليوم</div></div>
      )}
      {day && (
        <div className="prayer-grid" aria-label={day.date === now.date ? "أوقات اليوم" : "أوقات الغد"}>
          {PRAYERS.map(([k, label]) => {
            const t = fmt12(day[k]);
            const isNow = !!next && next.date === day.date && next.key === k;
            const passed = day.date === now.date && toMinutes(day[k]) <= toMinutes(now.time) && !isNow;
            return (
              <div key={k} className={isNow ? "now" : passed ? "past" : ""}>
                <div className="pg-label">{label}</div>
                <div className="pg-time" dir="ltr">{t.time}<small>{t.suffix}</small></div>
              </div>
            );
          })}
        </div>
      )}
      {day && <div className="prayer-foot">{day.date === now.date ? "الشروق" : "شروق الغد"} <b dir="ltr">{fmt12(day.sunrise).time} {fmt12(day.sunrise).suffix}</b></div>}
    </section>
  );
}
