import type { Metadata } from 'next';
import { LandingPage } from '@/components/LandingPage';

export const metadata: Metadata = {
  title: '平法识图学习 | RebarViz',
  description: '基于 22G101 图集的钢筋平法识图与三维配筋可视化学习工具。',
};

export default function LearningPage() {
  return <LandingPage />;
}
