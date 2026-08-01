'use client';

/**
 * Analytics Tab — wraps the AnalyticsDashboard component in the tab system.
 * Reads the current storeId from the app store and passes it through.
 */

import React from 'react';

import { useAppStore } from '@/lib/stores';
import { AnalyticsDashboard } from '@/components/analytics/analytics-dashboard';
import { Card, CardContent } from '@/components/ui/card';
import { Lock } from 'lucide-react';

export default function AnalyticsTab() {
  const currentStoreId = useAppStore((s) => s.currentStoreId);

  if (!currentStoreId) {
    return (
      <Card>
        <CardContent className="p-8 flex flex-col items-center justify-center gap-2 text-center">
          <Lock className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm font-medium">No store selected</p>
          <p className="text-xs text-muted-foreground">
            Choose a store from the sidebar to view analytics.
          </p>
        </CardContent>
      </Card>
    );
  }

  return <AnalyticsDashboard storeId={currentStoreId} />;
}
