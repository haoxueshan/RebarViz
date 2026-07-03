'use client';

import { useState, useMemo } from 'react';
import * as THREE from 'three';
import type { RebarMeshInfo, RebarRenderMode } from '@/lib/types';
import { COLOR_TIEBAR, COLOR_TIEBAR_HI, REBAR_MATERIAL } from '@/lib/constants';

const MIN_HIT_RADIUS = 0.045;

export interface TieBarMeshProps {
  position: [number, number, number];
  points: THREE.Vector3[];
  radius: number;
  info: RebarMeshInfo;
  selected: boolean;
  highlighted?: boolean;
  onSelect: (info: RebarMeshInfo | null) => void;
  renderMode?: RebarRenderMode;
}

/**
 * 可点击的拉筋管状网格
 */
export function TieBarMesh({
  position,
  points,
  radius,
  info,
  selected,
  highlighted = false,
  onSelect,
  renderMode = 'solid',
}: TieBarMeshProps) {
  const [hovered, setHovered] = useState(false);
  const active = selected || hovered || highlighted;
  const prominent = selected || hovered;
  const activeColor = active ? COLOR_TIEBAR_HI : COLOR_TIEBAR;
  const scale = selected ? 1.1 : hovered ? 1.06 : highlighted ? 1.03 : 1;
  const emissiveIntensity = selected ? 0.3 : highlighted ? 0.16 : 0;
  const hitRadius = Math.max(radius * 5, MIN_HIT_RADIUS);
  const showFullSolid = prominent && (renderMode === 'solid' || renderMode === 'hybrid');
  const showSubduedSolid = !prominent && renderMode === 'solid';
  const showCenterline = renderMode === 'centerline' || (!prominent && renderMode === 'hybrid');
  const lineGeometry = useMemo(() => new THREE.BufferGeometry().setFromPoints(points), [points]);

  const curve = useMemo(() => {
    const path = new THREE.CurvePath<THREE.Vector3>();
    points.slice(0, -1).forEach((start, i) => {
      const end = points[i + 1];
      const dir = new THREE.Vector3().subVectors(end, start);
      if (dir.length() > 1e-6) {
        path.add(new THREE.LineCurve3(start, end));
      }
    });
    return path.curves.length > 0 ? path : null;
  }, [points]);

  return (
    <group
      position={position}
      scale={scale}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(selected ? null : info);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={() => {
        setHovered(false);
        document.body.style.cursor = 'auto';
      }}
    >
      {curve && (
        <>
          {showFullSolid && (
            <mesh>
              <tubeGeometry args={[curve, 96, radius, 8, false]} />
              <meshStandardMaterial
                color={activeColor}
                roughness={REBAR_MATERIAL.roughness}
                metalness={REBAR_MATERIAL.metalness}
                emissive={selected || highlighted ? COLOR_TIEBAR_HI : '#000000'}
                emissiveIntensity={emissiveIntensity}
              />
            </mesh>
          )}
          {showSubduedSolid && (
            <mesh>
              <tubeGeometry args={[curve, 48, radius * 0.68, 6, false]} />
              <meshStandardMaterial
                color={activeColor}
                roughness={REBAR_MATERIAL.roughness}
                metalness={REBAR_MATERIAL.metalness}
                transparent
                opacity={0.86}
              />
            </mesh>
          )}
          {showCenterline && (
            <lineSegments geometry={lineGeometry}>
              <lineBasicMaterial color={activeColor} transparent opacity={selected || highlighted ? 0.95 : 0.58} />
            </lineSegments>
          )}
          <mesh>
            <tubeGeometry args={[curve, 64, hitRadius, 6, false]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
        </>
      )}
    </group>
  );
}
