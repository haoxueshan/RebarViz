'use client';

import { useMemo, useState, useEffect } from 'react';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import { Maximize2, Minimize2 } from 'lucide-react';
import { useFullscreen } from '@/lib/useFullscreen';
import * as THREE from 'three';
import type { ShearWallParams, RebarMeshInfo } from '@/lib/types';
import { parseSlabRebar, parseRebar, parseStirrup, gradeLabel } from '@/lib/rebar';
import { S } from '@/lib/constants';

function CameraController({ targetPosition }: { targetPosition: [number, number, number] | null }) {
  const { camera } = useThree();
  useEffect(() => {
    if (targetPosition) { camera.position.set(...targetPosition); camera.updateProjectionMatrix(); }
  }, [targetPosition, camera]);
  return null;
}

function InfoTooltip({ info }: { info: RebarMeshInfo }) {
  const colorMap: Record<string, string> = {
    vertBar: 'bg-red-50 border-red-200 text-red-800',
    horizBar: 'bg-blue-50 border-blue-200 text-blue-800',
    boundaryMain: 'bg-purple-50 border-purple-200 text-purple-800',
    boundaryStirrup: 'bg-green-50 border-green-200 text-green-800',
    wallTieBar: 'bg-teal-50 border-teal-200 text-teal-800',
    wallOpeningRebar: 'bg-pink-50 border-pink-200 text-pink-800',
  };
  const cls = colorMap[info.type] || 'bg-gray-50 border-gray-200 text-gray-800';
  return (
    <div className={`absolute top-3 right-3 px-4 py-3 rounded-xl border text-sm shadow-lg backdrop-blur-sm z-10 max-w-xs ${cls}`}>
      <p className="font-semibold">{info.label}</p>
      <p className="text-xs mt-1 opacity-80">{info.detail}</p>
    </div>
  );
}

