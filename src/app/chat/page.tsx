// Global chat route (v2.16.0 subdomain workspaces)
//
// Dedicated /chat page: the GLOBAL organization channel plus the caller's
// workspace store threads, with branch origin badges on every message.
// Available from the org console, branch workspaces, and the branch selector.

import type { Metadata } from 'next';
import { GlobalChat } from '@/components/workspace/global-chat';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Global Chat | Mbumah Hardware POS',
};

export default function ChatPage() {
  return <GlobalChat />;
}
