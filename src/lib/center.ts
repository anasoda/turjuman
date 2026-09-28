// الموقع مخصص لمركز واحد: مركز أبي بن كعب. المعرّف `obai-01` هو نفسه في الإنتاج وبذرة التطوير،
// ويمكن تجاوزه عند البناء بـ VITE_CENTER_ID عند الحاجة فقط.
const centerId: string = (import.meta.env.VITE_CENTER_ID as string | undefined)?.trim() || "obai-01";
export const getCenterId = (): string => centerId;
