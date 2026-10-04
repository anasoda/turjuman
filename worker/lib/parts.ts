import type { Direction } from "../../shared/constants";
import { completedJuz } from "../../shared/quran";

// قرار المالك (2026-09-24): «المحفوظ» للطالب يُحسب دائماً من آخر موضع حفظه واتجاهه،
// ولا يُعتمد العمود اليدوي students.memorized_parts (يبقى في القاعدة للتوافق فقط).
interface PosRow { direction: Direction | string; lastSurah: number; lastAyah: number }

export const partsOf = (r: PosRow): number => completedJuz(r.direction as Direction, { surah: r.lastSurah, ayah: r.lastAyah });

/** الحافظ: أتمّ الأجزاء الثلاثين من موضع حفظه واتجاهه (لا من الرقم اليدوي القديم). */
export const isHafiz = (r: PosRow): boolean => partsOf(r) >= 30;

export const withParts = <T extends PosRow>(r: T): T & { memorizedParts: number } => ({ ...r, memorizedParts: partsOf(r) });