function ShearWallScene({ params, selected, onSelect, cutPosition, concreteOpacity }: {
  params: ShearWallParams;
  selected: RebarMeshInfo | null;
  onSelect: (info: RebarMeshInfo | null) => void;
  cutPosition: number | null;
  concreteOpacity: number;
}) {
  const LW = params.lw * S;
  const BW = params.bw * S;
  const HW = params.hw * S;
  const COVER = params.cover * S;
  const vert = parseSlabRebar(params.vertBar);
  const horiz = parseSlabRebar(params.horizBar);
  const boundaryR = parseRebar(params.boundaryMain);
  const boundaryStir = parseStirrup(params.boundaryStirrup);
  const tie = params.tieBar ? parseSlabRebar(params.tieBar) : null;
  const openingVert = params.openingVertBar ? parseSlabRebar(params.openingVertBar) : null;
  const openingHoriz = params.openingHorizBar ? parseSlabRebar(params.openingHorizBar) : null;

  // Boundary element length: max(bw, 400mm)
  const BL = (params.boundaryLength || Math.max(params.bw, 400)) * S;
  const bottomStrengthenLen = Math.max(params.hw / 6, 500) * S;
  const boundaryProjection = (params.boundaryProjection || 0) * S;
  const boundaryTypeLabel = params.boundaryType === 'ybz'
    ? '约束边缘构件 YBZ'
    : params.boundaryType === 'fbz'
      ? '扶壁柱 FBZ'
      : params.boundaryType === 'az'
        ? '非边缘暗柱 AZ'
        : '构造边缘构件 GBZ';
  const boundaryForm = params.boundaryForm || 'concealed';
  const boundaryTint = params.boundaryType === 'ybz'
    ? '#8E44AD'
    : params.boundaryType === 'fbz'
      ? '#7C3AED'
      : params.boundaryType === 'az'
        ? '#6D28D9'
        : '#A855F7';
  const boundaryDepth = boundaryForm === 'concealed'
    ? BW
    : boundaryForm === 'endColumn'
      ? BW + Math.max(boundaryProjection, BW * 0.35)
      : boundaryForm === 'cornerWall'
        ? BW + Math.max(boundaryProjection, BW * 0.5)
        : BW + Math.max(boundaryProjection, BW * 0.2);
  const boundaryLengthGeom = boundaryForm === 'wingWall'
    ? BL * 1.35
    : boundaryForm === 'cornerWall'
      ? BL * 1.18
      : BL;
  const boundaryInnerLength = Math.max(boundaryLengthGeom - 2 * COVER, boundaryLengthGeom * 0.35);
  const boundaryInnerDepth = Math.max(boundaryDepth - 2 * COVER, Math.min(BW * 0.6, boundaryDepth));

  const vertInfo: RebarMeshInfo = { type: 'vertBar', label: '竖向分布筋', detail: `${params.vertBar} · ${gradeLabel(vert.grade)} Φ${vert.diameter}@${vert.spacing}，双排布置` };
  const horizInfo: RebarMeshInfo = { type: 'horizBar', label: '水平分布筋', detail: `${params.horizBar} · ${gradeLabel(horiz.grade)} Φ${horiz.diameter}@${horiz.spacing}，双排布置` };
  const boundaryMainInfo: RebarMeshInfo = { type: 'boundaryMain', label: '边缘构件纵筋', detail: `${boundaryTypeLabel} · ${params.boundaryMain} · ${boundaryR.count}根 ${gradeLabel(boundaryR.grade)} Φ${boundaryR.diameter}` };
  const boundaryStirInfo: RebarMeshInfo = { type: 'boundaryStirrup', label: '边缘构件箍筋', detail: `${boundaryTypeLabel} · ${params.boundaryStirrup} · ${gradeLabel(boundaryStir.grade)} Φ${boundaryStir.diameter}@${boundaryStir.spacingDense}` };
  const tieInfo: RebarMeshInfo | null = tie ? { type: 'wallTieBar', label: '拉结筋', detail: `${params.tieBar} · ${gradeLabel(tie.grade)} Φ${tie.diameter}@${tie.spacing}，连接双排分布筋` } : null;
  const openingInfo: RebarMeshInfo | null = params.hasOpening ? { type: 'wallOpeningRebar', label: '洞口补强筋', detail: `${params.openingWidth}×${params.openingHeight}洞口 · 侧边${params.openingVertBar || '未设'} · 上下${params.openingHorizBar || '未设'}` } : null;
  const openingBox = params.hasOpening ? {
    w: Math.min(params.openingWidth || 1200, params.lw - 2 * (params.boundaryLength || Math.max(params.bw, 400))),
    h: Math.min(params.openingHeight || 1500, params.hw - 200),
    bottom: Math.max(params.openingBottom || 900, 0),
    cx: params.openingOffsetX || 0,
  } : null;
  const openingLeft = openingBox ? openingBox.cx * S - (openingBox.w * S) / 2 : 0;
  const openingRight = openingBox ? openingBox.cx * S + (openingBox.w * S) / 2 : 0;
  const openingBottomY = openingBox ? openingBox.bottom * S : 0;
  const openingTopY = openingBox ? openingBottomY + openingBox.h * S : 0;

  // Vertical distributed bars positions (two rows, front and back face)
  const vertBars = (() => {
    const positions: { x: number; z: number; yCenter: number; height: number }[] = [];
    const wallInnerL = LW - 2 * BL; // middle zone only
    const startX = -LW / 2 + BL;
    const count = Math.max(Math.floor(wallInnerL / (vert.spacing * S)), 1);
    const spacing = wallInnerL / Math.max(count, 1);
    for (let i = 0; i <= count; i++) {
      const x = startX + i * spacing;
      const faces = [BW / 2 - COVER, -(BW / 2 - COVER)];
      for (const z of faces) {
        if (openingBox && x >= openingLeft && x <= openingRight) {
          if (openingBottomY > 0.02) positions.push({ x, z, yCenter: openingBottomY / 2, height: openingBottomY });
          if (openingTopY < HW - 0.02) positions.push({ x, z, yCenter: (openingTopY + HW) / 2, height: HW - openingTopY });
        } else {
          positions.push({ x, z, yCenter: HW / 2, height: HW });
        }
      }
    }
    return positions;
  })();

  // Horizontal distributed bars positions
  const horizBars = (() => {
    const bars: { xCenter: number; y: number; z: number; length: number }[] = [];
    const spacing = horiz.spacing * S;
    for (let y = spacing; y < HW - 0.05; y += spacing) {
      for (const z of [BW / 2 - COVER, -(BW / 2 - COVER)]) {
        if (openingBox && y >= openingBottomY && y <= openingTopY) {
          const leftLen = Math.max(openingLeft + LW / 2, 0);
          const rightLen = Math.max(LW / 2 - openingRight, 0);
          if (leftLen > 0.02) bars.push({ xCenter: -LW / 2 + leftLen / 2, y, z, length: leftLen });
          if (rightLen > 0.02) bars.push({ xCenter: openingRight + rightLen / 2, y, z, length: rightLen });
        } else {
          bars.push({ xCenter: 0, y, z, length: LW });
        }
      }
    }
    return bars;
  })();

  const tieBars = (() => {
    if (!tie) return [] as { x: number; y: number }[];
    const xStart = -LW / 2 + BL + tie.spacing * S;
    const xEnd = LW / 2 - BL - tie.spacing * S;
    const yStart = tie.spacing * S;
    const yEnd = HW - tie.spacing * S;
    const xs: number[] = [];
    const ys: number[] = [];
    for (let x = xStart; x <= xEnd + 1e-6; x += tie.spacing * S) xs.push(x);
    for (let y = yStart; y <= yEnd + 1e-6; y += tie.spacing * S) ys.push(y);
    return xs.flatMap(x => ys.map(y => ({ x, y })));
  })();

  // Boundary element rebar positions (both ends)
  const boundaryBars = (() => {
    const positions: { x: number; z: number; side: 'left' | 'right' }[] = [];
    const perSide = Math.max(Math.round(boundaryR.count / 2), 2);
    // Left boundary
    for (let i = 0; i < perSide; i++) {
      const x = -LW / 2 + COVER + (boundaryInnerLength * i) / Math.max(perSide - 1, 1);
      positions.push({ x, z: boundaryInnerDepth / 2, side: 'left' });
      positions.push({ x, z: -(boundaryInnerDepth / 2), side: 'left' });
    }
    // Right boundary
    for (let i = 0; i < perSide; i++) {
      const x = LW / 2 - COVER - (boundaryInnerLength * i) / Math.max(perSide - 1, 1);
      positions.push({ x, z: boundaryInnerDepth / 2, side: 'right' });
      positions.push({ x, z: -(boundaryInnerDepth / 2), side: 'right' });
    }
    return positions;
  })();

  const boundaryOuterBars = (() => {
    if ((boundaryForm !== 'wingWall' && boundaryForm !== 'cornerWall') || boundaryProjection <= 0) return [] as { x: number; z: number }[];
    const positions: { x: number; z: number }[] = [];
    const perSide = Math.max(Math.round(boundaryR.count / 2), 2);
    for (let i = 0; i < perSide; i++) {
      const xL = -LW / 2 + COVER + (boundaryInnerLength * i) / Math.max(perSide - 1, 1);
      const xR = LW / 2 - COVER - (boundaryInnerLength * i) / Math.max(perSide - 1, 1);
      const z = BW / 2 + boundaryProjection - COVER;
      positions.push({ x: xL, z });
      positions.push({ x: xR, z });
    }
    return positions;
  })();

  // Boundary stirrup curve
  const boundaryStirCurve = useMemo(() => {
    const w2 = boundaryInnerLength / 2;
    const h2 = boundaryInnerDepth / 2;
    const r = 0.01;
    const shape = new THREE.Shape();
    shape.moveTo(-w2 + r, -h2);
    shape.lineTo(w2 - r, -h2);
    shape.quadraticCurveTo(w2, -h2, w2, -h2 + r);
    shape.lineTo(w2, h2 - r);
    shape.quadraticCurveTo(w2, h2, w2 - r, h2);
    shape.lineTo(-w2 + r, h2);
    shape.quadraticCurveTo(-w2, h2, -w2, h2 - r);
    shape.lineTo(-w2, -h2 + r);
    shape.quadraticCurveTo(-w2, -h2, -w2 + r, -h2);
    const pts = shape.getPoints(32);
    return new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(p.x, 0, p.y)), true);
  }, [boundaryInnerLength, boundaryInnerDepth]);

  const boundaryOuterStirCurve = useMemo(() => {
    if ((boundaryForm !== 'wingWall' && boundaryForm !== 'cornerWall') || boundaryProjection <= 0) return null;
    const outerWidth = boundaryForm === 'wingWall' ? BL : BL * 0.75;
    const w2 = Math.max(outerWidth / 2 - COVER, outerWidth * 0.25);
    const h2 = Math.max(boundaryProjection / 2 - COVER, boundaryProjection * 0.25);
    const r = 0.01;
    const shape = new THREE.Shape();
    shape.moveTo(-w2 + r, -h2);
    shape.lineTo(w2 - r, -h2);
    shape.quadraticCurveTo(w2, -h2, w2, -h2 + r);
    shape.lineTo(w2, h2 - r);
    shape.quadraticCurveTo(w2, h2, w2 - r, h2);
    shape.lineTo(-w2 + r, h2);
    shape.quadraticCurveTo(-w2, h2, -w2, h2 - r);
    shape.lineTo(-w2, -h2 + r);
    shape.quadraticCurveTo(-w2, -h2, -w2 + r, -h2);
    const pts = shape.getPoints(32);
    return new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(p.x, 0, p.y)), true);
  }, [boundaryForm, boundaryProjection, BL, COVER]);

  const boundaryOuterTieLen = Math.max(BW / 2 + boundaryProjection - COVER - boundaryInnerDepth / 2, 0);
  const boundaryOuterTiePoints = (() => {
    if (!boundaryOuterStirCurve || boundaryOuterTieLen <= 0.02) return [] as { x: number; z: number }[];
    const offsets = boundaryForm === 'cornerWall'
      ? [-boundaryLengthGeom * 0.18, boundaryLengthGeom * 0.14]
      : [-boundaryLengthGeom * 0.22, 0, boundaryLengthGeom * 0.22];
    const z = boundaryInnerDepth / 2 + boundaryOuterTieLen / 2;
    return [-1, 1].flatMap(side => offsets.map(offset => ({
      x: side * (LW / 2 - BL / 2) + offset,
      z,
    })));
  })();

  const [hoveredType, setHoveredType] = useState<string | null>(null);

  const isSelected = (type: string) => selected?.type === type;
  const isHovered = (type: string) => hoveredType === type;

  const barColor = (type: string, base: string, hi: string) =>
    isSelected(type) ? hi : isHovered(type) ? hi : base;

  const handleClick = (e: ThreeEvent<MouseEvent>, info: RebarMeshInfo) => {
    e.stopPropagation();
    onSelect(isSelected(info.type) ? null : info);
  };

  const boundaryStirYs = (() => {
    const ys: number[] = [];
    const s = boundaryStir.spacingDense * S;
    for (let y = s; y < HW - 0.05; y += s) ys.push(y);
    return ys;
  })();

  return (
    <>
      {/* Background click to deselect */}
      <mesh position={[0, HW / 2, 0]} onClick={() => onSelect(null)} visible={false}>
        <boxGeometry args={[LW + 1, HW + 1, BW + 1]} />
        <meshBasicMaterial />
      </mesh>

      {/* Wall body */}
      <mesh position={[0, HW / 2, 0]}>
        <boxGeometry args={[LW, HW, BW]} />
        <meshPhysicalMaterial color="#BDC3C7" transparent opacity={concreteOpacity} side={THREE.DoubleSide} depthWrite={false} roughness={0.8} />
      </mesh>
      <lineSegments position={[0, HW / 2, 0]}>
        <edgesGeometry args={[new THREE.BoxGeometry(LW, HW, BW)]} />
        <lineBasicMaterial color="#94A3B8" />
      </lineSegments>

      {/* Boundary element highlight boxes */}
      {[-1, 1].map(side => (
        <mesh key={side} position={[side * (LW / 2 - BL / 2), HW / 2, 0]}>
          <boxGeometry args={[boundaryLengthGeom, HW, boundaryDepth]} />
          <meshPhysicalMaterial color={boundaryTint} transparent opacity={0.05} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      ))}

      {boundaryForm === 'wingWall' && boundaryProjection > 0 && [-1, 1].map(side => (
        <group key={`fbz-rib-${side}`}>
          <mesh position={[side * (LW / 2 - BL / 2), HW / 2, BW / 2 + boundaryProjection / 2]}>
            <boxGeometry args={[BL, HW, boundaryProjection]} />
            <meshPhysicalMaterial color={boundaryTint} transparent opacity={0.1} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
          <lineSegments position={[side * (LW / 2 - BL / 2), HW / 2, BW / 2 + boundaryProjection / 2]}>
            <edgesGeometry args={[new THREE.BoxGeometry(BL, HW, boundaryProjection)]} />
            <lineBasicMaterial color={boundaryTint} transparent opacity={0.45} />
          </lineSegments>
        </group>
      ))}

      {boundaryForm === 'cornerWall' && boundaryProjection > 0 && [-1, 1].map(side => (
        <group key={`corner-rib-${side}`}>
          <mesh position={[side * (LW / 2 - BL / 2), HW / 2, BW / 2 + boundaryProjection / 2]}>
            <boxGeometry args={[BL * 0.75, HW, boundaryProjection]} />
            <meshPhysicalMaterial color={boundaryTint} transparent opacity={0.1} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
        </group>
      ))}

      {boundaryForm === 'concealed' && boundaryProjection > 0 && [-1, 1].map(side => (
        <group key={`az-core-${side}`}>
          <mesh position={[side * (LW / 2 - BL / 2), HW / 2, 0]}>
            <boxGeometry args={[BL * 0.82, HW, Math.min(BW, boundaryProjection)]} />
            <meshPhysicalMaterial color={boundaryTint} transparent opacity={0.08} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
        </group>
      ))}

      <mesh position={[0, bottomStrengthenLen / 2, 0]}>
        <boxGeometry args={[LW * 1.01, bottomStrengthenLen, BW * 1.01]} />
        <meshBasicMaterial color="#22C55E" transparent opacity={0.05} depthWrite={false} />
      </mesh>

      {[-1, 1].map(side => (
        <mesh key={`boundary-bottom-zone-${side}`} position={[side * (LW / 2 - BL / 2), bottomStrengthenLen / 2, 0]}>
          <boxGeometry args={[boundaryLengthGeom * 1.02, bottomStrengthenLen, boundaryDepth * 1.02]} />
          <meshBasicMaterial color={boundaryTint} transparent opacity={0.06} depthWrite={false} />
        </mesh>
      ))}

      {boundaryOuterStirCurve && [-1, 1].map(side => (
        <mesh key={`boundary-outer-bottom-zone-${side}`} position={[side * (LW / 2 - BL / 2), bottomStrengthenLen / 2, BW / 2 + boundaryProjection / 2]}>
          <boxGeometry args={[boundaryForm === 'wingWall' ? BL * 1.02 : BL * 0.78, bottomStrengthenLen, boundaryProjection * 1.04]} />
          <meshBasicMaterial color={boundaryTint} transparent opacity={0.08} depthWrite={false} />
        </mesh>
      ))}

      {openingBox && (
        <group>
          <mesh position={[openingBox.cx * S, openingBottomY + (openingBox.h * S) / 2, 0]}>
            <boxGeometry args={[openingBox.w * S, openingBox.h * S, BW * 1.2]} />
            <meshBasicMaterial color="#f8fafc" transparent opacity={0.92} depthWrite={false} />
          </mesh>
          <lineSegments position={[openingBox.cx * S, openingBottomY + (openingBox.h * S) / 2, 0]}>
            <edgesGeometry args={[new THREE.BoxGeometry(openingBox.w * S, openingBox.h * S, BW * 1.02)]} />
            <lineBasicMaterial color="#EC4899" transparent opacity={0.7} />
          </lineSegments>
        </group>
      )}

      {/* Vertical distributed bars */}
      {vertBars.map((p, i) => (
        <mesh key={`v${i}`} position={[p.x, p.yCenter, p.z]}
          onClick={(e) => handleClick(e, vertInfo)}
          onPointerOver={(e) => { e.stopPropagation(); setHoveredType('vertBar'); document.body.style.cursor = 'pointer'; }}
          onPointerOut={() => { setHoveredType(null); document.body.style.cursor = 'auto'; }}>
          <cylinderGeometry args={[vert.diameter * S / 2, vert.diameter * S / 2, p.height, 8]} />
          <meshStandardMaterial color={barColor('vertBar', '#C0392B', '#E74C3C')} roughness={0.4} metalness={0.6}
            emissive={isSelected('vertBar') ? '#E74C3C' : '#000'} emissiveIntensity={isSelected('vertBar') ? 0.3 : 0} />
        </mesh>
      ))}

      {/* Horizontal distributed bars */}
      {horizBars.map((bar, i) => (
        <mesh key={`h${i}`} position={[bar.xCenter, bar.y, bar.z]}
          onClick={(e) => handleClick(e, horizInfo)}
          onPointerOver={(e) => { e.stopPropagation(); setHoveredType('horizBar'); document.body.style.cursor = 'pointer'; }}
          onPointerOut={() => { setHoveredType(null); document.body.style.cursor = 'auto'; }}>
          <boxGeometry args={[bar.length, horiz.diameter * S, horiz.diameter * S]} />
          <meshStandardMaterial color={barColor('horizBar', '#2980B9', '#3498DB')} roughness={0.4} metalness={0.6}
            emissive={isSelected('horizBar') ? '#3498DB' : '#000'} emissiveIntensity={isSelected('horizBar') ? 0.3 : 0} />
        </mesh>
      ))}

      {/* Boundary element main bars */}
      {boundaryBars.map((p, i) => (
        <mesh key={`b${i}`} position={[p.x, HW / 2, p.z]}
          onClick={(e) => handleClick(e, boundaryMainInfo)}
          onPointerOver={(e) => { e.stopPropagation(); setHoveredType('boundaryMain'); document.body.style.cursor = 'pointer'; }}
          onPointerOut={() => { setHoveredType(null); document.body.style.cursor = 'auto'; }}>
          <cylinderGeometry args={[boundaryR.diameter * S / 2, boundaryR.diameter * S / 2, HW, 10]} />
          <meshStandardMaterial color={barColor('boundaryMain', '#8E44AD', '#9B59B6')} roughness={0.4} metalness={0.6}
            emissive={isSelected('boundaryMain') ? '#9B59B6' : '#000'} emissiveIntensity={isSelected('boundaryMain') ? 0.3 : 0} />
        </mesh>
      ))}

      {boundaryOuterBars.map((p, i) => (
        <mesh key={`bo${i}`} position={[p.x, HW / 2, p.z]}
          onClick={(e) => handleClick(e, boundaryMainInfo)}
          onPointerOver={(e) => { e.stopPropagation(); setHoveredType('boundaryMain'); document.body.style.cursor = 'pointer'; }}
          onPointerOut={() => { setHoveredType(null); document.body.style.cursor = 'auto'; }}>
          <cylinderGeometry args={[boundaryR.diameter * S / 2, boundaryR.diameter * S / 2, HW, 10]} />
          <meshStandardMaterial color={barColor('boundaryMain', '#8E44AD', '#9B59B6')} roughness={0.4} metalness={0.6}
            emissive={isSelected('boundaryMain') ? '#9B59B6' : '#000'} emissiveIntensity={isSelected('boundaryMain') ? 0.3 : 0} />
        </mesh>
      ))}

      {/* Boundary element stirrups (both ends) */}
      {[-1, 1].map(side =>
        boundaryStirYs.map((y, i) => (
          <mesh key={`bs${side}${i}`} position={[side * (LW / 2 - BL / 2), y, 0]}
            onClick={(e) => handleClick(e, boundaryStirInfo)}
            onPointerOver={(e) => { e.stopPropagation(); setHoveredType('boundaryStirrup'); document.body.style.cursor = 'pointer'; }}
            onPointerOut={() => { setHoveredType(null); document.body.style.cursor = 'auto'; }}>
            <tubeGeometry args={[boundaryStirCurve, 32, boundaryStir.diameter * S / 2, 6, true]} />
            <meshStandardMaterial color={barColor('boundaryStirrup', '#27AE60', '#2ECC71')} roughness={0.4} metalness={0.6}
              emissive={isSelected('boundaryStirrup') ? '#2ECC71' : '#000'} emissiveIntensity={isSelected('boundaryStirrup') ? 0.3 : 0} />
          </mesh>
        ))
      )}

      {/* Outer stirrup envelopes for wing-wall / corner-wall forms */}
      {boundaryOuterStirCurve && [-1, 1].map(side =>
        boundaryStirYs.map((y, i) => (
          <mesh
            key={`bos${side}${i}`}
            position={[side * (LW / 2 - BL / 2), y, BW / 2 + boundaryProjection / 2]}
            onClick={(e) => handleClick(e, boundaryStirInfo)}
            onPointerOver={(e) => { e.stopPropagation(); setHoveredType('boundaryStirrup'); document.body.style.cursor = 'pointer'; }}
            onPointerOut={() => { setHoveredType(null); document.body.style.cursor = 'auto'; }}
          >
            <tubeGeometry args={[boundaryOuterStirCurve, 32, boundaryStir.diameter * S / 2, 6, true]} />
            <meshStandardMaterial
              color={barColor('boundaryStirrup', '#27AE60', '#2ECC71')}
              roughness={0.4}
              metalness={0.6}
              emissive={isSelected('boundaryStirrup') ? '#2ECC71' : '#000'}
              emissiveIntensity={isSelected('boundaryStirrup') ? 0.3 : 0}
            />
          </mesh>
        ))
      )}

      {boundaryOuterTiePoints.flatMap((point, pi) =>
        boundaryStirYs.map((y, yi) => (
          <mesh
            key={`bot${pi}${yi}`}
            position={[point.x, y, point.z]}
            onClick={(e) => handleClick(e, boundaryStirInfo)}
            onPointerOver={(e) => { e.stopPropagation(); setHoveredType('boundaryStirrup'); document.body.style.cursor = 'pointer'; }}
            onPointerOut={() => { setHoveredType(null); document.body.style.cursor = 'auto'; }}
          >
            <boxGeometry args={[boundaryStir.diameter * S, boundaryStir.diameter * S, boundaryOuterTieLen]} />
            <meshStandardMaterial
              color={barColor('boundaryStirrup', '#27AE60', '#2ECC71')}
              roughness={0.4}
              metalness={0.6}
              emissive={isSelected('boundaryStirrup') ? '#2ECC71' : '#000'}
              emissiveIntensity={isSelected('boundaryStirrup') ? 0.3 : 0}
            />
          </mesh>
        ))
      )}

      {/* Tie bars through wall thickness */}
      {tieInfo && tieBars.map((p, i) => (
        <mesh key={`tie-${i}`} position={[p.x, p.y, 0]} rotation={[Math.PI / 2, 0, 0]}
          onClick={(e) => handleClick(e, tieInfo)}
          onPointerOver={(e) => { e.stopPropagation(); setHoveredType('wallTieBar'); document.body.style.cursor = 'pointer'; }}
          onPointerOut={() => { setHoveredType(null); document.body.style.cursor = 'auto'; }}>
          <cylinderGeometry args={[tie!.diameter * S / 2, tie!.diameter * S / 2, BW - 2 * COVER, 8]} />
          <meshStandardMaterial color={barColor('wallTieBar', '#16A085', '#1ABC9C')} roughness={0.4} metalness={0.6}
            emissive={isSelected('wallTieBar') ? '#1ABC9C' : '#000'} emissiveIntensity={isSelected('wallTieBar') ? 0.3 : 0} />
        </mesh>
      ))}

      {/* Opening reinforcement */}
      {openingInfo && openingVert && [openingLeft, openingRight].flatMap((x, xi) => [
        BW / 2 - COVER,
        -(BW / 2 - COVER),
      ].map((z, zi) => (
        <mesh key={`ov-${xi}-${zi}`} position={[x, (openingBottomY + openingTopY) / 2, z]}
          onClick={(e) => handleClick(e, openingInfo)}
          onPointerOver={(e) => { e.stopPropagation(); setHoveredType('wallOpeningRebar'); document.body.style.cursor = 'pointer'; }}
          onPointerOut={() => { setHoveredType(null); document.body.style.cursor = 'auto'; }}>
          <cylinderGeometry args={[openingVert.diameter * S / 2, openingVert.diameter * S / 2, Math.max(openingTopY - openingBottomY, 0.02), 8]} />
          <meshStandardMaterial color={barColor('wallOpeningRebar', '#EC4899', '#F472B6')} roughness={0.4} metalness={0.6}
            emissive={isSelected('wallOpeningRebar') ? '#F472B6' : '#000'} emissiveIntensity={isSelected('wallOpeningRebar') ? 0.3 : 0} />
        </mesh>
      )))}
      {openingInfo && openingHoriz && [openingBottomY, openingTopY].flatMap((y, yi) => [
        BW / 2 - COVER,
        -(BW / 2 - COVER),
      ].map((z, zi) => (
        <mesh key={`oh-${yi}-${zi}`} position={[openingBox!.cx * S, y, z]}
          onClick={(e) => handleClick(e, openingInfo)}
          onPointerOver={(e) => { e.stopPropagation(); setHoveredType('wallOpeningRebar'); document.body.style.cursor = 'pointer'; }}
          onPointerOut={() => { setHoveredType(null); document.body.style.cursor = 'auto'; }}>
          <boxGeometry args={[Math.max(openingBox!.w * S, 0.02), openingHoriz.diameter * S, openingHoriz.diameter * S]} />
          <meshStandardMaterial color={barColor('wallOpeningRebar', '#EC4899', '#F472B6')} roughness={0.4} metalness={0.6}
            emissive={isSelected('wallOpeningRebar') ? '#F472B6' : '#000'} emissiveIntensity={isSelected('wallOpeningRebar') ? 0.3 : 0} />
        </mesh>
      )))}

      {/* Cut plane */}
      {cutPosition !== null && (
        <group position={[0, cutPosition, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <mesh>
            <planeGeometry args={[LW * 1.3, BW * 1.3]} />
            <meshBasicMaterial color="#3B82F6" transparent opacity={0.35} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
          <lineLoop geometry={new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(-LW * 0.65, -BW * 0.65, 0),
            new THREE.Vector3(LW * 0.65, -BW * 0.65, 0),
            new THREE.Vector3(LW * 0.65, BW * 0.65, 0),
            new THREE.Vector3(-LW * 0.65, BW * 0.65, 0),
          ])}>
            <lineBasicMaterial color="#2563EB" linewidth={2} />
          </lineLoop>
        </group>
      )}
    </>
  );
}

