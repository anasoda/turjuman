// أرقام الجوال: تطبيع الرقم وبناء روابط الاتصال والواتساب.
// «مقدمة الواتس» = مقدمة الدولة (إعداد المركز `phonePrefix`، افتراضياً 970 لفلسطين).

/** يحوّل الأرقام العربية/الفارسية إلى لاتينية. */
export const latinDigits = (s: string): string =>
  s.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));

/** أرقام الرقم فقط بعد تحويل الأرقام العربية وإسقاط الفراغات والرموز. */
export const phoneDigits = (raw: string): string => latinDigits(String(raw ?? "")).replace(/[^\d]/g, "");

/**
 * الرقم بصيغة دولية بلا «+» ولا أصفار بادئة، جاهز لـ wa.me.
 * 0591234567 + مقدمة 970 → 970591234567 · 00970591234567 → 970591234567 · 970591234567 يبقى كما هو.
 * يعيد "" إن كان الرقم أقصر من 7 خانات (غير صالح).
 */
export function intlPhone(raw: string, prefix: string): string {
  let d = phoneDigits(raw);
  const p = phoneDigits(prefix);
  if (!d) return "";
  if (d.startsWith("00")) d = d.slice(2);
  const body = p && d.startsWith(p) && d.length > p.length ? d.slice(p.length) : d.replace(/^0+/, "");
  if (body.length < 7 || body.length > 15) return "";
  return p ? p + body : body;
}

/** الرقم كما يُكتب محلياً للعرض (بلا مقدمة الدولة): 970591234567 → 0591234567 */
export function localPhone(raw: string, prefix: string): string {
  const d = intlPhone(raw, prefix);
  const p = phoneDigits(prefix);
  if (!d) return phoneDigits(raw);
  return `0${p && d.startsWith(p) ? d.slice(p.length) : d}`;
}

export const telHref = (raw: string, prefix: string): string => {
  const d = intlPhone(raw, prefix);
  return d ? `tel:+${d}` : "";
};

export const waHref = (raw: string, prefix: string, text = ""): string => {
  const d = intlPhone(raw, prefix);
  if (!d) return "";
  return `https://wa.me/${d}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
};

/** للتحقق من الإدخال: يُقبل الفراغ (اختياري) أو رقم من 7 خانات على الأقل. */
export const isPhoneish = (raw: string): boolean => {
  const d = phoneDigits(raw);
  return d.length === 0 || (d.length >= 7 && d.length <= 15);
};

/**
 * صيغة الرقم الدولية من جزأين (مقدمة + وطني) — تخزين §14.1 من requirements.
 * cc="970"  national="0591234567"  → "970591234567"
 * cc="+970" national="591234567"   → "970591234567"
 * تُعيد "" إذا كان الوطني أقل من 7 خانات أو أكثر من 15.
 */
export function intlFromParts(cc: string, national: string): string {
  const p = phoneDigits(cc);
  const n = phoneDigits(national).replace(/^0+/, "");
  if (!n || n.length < 7 || n.length > 15) return "";
  return p + n;
}

export const telHrefParts = (cc: string, national: string): string => {
  const d = intlFromParts(cc, national);
  return d ? `tel:+${d}` : "";
};

export const waHrefParts = (cc: string, national: string, text = ""): string => {
  const d = intlFromParts(cc, national);
  if (!d) return "";
  return `https://wa.me/${d}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
};
