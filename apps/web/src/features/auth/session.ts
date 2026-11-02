import { useQuery } from '@tanstack/react-query';
import { api, ApiError, type User } from '../../lib/api';

export const sessionKey = ['session'] as const;

export function useSession() {
  return useQuery({
    queryKey: sessionKey,
    queryFn: async () => {
      try { return (await api<{ user: User }>('/auth/me')).user; }
      catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    staleTime: 30_000,
    retry: false
  });
}
