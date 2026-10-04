import { useEffect, useMemo, useState } from "react";
import { waHrefParts } from "@shared/phone";
import { fillTemplate, WA_TEMPLATES } from "@shared/whatsapp";
import { useMe } from "../lib/session";
import { Field, Icons, Sheet } from "./ui";

export interface TemplateStudent {
  name: string;
  circle?: string | null;
  memorized?: number | null;
  plan?: number | null;
  position?: string | null;
}

const dateFmt = new Intl.DateTimeFormat("ar-EG-u-nu-latn", { weekday: "long", day: "numeric", month: "long" });

/**
 * اختيار قالب رسالة لولي الأمر وتحريره قبل فتح واتساب (§14.2).
 * لا إرسال تلقائي: الزر رابط wa.me يفتح التطبيق بالنص جاهزاً ويرسله الكادر بنفسه.
 */
export function WhatsAppSheet({ cc, national, guardian, students, onClose }: {
  cc: string;
  national: string;
  guardian: string;
  students: TemplateStudent[];
  onClose: () => void;
}) {
  const { center } = useMe();
  const [studentIdx, setStudentIdx] = useState(0);
  const [key, setKey] = useState(WA_TEMPLATES[0].key);
  const student = students[studentIdx] ?? students[0];
  const date = useMemo(() => dateFmt.format(new Date()), []);
  const base = useMemo(() => {
    const tpl = WA_TEMPLATES.find((t) => t.key === key) ?? WA_TEMPLATES[0];
    return fillTemplate(tpl.body, { student: student.name, guardian, center: center.name, circle: student.circle, date, memorized: student.memorized, plan: student.plan, position: student.position });
  }, [key, student, guardian, center.name, date]);
  const [text, setText] = useState(base);
  // تغيير القالب أو الطالب يعيد بناء النص؛ والتحرير اليدوي يبقى حتى ذلك
  useEffect(() => setText(base), [base]);
  const href = text.trim() ? waHrefParts(cc || "970", national, text) : "";

  return (
    <Sheet title={`رسالة إلى ${guardian}`} onClose={onClose}>
      <div className="tabs" role="group" aria-label="القالب">
        {WA_TEMPLATES.map((t) => <button key={t.key} type="button" aria-pressed={t.key === key} onClick={() => setKey(t.key)}>{t.label}</button>)}
      </div>
      {students.length > 1 && (
        <Field label="الطالب">
          <select value={studentIdx} onChange={(e) => setStudentIdx(Number(e.target.value))}>
            {students.map((s, i) => <option key={s.name + i} value={i}>{s.name}</option>)}
          </select>
        </Field>
      )}
      <Field label="نص الرسالة" hint="عدّل النص كما تشاء قبل الفتح">
        <textarea rows={9} value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      <div className="actions">
        {href
          ? <a className="btn wa" href={href} target="_blank" rel="noopener noreferrer" onClick={onClose}>{Icons.chat}فتح واتساب</a>
          : <button className="btn wa" type="button" disabled>{Icons.chat}فتح واتساب</button>}
        <button className="btn ghost" type="button" onClick={onClose}>إلغاء</button>
      </div>
    </Sheet>
  );
}
