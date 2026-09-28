import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError, clearLocalData, SESSION_EXPIRED_EVENT, setApiUser, startSync } from "./api";
import { getCenterId } from "./center";
import type { MeResponse } from "./types";

interface SessionValue {
  me: MeResponse | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
}

const Ctx = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const data = await api<MeResponse>("/api/auth/me");
      // جلسة مركز آخر لا تُستعمل في هذا المركز
      const mine = data.center.id === getCenterId() ? data : null;
      if (mine) { setApiUser(mine.user.id); startSync(mine.user.role); }
      setMe(mine);
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    const expire = () => setMe(null);
    window.addEventListener(SESSION_EXPIRED_EVENT, expire);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, expire);
  }, [reload]);

  const login = useCallback(
    async (username: string, password: string) => {
      await api("/api/auth/login", { method: "POST", body: { centerId: getCenterId(), username: username.trim(), password } });
      await reload();
    },
    [reload]
  );

  const logout = useCallback(async () => {
    try {
      await api("/api/auth/logout", { method: "POST", body: {} });
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
    }
    await clearLocalData();
    setMe(null);
  }, []);

  const value = useMemo(() => ({ me, loading, login, logout, reload }), [me, loading, login, logout, reload]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession خارج SessionProvider");
  return v;
}

/** المستخدم المسجَّل (للصفحات المحمية فقط). */
export function useMe(): MeResponse {
  const { me } = useSession();
  if (!me) throw new Error("لا توجد جلسة");
  return me;
}
