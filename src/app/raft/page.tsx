import { Suspense } from 'react';
import type { Metadata } from 'next';
import { RaftPageClient } from './RaftPageClient';

export const metadata: Metadata = {
  title: '筏板基础配筋 3D 可视化 | RebarViz',
  description: '筏板基础双向配筋、柱网插筋 3D 可视化，符合 22G101-3 图集规范',
};

export default function RaftPage() {
  return (
    <Suspense>
      <RaftPageClient />
    </Suspense>
  );
}
