import type { Metadata } from 'next';
import { AdminConsole } from '@/components/admin/AdminConsole';

// Panel administrativo separado del workspace. NO indexar.
export const metadata: Metadata = {
  title: 'Consola de Actividad · Admin',
  robots: { index: false, follow: false, nocache: true },
};

export default function AdminPage() {
  return <AdminConsole />;
}
