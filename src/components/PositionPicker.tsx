import { useState } from "react";
import { SURAHS } from "@shared/quran-data";
import { ayahCount, type Position } from "@shared/quran";
import { Icons } from "./ui";

/** تطبيع للبحث: يزيل التشكيل ويوحّد الألف والياء والتاء المربوطة. */
const norm = (s: string) =>
  s.replace(/[ً-ٰٟـ]/g, "").replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").trim();

/** اختيار موضع (سورة + آية) في صف واحد: وسم «من/إلى» ثم السورة ثم الآية. السور بترتيب المصحف مع بحث بالاسم؛ الآية من قائمة بعدد آيات السورة. */
export function PositionPicker({ label, value, onChange, disabled = false }: { label: string; value: Position; onChange: (p: Position) => void; disabled?: boolean }) {
  const max = ayahCount(value.surah) || 286;
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const q = norm(query);
  const surahs = SURAHS.map((s, i) => ({ name: s[0], no: i + 1 })).filter((s) => !q || s.no === value.surah || norm(s.name).includes(q) || String(s.no) === q);
  const ayahs = Array.from({ length: max }, (_, i) => i + 1);

  return (
    <div className="pos-picker">
      <div className="pos-row">
        <span className="pos-tag">{label}</span>
        <select value={value.surah} disabled={disabled} onChange={(e) => { onChange({ surah: Number(e.target.value), ayah: 1 }); setQuery(""); }} aria-label={`${label} — السورة`}>
          {surahs.map((s) => <option key={s.no} value={s.no}>{s.no}. {s.name}</option>)}
        </select>
        <select className="pos-ayah" value={value.ayah} disabled={disabled} onChange={(e) => onChange({ surah: value.surah, ayah: Number(e.target.value) })} aria-label={`${label} — الآية (من 1 إلى ${max})`}>
          {ayahs.map((n) => <option key={n} value={n}>آية {n}</option>)}
        </select>
        <button type="button" className={`pos-search-btn${searching ? " on" : ""}`} disabled={disabled} aria-label="بحث عن سورة بالاسم" aria-pressed={searching} onClick={() => { setSearching((v) => !v); setQuery(""); }}>{Icons.search}</button>
      </div>
      {searching && (
        <input className="pos-search" type="search" autoFocus placeholder="اكتب اسم السورة…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label={`${label} — بحث عن سورة`} />
      )}
    </div>
  );
}
