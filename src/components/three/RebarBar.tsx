'use client';

import { useMemo, useState, useCallback } from 'react';
import { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { RebarMeshInfo, RebarRenderMode } from '@/lib/types';
import { S, REBAR_MATERIAL, REBAR_SEGMENTS } from '@/lib/constants';

// ─── Shared geometry cache: same (diameter, length) → single CylinderGeometry ───
const geoCache = new Map<string, THREE.CylinderGeometry>();
const MIN_HIT_RADIUS = 0.055;

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
  highlighted?: boolean;
  renderMode?: RebarRenderMode;
  activeScale?: number;
  highlightScale?: number;
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
  highlighted = false,
  renderMode = 'solid',
  activeScale = 1.3,
  highlightScale = 1.08,
}: RebarBarProps) {
  const [hovered, setHovered] = useState(false);

  const handleClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      onSelect(selected ? null : info);
    },
    [selected, info, onSelect],
  );

  const activeColor = selected ? hiColor : hovered ? hiColor : highlighted ? hiColor : color;
  const scale = selected ? activeScale : hovered ? Math.min(activeScale, 1.15) : highlighted ? highlightScale : 1;
  const showSolid = renderMode === 'solid' || (renderMode === 'hybrid' && (selected || hovered || highlighted));
  const showCenterline = renderMode === 'centerline' || !showSolid;

  const geometry = useMemo(
    () => getCachedGeo((diameter * S) / 2, length),
    [diameter, length],
  );
  const hitGeometry = useMemo(
    () => getCachedGeo(Math.max((diameter * S) * 2.5, MIN_HIT_RADIUS), length),
    [diameter, length],
  );
  const lineGeometry = useMemo(
    () => new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, -length / 2, 0),
      new THREE.Vector3(0, length / 2, 0),
    ]),
    [length],
  );

  return (
    <group
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
    >
      {showSolid && (
        <mesh scale={[scale, 1, scale]}>
          <primitive object={geometry} attach="geometry" />
          <meshStandardMaterial
            color={activeColor}
            roughness={REBAR_MATERIAL.roughness}
            metalness={REBAR_MATERIAL.metalness}
            emissive={selected || highlighted ? hiColor : '#000000'}
            emissiveIntensity={selected ? 0.3 : highlighted ? 0.16 : 0}
          />
        </mesh>
      )}
      {showCenterline && (
        <lineSegments geometry={lineGeometry}>
          <lineBasicMaterial color={activeColor} transparent opacity={selected || highlighted ? 0.95 : 0.58} />
        </lineSegments>
      )}
      <mesh>
        <primitive object={hitGeometry} attach="geometry" />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
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
  renderMode?: RebarRenderMode;
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
  renderMode = 'solid',
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
  const showSolid = renderMode === 'solid' || (renderMode === 'hybrid' && (selected || hovered));
  const showCenterline = renderMode === 'centerline' || !showSolid;
  const hitGeometry = useMemo(
    () => getCachedGeo(Math.max((diameter * S) * 2.5, MIN_HIT_RADIUS), length),
    [diameter, length],
  );
  const lineGeometry = useMemo(
    () => new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, -length / 2, 0),
      new THREE.Vector3(0, length / 2, 0),
    ]),
    [length],
  );

  return (
    <group
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
    >
      {showSolid && (
        <mesh scale={[scale, 1, scale]}>
          <primitive object={getCachedGeo((diameter * S) / 2, length)} attach="geometry" />
          <meshStandardMaterial
            color={activeColor}
            roughness={REBAR_MATERIAL.roughness}
            metalness={REBAR_MATERIAL.metalness}
            emissive={selected ? hiColor : '#000000'}
            emissiveIntensity={selected ? 0.3 : 0}
          />
        </mesh>
      )}
      {showCenterline && (
        <lineSegments geometry={lineGeometry}>
          <lineBasicMaterial color={activeColor} transparent opacity={selected ? 0.95 : 0.58} />
        </lineSegments>
      )}
      <mesh>
        <primitive object={hitGeometry} attach="geometry" />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}
