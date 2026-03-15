import type { Metadata } from 'next';
import { Suspense } from 'react';
import { FoundationPageClient } from './FoundationPageClient';

export const metadata: Metadata = {
  title: '独立基础识图 - 3D 配筋可视化 | RebarViz',
  description: '在线学习独立基础(DJ)平法标注，3D可视化查看底部双向配筋、柱插筋构造。支持阶形/锥形基础。',
  keywords: '独立基础,DJ,柱下独立基础,底部配筋,柱插筋,22G101-3,基础配筋图',
};

export default function FoundationPage() {
  return (
    <Suspense>
      <FoundationPageClient />
    </Suspense>
  );
}
