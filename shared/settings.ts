// إعدادات المركز الافتراضية. يعدّلها المدير من شاشة الإعدادات.

export interface Level {
  key: string;
  label: string;
}
export interface SardBand {
  min: number;
  label: string;
}
export interface ExamQuestionSlot {
  label: string;
  maxScore: number;
  isQuranic: boolean;
}

export interface CenterSettings {
  /** أقصى عدد طلاب في الحلقة */
  maxStudentsPerCircle: number;
  /** مستويات الحلقات (يعدّل المدير أسماءها) */
  levels: Level[];
  /** درجة السرد تبدأ من هذه القيمة ويُخصم منها */
  sardStartScore: number;
  sardDeductMistake: number;
  sardDeductAlert: number;
  /** تقسيمة الدرجات: تُفحص من الأعلى إلى الأدنى، أول حدّ min ≤ الدرجة يُختار */
  sardBands: SardBand[];
  /** أدنى علامة نجاح للاختبار */
  minPassScore: number;
  /** مقياس تقييم التسميع اليومي */
  recitationGrades: string[];
  /** يوم فتح الكشف الشهري للمعلّم */
  monthlyReportOpenDay: number;
  /** تعديل التاريخ الهجري المعروض بالأيام (−2..+2) ليطابق تقويم البلد بدل أم القرى */
  hijriOffset: number;
  /** مقدمة الدولة لأرقام الجوال (بلا +): تُستعمل لروابط الاتصال والواتساب */
  phonePrefix: string;
  /** توزيع درجات الاختبار الرسمي — المجموع يجب أن يساوي 100 */
  examQuestionSlots: ExamQuestionSlot[];
}

export const DEFAULT_SETTINGS: CenterSettings = {
  maxStudentsPerCircle: 15,
  levels: [
    { key: "talqeen", label: "تلقين" },
    { key: "primary", label: "ابتدائي" },
    { key: "prep_secondary", label: "إعدادي / ثانوي" }
  ],
  sardStartScore: 100,
  sardDeductMistake: 1,
  sardDeductAlert: 0.5,
  sardBands: [
    { min: 95, label: "ممتاز جداً" },
    { min: 90, label: "ممتاز" },
    { min: 85, label: "جيد جداً" },
    { min: 80, label: "جيد" },
    { min: 70, label: "مقبول" },
    { min: 0, label: "إعادة" }
  ],
  minPassScore: 70,
  recitationGrades: ["ممتاز", "جيد جداً", "جيد", "مقبول", "إعادة"],
  monthlyReportOpenDay: 24,
  hijriOffset: 0,
  phonePrefix: "970",
  examQuestionSlots: [
    { label: "السؤال الأول", maxScore: 20, isQuranic: true },
    { label: "السؤال الثاني", maxScore: 20, isQuranic: true },
    { label: "السؤال الثالث", maxScore: 20, isQuranic: true },
    { label: "السؤال الرابع", maxScore: 20, isQuranic: true },
    { label: "أحكام التجويد", maxScore: 20, isQuranic: false },
  ]
};
