// قاعدة نقل الطلاب بين الحلقات (قرار المالك) — منطق نقي يشاركه الخادم والواجهة.
// يُرتَّب النقل من اليوم 25 حتى نهاية الشهر ويسري من أول الشهر التالي. خارج هذه النافذة يستطيع مدير المركز وحده
// النقل الفوري بسبب مكتوب. سجلات ما قبل النقل تبقى منسوبة للحلقة القديمة (انظر worker/lib/transfers.ts).

export const TRANSFER_ARRANGE_FROM_DAY = 25;

export function firstOfNextMonth(today: string): string {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

export type TransferPlan =
  | { kind: "arranged"; effectiveFrom: string }
  | { kind: "immediate"; effectiveFrom: string }
  | { kind: "denied"; status: 400 | 403; message: string };

/** قاعدة النقل لطالب له حلقة حالية. `role` هو الدور الفعلي (admin/secretary/stage_manager). */
export function planTransfer(today: string, role: string, reason: string): TransferPlan {
  const day = Number(today.slice(8, 10));
  if (day >= TRANSFER_ARRANGE_FROM_DAY) return { kind: "arranged", effectiveFrom: firstOfNextMonth(today) };
  if (role !== "admin") {
    return { kind: "denied", status: 403, message: `يُرتَّب نقل الطلاب من اليوم ${TRANSFER_ARRANGE_FROM_DAY} حتى نهاية الشهر ويسري من أول الشهر التالي. للنقل قبل ذلك راجع مدير المركز.` };
  }
  if (reason.trim().length < 3) {
    return { kind: "denied", status: 400, message: `النقل قبل اليوم ${TRANSFER_ARRANGE_FROM_DAY} استثناء: اكتب سبباً واضحاً (3 أحرف على الأقل)` };
  }
  return { kind: "immediate", effectiveFrom: today };
}
