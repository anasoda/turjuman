import { RELATION_LABELS, WA_PREFIXES, WA_PREFIX_LABELS, type GuardianRelation } from "@shared/constants";
import { Field } from "./ui";
import type { GuardianInput } from "../lib/types";

/** مقدمات الواتساب المسموحة: 970 و972 فقط (قرار المالك). */
export const COUNTRY_CODES: Array<[string, string]> = WA_PREFIXES.map((code) => [code, WA_PREFIX_LABELS[code]]);

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
        <Field label="رقم الاتصال"><input value={value.callPhone} onChange={(e) => set({ callPhone: e.target.value })} required inputMode="tel" pattern="05[96][0-9]{7}" title="يجب أن يبدأ بـ 059 أو 056 ويتكون من 10 خانات" dir="ltr" placeholder="0599876543" /></Field>
      </div>
      <div className="form-grid two">
        <CountryCodeField value={value.waCc} onChange={(waCc) => set({ waCc })} />
        <Field label="رقم الواتساب"><input value={value.waNational} onChange={(e) => set({ waNational: e.target.value })} required inputMode="tel" pattern="05[96][0-9]{7}" title="يجب أن يبدأ بـ 059 أو 056 ويتكون من 10 خانات" dir="ltr" placeholder="0599876543" /></Field>
      </div>
      <Field label="رقم هوية ولي الأمر" hint="اختياري الآن — وهو اسم المستخدم وكلمة المرور الأولية عند إنشاء حسابه">
        <input value={value.nationalId} onChange={(e) => set({ nationalId: e.target.value })} inputMode="numeric" pattern="[0-9]{9}" title="رقم الهوية يجب أن يتكون من 9 خانات" dir="ltr" maxLength={20} placeholder="9 أرقام" />
      </Field>
    </>
  );
}
