import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "./api";

/** يجلب مساراً عند التحميل ويوفّر reload. لا كاش؛ الترقيم والبحث بتغيير المسار. */
export function useFetch<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(!!path);

  const load = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      setData(await api<T>(path));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "حدث خطأ");
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, error, loading, reload: load };
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

export const initials = (name: string) => name.trim().charAt(0) || "؟";

/** يفتح نموذج الإضافة مباشرة عند الوصول برابط ‎?new=1‎ (من اختصارات الرئيسية)، ثم يحذف المعامل من الرابط. */
export function useWantsNew(): boolean {
  const [params, setParams] = useSearchParams();
  const [wants] = useState(() => params.has("new"));
  useEffect(() => {
    if (!params.has("new")) return;
    params.delete("new");
    setParams(params, { replace: true });
  }, [params, setParams]);
  return wants;
}
