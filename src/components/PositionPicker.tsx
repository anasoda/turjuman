import { useState } from "react";
import { SURAHS } from "@shared/quran-data";
import { ayahCount, type Position } from "@shared/quran";
import { Icons } from "./ui";

/** تطبيع للبحث: يزيل التشكيل ويوحّد الألف والياء والتاء المربوطة. */
const norm = (s: string) =>
  s.replace(/[ً-ٰٟـ]/g, "").replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").trim();

const ALL = SURAHS.map((s, i) => ({ name: s[0], no: i + 1, key: norm(s[0]) }));

/** اختيار موضع (سورة + آية) في صف واحد: وسم «من/إلى» ثم السورة ثم الآية. زر البحث يعرض نتائج بالاسم (أو الرقم) تُختار بلمسة؛ الآية من قائمة بعدد آيات السورة. */
export function PositionPicker({ label, value, onChange, disabled = false }: { label: string; value: Position; onChange: (p: Position) => void; disabled?: boolean }) {
  const max = ayahCount(value.surah) || 286;
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const q = norm(query);
  const matches = q ? ALL.filter((s) => s.key.includes(q) || String(s.no) === q) : [];
  const ayahs = Array.from({ length: max }, (_, i) => i + 1);

  const closeSearch = () => { setSearching(false); setQuery(""); };
  const pick = (surah: number) => { onChange({ surah, ayah: 1 }); closeSearch(); };

  return (
    <div className="pos-picker">
      <div className="pos-row">
        <span className="pos-tag">{label}</span>
        <select value={value.surah} disabled={disabled} onChange={(e) => pick(Number(e.target.value))} aria-label={`${label} — السورة`}>
          {ALL.map((s) => <option key={s.no} value={s.no}>{s.no}. {s.name}</option>)}
        </select>
        <select className="pos-ayah" value={value.ayah} disabled={disabled} onChange={(e) => onChange({ surah: value.surah, ayah: Number(e.target.value) })} aria-label={`${label} — الآية (من 1 إلى ${max})`}>
          {ayahs.map((n) => <option key={n} value={n}>آية {n}</option>)}
        </select>
        <button type="button" className={`pos-search-btn${searching ? " on" : ""}`} disabled={disabled} aria-label="بحث عن سورة بالاسم" aria-pressed={searching} onClick={() => (searching ? closeSearch() : setSearching(true))}>{Icons.search}</button>
      </div>
      {searching && (
        <>
          <input
            className="pos-search" type="search" autoFocus placeholder="اكتب اسم السورة أو رقمها…" value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (matches[0]) pick(matches[0].no); } else if (e.key === "Escape") { e.stopPropagation(); closeSearch(); } }}
            aria-label={`${label} — بحث عن سورة`}
          />
          {q && (
            <div className="pos-results" role="listbox" aria-label="نتائج البحث">
              {matches.length ? matches.map((s) => (
                <button key={s.no} type="button" role="option" aria-selected={s.no === value.surah} className="pos-result" onClick={() => pick(s.no)}>{s.no}. {s.name}</button>
              )) : <span className="muted pos-none">لا توجد سورة بهذا الاسم</span>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
