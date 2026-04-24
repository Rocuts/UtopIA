import type { Metadata } from 'next';

/**
 * Layout kept so the marketing header link `/dashboard` still resolves
 * through Next.js routing — the page itself is a redirect to `/workspace`.
 * Metadata is irrelevant (the redirect fires before rendering) but preserved
 * for crawler clarity while external links still exist.
 */
export const metadata: Metadata = {
  title: 'Redirigiendo… · 1+1',
  robots: { index: false, follow: false },
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
