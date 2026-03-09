import type { Metadata } from 'next';
import { Suspense } from 'react';
import { StairPageClient } from './StairPageClient';

export const metadata: Metadata = {
  title: '楼梯平法识图 - 3D 配筋可视化 | RebarViz',
  description: '在线学习楼梯平法标注，3D可视化查看AT型板式楼梯配筋构造。支持自定义踏步尺寸和配筋参数。',
  keywords: '楼梯平法,AT型楼梯,板式楼梯,22G101-2,楼梯配筋,踏步,梯板,梯梁,支座',
};

export default function StairPage() {
  return (
    <Suspense>
      <StairPageClient />
    </Suspense>
  );
}
