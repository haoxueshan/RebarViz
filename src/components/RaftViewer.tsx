'use client';

import { useMemo, useState, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import { Maximize2, Minimize2 } from 'lucide-react';
import { useFullscreen } from '@/lib/useFullscreen';
import * as THREE from 'three';
import type { RaftFoundationParams, RebarMeshInfo } from '@/lib/types';
import { parseSlabRebar, parseRebar, gradeLabel } from '@/lib/rebar';
import { calcLaE } from '@/lib/anchor';
import { determineColFoundAnchor } from '@/lib/construction-rules';
import { CameraController, InstancedRebarGroup, buildZBarMatrices, buildXBarMatrices, buildVertBarMatrices, buildColBendMatrices } from '@/components/InstancedRebar';
import {
  S,
  COLOR_RAFT_BOTTOM_X, COLOR_RAFT_BOTTOM_X_HI,
  COLOR_RAFT_BOTTOM_Y, COLOR_RAFT_BOTTOM_Y_HI,
  COLOR_RAFT_TOP_X, COLOR_RAFT_TOP_X_HI,
  COLOR_RAFT_TOP_Y, COLOR_RAFT_TOP_Y_HI,
  COLOR_RAFT_COL, COLOR_RAFT_COL_HI,
  RAFT_CONSTRUCTION_STEPS,
} from '@/lib/constants';

/* ─── Raft 3D Scene (InstancedMesh optimized) ─── */
function RaftScene({ params, selected, onSelect, concreteOpacity, visibleGroups }: {
  params: RaftFoundationParams; selected: RebarMeshInfo | null;
  onSelect: (info: RebarMeshInfo | null) => void; concreteOpacity: number;
  visibleGroups: Set<string>;
}) {
  const cover = (params.cover || 40) * S;
  const botX = parseSlabRebar(params.bottomBarX);
  const botY = parseSlabRebar(params.bottomBarY);
  const topX = params.topBarX ? parseSlabRebar(params.topBarX) : null;
  const topY = params.topBarY ? parseSlabRebar(params.topBarY) : null;
  const colR = parseRebar(params.colMain);

  const lxM = params.lx * S;
  const lyM = params.ly * S;
  const hM = params.h * S;

  const botXInfo: RebarMeshInfo = { type: 'raftBottomX', label: 'X向底筋', detail: `${params.bottomBarX} · ${gradeLabel(botX.grade)} Φ${botX.diameter}@${botX.spacing}` };
  const botYInfo: RebarMeshInfo = { type: 'raftBottomY', label: 'Y向底筋', detail: `${params.bottomBarY} · ${gradeLabel(botY.grade)} Φ${botY.diameter}@${botY.spacing}` };
  const topXInfo: RebarMeshInfo | null = topX ? { type: 'raftTopX', label: 'X向面筋', detail: `${params.topBarX} · ${gradeLabel(topX.grade)} Φ${topX.diameter}@${topX.spacing}` } : null;
  const topYInfo: RebarMeshInfo | null = topY ? { type: 'raftTopY', label: 'Y向面筋', detail: `${params.topBarY} · ${gradeLabel(topY.grade)} Φ${topY.diameter}@${topY.spacing}` } : null;
  const colTotal = params.colCountX * params.colCountY;

  // 22G101-3 柱插筋锚固
  const coverMm = params.cover || 40;
  const laE = calcLaE(colR.grade, colR.diameter, params.concreteGrade, params.seismicGrade);
  const anchor = determineColFoundAnchor(params.h, coverMm, colR.diameter, laE);
  const bendLenM = anchor.bendLength * S; // bend length in scene units

  const anchorLabel = anchor.canStraight ? '直锚' : '弯锚';
  const colInfo: RebarMeshInfo = { type: 'raftColMain', label: '柱插筋', detail: `${params.colMain} · ${colR.count}根/柱 × ${colTotal}柱 · ${anchorLabel} 底弯${anchor.bendLength}mm` };

  const botXSelected = selected?.type === 'raftBottomX';
  const botYSelected = selected?.type === 'raftBottomY';
  const topXSelected = selected?.type === 'raftTopX';
  const topYSelected = selected?.type === 'raftTopY';
  const colSelected = selected?.type === 'raftColMain';

  const MAX_BARS = 200; // InstancedMesh can handle far more than individual meshes

  const barXLevel = cover;
  const barYLevel = cover + botX.diameter * S;
  const zStart = -lyM / 2 + cover;
  const zEnd = lyM / 2 - cover;
  const xStart = -lxM / 2 + cover;
  const xEnd = lxM / 2 - cover;
  const barLenZ = Math.abs(zEnd - zStart);
  const barLenX = Math.abs(xEnd - xStart);

  // X bottom bar positions & matrices
  const { matrices: xBotMatrices } = useMemo(() => {
    const count = Math.min(Math.floor((params.lx - 2 * (params.cover || 40)) / botX.spacing) + 1, MAX_BARS);
    const startX = -lxM / 2 + cover;
    const step = botX.spacing * S;
    const positions = Array.from({ length: count }, (_, i) => startX + i * step);
    return { positions, matrices: buildZBarMatrices(positions, barXLevel, zStart, zEnd) };
  }, [params.lx, params.cover, botX.spacing, lxM, cover, barXLevel, zStart, zEnd]);

  // Y bottom bar positions & matrices
  const { matrices: yBotMatrices } = useMemo(() => {
    const count = Math.min(Math.floor((params.ly - 2 * (params.cover || 40)) / botY.spacing) + 1, MAX_BARS);
    const startZ = -lyM / 2 + cover;
    const step = botY.spacing * S;
    const positions = Array.from({ length: count }, (_, i) => startZ + i * step);
    return { positions, matrices: buildXBarMatrices(positions, barYLevel, xStart, xEnd) };
  }, [params.ly, params.cover, botY.spacing, lyM, cover, barYLevel, xStart, xEnd]);

  // X top bar matrices
  const xTopMatrices = useMemo(() => {
    if (!topX) return [];
    const count = Math.min(Math.floor((params.lx - 2 * (params.cover || 40)) / topX.spacing) + 1, MAX_BARS);
    const startX = -lxM / 2 + cover;
    const step = topX.spacing * S;
    const positions = Array.from({ length: count }, (_, i) => startX + i * step);
    return buildZBarMatrices(positions, hM - cover, zStart, zEnd);
  }, [params.lx, params.cover, topX, lxM, cover, hM, zStart, zEnd]);

  // Y top bar matrices
  const yTopMatrices = useMemo(() => {
    if (!topY) return [];
    const count = Math.min(Math.floor((params.ly - 2 * (params.cover || 40)) / topY.spacing) + 1, MAX_BARS);
    const startZ = -lyM / 2 + cover;
    const step = topY.spacing * S;
    const positions = Array.from({ length: count }, (_, i) => startZ + i * step);
    const yLevel = hM - cover - (topX?.diameter || 12) * S;
    return buildXBarMatrices(positions, yLevel, xStart, xEnd);
  }, [params.ly, params.cover, topY, topX, lyM, cover, hM, xStart, xEnd]);

  // Column positions on the raft
  const colPositionsAll = useMemo(() => {
    const positions: { cx: number; cz: number }[] = [];
    if (colTotal === 0) return [];
    const halfGridX = ((params.colCountX - 1) * params.colSpacingX * S) / 2;
    const halfGridZ = ((params.colCountY - 1) * params.colSpacingY * S) / 2;
    for (let ix = 0; ix < params.colCountX; ix++) {
      for (let iy = 0; iy < params.colCountY; iy++) {
        positions.push({ cx: -halfGridX + ix * params.colSpacingX * S, cz: -halfGridZ + iy * params.colSpacingY * S });
      }
    }
    return positions;
  }, [params.colCountX, params.colCountY, params.colSpacingX, params.colSpacingY, colTotal]);

  // Column insert bar positions & matrices
  const colInsertH = hM + 0.5;
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
    for (const c of colPositionsAll) {
      for (const p of trimmed) all.push({ x: p.x + c.cx, z: p.z + c.cz });
    }
    return { positions: all, matrices: buildVertBarMatrices(all, colInsertH / 2) };
  }, [colR.count, params.colBx, params.colBy, cover, colPositionsAll, colInsertH]);

  // Column bend bar matrices — 22G101-3
  const colBendMatrices = useMemo(() =>
    buildColBendMatrices(colBarData.positions, bendLenM, cover, colR.diameter, S),
  [colBarData.positions, bendLenM, cover, colR.diameter]);

  return (
    <>
      {/* Click-to-deselect background */}
      <mesh position={[0, hM / 2, 0]} onClick={() => onSelect(null)} visible={false}>
        <boxGeometry args={[lxM + 2, hM + 2, lyM + 2]} />
        <meshBasicMaterial />
      </mesh>

      {/* Concrete slab */}
      {visibleGroups.has('concrete') && (
        <group>
          <mesh position={[0, hM / 2, 0]}>
            <boxGeometry args={[lxM, hM, lyM]} />
            <meshPhysicalMaterial color="#BDC3C7" transparent opacity={concreteOpacity} side={THREE.DoubleSide} depthWrite={false} roughness={0.8} />
          </mesh>
          <lineSegments position={[0, hM / 2, 0]}>
            <edgesGeometry args={[new THREE.BoxGeometry(lxM, hM, lyM)]} />
            <lineBasicMaterial color="#94A3B8" />
          </lineSegments>
        </group>
      )}

      {/* Column outlines on top */}
      {visibleGroups.has('concrete') && colPositionsAll.map((c, ci) => (
        <lineSegments key={`col-outline-${ci}`} position={[c.cx, hM, c.cz]} rotation={[Math.PI / 2, 0, 0]}>
          <edgesGeometry args={[new THREE.PlaneGeometry(params.colBx * S, params.colBy * S)]} />
          <lineBasicMaterial color="#64748B" linewidth={2} />
        </lineSegments>
      ))}

      {/* X-direction bottom rebars — 1 draw call */}
      <InstancedRebarGroup
        matrices={xBotMatrices} radius={botX.diameter * S / 2} length={barLenZ}
        color={COLOR_RAFT_BOTTOM_X} hiColor={COLOR_RAFT_BOTTOM_X_HI}
        info={botXInfo} selected={botXSelected} onSelect={onSelect}
        visible={visibleGroups.has('bottomX')} />

      {/* Y-direction bottom rebars — 1 draw call */}
      <InstancedRebarGroup
        matrices={yBotMatrices} radius={botY.diameter * S / 2} length={barLenX}
        color={COLOR_RAFT_BOTTOM_Y} hiColor={COLOR_RAFT_BOTTOM_Y_HI}
        info={botYInfo} selected={botYSelected} onSelect={onSelect}
        visible={visibleGroups.has('bottomY')} />

      {/* X-direction top rebars — 1 draw call */}
      {topXInfo && (
        <InstancedRebarGroup
          matrices={xTopMatrices} radius={topX!.diameter * S / 2} length={barLenZ}
          color={COLOR_RAFT_TOP_X} hiColor={COLOR_RAFT_TOP_X_HI}
          info={topXInfo} selected={topXSelected} onSelect={onSelect}
          visible={visibleGroups.has('topX')} />
      )}

      {/* Y-direction top rebars — 1 draw call */}
      {topYInfo && (
        <InstancedRebarGroup
          matrices={yTopMatrices} radius={topY!.diameter * S / 2} length={barLenX}
          color={COLOR_RAFT_TOP_Y} hiColor={COLOR_RAFT_TOP_Y_HI}
          info={topYInfo} selected={topYSelected} onSelect={onSelect}
          visible={visibleGroups.has('topY')} />
      )}

      {/* Column insert rebars — 1 draw call */}
      <InstancedRebarGroup
        matrices={colBarData.matrices} radius={colR.diameter * S / 2} length={colInsertH}
        color={COLOR_RAFT_COL} hiColor={COLOR_RAFT_COL_HI}
        info={colInfo} selected={colSelected} onSelect={onSelect}
        visible={visibleGroups.has('colMain')} />

      {/* Column insert bottom bends — 22G101-3 (6d/15d) */}
      <InstancedRebarGroup
        matrices={colBendMatrices} radius={colR.diameter * S / 2} length={bendLenM}
        color={COLOR_RAFT_COL} hiColor={COLOR_RAFT_COL_HI}
        info={colInfo} selected={colSelected} onSelect={onSelect}
        visible={visibleGroups.has('colMain')} />
    </>
  );
}

