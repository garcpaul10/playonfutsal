import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";

const API = "/api";

export function useIsRegistered(type: "league" | "tournament", id: number) {
  const { getToken, isSignedIn } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["is-registered", type, id],
    queryFn: async () => {
      const token = await getToken();
      const r = await fetch(`${API}/${type}s/${id}/is-registered`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!r.ok) return { isRegistered: false };
      return r.json() as Promise<{ isRegistered: boolean }>;
    },
    enabled: !!id,
    staleTime: 60_000,
  });

  return {
    isRegistered: data?.isRegistered ?? false,
    isLoading,
  };
}
