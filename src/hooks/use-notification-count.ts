'use client';

import { useQuery } from '@tanstack/react-query';
import { notificationsApi } from '@/lib/api';
import { useNotificationReadState } from '@/lib/notification-read-state';

/** Hook to provide notification count globally — used by sidebar and top bar. */
export function useNotificationCount(storeId: string) {
  // Read/dismissed state is a shared external store (same source the
  // NotificationCenter writes to), so the badge recomputes the instant a
  // notification is read/dismissed in any tab — no waiting for this poll.
  const { readIds, dismissedIds } = useNotificationReadState();

  const { data } = useQuery({
    queryKey: ['notification-count', storeId],
    queryFn: async () => {
      const res = await notificationsApi.list(storeId);
      return Array.isArray(res.data) ? res.data : [];
    },
    refetchInterval: 60000, // Refresh every minute
  });

  const notifications = data || [];
  const active = notifications.filter((n) => !dismissedIds.has(n.id));
  const unread = active.filter((n) => !readIds.has(n.id));

  return {
    total: active.length,
    unread: unread.length,
    critical: unread.filter((n) => n.severity === 'critical').length,
    hasNew: unread.length > 0,
  };
}
