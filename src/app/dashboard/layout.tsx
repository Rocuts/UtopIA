import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Dashboard | UtopIA',
  description: 'Panel de control de consultas contables y tributarias - UtopIA',
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
