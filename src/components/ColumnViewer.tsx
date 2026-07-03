'use client';

import { useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import { Maximize2, Minimize2 } from 'lucide-react';
import { useFullscreen } from '@/lib/useFullscreen';
import * as THREE from 'three';
import type { ColumnParams, RebarMeshInfo, RebarRenderMode } from '@/lib/types';
import { parseStirrup, gradeLabel, resolveColumnBars } from '@/lib/rebar';
import { CameraController } from '@/components/InstancedRebar';
import { BentRebarEnd } from '@/components/three';
import { calcColumnLapZone, calcLlE } from '@/lib/anchor';
import { S } from '@/lib/constants';
import { createStirrupCurves, createStirrupShapeSpec, resolveInnerLegPositions } from '@/lib/rebar-shapes';
import { formatDistributionRange, isRelatedRebarSet, rebarGroupDataFromInfo } from '@/lib/rebar-semantics';
import { RebarDetailPanel } from './RebarDetailPanel';

const MIN_COLUMN_HIT_RADIUS = 0.055;
const MIN_STIRRUP_HIT_RADIUS = 0.045;

function ClickableBar({ position, height, diameter, color, hiColor, info, selected, onSelect, renderMode = 'solid' }: {
  position: [number, number, number]; height: number; diameter: number;
  color: string; hiColor: string; info: RebarMeshInfo;
  selected: boolean; onSelect: (info: RebarMeshInfo | null) => void;
  renderMode?: RebarRenderMode;
}) {
  const [hovered, setHovered] = useState(false);
  const activeColor = selected ? hiColor : hovered ? hiColor : color;
  const scale = selected ? 1.3 : hovered ? 1.15 : 1;
  const r = diameter * S / 2;
  const hitR = Math.max(diameter * S * 2.5, MIN_COLUMN_HIT_RADIUS);
  const showSolid = renderMode === 'solid' || (renderMode === 'hybrid' && (selected || hovered));
  const showCenterline = renderMode === 'centerline' || !showSolid;
  const lineGeometry = useMemo(() => new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, -height / 2, 0),
    new THREE.Vector3(0, height / 2, 0),
  ]), [height]);
  return (
    <group position={position}
      onClick={(e) => { e.stopPropagation(); onSelect(selected ? null : info); }}
      onPointerOver={(e) => { e.stopPropagation(); setHovered(true); document.body.style.cursor = 'pointer'; }}
      onPointerOut={() => { setHovered(false); document.body.style.cursor = 'auto'; }}>
      {showSolid && (
        <mesh scale={[scale, 1, scale]}>
          <cylinderGeometry args={[r, r, height, 12]} />
          <meshStandardMaterial color={activeColor} roughness={0.4} metalness={0.6} emissive={selected ? hiColor : '#000000'} emissiveIntensity={selected ? 0.3 : 0} />
        </mesh>
      )}
      {showCenterline && (
        <lineSegments geometry={lineGeometry}>
          <lineBasicMaterial color={activeColor} transparent opacity={selected ? 0.95 : 0.62} />
        </lineSegments>
      )}
      <mesh>
        <cylinderGeometry args={[hitR, hitR, height, 6]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}

const COLOR_CORNER = '#C0392B';
const COLOR_CORNER_HI = '#E74C3C';
const COLOR_B_MID = '#E67E22';
const COLOR_B_MID_HI = '#F39C12';
const COLOR_H_MID = '#8E44AD';
const COLOR_H_MID_HI = '#9B59B6';

function barColor(role: string): string {
  if (role === 'bMiddle') return COLOR_B_MID;
  if (role === 'hMiddle') return COLOR_H_MID;
  return COLOR_CORNER;
}
function barHiColor(role: string): string {
  if (role === 'bMiddle') return COLOR_B_MID_HI;
  if (role === 'hMiddle') return COLOR_H_MID_HI;
  return COLOR_CORNER_HI;
}

function ColumnScene({ params, selected, onSelect, cutPosition, concreteOpacity, renderMode }: {
  params: ColumnParams; selected: RebarMeshInfo | null;
  onSelect: (info: RebarMeshInfo | null) => void; cutPosition: number | null; concreteOpacity: number;
  renderMode: RebarRenderMode;
}) {
  const bm = params.b * S;
  const hm = params.h * S;
  const COVER = (params.cover || 25) * S;
  const COL_H = (params.height || 3000) * S;
  const hasVariableSection = !!params.hasVariableSection;
  const variableStart = hasVariableSection ? Math.min(Math.max((params.variableStart || ((params.height || 3000) * 0.7)) * S, 0.2), COL_H - 0.2) : COL_H;
  const upperBm = (params.upperB || params.b) * S;
  const upperHm = (params.upperH || params.h) * S;
  const topNodeType = params.topNodeType || 'middle';
  const roofBeamB = (params.roofBeamB || 300) * S;
  const roofBeamH = (params.roofBeamH || 600) * S;
  const roofSlabT = (params.roofSlabThickness || 120) * S;
  const baseSupportType = params.baseSupportType || 'foundation';
  const baseSupportWidth = (params.baseSupportWidth || params.b) * S;
  const baseSupportHeight = (params.baseSupportHeight || 800) * S;
  const topSpanX = bm * 2.0;
  const topSpanZ = hm * 2.0;
  const beamHalf = roofBeamB / 2;
  const stir = parseStirrup(params.stirrup);
  const STIR_D = stir.diameter * S;
  const innerW = bm - 2 * COVER;
  const innerH = hm - 2 * COVER;
  const upperInnerW = upperBm - 2 * COVER;
  const upperInnerH = upperHm - 2 * COVER;
  const stirCenterW = Math.max(bm - 2 * COVER - STIR_D, 0.02);
  const stirCenterH = Math.max(hm - 2 * COVER - STIR_D, 0.02);
  const upperStirCenterW = Math.max(upperBm - 2 * COVER - STIR_D, 0.02);
  const upperStirCenterH = Math.max(upperHm - 2 * COVER - STIR_D, 0.02);
  const topNodeBarH = Math.max(roofBeamH + (params.hasRoofSlab ? roofSlabT : 0), 0.12);

  const resolved = useMemo(() =>
    resolveColumnBars(params.main, params.cornerMain, params.bMiddleMain, params.hMiddleMain, innerW, innerH),
  [params.main, params.cornerMain, params.bMiddleMain, params.hMiddleMain, innerW, innerH]);

  const upperResolved = useMemo(() =>
    resolveColumnBars(params.main, params.cornerMain, params.bMiddleMain, params.hMiddleMain, upperInnerW, upperInnerH),
  [params.main, params.cornerMain, params.bMiddleMain, params.hMiddleMain, upperInnerW, upperInnerH]);
  const nodeResolved = hasVariableSection ? upperResolved : resolved;

  const denseZoneLen = useMemo(() => {
    return Math.max(COL_H / 6, Math.max(bm, hm), 0.5);
  }, [COL_H, bm, hm]);

  const lapZone = useMemo(() => calcColumnLapZone(params.height || 3000), [params.height]);
  const lapZoneStart = lapZone.start * S;
  const lapZoneEnd = Math.min(lapZone.end * S, COL_H);

  const stirrups = useMemo(() => {
    const positions: { y: number; zone: 'dense' | 'normal' }[] = [];
    const denseS = stir.spacingDense * S;
    const normalS = stir.spacingNormal * S;
    for (let y = 0.05; y < denseZoneLen; y += denseS) positions.push({ y, zone: 'dense' });
    for (let y = denseZoneLen; y < COL_H - denseZoneLen; y += normalS) positions.push({ y, zone: 'normal' });
    for (let y = COL_H - denseZoneLen; y < COL_H - 0.05; y += denseS) positions.push({ y, zone: 'dense' });
    return positions;
  }, [stir.spacingDense, stir.spacingNormal, COL_H, denseZoneLen]);

  const stirrupCurves = useMemo(() => createStirrupCurves({
    width: stirCenterW,
    height: stirCenterH,
    diameter: stir.diameter,
    plane: 'xz',
  }), [stirCenterW, stirCenterH, stir.diameter]);

  const upperStirrupCurves = useMemo(() => createStirrupCurves({
    width: upperStirCenterW,
    height: upperStirCenterH,
    diameter: stir.diameter,
    plane: 'xz',
  }), [upperStirCenterW, upperStirCenterH, stir.diameter]);

  const stirrupTieOffsets = useMemo(() => resolveInnerLegPositions({
    legs: stir.legs,
    width: stirCenterW,
    barPositions: resolved.bars.map((bar) => bar.x),
  }), [stir.legs, stirCenterW, resolved.bars]);

  const upperStirrupTieOffsets = useMemo(() => resolveInnerLegPositions({
    legs: stir.legs,
    width: upperStirCenterW,
    barPositions: upperResolved.bars.map((bar) => bar.x),
  }), [stir.legs, upperStirCenterW, upperResolved.bars]);

  const stirSpec = useMemo(() => createStirrupShapeSpec({
    widthMm: params.b - 2 * (params.cover || 25) - stir.diameter,
    heightMm: params.h - 2 * (params.cover || 25) - stir.diameter,
    diameterMm: stir.diameter,
  }), [params.b, params.h, params.cover, stir.diameter]);

  const [stirHovered, setStirHovered] = useState(false);
  const isSetSelected = (type: RebarMeshInfo['type'], setId?: string) => {
    if (setId && selected?.setId) return selected.setId === setId;
    return selected?.type === type;
  };
  const isRelated = (setId?: string) => isRelatedRebarSet(setId, selected);
  const cornerSelected = isSetSelected('corner', 'column.corner');
  const bMidSelected = isSetSelected('bMiddle', 'column.bMiddle');
  const hMidSelected = isSetSelected('hMiddle', 'column.hMiddle');
  const anyMainSelected = selected?.type === 'main'; // legacy
  const anyColumnBarSelected = cornerSelected || bMidSelected || hMidSelected || anyMainSelected;

  // Per-role info objects
  const cornerInfo: RebarMeshInfo = resolved.isDetailed
    ? { type: 'corner', label: '角筋', detail: `${params.cornerMain} · 4根 ${gradeLabel(resolved.corner.grade)} Φ${resolved.corner.diameter}`, setId: 'column.corner', groupLabel: '柱角筋', groupCount: 4, distributionRange: formatDistributionRange(0, Math.round(COL_H / S)), relatedSetIds: ['column.stirrup.dense-bottom', 'column.stirrup.normal', 'column.stirrup.dense-top'] }
    : { type: 'main', label: '纵向钢筋', detail: `${params.main} · ${resolved.totalCount}根 ${gradeLabel(resolved.corner.grade)} Φ${resolved.corner.diameter}`, setId: 'column.main', groupLabel: '柱纵向钢筋', groupCount: resolved.totalCount, distributionRange: formatDistributionRange(0, Math.round(COL_H / S)), relatedSetIds: ['column.stirrup.dense-bottom', 'column.stirrup.normal', 'column.stirrup.dense-top'] };
  const bMidInfo: RebarMeshInfo | null = resolved.bMiddle
    ? { type: 'bMiddle', label: 'b边中部筋', detail: `${params.bMiddleMain} · 每侧${resolved.bMiddle.count}根 ${gradeLabel(resolved.bMiddle.grade)} Φ${resolved.bMiddle.diameter}`, setId: 'column.bMiddle', groupLabel: '柱b边中部筋', groupCount: resolved.bMiddle.count * 2, distributionRange: formatDistributionRange(0, Math.round(COL_H / S)), relatedSetIds: ['column.stirrup.dense-bottom', 'column.stirrup.normal', 'column.stirrup.dense-top'] }
    : null;
  const hMidInfo: RebarMeshInfo | null = resolved.hMiddle
    ? { type: 'hMiddle', label: 'h边中部筋', detail: `${params.hMiddleMain} · 每侧${resolved.hMiddle.count}根 ${gradeLabel(resolved.hMiddle.grade)} Φ${resolved.hMiddle.diameter}`, setId: 'column.hMiddle', groupLabel: '柱h边中部筋', groupCount: resolved.hMiddle.count * 2, distributionRange: formatDistributionRange(0, Math.round(COL_H / S)), relatedSetIds: ['column.stirrup.dense-bottom', 'column.stirrup.normal', 'column.stirrup.dense-top'] }
    : null;

  function infoForRole(role: string): RebarMeshInfo {
    if (role === 'bMiddle' && bMidInfo) return bMidInfo;
    if (role === 'hMiddle' && hMidInfo) return hMidInfo;
    return cornerInfo;
  }
  function isBarSelected(role: string): boolean {
    if (!resolved.isDetailed) return anyMainSelected;
    return isSetSelected(infoForRole(role).type, infoForRole(role).setId);
  }

  const topNodeBars = useMemo(() => {
    return nodeResolved.bars.filter((bar) => {
      if (topNodeType === 'edge') return Math.abs(bar.z) <= beamHalf;
      if (topNodeType === 'corner') return Math.abs(bar.z) <= beamHalf || Math.abs(bar.x) <= beamHalf;
      return Math.abs(bar.z) <= beamHalf || Math.abs(bar.x) <= beamHalf;
    });
  }, [nodeResolved.bars, beamHalf, topNodeType]);

  const topNodeBentBars = useMemo(() => {
    if (topNodeType === 'middle') return [];
    return nodeResolved.bars
      .filter((bar) => {
        if (topNodeType === 'edge') return Math.abs(bar.z) > beamHalf;
        return Math.abs(bar.z) > beamHalf && Math.abs(bar.x) > beamHalf;
      })
      .map((bar) => {
        if (topNodeType === 'edge') {
          const excess = Math.max(Math.abs(bar.z) - beamHalf, 0);
          return {
            bar,
            horizontalAxis: 'z' as const,
            xDir: bar.z >= 0 ? -1 : 1,
            straightLen: Math.max(excess + roofBeamB * 0.18, roofBeamB * 0.18, 0.08),
            bendLen: Math.max(topNodeBarH * 0.72, 0.12),
          };
        }

        const excessX = Math.max(Math.abs(bar.x) - beamHalf, 0);
        const excessZ = Math.max(Math.abs(bar.z) - beamHalf, 0);
        const bendAlongX = excessX <= excessZ;
        return {
          bar,
          horizontalAxis: bendAlongX ? 'x' as const : 'z' as const,
          xDir: bendAlongX
            ? (bar.x >= 0 ? -1 : 1)
            : (bar.z >= 0 ? -1 : 1),
          straightLen: Math.max((bendAlongX ? excessX : excessZ) + roofBeamB * 0.18, roofBeamB * 0.18, 0.08),
          bendLen: Math.max(topNodeBarH * 0.72, 0.12),
        };
      });
  }, [beamHalf, nodeResolved.bars, roofBeamB, topNodeBarH, topNodeType]);

  return (
    <>
      <mesh position={[0, COL_H / 2, 0]} onClick={() => onSelect(null)} visible={false}>
        <boxGeometry args={[bm + 1, COL_H + 1, hm + 1]} />
        <meshBasicMaterial />
      </mesh>

      {!hasVariableSection ? (
        <mesh position={[0, COL_H / 2, 0]}>
          <boxGeometry args={[bm, COL_H, hm]} />
          <meshPhysicalMaterial color="#BDC3C7" transparent opacity={concreteOpacity} side={THREE.DoubleSide} depthWrite={false} roughness={0.8} />
        </mesh>
      ) : (
        <>
          <mesh position={[0, variableStart / 2, 0]}>
            <boxGeometry args={[bm, variableStart, hm]} />
            <meshPhysicalMaterial color="#BDC3C7" transparent opacity={concreteOpacity} side={THREE.DoubleSide} depthWrite={false} roughness={0.8} />
          </mesh>
          <mesh position={[0, variableStart + (COL_H - variableStart) / 2, 0]}>
            <boxGeometry args={[upperBm, COL_H - variableStart, upperHm]} />
            <meshPhysicalMaterial color="#BDC3C7" transparent opacity={concreteOpacity} side={THREE.DoubleSide} depthWrite={false} roughness={0.8} />
          </mesh>
          <mesh position={[0, variableStart, 0]}>
            <boxGeometry args={[bm * 1.02, 0.02, hm * 1.02]} />
            <meshBasicMaterial color="#F59E0B" transparent opacity={0.22} depthWrite={false} />
          </mesh>
        </>
      )}
      <lineSegments position={[0, (!hasVariableSection ? COL_H : variableStart) / 2, 0]}>
        <edgesGeometry args={[new THREE.BoxGeometry(bm, !hasVariableSection ? COL_H : variableStart, hm)]} />
        <lineBasicMaterial color="#94A3B8" />
      </lineSegments>
      {hasVariableSection && (
        <lineSegments position={[0, variableStart + (COL_H - variableStart) / 2, 0]}>
          <edgesGeometry args={[new THREE.BoxGeometry(upperBm, COL_H - variableStart, upperHm)]} />
          <lineBasicMaterial color="#94A3B8" />
        </lineSegments>
      )}

      {resolved.bars.map((bar, i) => (
        <ClickableBar key={`r-lower-${i}`} position={[bar.x, variableStart / 2, bar.z]} height={variableStart} diameter={bar.diameter}
          color={resolved.isDetailed ? barColor(bar.role) : COLOR_CORNER}
          hiColor={resolved.isDetailed ? barHiColor(bar.role) : COLOR_CORNER_HI}
          info={{ ...infoForRole(bar.role), instanceIndex: i + 1 }} selected={isBarSelected(bar.role)} onSelect={onSelect} renderMode={renderMode} />
      ))}
      {hasVariableSection && upperResolved.bars.map((bar, i) => (
        <ClickableBar key={`r-upper-${i}`} position={[bar.x, variableStart + (COL_H - variableStart) / 2, bar.z]} height={COL_H - variableStart} diameter={bar.diameter}
          color={upperResolved.isDetailed ? barColor(bar.role) : COLOR_CORNER}
          hiColor={upperResolved.isDetailed ? barHiColor(bar.role) : COLOR_CORNER_HI}
          info={{ ...infoForRole(bar.role), instanceIndex: i + 1 }} selected={isBarSelected(bar.role)} onSelect={onSelect} renderMode={renderMode} />
      ))}

      {topNodeBars.map((bar, i) => (
        <ClickableBar key={`r-top-node-${i}`} position={[bar.x, COL_H + topNodeBarH / 2, bar.z]} height={topNodeBarH} diameter={bar.diameter}
          color={nodeResolved.isDetailed ? barColor(bar.role) : COLOR_CORNER}
          hiColor={nodeResolved.isDetailed ? barHiColor(bar.role) : COLOR_CORNER_HI}
          info={{ ...infoForRole(bar.role), instanceIndex: i + 1 }} selected={isBarSelected(bar.role)} onSelect={onSelect} renderMode={renderMode} />
      ))}

      {topNodeBentBars.map(({ bar, horizontalAxis, xDir, straightLen, bendLen }, i) => (
        <BentRebarEnd
          key={`r-top-bent-${i}`}
          position={[bar.x, COL_H, bar.z]}
          straightLen={straightLen}
          bendLen={bendLen}
          diameter={bar.diameter}
          direction="up"
          horizontalAxis={horizontalAxis}
          xDir={xDir}
          color={nodeResolved.isDetailed ? barColor(bar.role) : COLOR_CORNER}
          hiColor={nodeResolved.isDetailed ? barHiColor(bar.role) : COLOR_CORNER_HI}
          info={{ ...infoForRole(bar.role), instanceIndex: i + 1 }}
          selected={isBarSelected(bar.role)}
          onSelect={onSelect}
          renderMode={renderMode}
        />
      ))}

      <group>
        <mesh position={[0, denseZoneLen / 2, 0]}>
          <boxGeometry args={[bm * 1.02, denseZoneLen, hm * 1.02]} />
          <meshBasicMaterial color="#22C55E" transparent opacity={0.06} depthWrite={false} />
        </mesh>
        <mesh position={[0, COL_H - denseZoneLen / 2, 0]}>
          <boxGeometry args={[bm * 1.02, denseZoneLen, hm * 1.02]} />
          <meshBasicMaterial color="#22C55E" transparent opacity={0.06} depthWrite={false} />
        </mesh>
        <mesh position={[0, (lapZoneStart + lapZoneEnd) / 2, 0]}>
          <boxGeometry args={[bm * 1.06, Math.max(lapZoneEnd - lapZoneStart, 0.02), hm * 1.06]} />
          <meshBasicMaterial color="#06B6D4" transparent opacity={0.06} depthWrite={false} />
        </mesh>
      </group>

      {stirrups.map(({ y, zone }, i) => {
        const isUpper = hasVariableSection && y >= variableStart;
        const activeCurves = isUpper ? upperStirrupCurves : stirrupCurves;
        const activeTieOffsets = isUpper ? upperStirrupTieOffsets : stirrupTieOffsets;
        const activeTieLength = isUpper ? upperStirCenterH : stirCenterH;
        const zoneKey = zone === 'normal' ? 'normal' : (y < denseZoneLen ? 'dense-bottom' : 'dense-top');
        const setId = `column.stirrup.${zoneKey}`;
        const groupStirrups = stirrups.filter((item) => {
          const itemZoneKey = item.zone === 'normal' ? 'normal' : (item.y < denseZoneLen ? 'dense-bottom' : 'dense-top');
          return itemZoneKey === zoneKey;
        });
        const instanceIndex = groupStirrups.findIndex((item) => item.y === y && item.zone === zone) + 1;
        const groupStart = groupStirrups[0]?.y ?? y;
        const groupEnd = groupStirrups[groupStirrups.length - 1]?.y ?? y;
        const spacingMm = zone === 'dense' ? stir.spacingDense : stir.spacingNormal;
        const stirInfo: RebarMeshInfo = {
          type: 'stirrup',
          label: zone === 'dense' ? '箍筋(加密区)' : '箍筋(非加密区)',
          detail: `${params.stirrup} · ${gradeLabel(stir.grade)} Φ${stir.diameter} 加密${stir.spacingDense}/非加密${stir.spacingNormal} ${stir.legs}肢箍，中心线${Math.round(stirSpec.widthMm)}×${Math.round(stirSpec.heightMm)}，单根L=${stirSpec.lengthMm}mm`,
          setId,
          instanceIndex,
          groupLabel: zoneKey === 'normal' ? '柱中部非加密区箍筋' : zoneKey === 'dense-bottom' ? '柱底部加密区箍筋' : '柱顶部加密区箍筋',
          groupCount: groupStirrups.length,
          distributionRange: formatDistributionRange(Math.round(groupStart / S), Math.round(groupEnd / S), spacingMm),
          relatedSetIds: ['column.corner', 'column.bMiddle', 'column.hMiddle', 'column.main'],
        };
        const activeStirSelected = isSetSelected('stirrup', setId) || selected?.setId === 'column.stirrup';
        const activeColor = activeStirSelected || stirHovered || anyColumnBarSelected ? '#2ECC71' : zone === 'dense' ? '#1E8449' : '#27AE60';
        const stirEmissiveIntensity = activeStirSelected ? 0.3 : anyColumnBarSelected || isRelated(setId) ? 0.14 : 0;
        const stirHitR = Math.max(STIR_D * 2.5, MIN_STIRRUP_HIT_RADIUS);
        const showSolid = renderMode === 'solid' || (renderMode === 'hybrid' && (activeStirSelected || stirHovered || anyColumnBarSelected));
        const showCenterline = renderMode === 'centerline' || !showSolid;
        const outerLineGeometry = new THREE.BufferGeometry().setFromPoints(activeCurves.outerCurve.getPoints(120));
        const hookLineGeometries = activeCurves.hookCurves.map((hookCurve) => new THREE.BufferGeometry().setFromPoints(hookCurve.getPoints(32)));
        const tieLineGeometry = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, -activeTieLength / 2, 0),
          new THREE.Vector3(0, activeTieLength / 2, 0),
        ]);
        return (
        <group key={`s${i}`} position={[0, y, 0]}
          onClick={(e) => { e.stopPropagation(); onSelect(activeStirSelected ? null : stirInfo); }}
          onPointerOver={(e) => { e.stopPropagation(); setStirHovered(true); document.body.style.cursor = 'pointer'; }}
          onPointerOut={() => { setStirHovered(false); document.body.style.cursor = 'auto'; }}>
          {showSolid && (
            <mesh>
              <tubeGeometry args={[activeCurves.outerCurve, 160, STIR_D / 2, 8, true]} />
              <meshStandardMaterial
                color={activeColor}
                roughness={0.4} metalness={0.6}
                emissive={activeStirSelected || anyColumnBarSelected || isRelated(setId) ? '#2ECC71' : '#000000'} emissiveIntensity={stirEmissiveIntensity} />
            </mesh>
          )}
          {showCenterline && (
            <lineSegments geometry={outerLineGeometry}>
              <lineBasicMaterial color={activeColor} transparent opacity={activeStirSelected ? 0.95 : 0.62} />
            </lineSegments>
          )}
          <mesh>
            <tubeGeometry args={[activeCurves.outerCurve, 100, stirHitR, 6, true]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
          {activeCurves.hookCurves.map((hookCurve, hi) => (
            <group key={`st-hook-${hi}`}>
              {showSolid && (
                <mesh>
                  <tubeGeometry args={[hookCurve, 40, STIR_D / 2, 6, false]} />
                  <meshStandardMaterial
                    color={activeColor}
                    roughness={0.4} metalness={0.6}
                    emissive={activeStirSelected || anyColumnBarSelected || isRelated(setId) ? '#2ECC71' : '#000000'} emissiveIntensity={stirEmissiveIntensity} />
                </mesh>
              )}
              {showCenterline && (
                <lineSegments geometry={hookLineGeometries[hi]}>
                  <lineBasicMaterial color={activeColor} transparent opacity={activeStirSelected ? 0.95 : 0.62} />
                </lineSegments>
              )}
              <mesh>
                <tubeGeometry args={[hookCurve, 28, stirHitR, 6, false]} />
                <meshBasicMaterial transparent opacity={0} depthWrite={false} />
              </mesh>
            </group>
          ))}
          {activeTieOffsets.map((x, ti) => (
            <group key={`st-tie-${ti}`} position={[x, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
              {showSolid && (
                <mesh>
                  <cylinderGeometry args={[STIR_D / 2, STIR_D / 2, activeTieLength, 8]} />
                  <meshStandardMaterial
                    color={activeColor}
                    roughness={0.4} metalness={0.6}
                    emissive={activeStirSelected || anyColumnBarSelected || isRelated(setId) ? '#2ECC71' : '#000000'} emissiveIntensity={stirEmissiveIntensity} />
                </mesh>
              )}
              {showCenterline && (
                <lineSegments geometry={tieLineGeometry}>
                  <lineBasicMaterial color={activeColor} transparent opacity={activeStirSelected ? 0.95 : 0.62} />
                </lineSegments>
              )}
              <mesh>
                <cylinderGeometry args={[stirHitR, stirHitR, activeTieLength, 6]} />
                <meshBasicMaterial transparent opacity={0} depthWrite={false} />
              </mesh>
            </group>
          ))}
        </group>
      )})}

      {cutPosition !== null && (
        <group position={[0, cutPosition, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <mesh>
            <planeGeometry args={[bm * 1.5, hm * 1.5]} />
            <meshBasicMaterial color="#3B82F6" transparent opacity={0.35} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
          <lineLoop geometry={new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(-bm * 0.75, -hm * 0.75, 0),
            new THREE.Vector3( bm * 0.75, -hm * 0.75, 0),
            new THREE.Vector3( bm * 0.75,  hm * 0.75, 0),
            new THREE.Vector3(-bm * 0.75,  hm * 0.75, 0),
          ])}>
            <lineBasicMaterial color="#2563EB" linewidth={2} />
          </lineLoop>
        </group>
      )}

      {topNodeType === 'middle' && (
        <>
          <mesh position={[0, COL_H + roofBeamH / 2, 0]}>
            <boxGeometry args={[topSpanX, roofBeamH, roofBeamB]} />
            <meshPhysicalMaterial color="#AAB4C3" transparent opacity={0.14} side={THREE.DoubleSide} depthWrite={false} roughness={0.8} />
          </mesh>
          <mesh position={[0, COL_H + roofBeamH / 2, 0]}>
            <boxGeometry args={[roofBeamB, roofBeamH, topSpanZ]} />
            <meshPhysicalMaterial color="#AAB4C3" transparent opacity={0.14} side={THREE.DoubleSide} depthWrite={false} roughness={0.8} />
          </mesh>
          {params.hasRoofSlab && (
            <mesh position={[0, COL_H + roofBeamH + roofSlabT / 2, 0]}>
              <boxGeometry args={[bm * 2.4, roofSlabT, hm * 2.4]} />
              <meshPhysicalMaterial color="#CBD5E1" transparent opacity={0.1} side={THREE.DoubleSide} depthWrite={false} roughness={0.8} />
            </mesh>
          )}
          <mesh position={[0, COL_H + roofBeamH * 0.5, 0]}>
            <boxGeometry args={[bm * 0.9, roofBeamH * 0.96, roofBeamB]} />
            <meshBasicMaterial color="#F59E0B" transparent opacity={0.08} depthWrite={false} />
          </mesh>
        </>
      )}
      {topNodeType === 'edge' && (
        <>
          <mesh position={[0, COL_H + roofBeamH / 2, 0]}>
            <boxGeometry args={[topSpanX, roofBeamH, roofBeamB]} />
            <meshPhysicalMaterial color="#AAB4C3" transparent opacity={0.14} side={THREE.DoubleSide} depthWrite={false} roughness={0.8} />
          </mesh>
          {params.hasRoofSlab && (
            <mesh position={[0, COL_H + roofBeamH + roofSlabT / 2, hm * 0.6]}>
              <boxGeometry args={[bm * 2.4, roofSlabT, hm * 1.2]} />
              <meshPhysicalMaterial color="#CBD5E1" transparent opacity={0.1} side={THREE.DoubleSide} depthWrite={false} roughness={0.8} />
            </mesh>
          )}
          <mesh position={[0, COL_H + roofBeamH * 0.5, 0]}>
            <boxGeometry args={[bm * 0.9, roofBeamH * 0.96, roofBeamB]} />
            <meshBasicMaterial color="#F59E0B" transparent opacity={0.08} depthWrite={false} />
          </mesh>
          <mesh position={[0, COL_H + roofBeamH * 0.5, hm * 0.42]}>
            <boxGeometry args={[bm * 0.9, roofBeamH * 0.96, hm * 0.36]} />
            <meshBasicMaterial color="#FBBF24" transparent opacity={0.08} depthWrite={false} />
          </mesh>
          <mesh position={[bm * 0.24, COL_H + roofBeamH * 0.35, 0]}>
            <boxGeometry args={[bm * 0.18, roofBeamH * 0.7, roofBeamB * 0.9]} />
            <meshBasicMaterial color="#F59E0B" transparent opacity={0.16} depthWrite={false} />
          </mesh>
        </>
      )}
      {topNodeType === 'corner' && (
        <>
          <mesh position={[0, COL_H + roofBeamH / 2, -hm * 0.25]}>
            <boxGeometry args={[bm * 1.5, roofBeamH, roofBeamB]} />
            <meshPhysicalMaterial color="#AAB4C3" transparent opacity={0.14} side={THREE.DoubleSide} depthWrite={false} roughness={0.8} />
          </mesh>
          <mesh position={[-bm * 0.25, COL_H + roofBeamH / 2, 0]}>
            <boxGeometry args={[roofBeamB, roofBeamH, hm * 1.5]} />
            <meshPhysicalMaterial color="#AAB4C3" transparent opacity={0.14} side={THREE.DoubleSide} depthWrite={false} roughness={0.8} />
          </mesh>
          {params.hasRoofSlab && (
            <mesh position={[bm * 0.45, COL_H + roofBeamH + roofSlabT / 2, hm * 0.45]}>
              <boxGeometry args={[bm * 1.35, roofSlabT, hm * 1.35]} />
              <meshPhysicalMaterial color="#CBD5E1" transparent opacity={0.1} side={THREE.DoubleSide} depthWrite={false} roughness={0.8} />
            </mesh>
          )}
          <mesh position={[0, COL_H + roofBeamH * 0.5, 0]}>
            <boxGeometry args={[bm * 0.9, roofBeamH * 0.96, roofBeamB]} />
            <meshBasicMaterial color="#F59E0B" transparent opacity={0.08} depthWrite={false} />
          </mesh>
          <mesh position={[0, COL_H + roofBeamH * 0.5, hm * 0.42]}>
            <boxGeometry args={[bm * 0.9, roofBeamH * 0.96, hm * 0.36]} />
            <meshBasicMaterial color="#FBBF24" transparent opacity={0.08} depthWrite={false} />
          </mesh>
          <mesh position={[bm * 0.42, COL_H + roofBeamH * 0.5, 0]}>
            <boxGeometry args={[bm * 0.36, roofBeamH * 0.96, hm * 0.9]} />
            <meshBasicMaterial color="#FBBF24" transparent opacity={0.08} depthWrite={false} />
          </mesh>
          <mesh position={[bm * 0.24, COL_H + roofBeamH * 0.35, hm * 0.24]}>
            <boxGeometry args={[bm * 0.18, roofBeamH * 0.7, roofBeamB * 0.9]} />
            <meshBasicMaterial color="#F59E0B" transparent opacity={0.16} depthWrite={false} />
          </mesh>
        </>
      )}

      {baseSupportType === 'wall' && (
        <mesh position={[0, baseSupportHeight / 2, 0]}>
          <boxGeometry args={[baseSupportWidth, baseSupportHeight, hm * 1.2]} />
          <meshPhysicalMaterial color="#B8C2D9" transparent opacity={0.12} side={THREE.DoubleSide} depthWrite={false} roughness={0.8} />
        </mesh>
      )}
      {baseSupportType === 'beam' && (
        <mesh position={[0, baseSupportHeight / 2, 0]}>
          <boxGeometry args={[bm * 1.8, baseSupportHeight, baseSupportWidth]} />
          <meshPhysicalMaterial color="#B8C2D9" transparent opacity={0.12} side={THREE.DoubleSide} depthWrite={false} roughness={0.8} />
        </mesh>
      )}
    </>
  );
}

export default function ColumnViewer({ params, cutPosition, showCut, onCutPositionChange, onShowCutChange, selectedInfo, onSelectedInfoChange }: {
  params: ColumnParams;
  cutPosition: number | null;
  showCut: boolean;
  onCutPositionChange: (v: number | null) => void;
  onShowCutChange: (v: boolean) => void;
  selectedInfo?: RebarMeshInfo | null;
  onSelectedInfoChange?: (info: RebarMeshInfo | null) => void;
}) {
  const [selected, setSelected] = useState<RebarMeshInfo | null>(null);
  const [renderMode, setRenderMode] = useState<RebarRenderMode>('solid');
  const currentSelected = selectedInfo !== undefined ? selectedInfo : selected;
  const setCurrentSelected = (info: RebarMeshInfo | null) => {
    if (selectedInfo !== undefined) onSelectedInfoChange?.(info);
    else setSelected(info);
  };
  const [concreteOpacity, setConcreteOpacity] = useState(0.15);
  const [cameraTarget, setCameraTarget] = useState<[number, number, number] | null>(null);
  const { isFullscreen: fsActive, toggle: fsToggle, containerRef: fsContainerRef, containerClass: fsClass } = useFullscreen();
  const COL_H = (params.height || 3000) * S;
  const camDist = useMemo(() => {
    const maxDim = Math.max(params.b, params.h, params.height || 3000) * S;
    return Math.max(maxDim * 1.15, 3.5);
  }, [params.b, params.h, params.height]);
  const selectedAdditionalData = useMemo(() => {
    if (!currentSelected) return undefined;
    const selected = currentSelected;
    const groupData = rebarGroupDataFromInfo(selected);
    const cover = params.cover || 25;
    const colHeight = params.height || 3000;
    const stir = parseStirrup(params.stirrup);
    const linearWeight = (d: number) => d * d / 162 / 1000;

    if (selected.type === 'stirrup') {
      const stirSpec = createStirrupShapeSpec({
        widthMm: params.b - 2 * cover - stir.diameter,
        heightMm: params.h - 2 * cover - stir.diameter,
        diameterMm: stir.diameter,
      });
      return {
        ...groupData,
        length: stirSpec.lengthMm,
        weight: stirSpec.lengthMm * linearWeight(stir.diameter),
        spacing: selected.setId?.includes('normal') ? stir.spacingNormal : stir.spacingDense,
      };
    }

    const resolved = resolveColumnBars(
      params.main,
      params.cornerMain,
      params.bMiddleMain,
      params.hMiddleMain,
      params.b - 2 * cover,
      params.h - 2 * cover,
    );
    const barInfo = selected.type === 'bMiddle'
      ? resolved.bMiddle
      : selected.type === 'hMiddle'
        ? resolved.hMiddle
        : resolved.corner;
    if (!barInfo) return undefined;

    const lapLength = calcLlE(barInfo.grade, barInfo.diameter, params.concreteGrade, params.seismicGrade);
    const length = colHeight + lapLength;
    return {
      ...groupData,
      length,
      weight: length * linearWeight(barInfo.diameter),
      lapLength,
    };
  }, [currentSelected, params]);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => { onShowCutChange(!showCut); if (showCut) onCutPositionChange(null); else onCutPositionChange(COL_H / 2); }}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${showCut ? 'bg-accent text-white' : 'bg-white border border-gray-200 text-muted hover:bg-gray-50'}`}>
          {showCut ? '关闭剖切' : '剖切视图'}
        </button>
        <div className="inline-flex items-center gap-0.5 rounded-lg border border-gray-200 bg-white p-0.5">
          {([
            ['solid', '实体'],
            ['centerline', '中心线'],
            ['hybrid', '混合'],
          ] as const).map(([mode, label]) => (
            <button
              key={mode}
              onClick={() => setRenderMode(mode)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${renderMode === mode ? 'bg-accent text-white' : 'text-muted hover:bg-gray-50'}`}
            >
              {label}
            </button>
          ))}
        </div>
        {currentSelected && (
          <button onClick={() => setCurrentSelected(null)} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 text-muted cursor-pointer hover:bg-gray-200 transition-colors">
            取消选中
          </button>
        )}
      </div>

      {showCut && (
        <div className="flex items-center gap-3 bg-white rounded-lg border border-gray-200 px-4 py-2">
          <span className="text-xs text-muted whitespace-nowrap">剖切高度</span>
          <input type="range" min={0.1} max={COL_H - 0.1} step={0.05} value={cutPosition ?? COL_H / 2}
            onChange={e => onCutPositionChange(parseFloat(e.target.value))} className="flex-1 accent-accent" />
          <span className="text-xs text-muted w-16 text-right">{((cutPosition ?? COL_H / 2) * 1000).toFixed(0)}mm</span>
        </div>
      )}

      <div ref={fsContainerRef} className={`relative w-full bg-surface overflow-hidden ${fsClass}`}>
        {currentSelected && <RebarDetailPanel info={currentSelected} onClose={() => setCurrentSelected(null)} additionalData={selectedAdditionalData} />}

        <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5">
          {[
            { name: '正面', pos: [0, COL_H / 2, camDist] as [number, number, number] },
            { name: '侧面', pos: [camDist, COL_H / 2, 0] as [number, number, number] },
            { name: '俯视', pos: [0, camDist + COL_H * 0.2, 0.1] as [number, number, number] },
            { name: '透视', pos: [camDist * 0.55, COL_H * 0.75, camDist * 0.75] as [number, number, number] },
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

        <Canvas camera={{ position: [camDist * 0.55, COL_H * 0.75, camDist * 0.75], fov: 45 }} scene={{ background: new THREE.Color('#f8fafc') }}>
          <CameraController targetPosition={cameraTarget} />
          <ambientLight intensity={0.6} />
          <directionalLight position={[5, 8, 5]} intensity={0.8} castShadow />
            <ColumnScene params={params} selected={currentSelected} onSelect={setCurrentSelected} cutPosition={cutPosition} concreteOpacity={concreteOpacity} renderMode={renderMode} />
          <Grid args={[10, 10]} position={[0, -0.01, 0]} cellColor="#E2E8F0" sectionColor="#E2E8F0" fadeDistance={15} />
          <axesHelper args={[1]} />
          <OrbitControls target={[0, COL_H / 2, 0]} enableDamping dampingFactor={0.1} />
        </Canvas>
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-primary/70 text-white text-xs px-4 py-1.5 rounded-full backdrop-blur-sm pointer-events-none">
          左键旋转 · 右键平移 · 滚轮缩放 · 点击钢筋查看详情
        </div>
      </div>
    </div>
  );
}
