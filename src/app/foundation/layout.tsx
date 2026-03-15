import { AppShell } from '@/components/AppShell';

export default function FoundationLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
