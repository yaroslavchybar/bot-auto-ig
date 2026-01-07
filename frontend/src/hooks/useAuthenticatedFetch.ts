import { useAuth } from '@clerk/clerk-react';
import { useCallback, useEffect } from 'react';
import { setTokenGetter } from '@/lib/api';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export function useAuthenticatedFetch() {
    const { getToken } = useAuth();

    // Set up the token getter for apiFetch
    useEffect(() => {
        setTokenGetter(getToken);
        return () => {
            setTokenGetter(() => Promise.resolve(null));
        };
    }, [getToken]);

    const authFetch = useCallback(async <T>(
        endpoint: string,
        options: RequestInit = {}
    ): Promise<T> => {
        const token = await getToken();

        const headers: HeadersInit = {
            'Content-Type': 'application/json',
            ...(options.headers || {}),
        };

        if (token) {
            (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
        }

        const url = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint}`;
        const response = await fetch(url, {
            ...options,
            headers,
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Request failed' }));
            throw new Error(error.error || `HTTP ${response.status}`);
        }

        return response.json();
    }, [getToken]);

    return authFetch;
}
