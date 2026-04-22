import { AppShell } from '@/components/AppShell';

export default function StripFoundationLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
