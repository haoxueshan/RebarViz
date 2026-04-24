'use client';

import { useMemo, useState, useCallback } from 'react';
import { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { RebarMeshInfo } from '@/lib/types';
import { S, REBAR_MATERIAL } from '@/lib/constants';

export interface BentRebarEndProps {
  position: [number, number, number];
  straightLen: number;
  bendLen: number;
  diameter: number;
  direction: 'down' | 'up';
  horizontalAxis?: 'x' | 'z';
  color: string;
  hiColor?: string;
  info?: RebarMeshInfo;
  selected?: boolean;
  onSelect?: (info: RebarMeshInfo | null) => void;
  xDir?: number; // 1 = 向右伸入右柱, -1 = 向左伸入左柱
}

/**
 * 弯锚钢筋端部
 * 用于梁端锚固无法直锚时的 90° 弯折
 */
export function BentRebarEnd({
  position,
  straightLen,
  bendLen,
  diameter,
  direction,
  horizontalAxis = 'x',
  color,
  hiColor,
  info,
  selected = false,
  onSelect,
  xDir = 1,
}: BentRebarEndProps) {
  const [hovered, setHovered] = useState(false);
  const r = (diameter * S) / 2;

  const handleClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      if (onSelect && info) onSelect(selected ? null : info);
    },
    [selected, info, onSelect],
  );

  const activeColor = selected && hiColor ? hiColor : hovered && hiColor ? hiColor : color;
  const radiusScale = selected ? 1.3 : hovered ? 1.15 : 1;

  const curve = useMemo(() => {
    const bendRadius = Math.max(Math.min(4 * diameter * S, Math.max(straightLen, 4 * diameter * S) * 0.3), 2 * diameter * S, 0.006);
    const linePart = Math.max(straightLen - bendRadius, 0);
    const pts: THREE.Vector3[] = [];
    const makePoint = (primary: number, vertical: number) =>
      horizontalAxis === 'x'
        ? new THREE.Vector3(primary, vertical, 0)
        : new THREE.Vector3(0, vertical, primary);

    // 水平直段（从梁端面伸入柱内）
    for (let t = 0; t <= 1; t += 0.1) {
      pts.push(makePoint(xDir * t * linePart, 0));
    }

    // 90° 弯折弧
    const sign = direction === 'down' ? -1 : 1;
    for (let a = 0; a <= Math.PI / 2; a += Math.PI / 20) {
      pts.push(makePoint(
        xDir * (linePart + bendRadius * Math.sin(a)),
        sign * bendRadius * (1 - Math.cos(a)),
      ));
    }

    // 竖直弯折段
    const bendEndPrimary = xDir * (linePart + bendRadius);
    const bendEndVertical = sign * bendRadius;
    for (let t = 0.1; t <= 1; t += 0.1) {
      pts.push(makePoint(bendEndPrimary, bendEndVertical + sign * t * bendLen));
    }

    return new THREE.CatmullRomCurve3(pts, false);
  }, [straightLen, bendLen, diameter, direction, xDir, horizontalAxis]);

  return (
    <mesh
      position={position}
      onClick={onSelect ? handleClick : undefined}
      onPointerOver={hiColor ? (e) => {
        e.stopPropagation();
        setHovered(true);
        document.body.style.cursor = 'pointer';
      } : undefined}
      onPointerOut={hiColor ? () => {
        setHovered(false);
        document.body.style.cursor = 'auto';
      } : undefined}
    >
      <tubeGeometry args={[curve, 32, r * radiusScale, 8, false]} />
      <meshStandardMaterial
        color={activeColor}
        roughness={REBAR_MATERIAL.roughness}
        metalness={REBAR_MATERIAL.metalness}
        emissive={selected && hiColor ? hiColor : '#000000'}
        emissiveIntensity={selected ? 0.3 : 0}
      />
    </mesh>
  );
}
