import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Dashboard · 1+1',
  description: 'Panel de control de consultas contables y tributarias — 1+1, Directorio Ejecutivo Digital.',
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
