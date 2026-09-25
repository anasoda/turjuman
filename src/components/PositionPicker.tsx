import { SURAHS } from "@shared/quran-data";
import { ayahCount, type Position } from "@shared/quran";
import { Field } from "./ui";

/** اختيار موضع (سورة + آية). السور بترتيب المصحف؛ الآية ضمن عدد آيات السورة. */
export function PositionPicker({ label, value, onChange }: { label: string; value: Position; onChange: (p: Position) => void }) {
  const max = ayahCount(value.surah) || 286;
  return (
    <div className="form-grid two">
      <Field label={`${label} — السورة`}>
        <select value={value.surah} onChange={(e) => onChange({ surah: Number(e.target.value), ayah: 1 })}>
          {SURAHS.map((s, i) => <option key={s[0]} value={i + 1}>{i + 1}. {s[0]}</option>)}
        </select>
      </Field>
      <Field label={`${label} — الآية`} hint={`من 1 إلى ${max}`}>
        <input type="number" min={1} max={max} inputMode="numeric" value={value.ayah} onChange={(e) => onChange({ surah: value.surah, ayah: Math.max(1, Math.min(max, Number(e.target.value) || 1)) })} />
      </Field>
    </div>
  );
}
