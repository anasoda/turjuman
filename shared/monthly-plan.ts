/** الشهر الجاري، والشهر القادم من آخر خمسة أيام في الشهر السابق فقط. */
export function canEditMonthlyPlan(today: string, targetMonth: string): boolean {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(targetMonth) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return false;
  const currentMonth = today.slice(0, 7);
  if (targetMonth === currentMonth) return true;
  const year = Number(currentMonth.slice(0, 4));
  const month = Number(currentMonth.slice(5, 7));
  const nextMonth = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 7);
  if (targetMonth !== nextMonth) return false;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Number(today.slice(8, 10)) >= days - 4;
}
