import { useState } from "react";
import { SURAHS } from "@shared/quran-data";
import { ayahCount, type Position } from "@shared/quran";
import { Field } from "./ui";

/** تطبيع للبحث: يزيل التشكيل ويوحّد الألف والياء والتاء المربوطة. */
const norm = (s: string) =>
  s.replace(/[ً-ٰٟـ]/g, "").replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").trim();

/** اختيار موضع (سورة + آية). السور بترتيب المصحف مع بحث بالاسم؛ الآية تُختار من قائمة بعدد آيات السورة. */
export function PositionPicker({ label, value, onChange, disabled = false }: { label: string; value: Position; onChange: (p: Position) => void; disabled?: boolean }) {
  const max = ayahCount(value.surah) || 286;
  const [query, setQuery] = useState("");
  const q = norm(query);
  const surahs = SURAHS.map((s, i) => ({ name: s[0], no: i + 1 })).filter((s) => !q || s.no === value.surah || norm(s.name).includes(q) || String(s.no) === q);
  const ayahs = Array.from({ length: max }, (_, i) => i + 1);

  return (
    <div className="form-grid two">
      <div className="field">
        <span>{label} — السورة</span>
        <input type="search" placeholder="ابحث عن سورة بالاسم…" value={query} disabled={disabled} onChange={(e) => setQuery(e.target.value)} aria-label={`${label} — بحث عن سورة`} />
        <select value={value.surah} disabled={disabled} onChange={(e) => { onChange({ surah: Number(e.target.value), ayah: 1 }); setQuery(""); }} aria-label={`${label} — السورة`}>
          {surahs.map((s) => <option key={s.no} value={s.no}>{s.no}. {s.name}</option>)}
        </select>
      </div>
      <Field label={`${label} — الآية`} hint={`من 1 إلى ${max}`}>
        <select value={value.ayah} disabled={disabled} onChange={(e) => onChange({ surah: value.surah, ayah: Number(e.target.value) })}>
          {ayahs.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </Field>
    </div>
  );
}
