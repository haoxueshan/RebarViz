import type { Metadata } from 'next';
import { Suspense } from 'react';
import { StripFoundationPageClient } from './StripFoundationPageClient';

export const metadata: Metadata = {
  title: '条形基础识图 - 3D 配筋可视化 | RebarViz',
  description: '在线学习条形基础(TJ)平法标注，3D可视化查看底板 B/T 配筋、分布筋以及单梁/双梁或单墙/双墙条基构造。',
  keywords: '条形基础,TJ,TJBj,TJBp,基础梁,双梁条基,双墙条基,22G101-3,条基配筋图',
};

export default function StripFoundationPage() {
  return (
    <Suspense>
      <StripFoundationPageClient />
    </Suspense>
  );
}
