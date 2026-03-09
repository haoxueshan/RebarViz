import { Suspense } from 'react';
import { ShearWallPageClient } from './ShearWallPageClient';

export default function ShearWallPage() {
  return (
    <Suspense>
      <ShearWallPageClient />
    </Suspense>
  );
}