function InfoTooltip({ info }: { info: RebarMeshInfo }) {
  const colorMap: Record<string, string> = {
    raftBottomX: 'bg-red-50 border-red-200 text-red-800',
    raftBottomY: 'bg-blue-50 border-blue-200 text-blue-800',
    raftTopX: 'bg-orange-50 border-orange-200 text-orange-800',
    raftTopY: 'bg-green-50 border-green-200 text-green-800',
    raftColMain: 'bg-purple-50 border-purple-200 text-purple-800',
  };
  const cls = colorMap[info.type] || 'bg-gray-50 border-gray-200 text-gray-800';
  return (
    <div className={`absolute top-3 right-3 px-4 py-3 rounded-xl border text-sm shadow-lg backdrop-blur-sm z-10 max-w-xs ${cls}`}>
      <p className="font-semibold">{info.label}</p>
      <p className="text-xs mt-1 opacity-80">{info.detail}</p>
    </div>
  );
}

export default function RaftViewer({ params }: { params: RaftFoundationParams }) {
  const [selected, setSelected] = useState<RebarMeshInfo | null>(null);
  const [concreteOpacity, setConcreteOpacity] = useState(0.15);
  const [cameraTarget, setCameraTarget] = useState<[number, number, number] | null>(null);
  const { isFullscreen: fsActive, toggle: fsToggle, containerRef: fsContainerRef, containerClass: fsClass } = useFullscreen();
  const steps = RAFT_CONSTRUCTION_STEPS;
  const [stepIndex, setStepIndex] = useState(steps.length - 1);

  const hM = params.h * S;
  const visibleGroups = steps[Math.min(stepIndex, steps.length - 1)].groups;

  // Compute camera distance based on raft size
  const camDist = useMemo(() => {
    const maxDim = Math.max(params.lx, params.ly) * S;
    return Math.max(maxDim * 0.8, 3);
  }, [params.lx, params.ly]);

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
            { name: '正面', pos: [0, camDist * 0.3, camDist] as [number, number, number] },
            { name: '侧面', pos: [camDist, camDist * 0.3, 0] as [number, number, number] },
            { name: '俯视', pos: [0, camDist, 0.1] as [number, number, number] },
            { name: '透视', pos: [camDist * 0.6, camDist * 0.4, camDist * 0.8] as [number, number, number] },
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

        <Canvas camera={{ position: [camDist * 0.6, camDist * 0.4, camDist * 0.8], fov: 45 }} scene={{ background: new THREE.Color('#f8fafc') }}
          style={{ height: fsActive ? '100%' : '500px' }}>
          <CameraController targetPosition={cameraTarget} />
          <ambientLight intensity={0.6} />
          <directionalLight position={[5, 8, 5]} intensity={0.8} castShadow />
          <RaftScene params={params} selected={selected} onSelect={setSelected}
            concreteOpacity={concreteOpacity} visibleGroups={visibleGroups} />
          <Grid args={[20, 20]} position={[0, -0.01, 0]} cellColor="#E2E8F0" sectionColor="#E2E8F0" fadeDistance={25} />
          <axesHelper args={[1]} />
          <OrbitControls target={[0, hM / 2, 0]} enableDamping dampingFactor={0.1} />
        </Canvas>
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-primary/70 text-white text-xs px-4 py-1.5 rounded-full backdrop-blur-sm pointer-events-none">
          左键旋转 · 右键平移 · 滚轮缩放 · 点击钢筋查看详情
        </div>
      </div>
    </div>
  );
}
