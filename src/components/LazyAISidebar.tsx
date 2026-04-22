'use client';

import dynamic from 'next/dynamic';
import type { AISidebarProps } from './AISidebar';

export const LazyAISidebar = dynamic<AISidebarProps>(
  () => import('./AISidebar').then((mod) => mod.AISidebar),
  {
    ssr: false,
  },
);
