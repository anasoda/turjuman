// قوالب رسائل واتساب لولي الأمر (§14.2). النص قابل للتحرير قبل الفتح، ولا إرسال تلقائي: الفتح عبر wa.me فقط.

export interface TemplateVars {
  student: string;
  guardian: string;
  center: string;
  circle?: string | null;
  /** تاريخ اليوم بصيغة مقروءة */
  date: string;
  /** عدد الأجزاء المحفوظة (يُحسب من الموضع) */
  memorized?: number | null;
  /** خطة الحفظ لهذا الشهر بالصفحات */
  plan?: number | null;
  /** آخر موضع حفظ مكتوباً، مثل «سورة النبأ — آية 12» */
  position?: string | null;
}

export interface WaTemplate {
  key: string;
  label: string;
  body: string;
}

const GREETING = "السلام عليكم ورحمة الله وبركاته،\nأخي الكريم {guardian}،";
const SIGNATURE = "مع الشكر، {center}";

/** سطر فيه متغيّر اختياري غير متوفر يُحذف كاملاً (فلا يظهر «الحلقة: » فارغاً). */
export const WA_TEMPLATES: WaTemplate[] = [
  {
    key: "contact",
    label: "طلب تواصل",
    body: `${GREETING}\nنرجو التواصل معنا بخصوص الطالب {student}{circle_in}.\nوقت مناسب لكم لنتحدث؟\n${SIGNATURE}`
  },
  {
    key: "absence",
    label: "غياب",
    body: `${GREETING}\nنفيدكم بغياب الطالب {student}{circle_in} اليوم {date}.\nنرجو الاطمئنان عليه وإبلاغنا بسبب الغياب.\n${SIGNATURE}`
  },
  {
    key: "praise",
    label: "إشادة بتقدم",
    body: `${GREETING}\nيسرّنا إبلاغكم بتقدّم الطالب {student}{circle_in} في حفظه ومراجعته، وبارك الله فيه وفيكم.\nنسأل الله أن يزيده علماً وتوفيقاً.\n${SIGNATURE}`
  },
  {
    key: "summary",
    label: "ملخص متابعة",
    body: `${GREETING}\nملخص متابعة الطالب {student}{circle_in} حتى {date}:\n• الأجزاء المحفوظة: {memorized} من 30\n• آخر موضع حفظ: {position}\n• خطة هذا الشهر: {plan} صفحة\nنسأل الله له التوفيق.\n${SIGNATURE}`
  }
];

/**
 * يُدرج المتغيّرات في القالب. `{circle_in}` يصير « في حلقة X» أو يختفي إن لم تتوفر الحلقة.
 * سطر فيه متغيّر معروف بلا قيمة يُحذف؛ وما ليس متغيّراً معروفاً يبقى كما كُتب.
 */
export function fillTemplate(body: string, v: TemplateVars): string {
  const values: Record<string, string | null> = {
    student: v.student,
    guardian: v.guardian,
    center: v.center,
    date: v.date,
    circle_in: v.circle ? ` في ${v.circle.startsWith("حلقة") ? v.circle : `حلقة ${v.circle}`}` : "",
    memorized: v.memorized == null ? null : String(v.memorized),
    plan: v.plan == null ? null : String(v.plan),
    position: v.position || null
  };
  const out: string[] = [];
  for (const line of body.split("\n")) {
    let drop = false;
    const text = line.replace(/\{(\w+)\}/g, (whole, key: string) => {
      if (!(key in values)) return whole;
      const val = values[key];
      if (val === null) { drop = true; return ""; }
      return val;
    });
    if (!drop) out.push(text);
  }
  return out.join("\n");
}
