// Branch workspace route (v2.16.0 subdomain workspaces)
//
//   /stores/juja-main/dashboard        (path mode)
//   /stores/juja-main/pos              (path mode, nested)
//   juja-main.mbumah.test/dashboard    (subdomain mode: the proxy rewrites
//                                       internally to /stores/juja-main/...)
//
// The catch-all [[...rest]] accepts every in-workspace page so the SPA shell
// can render any tab under the workspace URL. Authorization happens in the
// gateway + /api/me/store-context; this server component only resolves the
// display metadata (page title per spec: "{Store Name} | Mbumah Hardware POS").

import type { Metadata } from 'next';
import { db } from '@/lib/db';
import { WorkspaceGateway } from '@/components/workspace/workspace-gateway';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ slug: string; rest?: string[] }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  try {
    const store = await db.store.findFirst({
      where: { OR: [{ slug }, { subdomain: slug }] },
      select: { name: true },
    });
    if (store) {
      return { title: `${store.name} | Mbumah Hardware POS` };
    }
  } catch {
    // DB unavailable at build/request time: fall through to the generic title.
  }
  return { title: 'Mbumah Hardware POS' };
}

export default async function StoreWorkspacePage({ params }: PageProps) {
  const { slug } = await params;
  return <WorkspaceGateway slug={slug.toLowerCase()} />;
}
