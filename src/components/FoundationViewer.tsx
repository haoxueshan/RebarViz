'use client';

import { useMemo, useState, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import { Maximize2, Minimize2 } from 'lucide-react';
import { useFullscreen } from '@/lib/useFullscreen';
import * as THREE from 'three';
import type { FoundationParams, RebarMeshInfo } from '@/lib/types';
import { parseSlabRebar, parseRebar, gradeLabel } from '@/lib/rebar';
import { calcLaE } from '@/lib/anchor';
import { determineColFoundAnchor } from '@/lib/construction-rules';
import { CameraController, InstancedRebarGroup, buildZBarMatrices, buildXBarMatrices, buildVertBarMatrices, buildColBendMatrices } from '@/components/InstancedRebar';
import {
  S,
  COLOR_FOUND_BOTTOM_X, COLOR_FOUND_BOTTOM_X_HI,
  COLOR_FOUND_BOTTOM_Y, COLOR_FOUND_BOTTOM_Y_HI,
  COLOR_FOUND_COL, COLOR_FOUND_COL_HI,
  COLOR_FOUND_TOP_X, COLOR_FOUND_TOP_X_HI,
  COLOR_FOUND_TOP_Y, COLOR_FOUND_TOP_Y_HI,
  FOUNDATION_CONSTRUCTION_STEPS,
  FOUNDATION_DUAL_COL_STEPS,
} from '@/lib/constants';

/* ─── Foundation 3D Scene (InstancedMesh optimized) ─── */
function FoundationScene({ params, selected, onSelect, concreteOpacity, visibleGroups }: {
  params: FoundationParams; selected: RebarMeshInfo | null;
  onSelect: (info: RebarMeshInfo | null) => void; concreteOpacity: number;
  visibleGroups: Set<string>;
}) {
  const cover = (params.cover || 40) * S;
  const coverMm = params.cover || 40;
  const barX = parseSlabRebar(params.bottomBarX);
  const barY = parseSlabRebar(params.bottomBarY);
  const colR = parseRebar(params.colMain);

  const isDual = (params.columnCount || 1) === 2;
  const topBarX = isDual && params.topBarX ? parseSlabRebar(params.topBarX) : null;
  const topBarY = isDual && params.topBarY ? parseSlabRebar(params.topBarY) : null;

  // 22G101-3 column anchor
  const seismicGrade = params.seismicGrade || '三级';
  const laE = calcLaE(colR.grade, colR.diameter, params.concreteGrade, seismicGrade);
  const anchor = determineColFoundAnchor(params.h, coverMm, colR.diameter, laE);
  const bendLenM = anchor.bendLength * S;
  const anchorLabel = anchor.canStraight ? '直锚' : '弯锚';

  const barXInfo: RebarMeshInfo = { type: 'foundBottomX', label: 'X向底筋', detail: `${params.bottomBarX} · ${gradeLabel(barX.grade)} Φ${barX.diameter}@${barX.spacing}` };
  const barYInfo: RebarMeshInfo = { type: 'foundBottomY', label: 'Y向底筋', detail: `${params.bottomBarY} · ${gradeLabel(barY.grade)} Φ${barY.diameter}@${barY.spacing}` };
  const colInfo: RebarMeshInfo = { type: 'foundColMain', label: '柱插筋', detail: `${params.colMain} · ${colR.count}根 ${gradeLabel(colR.grade)} Φ${colR.diameter}${isDual ? ' ×2柱' : ''} · ${anchorLabel} 底弯${anchor.bendLength}mm` };
  const topXInfo: RebarMeshInfo | null = topBarX ? { type: 'foundTopX', label: '顶部纵向筋', detail: `${params.topBarX} · ${gradeLabel(topBarX.grade)} Φ${topBarX.diameter}@${topBarX.spacing}` } : null;
  const topYInfo: RebarMeshInfo | null = topBarY ? { type: 'foundTopY', label: '顶部分布筋', detail: `${params.topBarY} · ${gradeLabel(topBarY.grade)} Φ${topBarY.diameter}@${topBarY.spacing}` } : null;

  const barXSelected = selected?.type === 'foundBottomX';
  const barYSelected = selected?.type === 'foundBottomY';
  const colSelected = selected?.type === 'foundColMain';
  const topXSelected = selected?.type === 'foundTopX';
  const topYSelected = selected?.type === 'foundTopY';

  const concreteBlocks = useMemo(() => {
    if (params.shape === 'stepped') {
      const blocks: { bx: number; by: number; h: number; yOffset: number }[] = [];
      let yAcc = 0;
      for (const s of params.stepDims) {
        blocks.push({ bx: s.bx * S, by: s.by * S, h: s.h * S, yOffset: yAcc + s.h * S / 2 });
        yAcc += s.h * S;
      }
      return blocks;
    }
    return [{ bx: params.bx * S, by: params.by * S, h: params.h * S, yOffset: params.h * S / 2 }];
  }, [params.shape, params.stepDims, params.bx, params.by, params.h]);

  const totalH = params.h * S;
  const bxM = params.bx * S;
  const byM = params.by * S;
  const barXLevel = cover;
  const barYLevel = cover + barX.diameter * S;
  const zStart = -byM / 2 + cover;
  const zEnd = byM / 2 - cover;
  const xStart = -bxM / 2 + cover;
  const xEnd = bxM / 2 - cover;
  const barLenZ = Math.abs(zEnd - zStart);
  const barLenX = Math.abs(xEnd - xStart);

  // Bottom bar matrices
  const xBotMatrices = useMemo(() => {
    const count = Math.floor((params.bx - 2 * params.cover) / barX.spacing) + 1;
    const positions = Array.from({ length: count }, (_, i) => -bxM / 2 + cover + i * barX.spacing * S);
    return buildZBarMatrices(positions, barXLevel, zStart, zEnd);
  }, [params.bx, params.cover, barX.spacing, bxM, cover, barXLevel, zStart, zEnd]);

  const yBotMatrices = useMemo(() => {
    const count = Math.floor((params.by - 2 * params.cover) / barY.spacing) + 1;
    const positions = Array.from({ length: count }, (_, i) => -byM / 2 + cover + i * barY.spacing * S);
    return buildXBarMatrices(positions, barYLevel, xStart, xEnd);
  }, [params.by, params.cover, barY.spacing, byM, cover, barYLevel, xStart, xEnd]);

  // Column centers
  const colCenters = useMemo(() => {
    if (!isDual || !params.colSpacing) return [{ cx: 0, cz: 0 }];
    const halfS = (params.colSpacing * S) / 2;
    return [{ cx: -halfS, cz: 0 }, { cx: halfS, cz: 0 }];
  }, [isDual, params.colSpacing]);

  // Column insert bar data
  const colInsertH = totalH + 0.5;
  const colBarData = useMemo(() => {
    const colBxM = params.colBx * S;
    const colByM = params.colBy * S;
    const perSide = Math.max(Math.round(colR.count / 4), 2);
    const innerW = colBxM - 2 * cover;
    const innerH = colByM - 2 * cover;
    const singleCol: { x: number; z: number }[] = [];
    for (let i = 0; i < perSide; i++) singleCol.push({ x: -innerW / 2 + (innerW * i) / (perSide - 1), z: innerH / 2 });
    for (let i = 1; i < perSide; i++) singleCol.push({ x: innerW / 2, z: innerH / 2 - (innerH * i) / (perSide - 1) });
    for (let i = 1; i < perSide; i++) singleCol.push({ x: innerW / 2 - (innerW * i) / (perSide - 1), z: -innerH / 2 });
    for (let i = 1; i < perSide - 1; i++) singleCol.push({ x: -innerW / 2, z: -innerH / 2 + (innerH * i) / (perSide - 1) });
    const trimmed = singleCol.slice(0, colR.count);
    const all: { x: number; z: number }[] = [];
    for (const c of colCenters) { for (const p of trimmed) all.push({ x: p.x + c.cx, z: p.z + c.cz }); }
    return { positions: all, matrices: buildVertBarMatrices(all, colInsertH / 2) };
  }, [colR.count, params.colBx, params.colBy, cover, colCenters, colInsertH]);

  // Column bend matrices — 22G101-3
  const colBendMatrices = useMemo(() =>
    buildColBendMatrices(colBarData.positions, bendLenM, cover, colR.diameter, S),
  [colBarData.positions, bendLenM, cover, colR.diameter]);

  // Top bar matrices (dual-column)
  const topXMatrices = useMemo(() => {
    if (!isDual || !topBarX || !params.colSpacing) return [];
    const count = Math.floor((params.by - 2 * params.cover) / topBarX.spacing) + 1;
    const positions = Array.from({ length: count }, (_, i) => -byM / 2 + cover + i * topBarX.spacing * S);
    return buildXBarMatrices(positions, totalH - cover, xStart, xEnd);
  }, [isDual, topBarX, params.colSpacing, params.by, params.cover, byM, cover, totalH, xStart, xEnd]);

  const topYMatrices = useMemo(() => {
    if (!isDual || !topBarY || !params.colSpacing) return [];
    const regionW = (params.colSpacing - params.colBx);
    const count = Math.floor(regionW / topBarY.spacing) + 1;
    const startX = -(regionW * S) / 2;
    const positions = Array.from({ length: count }, (_, i) => startX + i * topBarY.spacing * S);
    const yLevel = totalH - cover - (topBarX?.diameter || 12) * S;
    return buildZBarMatrices(positions, yLevel, zStart, zEnd);
  }, [isDual, topBarY, params.colSpacing, params.colBx, topBarX, totalH, cover, zStart, zEnd]);

  return (
    <>
      <mesh position={[0, totalH / 2, 0]} onClick={() => onSelect(null)} visible={false}>
        <boxGeometry args={[bxM + 2, totalH + 2, byM + 2]} />
        <meshBasicMaterial />
      </mesh>

      {visibleGroups.has('concrete') && concreteBlocks.map((block, i) => (
        <group key={`cb${i}`}>
          <mesh position={[0, block.yOffset, 0]}>
            <boxGeometry args={[block.bx, block.h, block.by]} />
            <meshPhysicalMaterial color="#BDC3C7" transparent opacity={concreteOpacity} side={THREE.DoubleSide} depthWrite={false} roughness={0.8} />
          </mesh>
          <lineSegments position={[0, block.yOffset, 0]}>
            <edgesGeometry args={[new THREE.BoxGeometry(block.bx, block.h, block.by)]} />
            <lineBasicMaterial color="#94A3B8" />
          </lineSegments>
        </group>
      ))}

      {visibleGroups.has('concrete') && colCenters.map((c, ci) => (
        <lineSegments key={`col-outline-${ci}`} position={[c.cx, totalH, c.cz]} rotation={[Math.PI / 2, 0, 0]}>
          <edgesGeometry args={[new THREE.PlaneGeometry(params.colBx * S, params.colBy * S)]} />
          <lineBasicMaterial color="#64748B" linewidth={2} />
        </lineSegments>
      ))}

      <InstancedRebarGroup matrices={xBotMatrices} radius={barX.diameter * S / 2} length={barLenZ}
        color={COLOR_FOUND_BOTTOM_X} hiColor={COLOR_FOUND_BOTTOM_X_HI}
        info={barXInfo} selected={barXSelected} onSelect={onSelect} visible={visibleGroups.has('bottomX')} />

      <InstancedRebarGroup matrices={yBotMatrices} radius={barY.diameter * S / 2} length={barLenX}
        color={COLOR_FOUND_BOTTOM_Y} hiColor={COLOR_FOUND_BOTTOM_Y_HI}
        info={barYInfo} selected={barYSelected} onSelect={onSelect} visible={visibleGroups.has('bottomY')} />

      <InstancedRebarGroup matrices={colBarData.matrices} radius={colR.diameter * S / 2} length={colInsertH}
        color={COLOR_FOUND_COL} hiColor={COLOR_FOUND_COL_HI}
        info={colInfo} selected={colSelected} onSelect={onSelect} visible={visibleGroups.has('colMain')} />

      <InstancedRebarGroup matrices={colBendMatrices} radius={colR.diameter * S / 2} length={bendLenM}
        color={COLOR_FOUND_COL} hiColor={COLOR_FOUND_COL_HI}
        info={colInfo} selected={colSelected} onSelect={onSelect} visible={visibleGroups.has('colMain')} />

      {topXInfo && (
        <InstancedRebarGroup matrices={topXMatrices} radius={topBarX!.diameter * S / 2} length={barLenX}
          color={COLOR_FOUND_TOP_X} hiColor={COLOR_FOUND_TOP_X_HI}
          info={topXInfo} selected={topXSelected} onSelect={onSelect} visible={visibleGroups.has('topX')} />
      )}

      {topYInfo && (
        <InstancedRebarGroup matrices={topYMatrices} radius={topBarY!.diameter * S / 2} length={barLenZ}
          color={COLOR_FOUND_TOP_Y} hiColor={COLOR_FOUND_TOP_Y_HI}
          info={topYInfo} selected={topYSelected} onSelect={onSelect} visible={visibleGroups.has('topY')} />
      )}
    </>
  );
}

function InfoTooltip({ info }: { info: RebarMeshInfo }) {
  const colorMap: Record<string, string> = {
    foundBottomX: 'bg-red-50 border-red-200 text-red-800',
    foundBottomY: 'bg-blue-50 border-blue-200 text-blue-800',
    foundColMain: 'bg-purple-50 border-purple-200 text-purple-800',
    foundTopX: 'bg-orange-50 border-orange-200 text-orange-800',
    foundTopY: 'bg-green-50 border-green-200 text-green-800',
  };
  const cls = colorMap[info.type] || 'bg-gray-50 border-gray-200 text-gray-800';
  return (
    <div className={`absolute top-3 right-3 px-4 py-3 rounded-xl border text-sm shadow-lg backdrop-blur-sm z-10 max-w-xs ${cls}`}>
      <p className="font-semibold">{info.label}</p>
      <p className="text-xs mt-1 opacity-80">{info.detail}</p>
    </div>
  );
}

export default function FoundationViewer({ params }: {
  params: FoundationParams;
}) {
  const [selected, setSelected] = useState<RebarMeshInfo | null>(null);
  const [concreteOpacity, setConcreteOpacity] = useState(0.15);
  const [cameraTarget, setCameraTarget] = useState<[number, number, number] | null>(null);
  const { isFullscreen: fsActive, toggle: fsToggle, containerRef: fsContainerRef, containerClass: fsClass } = useFullscreen();
  const isDual = (params.columnCount || 1) === 2;
  const steps = isDual ? FOUNDATION_DUAL_COL_STEPS : FOUNDATION_CONSTRUCTION_STEPS;
  const [stepIndex, setStepIndex] = useState(steps.length - 1);

  const totalH = params.h * S;
  const visibleGroups = steps[Math.min(stepIndex, steps.length - 1)].groups;

  // Reset step index when switching between single/dual
  useEffect(() => { setStepIndex(steps.length - 1); }, [isDual, steps.length]);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1 bg-gray-100/80 rounded-lg p-0.5">
          {steps.map((s, i) => (
            <button key={i} onClick={() => setStepIndex(i)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium cursor-pointer transition-all ${stepIndex === i ? 'bg-white text-accent shadow-sm' : 'text-muted hover:text-primary'}`}>
              {s.label}
            </button>
          ))}
        </div>
        {selected && (
          <button onClick={() => setSelected(null)} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 text-muted cursor-pointer hover:bg-gray-200 transition-colors">
            取消选中
          </button>
        )}
      </div>

      <div ref={fsContainerRef} className={`relative w-full bg-surface overflow-hidden ${fsClass}`}>
        {selected && <InfoTooltip info={selected} />}

        <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5">
          {[
            { name: '正面', pos: [0, 1, 5] as [number, number, number] },
            { name: '侧面', pos: [5, 1, 0] as [number, number, number] },
            { name: '俯视', pos: [0, 5, 0.1] as [number, number, number] },
            { name: '透视', pos: [3, 2, 4] as [number, number, number] },
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

        <Canvas camera={{ position: [3, 2, 4], fov: 45 }} scene={{ background: new THREE.Color('#f8fafc') }}
          style={{ height: fsActive ? '100%' : '500px' }}>
          <CameraController targetPosition={cameraTarget} />
          <ambientLight intensity={0.6} />
          <directionalLight position={[5, 8, 5]} intensity={0.8} castShadow />
          <FoundationScene params={params} selected={selected} onSelect={setSelected}
            concreteOpacity={concreteOpacity} visibleGroups={visibleGroups} />
          <Grid args={[10, 10]} position={[0, -0.01, 0]} cellColor="#E2E8F0" sectionColor="#E2E8F0" fadeDistance={15} />
          <axesHelper args={[1]} />
          <OrbitControls target={[0, totalH / 2, 0]} enableDamping dampingFactor={0.1} />
        </Canvas>
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-primary/70 text-white text-xs px-4 py-1.5 rounded-full backdrop-blur-sm pointer-events-none">
          左键旋转 · 右键平移 · 滚轮缩放 · 点击钢筋查看详情
        </div>
      </div>
    </div>
  );
}
