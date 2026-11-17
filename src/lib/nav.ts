import { useCallback, useMemo } from "react";
import { useLocation, useRouter } from "@tanstack/react-router";

/** Navigate by plain path string (e.g. "/history?id=1"). */
export function useNavigate() {
  const router = useRouter();
  // دالة ثابتة بين الـ renders، حتى لا تُعيد useEffect تشغيل نفسها بلا نهاية
  return useCallback((href: string) => router.navigate({ href }), [router]);
}

export function useSearchParams(): [URLSearchParams] {
  const searchStr = useLocation({ select: (l) => l.searchStr });
  return [useMemo(() => new URLSearchParams(searchStr), [searchStr])];
}
