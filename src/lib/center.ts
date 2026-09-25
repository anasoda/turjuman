// الموقع مخصص لمركز واحد: مركز أبي بن كعب. المعرّف ثابت في البناء (VITE_CENTER_ID)،
// وفي التطوير المحلي يُضبط في .env.development على مركز البيانات التجريبية.
const centerId: string = (import.meta.env.VITE_CENTER_ID as string | undefined)?.trim() || "obai-01";
export const getCenterId = (): string => centerId;
