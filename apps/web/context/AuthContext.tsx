"use client";

/**
 * AuthContext
 *
 * 역할:
 *  - 로그인 유저 정보(UserPublic) 전역 관리
 *  - 토큰 저장/삭제
 *  - 앱 시작 시 GET /me로 세션 복구
 *  - login(), logout() 함수 제공
 *
 * 사용 예:
 *   const { user, login, logout, loading } = useAuth()
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  loginApi,
  getMe,
  setTokens,
  clearTokens,
  getToken,
} from "@/lib/api";
import type { UserPublic } from "@/types";

// ─── Context 타입 ─────────────────────────────────────────

interface AuthContextValue {
  user: UserPublic | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>; // 프로필 업데이트 후 재조회용
}

const AuthContext = createContext<AuthContextValue | null>(null);

// ─── Provider ────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<UserPublic | null>(null);
  const [loading, setLoading] = useState(true);

  // 앱 마운트 시 토큰 있으면 /me로 세션 복구
  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    getMe()
      .then(setUser)
      .catch(() => {
        // 토큰 만료됐지만 refresh도 실패한 경우 → api.ts에서 이미 clearTokens 처리
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const tokens = await loginApi(email, password);
    setTokens(tokens.access_token, tokens.refresh_token);
    const me = await getMe();
    setUser(me);
  }, []);

  const logout = useCallback(() => {
    clearTokens();
    setUser(null);
    router.push("/login");
  }, [router]);

  const refreshUser = useCallback(async () => {
    const me = await getMe();
    setUser(me);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
