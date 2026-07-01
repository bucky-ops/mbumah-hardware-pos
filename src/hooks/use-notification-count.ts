'use client';

import { useQuery } from '@tanstack/react-query';
import { notificationsApi } from '@/lib/api';

/** Hook to provide notification count globally — used by sidebar and top bar. */
export function useNotificationCount(storeId: string) {
  const { data } = useQuery({
    queryKey: ['notification-count', storeId],
    queryFn: async () => {
      const res = await notificationsApi.list(storeId);
      return Array.isArray(res.data) ? res.data : [];
    },
    refetchInterval: 60000, // Refresh every minute
    select: (notifications) => {
      const stored = localStorage.getItem('mbt_read_notifications');
      const storedDismissed = localStorage.getItem('mbt_dismissed_notifications');
      const readIds: Set<string> = stored ? new Set(JSON.parse(stored)) : new Set();
      const dismissedIds: Set<string> = storedDismissed ? new Set(JSON.parse(storedDismissed)) : new Set();
      const active = notifications.filter((n) => !dismissedIds.has(n.id));
      const unread = active.filter((n) => !readIds.has(n.id));
      return {
        total: active.length,
        unread: unread.length,
        critical: unread.filter((n) => n.severity === 'critical').length,
        hasNew: unread.length > 0,
      };
    },
  });
  return data || { total: 0, unread: 0, critical: 0, hasNew: false };
}
