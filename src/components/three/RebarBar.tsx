'use client';

import { useMemo, useState, useCallback } from 'react';
import { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { RebarMeshInfo } from '@/lib/types';
import { S, REBAR_MATERIAL, REBAR_SEGMENTS } from '@/lib/constants';

// ─── Shared geometry cache: same (diameter, length) → single CylinderGeometry ───
const geoCache = new Map<string, THREE.CylinderGeometry>();

function getCachedGeo(radius: number, length: number): THREE.CylinderGeometry {
  // Round to 6 decimals to avoid floating-point key collisions
  const key = `${radius.toFixed(6)}_${length.toFixed(6)}`;
  let geo = geoCache.get(key);
  if (!geo) {
    geo = new THREE.CylinderGeometry(radius, radius, length, REBAR_SEGMENTS);
    geoCache.set(key, geo);
  }
  return geo;
}

export interface RebarBarProps {
  position: [number, number, number];
  length: number;
  diameter: number;
  color: string;
  hiColor: string;
  info: RebarMeshInfo;
  selected: boolean;
  onSelect: (info: RebarMeshInfo | null) => void;
  renderOrder?: number;
}

/**
 * 可交互的钢筋圆柱体
 * 支持悬停高亮、点击选中
 */
export function RebarBar({
  position,
  length,
  diameter,
  color,
  hiColor,
  info,
  selected,
  onSelect,
  renderOrder = 1,
}: RebarBarProps) {
  const [hovered, setHovered] = useState(false);

  const handleClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      onSelect(selected ? null : info);
    },
    [selected, info, onSelect],
  );

  const activeColor = selected ? hiColor : hovered ? hiColor : color;
  const scale = selected ? 1.3 : hovered ? 1.15 : 1;

  const geometry = useMemo(
    () => getCachedGeo((diameter * S) / 2, length),
    [diameter, length],
  );

  return (
    <mesh
      position={position}
      rotation={[0, 0, Math.PI / 2]}
      renderOrder={renderOrder}
      onClick={handleClick}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={() => {
        setHovered(false);
        document.body.style.cursor = 'auto';
      }}
      scale={[scale, 1, scale]}
    >
      <primitive object={geometry} attach="geometry" />
      <meshStandardMaterial
        color={activeColor}
        roughness={REBAR_MATERIAL.roughness}
        metalness={REBAR_MATERIAL.metalness}
        emissive={selected ? hiColor : '#000000'}
        emissiveIntensity={selected ? 0.3 : 0}
      />
    </mesh>
  );
}

export interface SlopedRebarBarProps {
  start: [number, number, number];
  end: [number, number, number];
  diameter: number;
  color: string;
  hiColor: string;
  info: RebarMeshInfo;
  selected: boolean;
  onSelect: (info: RebarMeshInfo | null) => void;
}

/**
 * 斜向钢筋（用于加腋附加筋等）
 */
export function SlopedRebarBar({
  start,
  end,
  diameter,
  color,
  hiColor,
  info,
  selected,
  onSelect,
}: SlopedRebarBarProps) {
  const [hovered, setHovered] = useState(false);

  const { midPos, length, rotation } = useMemo(() => {
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const dz = end[2] - start[2];
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const mid: [number, number, number] = [
      (start[0] + end[0]) / 2,
      (start[1] + end[1]) / 2,
      (start[2] + end[2]) / 2,
    ];
    const angle = Math.atan2(dy, dx);
    return {
      midPos: mid,
      length: len,
      rotation: [0, 0, angle - Math.PI / 2] as [number, number, number],
    };
  }, [start, end]);

  const activeColor = selected ? hiColor : hovered ? hiColor : color;
  const scale = selected ? 1.3 : hovered ? 1.15 : 1;

  return (
    <mesh
      position={midPos}
      rotation={rotation}
      renderOrder={2}
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
      scale={[scale, 1, scale]}
    >
      <primitive object={getCachedGeo((diameter * S) / 2, length)} attach="geometry" />
      <meshStandardMaterial
        color={activeColor}
        roughness={REBAR_MATERIAL.roughness}
        metalness={REBAR_MATERIAL.metalness}
        emissive={selected ? hiColor : '#000000'}
        emissiveIntensity={selected ? 0.3 : 0}
      />
    </mesh>
  );
}
