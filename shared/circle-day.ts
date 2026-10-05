// متابعة الحلقات في يوم معيّن: حالة الحلقة من الجدول والإلغاء وعدد السجلات. دالة نقية بلا قاعدة بيانات.

export type CircleDayStatus = "cancelled" | "off" | "empty" | "none" | "partial" | "complete";

export function circleDayStatus(i: { cancelled: boolean; scheduledDay: boolean | null; students: number; recorded: number }): CircleDayStatus {
  if (i.cancelled) return "cancelled";
  // يوم خارج جدول الحلقة بلا أي تسجيل ليس تقصيراً؛ وإن سُجّلت فيه متابعة فهو حصة إضافية تُعدّ عادية
  if (i.scheduledDay === false && i.recorded === 0) return "off";
  if (i.students === 0 && i.recorded === 0) return "empty";
  if (i.recorded === 0) return "none";
  return i.recorded < i.students ? "partial" : "complete";
}

/** الحالات التي يصحّ فيها تنبيه المعلّم: لم يُسجَّل شيء أو سُجّل بعض الطلاب فقط. */
export const needsReminder = (status: CircleDayStatus): boolean => status === "none" || status === "partial";
