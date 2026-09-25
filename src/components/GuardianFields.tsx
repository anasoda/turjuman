import { RELATION_LABELS, type GuardianRelation } from "@shared/constants";
import { Field } from "./ui";
import type { GuardianInput } from "../lib/types";

export const COUNTRY_CODES: Array<[string, string]> = [
  ["970", "+970 فلسطين"],
  ["962", "+962 الأردن"],
  ["20", "+20 مصر"],
  ["966", "+966 السعودية"],
  ["971", "+971 الإمارات"],
  ["90", "+90 تركيا"]
];

export const emptyGuardian = (): GuardianInput => ({ name: "", relation: "father", callPhone: "", waCc: "970", waNational: "", nationalId: "" });

/** اختيار مقدمة الدولة — تُستعمل لأرقام الواتساب في كل الشاشات. */
export function CountryCodeField({ value, onChange, label = "مقدمة الواتساب" }: { value: string; onChange: (v: string) => void; label?: string }) {
  return (
    <Field label={label}>
      <select value={value || "970"} onChange={(e) => onChange(e.target.value)}>
        {COUNTRY_CODES.map(([code, text]) => <option key={code} value={code}>{text}</option>)}
      </select>
    </Field>
  );
}

/**
 * حقول ولي الأمر الإجبارية (§15.7): الاسم، الصفة، رقم الاتصال، رقم الواتساب ومقدمته.
 * رقم الهوية اختياري لكنه **اسم المستخدم** إن أُنشئ له حساب لاحقاً (§15.8).
 */
export function GuardianFields({ value, onChange }: { value: GuardianInput; onChange: (g: GuardianInput) => void }) {
  const set = (patch: Partial<GuardianInput>) => onChange({ ...value, ...patch });
  return (
    <>
      <Field label="اسم ولي الأمر"><input value={value.name} onChange={(e) => set({ name: e.target.value })} required minLength={3} maxLength={100} /></Field>
      <div className="form-grid two">
        <Field label="صلة القرابة">
          <select value={value.relation} onChange={(e) => set({ relation: e.target.value as GuardianRelation })}>
            {(Object.keys(RELATION_LABELS) as GuardianRelation[]).map((r) => <option key={r} value={r}>{RELATION_LABELS[r]}</option>)}
          </select>
        </Field>
        <Field label="رقم الاتصال"><input value={value.callPhone} onChange={(e) => set({ callPhone: e.target.value })} required inputMode="tel" dir="ltr" placeholder="0599876543" /></Field>
      </div>
      <div className="form-grid two">
        <CountryCodeField value={value.waCc} onChange={(waCc) => set({ waCc })} />
        <Field label="رقم الواتساب"><input value={value.waNational} onChange={(e) => set({ waNational: e.target.value })} required inputMode="tel" dir="ltr" placeholder="0599876543" /></Field>
      </div>
      <Field label="رقم هوية ولي الأمر" hint="اختياري الآن — وهو اسم المستخدم وكلمة المرور الأولية عند إنشاء حسابه">
        <input value={value.nationalId} onChange={(e) => set({ nationalId: e.target.value })} inputMode="numeric" dir="ltr" maxLength={20} placeholder="9 أرقام" />
      </Field>
    </>
  );
}
