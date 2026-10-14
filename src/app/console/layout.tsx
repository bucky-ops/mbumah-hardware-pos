import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Organization Console | Mbumah Hardware POS',
  description:
    'Expert Information System console: org KPIs, Store Intelligence Matrix, 9 domain expert modules, decision support, activity and global chat.',
  robots: { index: false, follow: false },
};

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return children;
}
