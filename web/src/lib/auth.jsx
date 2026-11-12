import { createContext, useContext, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api.js';

export const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const queryClient = useQueryClient();
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => api('/auth/me').catch((err) => {
      if (err.status === 401) return null;
      throw err;
    }),
    retry: false,
    staleTime: 60_000,
  });

  useEffect(() => {
    const signedOut = () => queryClient.setQueryData(['me'], null);
    window.addEventListener('falcon:unauthorized', signedOut);
    return () => window.removeEventListener('falcon:unauthorized', signedOut);
  }, [queryClient]);

  const value = useMemo(() => {
    const data = me.data || null;
    const permissions = data?.permissions || [];
    return {
      status: me.isPending ? 'loading' : data ? 'authenticated' : 'anonymous',
      error: me.error,
      user: data?.user || null,
      projects: data?.projects || [],
      assistantName: data?.assistantName || 'DIVA',
      can: (permission) => permissions.includes(permission),
      async login(email, password) {
        const next = await api('/auth/login', { method: 'POST', body: { email, password } });
        queryClient.setQueryData(['me'], next);
        return next;
      },
      async logout() {
        await api('/auth/logout', { method: 'POST' }).catch(() => {});
        // Keep the observed ['me'] query alive (removing it would orphan the
        // useQuery observer, leaving it stuck on the signed-in data).
        queryClient.setQueryData(['me'], null);
        queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
      },
      refresh: () => queryClient.invalidateQueries({ queryKey: ['me'] }),
    };
  }, [me.data, me.isPending, me.error, queryClient]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
