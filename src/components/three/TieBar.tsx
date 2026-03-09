'use client';

import { useState, useMemo } from 'react';
import * as THREE from 'three';
import type { RebarMeshInfo } from '@/lib/types';
import { COLOR_TIEBAR, COLOR_TIEBAR_HI, REBAR_MATERIAL } from '@/lib/constants';

export interface TieBarMeshProps {
  position: [number, number, number];
  points: THREE.Vector3[];
  radius: number;
  info: RebarMeshInfo;
  selected: boolean;
  onSelect: (info: RebarMeshInfo | null) => void;
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
  onSelect,
}: TieBarMeshProps) {
  const [hovered, setHovered] = useState(false);
  const activeColor = selected ? COLOR_TIEBAR_HI : hovered ? COLOR_TIEBAR_HI : COLOR_TIEBAR;
  const scale = selected ? 1.3 : hovered ? 1.15 : 1;

  // Build a CurvePath from line segments to preserve sharp bends
  const curve = useMemo(() => {
    const path = new THREE.CurvePath<THREE.Vector3>();
    for (let i = 0; i < points.length - 1; i++) {
      path.add(new THREE.LineCurve3(points[i], points[i + 1]));
    }
    return path;
  }, [points]);

  return (
    <mesh
      position={position}
      scale={[scale, scale, scale]}
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
      <tubeGeometry args={[curve, 64, radius, 6, false]} />
      <meshStandardMaterial
        color={activeColor}
        roughness={REBAR_MATERIAL.roughness}
        metalness={REBAR_MATERIAL.metalness}
        emissive={selected ? COLOR_TIEBAR_HI : '#000000'}
        emissiveIntensity={selected ? 0.3 : 0}
      />
    </mesh>
  );
}
