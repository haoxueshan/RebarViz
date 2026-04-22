import { Suspense } from 'react';
import type { Metadata } from 'next';
import { RaftPageClient } from './RaftPageClient';

export const metadata: Metadata = {
  title: '筏板基础配筋 3D 可视化 | RebarViz',
  description: '筏板基础双向配筋、柱网插筋 3D 可视化，支持 JL、LPB、ZXB、KZB、BPB 等22G101-3筏形基础构造学习。',
  keywords: '筏板基础,筏形基础,JL,LPB,ZXB,KZB,BPB,22G101-3,筏板配筋',
};

export default function RaftPage() {
  return (
    <Suspense>
      <RaftPageClient />
    </Suspense>
  );
}
