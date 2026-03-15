import { AppShell } from '@/components/AppShell';

export default function RaftLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
