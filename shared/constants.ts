// ثوابت مشتركة بين الواجهة والخادم.

// 'guardian' و'stage_manager' دوران فعليان يُشتقّان في loadAuth ولا يُخزَّنان في users.role
// (قيد CHECK في D1 لا يُوسَّع — انظر رأس migrations/0004 و0008).
export const ROLES = ["admin", "secretary", "teacher", "stage_manager", "exam_committee", "student", "guardian"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: "مدير المركز",
  secretary: "سكرتير",
  teacher: "معلّم",
  stage_manager: "مدير مرحلة",
  exam_committee: "لجنة الاختبار",
  student: "طالب",
  guardian: "ولي أمر"
};

/** أدوار الكادر التي ينشئها المدير */
export const STAFF_ROLES = ["secretary", "teacher", "stage_manager", "exam_committee"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/** الدور المخزَّن في users.role لكل دور كادر (مدير المرحلة يُخزَّن معلّماً — §15.3). */
export const STORED_ROLE: Record<StaffRole, "secretary" | "teacher" | "exam_committee"> = {
  secretary: "secretary",
  teacher: "teacher",
  stage_manager: "teacher",
  exam_committee: "exam_committee"
};

export type Gender = "male" | "female";
export const GENDER_LABELS: Record<Gender, string> = { male: "ذكر", female: "أنثى" };
export const CATEGORY_LABELS: Record<Gender, string> = { male: "ذكور", female: "إناث" };

/** descending: من الناس إلى الفاتحة — ascending: من الفاتحة إلى الناس */
export type Direction = "descending" | "ascending";
export const DIRECTION_LABELS: Record<Direction, string> = {
  descending: "من الناس إلى الفاتحة",
  ascending: "من الفاتحة إلى الناس"
};

export const AJKAM_COURSES = ["نورانية", "تمهيدية", "تأهيلية", "عليا", "تأهيل سند", "سند"] as const;
export const QUALIFICATIONS = ["ثانوية عامة", "بكالوريوس", "ماجستير", "دكتوراه"] as const;

export const USERNAME_RE = /^[^\s]{3,64}$/u;
export const MIN_PASSWORD = 8;
export const GUARDIAN_RELATIONS = ["father", "mother", "other"] as const;
export type GuardianRelation = (typeof GUARDIAN_RELATIONS)[number];
export const RELATION_LABELS: Record<GuardianRelation, string> = { father: "الأب", mother: "الأم", other: "قريب" };

export const NATIONAL_ID_RE = /^[0-9]{9}$/;
export const PHONE_RE = /^05[96][0-9]{7}$/;

/** مواعيد الحلقة بالصلوات (§15.6) — '' يعني موعداً بالساعات. */
export const PRAYER_SLOTS = ["fajr", "dhuhr", "asr", "maghrib", "isha"] as const;
export type PrayerSlot = (typeof PRAYER_SLOTS)[number];
export const SLOT_LABELS: Record<PrayerSlot, string> = {
  fajr: "فجراً", dhuhr: "ظهراً", asr: "عصراً", maghrib: "مغرباً", isha: "عشاءً"
};
