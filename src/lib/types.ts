import type { Direction, Gender, GuardianRelation, Role } from "@shared/constants";
import type { CenterSettings } from "@shared/settings";

export interface CenterInfo {
  id: string;
  name: string;
  subtitle: string;
  logo: string;
  phone: string;
  whatsapp: string;
}

export interface MeResponse {
  user: { id: string; role: Role; displayName: string; username: string; studentId: string | null };
  center: CenterInfo;
  settings: CenterSettings;
}

export interface Circle {
  id: string;
  name: string;
  category: Gender;
  levelKey: string;
  active: boolean;
  studentCount: number;
  primaryTeacherId: string | null;
  primaryTeacherName: string | null;
  assistantTeacherId: string | null;
  assistantTeacherName: string | null;
}

export interface Student {
  id: string;
  userId: string | null;
  nationalId: string;
  name: string;
  birth: string;
  gender: Gender;
  circleId: string | null;
  circleName: string | null;
  direction: Direction;
  memorizedParts: number;
  reviewSurah: number | null;
  reviewAyah: number | null;
  lastSurah: number;
  lastAyah: number;
  ajkamCourse: string;
  monthlyPlanPages: number;
  monthlyReviewPlanPages: number;
  phoneCc: string;
  phoneNational: string;
  guardianId: string | null;
  joinedAt: string | null;
  archivedAt: number | null;
  archiveReason: string;
  username: string | null;
  accountActive: boolean;
  hasPhoto: boolean;
  honorConsent: boolean;
  /** تأتي في ملف الطالب الفردي فقط (لا في القوائم) */
  photo?: string;
  /** أولياء الأمر أصحاب الحسابات المرتبطة بالطالب (في ملفه الفردي فقط) */
  guardians?: StudentGuardian[];
  /** نقل مرتَّب لم يسرِ بعد (في ملفه الفردي فقط) */
  pendingTransfer?: { toCircleId: string; toCircleName: string; effectiveFrom: string } | null;
}

/** ولي الأمر كيان مستقل عن الحساب (§15.7): id ثابت، و userId فارغ إن لم يُنشأ حساب بعد. */
export interface Guardian {
  id: string;
  userId: string | null;
  username: string | null;
  hasAccount: boolean;
  active: boolean;
  name: string;
  relation: GuardianRelation;
  nationalId: string | null;
  /** رقم الاتصال المحلي (بلا مقدمة مستقلة) */
  callPhone: string;
  /** رقم الواتساب ومقدمته */
  waCc: string;
  waNational: string;
  children: Array<{ id: string; name: string; circleName: string | null; archived: boolean }>;
}

/** ولي أمر الطالب كما يأتي داخل ملفه الفردي (بلا قائمة الأبناء). */
export type StudentGuardian = Omit<Guardian, "children">;

/** بيانات ولي أمر جديد تُرسَل مع الطالب (§15.7) — كلها إجبارية إلا الهوية. */
export interface GuardianInput {
  name: string;
  relation: GuardianRelation;
  callPhone: string;
  waCc: string;
  waNational: string;
  nationalId: string;
}

export interface GuardianChild {
  id: string;
  name: string;
  circleName: string | null;
  memorizedParts: number;
}

export interface AppNotification {
  id: string;
  kind: string;
  title: string;
  body: string;
  link: string;
  createdAt: number;
  readAt: number | null;
}

export interface Staff {
  id: string;
  role: Role;
  username: string;
  displayName: string;
  active: boolean;
  nationalId: string | null;
  /** رقم الاتصال المحلي (0599…) — بلا مقدمة دولة مستقلة (§15.2) */
  phone: string | null;
  /** رقم الواتساب المستقل ومقدمته؛ فارغ = استعمل رقم الاتصال */
  waCc: string;
  waNational: string;
  birth: string | null;
  gender: Gender | null;
  email: string | null;
  address: string | null;
  qualification: string | null;
  ajkamCourse: string | null;
  memorizedParts: number | null;
  /** مفاتيح مراحل مدير المرحلة (§15.3) — فارغة لبقية الأدوار */
  stages: string[];
  /** حلقات المعلّم — قد تكون أكثر من واحدة بعد هجرة 0009 (§15.5) */
  circles: Array<{ id: string; name: string; kind: "primary" | "assistant" }>;
}
