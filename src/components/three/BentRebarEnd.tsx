'use client';

import { useMemo, useState, useCallback } from 'react';
import { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { RebarMeshInfo, RebarRenderMode } from '@/lib/types';
import { S, REBAR_MATERIAL } from '@/lib/constants';

const MIN_HIT_RADIUS = 0.055;

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
  highlighted?: boolean;
  onSelect?: (info: RebarMeshInfo | null) => void;
  xDir?: number; // 1 = 向右伸入右柱, -1 = 向左伸入左柱
  renderMode?: RebarRenderMode;
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
  highlighted = false,
  onSelect,
  xDir = 1,
  renderMode = 'solid',
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

  const activeColor = (selected || hovered || highlighted) && hiColor ? hiColor : color;
  const radiusScale = selected ? 1.3 : hovered ? 1.15 : highlighted ? 1.08 : 1;

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

  const hitRadius = Math.max(r * 5, MIN_HIT_RADIUS);
  const showSolid = renderMode === 'solid' || (renderMode === 'hybrid' && (selected || hovered || highlighted));
  const showCenterline = renderMode === 'centerline' || !showSolid;
  const lineGeometry = useMemo(() => new THREE.BufferGeometry().setFromPoints(curve.getPoints(48)), [curve]);

  return (
    <group
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
      {showSolid && (
        <mesh>
          <tubeGeometry args={[curve, 32, r * radiusScale, 8, false]} />
          <meshStandardMaterial
            color={activeColor}
            roughness={REBAR_MATERIAL.roughness}
            metalness={REBAR_MATERIAL.metalness}
            emissive={(selected || highlighted) && hiColor ? hiColor : '#000000'}
            emissiveIntensity={selected ? 0.3 : highlighted ? 0.16 : 0}
          />
        </mesh>
      )}
      {showCenterline && (
        <lineSegments geometry={lineGeometry}>
          <lineBasicMaterial color={activeColor} transparent opacity={selected || highlighted ? 0.95 : 0.58} />
        </lineSegments>
      )}
      {onSelect && info && (
        <mesh>
          <tubeGeometry args={[curve, 32, hitRadius, 6, false]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}
