// MBUMAH HARDWARE POS - Branch selector (v2.16.0 subdomain workspaces)
//
// /branches/select is for users assigned to MULTIPLE stores (typically the
// WAREHOUSE_MANAGER). Shows only assigned active stores with an
// "Open workspace" action that opens the branch in a NEW TAB; the selector
// tab stays available. A single-store member is redirected straight to their
// workspace; zero assignments get a clear empty state.

import type { Metadata } from 'next';
import { BranchSelector } from '@/components/workspace/branch-selector';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Select Branch | Mbumah Hardware POS',
};

export default function BranchSelectPage() {
  return <BranchSelector />;
}
