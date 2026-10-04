import { useState } from "react";
import { createPortal } from "react-dom";
import { telHrefParts, waHrefParts, intlFromParts } from "@shared/phone";
import { useMe } from "../lib/session";
import { Icons } from "./ui";
import { WhatsAppSheet, type TemplateStudent } from "./WhatsAppSheet";

const displayLocal = (cc: string, national: string): string => {
  const d = intlFromParts(cc || "970", national);
  return d ? `0${d.slice((cc || "970").replace(/\D/g, "").length)}` : "";
};

interface ContactProps {
  /** رقم الواتساب ومقدمته */
  cc: string;
  national: string;
  /** رقم الاتصال المحلي إن كان منفصلاً عن الواتساب (§15.2) — بلا مقدمة مستقلة، تُستعمل مقدمة الواتساب/الافتراضية */
  callNational?: string;
  label: string;
  subject?: string;
  /** لولي الأمر: يفتح الواتساب نافذة اختيار قالب (غياب، إشادة…) بدل الرابط المباشر (§14.2) */
  templates?: { guardian: string; students: TemplateStudent[] };
}

/**
 * زرّا الاتصال والواتساب لشخص واحد (§15.2).
 * الاتصال يستعمل `callNational` إن وُجد وإلا رقم الواتساب؛ والواتساب دائماً برقمه ومقدمته.
 */
export function ContactIcons({ cc, national, callNational, label, subject, templates }: ContactProps) {
  const { center } = useMe();
  const [picking, setPicking] = useState(false);
  const waCc = cc || "970";
  const tel = telHrefParts(waCc, callNational || national);
  const wa = waHrefParts(waCc, national || callNational || "", `السلام عليكم، ${subject ? `${subject} — ` : ""}${center.name}`);
  if (!tel && !wa) return null;
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <span className="contact" onClick={stop}>
      {tel && (
        <a className="contact-btn call" href={tel} onClick={stop} aria-label={`اتصال بـ ${label}`} title={`اتصال: ${displayLocal(waCc, callNational || national)}`}>
          {Icons.phone}
        </a>
      )}
      {wa && templates?.students.length ? (
        <button type="button" className="contact-btn wa" aria-label={`رسالة واتساب إلى ${label}`} title={`واتساب: ${displayLocal(waCc, national || callNational || "")}`}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setPicking(true); }}>
          {Icons.chat}
        </button>
      ) : wa && (
        <a className="contact-btn wa" href={wa} target="_blank" rel="noopener noreferrer" onClick={stop} aria-label={`واتساب ${label}`} title={`واتساب: ${displayLocal(waCc, national || callNational || "")}`}>
          {Icons.chat}
        </a>
      )}
      {picking && templates && createPortal(
        <WhatsAppSheet cc={waCc} national={national || callNational || ""} guardian={templates.guardian} students={templates.students} onClose={() => setPicking(false)} />,
        document.body
      )}
    </span>
  );
}

/** سطر رقم + أيقونتاه (في بطاقة التفاصيل). */
export function ContactRow({ cc, national, callNational, label, title, subject, templates }: ContactProps & { title: string }) {
  if (!national && !callNational) return null;
  return (
    <div className="contact-row">
      <span className="grow">
        <b>{title}</b>
        <small dir="ltr">{displayLocal(cc || "970", callNational || national)}</small>
        {callNational && national && callNational !== national && <small dir="ltr">واتساب: {displayLocal(cc || "970", national)}</small>}
      </span>
      <ContactIcons cc={cc} national={national} callNational={callNational} label={label} subject={subject} templates={templates} />
    </div>
  );
}