export default function ShearWallViewer({ params, cutPosition, showCut, onCutPositionChange, onShowCutChange }: {
  params: ShearWallParams;
  cutPosition: number | null;
  showCut: boolean;
  onCutPositionChange: (v: number | null) => void;
  onShowCutChange: (v: boolean) => void;
}) {
  const [selected, setSelected] = useState<RebarMeshInfo | null>(null);
  const [concreteOpacity, setConcreteOpacity] = useState(0.15);
  const [cameraTarget, setCameraTarget] = useState<[number, number, number] | null>(null);
  const { isFullscreen: fsActive, toggle: fsToggle, containerRef: fsContainerRef, containerClass: fsClass } = useFullscreen();
  const HW = params.hw * S;
  const camDist = Math.max(Math.max(params.lw, params.hw) * S * 0.85, 4.5);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => { onShowCutChange(!showCut); if (showCut) onCutPositionChange(null); else onCutPositionChange(HW / 2); }}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${showCut ? 'bg-accent text-white' : 'bg-white border border-gray-200 text-muted hover:bg-gray-50'}`}>
          {showCut ? '关闭剖切' : '剖切视图'}
        </button>
        {selected && (
          <button onClick={() => setSelected(null)} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 text-muted cursor-pointer hover:bg-gray-200 transition-colors">
            取消选中
          </button>
        )}
      </div>

      {showCut && (
        <div className="flex items-center gap-3 bg-white rounded-lg border border-gray-200 px-4 py-2">
          <span className="text-xs text-muted whitespace-nowrap">剖切高度</span>
          <input type="range" min={0.1} max={HW - 0.1} step={0.05} value={cutPosition ?? HW / 2}
            onChange={e => onCutPositionChange(parseFloat(e.target.value))} className="flex-1 accent-accent" />
          <span className="text-xs text-muted w-16 text-right">{((cutPosition ?? HW / 2) * 1000).toFixed(0)}mm</span>
        </div>
      )}

      <div ref={fsContainerRef} className={`relative w-full bg-surface overflow-hidden ${fsClass}`}>
        {selected && <InfoTooltip info={selected} />}

        <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5">
          {[
            { name: '正面', pos: [0, HW / 2, camDist] as [number, number, number] },
            { name: '侧面', pos: [camDist, HW / 2, 0] as [number, number, number] },
            { name: '俯视', pos: [0, camDist + HW * 0.2, 0.1] as [number, number, number] },
            { name: '透视', pos: [camDist * 0.75, HW * 0.6, camDist * 0.75] as [number, number, number] },
          ].map(a => (
            <button key={a.name} onClick={() => setCameraTarget(a.pos)}
              className="px-2 py-1 rounded-md text-[11px] font-medium cursor-pointer bg-white/80 backdrop-blur-sm border border-gray-200/60 text-muted hover:bg-white hover:text-primary transition-colors">
              {a.name}
            </button>
          ))}
          <div className="flex items-center gap-1 ml-1 px-2 py-1 rounded-md bg-white/80 backdrop-blur-sm border border-gray-200/60">
            <span className="text-[11px] text-muted">透明</span>
            <input type="range" min={0} max={0.4} step={0.02} value={concreteOpacity}
              onChange={e => setConcreteOpacity(parseFloat(e.target.value))} className="w-12 accent-accent" />
          </div>
          <button onClick={fsToggle}
            className="ml-1 p-1 rounded-md bg-white/80 backdrop-blur-sm border border-gray-200/60 text-muted hover:bg-white hover:text-primary transition-colors cursor-pointer"
            title={fsActive ? '退出全屏 (Esc)' : '全屏显示'}>
            {fsActive ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>

        <Canvas camera={{ position: [camDist * 0.75, HW * 0.6, camDist * 0.75], fov: 45 }} scene={{ background: new THREE.Color('#f8fafc') }}>
          <CameraController targetPosition={cameraTarget} />
          <ambientLight intensity={0.6} />
          <directionalLight position={[5, 8, 5]} intensity={0.8} castShadow />
          <ShearWallScene params={params} selected={selected} onSelect={setSelected} cutPosition={cutPosition} concreteOpacity={concreteOpacity} />
          <Grid args={[20, 20]} position={[0, -0.01, 0]} cellColor="#E2E8F0" sectionColor="#E2E8F0" fadeDistance={20} />
          <axesHelper args={[1]} />
          <OrbitControls target={[0, HW / 2, 0]} enableDamping dampingFactor={0.1} />
        </Canvas>
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-primary/70 text-white text-xs px-4 py-1.5 rounded-full backdrop-blur-sm pointer-events-none">
          左键旋转 · 右键平移 · 滚轮缩放 · 点击钢筋查看详情
        </div>
      </div>
    </div>
  );
}
