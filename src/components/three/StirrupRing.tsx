'use client';

import { useMemo, useState } from 'react';
import * as THREE from 'three';
import type { RebarMeshInfo, RebarRenderMode } from '@/lib/types';
import { S, REBAR_MATERIAL } from '@/lib/constants';
import { createStirrupCurves, resolveInnerLegPositions } from '@/lib/rebar-shapes';

const MIN_HIT_RADIUS = 0.045;

export interface StirrupRingProps {
  x: number;
  width: number;
  height: number;
  diameter: number;
  color: string;
  hiColor: string;
  info: RebarMeshInfo;
  selected: boolean;
  onSelect: (info: RebarMeshInfo | null) => void;
  cover: number;
  legs?: number;
  cornerRadius?: number;
  barZPositions?: number[];
  renderMode?: RebarRenderMode;
}

/**
 * 箍筋环组件（含 135° 弯钩）
 * 22G101: 抗震箍筋弯钩 135°, 直段≥10d≥75mm
 */
export function StirrupRing({
  x,
  width,
  height,
  diameter,
  color,
  hiColor,
  info,
  selected,
  onSelect,
  cover,
  legs = 2,
  cornerRadius,
  barZPositions,
  renderMode = 'solid',
}: StirrupRingProps) {
  const [hovered, setHovered] = useState(false);

  const { outerCurve, hookCurves } = useMemo(() => {
    return createStirrupCurves({
      width,
      height,
      diameter,
      cornerRadius,
      plane: 'yz',
    });
  }, [width, height, diameter, cornerRadius]);

  // 多肢箍中间拉筋位置
  const legPositions = useMemo(() => {
    return resolveInnerLegPositions({ legs, width, barPositions: barZPositions });
  }, [legs, width, barZPositions]);

  const activeColor = selected ? hiColor : hovered ? hiColor : color;
  const r = (diameter * S) / 2;
  const hitR = Math.max(r * 5, MIN_HIT_RADIUS);
  const showSolid = renderMode === 'solid' || (renderMode === 'hybrid' && (selected || hovered));
  const showCenterline = renderMode === 'centerline' || !showSolid;
  const outerLineGeometry = useMemo(() => new THREE.BufferGeometry().setFromPoints(outerCurve.getPoints(160)), [outerCurve]);
  const hookLineGeometries = useMemo(() => hookCurves.map((curve) => new THREE.BufferGeometry().setFromPoints(curve.getPoints(32))), [hookCurves]);
  const legLineGeometries = useMemo(() => legPositions.map(() => new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, -height / 2, 0),
    new THREE.Vector3(0, height / 2, 0),
  ])), [legPositions, height]);

  return (
    <group
      position={[x, height / 2 + cover, 0]}
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
      {/* 外围箍筋 */}
      {showSolid && (
        <mesh>
          <tubeGeometry args={[outerCurve, 200, r, 8, true]} />
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
        <lineSegments geometry={outerLineGeometry}>
          <lineBasicMaterial color={activeColor} transparent opacity={selected ? 0.95 : 0.62} />
        </lineSegments>
      )}
      <mesh>
        <tubeGeometry args={[outerCurve, 120, hitR, 6, true]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* 箍筋弯钩 (135° hooks) */}
      {hookCurves.map((hc, hi) => (
        <group key={`hook${hi}`}>
          {showSolid && (
            <mesh>
              <tubeGeometry args={[hc, 40, r, 6, false]} />
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
            <lineSegments geometry={hookLineGeometries[hi]}>
              <lineBasicMaterial color={activeColor} transparent opacity={selected ? 0.95 : 0.62} />
            </lineSegments>
          )}
          <mesh>
            <tubeGeometry args={[hc, 28, hitR, 6, false]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
        </group>
      ))}

      {/* 中间拉筋（多肢箍） */}
      {legPositions.map((z, i) => (
        <group key={`leg${i}`} position={[0, 0, z]}>
          {showSolid && (
            <mesh>
              <cylinderGeometry args={[r, r, height, 8]} />
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
            <lineSegments geometry={legLineGeometries[i]}>
              <lineBasicMaterial color={activeColor} transparent opacity={selected ? 0.95 : 0.62} />
            </lineSegments>
          )}
          <mesh>
            <cylinderGeometry args={[hitR, hitR, height, 6]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
