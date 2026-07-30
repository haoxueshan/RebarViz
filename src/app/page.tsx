import type { Metadata } from 'next';
import { HomePortal } from '@/components/HomePortal';

export const metadata: Metadata = {
  title: '钢筋工程工具箱 | RebarViz',
  description: '选择进入钢筋计算器或平法识图学习。',
};

export default function Home() {
  return <HomePortal />;
}
