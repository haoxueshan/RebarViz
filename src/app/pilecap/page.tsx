import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PileCapPageClient } from './PileCapPageClient';

export const metadata: Metadata = {
  title: '承台识图 - 3D 配筋可视化 | RebarViz',
  description: '在线学习承台(CT)平法标注，3D可视化查看桩基排布、底部双向配筋、柱插筋构造。',
  keywords: '承台,CT,桩基承台,桩基础,底部配筋,柱插筋,22G101-3,承台配筋图',
};

export default function PileCapPage() {
  return (
    <Suspense>
      <PileCapPageClient />
    </Suspense>
  );
}
