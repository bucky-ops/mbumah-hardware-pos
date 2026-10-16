// Organization console route (v2.16.0 subdomain workspaces)
//
// /org/dashboard is the root-domain console for SUPER_ADMIN, STORE_OWNER and
// ACCOUNTANT (read-only financial view). Branch workspaces open in NEW TABS
// (target=_blank rel=noopener noreferrer) so the console stays available.

import type { Metadata } from 'next';
import { OrgConsole } from '@/components/workspace/org-console';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Organization Console | Mbumah Hardware POS',
};

export default function OrgDashboardPage() {
  return <OrgConsole />;
}
