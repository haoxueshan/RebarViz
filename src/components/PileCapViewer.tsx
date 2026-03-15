'use client';

import { useMemo, useState, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import { Maximize2, Minimize2 } from 'lucide-react';
import { useFullscreen } from '@/lib/useFullscreen';
import * as THREE from 'three';
import type { PileCapParams, RebarMeshInfo } from '@/lib/types';
import { parseSlabRebar, parseRebar, gradeLabel } from '@/lib/rebar';
import { calcLaE } from '@/lib/anchor';
import { determineColFoundAnchor } from '@/lib/construction-rules';
import { CameraController, InstancedRebarGroup, buildZBarMatrices, buildXBarMatrices, buildVertBarMatrices, buildColBendMatrices } from '@/components/InstancedRebar';
import {
  S,
  COLOR_PC_BOTTOM_X, COLOR_PC_BOTTOM_X_HI,
  COLOR_PC_BOTTOM_Y, COLOR_PC_BOTTOM_Y_HI,
  COLOR_PC_COL, COLOR_PC_COL_HI,
  COLOR_PC_PILE, COLOR_PC_PILE_HI,
  PILECAP_CONSTRUCTION_STEPS,
} from '@/lib/constants';

/* ─── Clickable pile cylinder (kept as individual — has outline rings) ─── */
function PileCylinder({ position, height, diameter, color, hiColor, info, selected, onSelect }: {
  position: [number, number, number]; height: number; diameter: number;
  color: string; hiColor: string; info: RebarMeshInfo;
  selected: boolean; onSelect: (info: RebarMeshInfo | null) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const activeColor = selected ? hiColor : hovered ? hiColor : color;
  return (
    <group>
      <mesh position={position}
        onClick={(e) => { e.stopPropagation(); onSelect(selected ? null : info); }}
        onPointerOver={(e) => { e.stopPropagation(); setHovered(true); document.body.style.cursor = 'pointer'; }}
        onPointerOut={() => { setHovered(false); document.body.style.cursor = 'auto'; }}>
        <cylinderGeometry args={[diameter / 2, diameter / 2, height, 24]} />
        <meshStandardMaterial color={activeColor} roughness={0.7} metalness={0.2} transparent opacity={0.85} />
      </mesh>
      <lineSegments position={position}>
        <edgesGeometry args={[new THREE.CylinderGeometry(diameter / 2, diameter / 2, height, 24)]} />
        <lineBasicMaterial color="#5D6D7E" />
      </lineSegments>
    </group>
  );
}

/* ─── Compute pile positions ─── */
function computePilePositions(params: PileCapParams): { x: number; z: number }[] {
  const positions: { x: number; z: number }[] = [];
  const { pileCount, pileSpacingX, pileSpacingY } = params;

  if (pileCount === 1) {
    positions.push({ x: 0, z: 0 });
  } else if (pileCount === 2) {
    positions.push({ x: -pileSpacingX * S / 2, z: 0 });
    positions.push({ x: pileSpacingX * S / 2, z: 0 });
  } else if (pileCount === 3) {
    positions.push({ x: -pileSpacingX * S / 2, z: -pileSpacingY * S / 3 });
    positions.push({ x: pileSpacingX * S / 2, z: -pileSpacingY * S / 3 });
    positions.push({ x: 0, z: pileSpacingY * S * 2 / 3 });
  } else {
    const cols = pileSpacingY > 0
      ? Math.ceil(Math.sqrt(pileCount * (pileSpacingX / Math.max(pileSpacingY, 1))))
      : pileCount;
    const rows = Math.ceil(pileCount / cols);
    const totalW = (cols - 1) * pileSpacingX * S;
    const totalH = (rows - 1) * (pileSpacingY || pileSpacingX) * S;
    let idx = 0;
    for (let r = 0; r < rows && idx < pileCount; r++) {
      for (let c = 0; c < cols && idx < pileCount; c++) {
        positions.push({
          x: -totalW / 2 + c * pileSpacingX * S,
          z: -totalH / 2 + r * (pileSpacingY || pileSpacingX) * S,
        });
        idx++;
      }
    }
  }
  return positions;
}

/* ─── PileCap 3D Scene (InstancedMesh optimized) ─── */
function PileCapScene({ params, selected, onSelect, concreteOpacity, visibleGroups }: {
  params: PileCapParams; selected: RebarMeshInfo | null;
  onSelect: (info: RebarMeshInfo | null) => void; concreteOpacity: number;
  visibleGroups: Set<string>;
}) {
  const cover = (params.cover || 50) * S;
  const coverMm = params.cover || 50;
  const barX = parseSlabRebar(params.bottomBarX);
  const barY = parseSlabRebar(params.bottomBarY);
  const colR = parseRebar(params.colMain);

  // 22G101-3 column anchor
  const seismicGrade = params.seismicGrade || '三级';
  const laE = calcLaE(colR.grade, colR.diameter, params.concreteGrade, seismicGrade);
  const anchor = determineColFoundAnchor(params.h, coverMm, colR.diameter, laE);
  const bendLenM = anchor.bendLength * S;
  const anchorLabel = anchor.canStraight ? '直锚' : '弯锚';

  const barXInfo: RebarMeshInfo = { type: 'pcBottomX', label: 'X向底筋', detail: `${params.bottomBarX} · ${gradeLabel(barX.grade)} Φ${barX.diameter}@${barX.spacing}` };
  const barYInfo: RebarMeshInfo = { type: 'pcBottomY', label: 'Y向底筋', detail: `${params.bottomBarY} · ${gradeLabel(barY.grade)} Φ${barY.diameter}@${barY.spacing}` };
  const colInfo: RebarMeshInfo = { type: 'pcColMain', label: '柱插筋', detail: `${params.colMain} · ${colR.count}根 ${gradeLabel(colR.grade)} Φ${colR.diameter} · ${anchorLabel} 底弯${anchor.bendLength}mm` };
  const pileInfo: RebarMeshInfo = { type: 'pcPile', label: '桩基', detail: `Φ${params.pileDiameter}mm × ${params.pileLength}mm · ${params.pileCount}根` };

  const barXSelected = selected?.type === 'pcBottomX';
  const barYSelected = selected?.type === 'pcBottomY';
  const colSelected = selected?.type === 'pcColMain';
  const pileSelected = selected?.type === 'pcPile';

  const bxM = params.bx * S;
  const byM = params.by * S;
  const hM = params.h * S;
  const pileLenVis = Math.min(params.pileLength * S, hM * 3);
  const pileDiaVis = params.pileDiameter * S;
  const barXLevel = cover;
  const barYLevel = cover + barX.diameter * S;
  const zStart = -byM / 2 + cover;
  const zEnd = byM / 2 - cover;
  const xStart = -bxM / 2 + cover;
  const xEnd = bxM / 2 - cover;
  const barLenZ = Math.abs(zEnd - zStart);
  const barLenX = Math.abs(xEnd - xStart);

  const pilePositions = useMemo(() => computePilePositions(params), [params]);

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

  // Column insert bar data
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
    return { positions: trimmed, matrices: buildVertBarMatrices(trimmed, colInsertH / 2) };
  }, [colR.count, params.colBx, params.colBy, cover, colInsertH]);

  // Column bend matrices — 22G101-3
  const colBendMatrices = useMemo(() =>
    buildColBendMatrices(colBarData.positions, bendLenM, cover, colR.diameter, S),
  [colBarData.positions, bendLenM, cover, colR.diameter]);

  return (
    <>
      <mesh position={[0, hM / 2, 0]} onClick={() => onSelect(null)} visible={false}>
        <boxGeometry args={[bxM + 2, hM + pileLenVis + 2, byM + 2]} />
        <meshBasicMaterial />
      </mesh>

      {visibleGroups.has('pile') && pilePositions.map((p, i) => (
        <PileCylinder key={`pile${i}`}
          position={[p.x, -pileLenVis / 2, p.z]}
          height={pileLenVis} diameter={pileDiaVis}
          color={COLOR_PC_PILE} hiColor={COLOR_PC_PILE_HI}
          info={pileInfo} selected={pileSelected} onSelect={onSelect} />
      ))}

      {visibleGroups.has('concrete') && (
        <group>
          <mesh position={[0, hM / 2, 0]}>
            <boxGeometry args={[bxM, hM, byM]} />
            <meshPhysicalMaterial color="#BDC3C7" transparent opacity={concreteOpacity} side={THREE.DoubleSide} depthWrite={false} roughness={0.8} />
          </mesh>
          <lineSegments position={[0, hM / 2, 0]}>
            <edgesGeometry args={[new THREE.BoxGeometry(bxM, hM, byM)]} />
            <lineBasicMaterial color="#94A3B8" />
          </lineSegments>
        </group>
      )}

      {visibleGroups.has('concrete') && (
        <lineSegments position={[0, hM, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <edgesGeometry args={[new THREE.PlaneGeometry(params.colBx * S, params.colBy * S)]} />
          <lineBasicMaterial color="#64748B" linewidth={2} />
        </lineSegments>
      )}

      <InstancedRebarGroup matrices={xBotMatrices} radius={barX.diameter * S / 2} length={barLenZ}
        color={COLOR_PC_BOTTOM_X} hiColor={COLOR_PC_BOTTOM_X_HI}
        info={barXInfo} selected={barXSelected} onSelect={onSelect} visible={visibleGroups.has('bottomX')} />

      <InstancedRebarGroup matrices={yBotMatrices} radius={barY.diameter * S / 2} length={barLenX}
        color={COLOR_PC_BOTTOM_Y} hiColor={COLOR_PC_BOTTOM_Y_HI}
        info={barYInfo} selected={barYSelected} onSelect={onSelect} visible={visibleGroups.has('bottomY')} />

      <InstancedRebarGroup matrices={colBarData.matrices} radius={colR.diameter * S / 2} length={colInsertH}
        color={COLOR_PC_COL} hiColor={COLOR_PC_COL_HI}
        info={colInfo} selected={colSelected} onSelect={onSelect} visible={visibleGroups.has('colMain')} />

      <InstancedRebarGroup matrices={colBendMatrices} radius={colR.diameter * S / 2} length={bendLenM}
        color={COLOR_PC_COL} hiColor={COLOR_PC_COL_HI}
        info={colInfo} selected={colSelected} onSelect={onSelect} visible={visibleGroups.has('colMain')} />
    </>
  );
}

/* ─── Main Viewer ─── */
export default function PileCapViewer({ params }: { params: PileCapParams }) {
  const [selected, setSelected] = useState<RebarMeshInfo | null>(null);
  const [concreteOpacity, setConcreteOpacity] = useState(0.25);
  const { containerRef: fsRef, isFullscreen: fsActive, toggle: fsToggle } = useFullscreen();

  const [stepIdx, setStepIdx] = useState(PILECAP_CONSTRUCTION_STEPS.length - 1);
  const visibleGroups = PILECAP_CONSTRUCTION_STEPS[stepIdx]?.groups ?? new Set<string>();
  const [cameraTarget, setCameraTarget] = useState<[number, number, number] | null>(null);

  const totalH = params.h * S;

  useEffect(() => { setSelected(null); }, [params]);

  return (
    <div ref={fsRef} className={`bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden ${fsActive ? 'fixed inset-0 z-50' : ''}`}>
      {/* Top controls */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 bg-gradient-to-r from-gray-50/80 to-white">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-primary">3D 承台模型</span>
          {selected && (
            <span className="text-xs text-accent bg-accent/10 px-2 py-0.5 rounded-full">
              {selected.label}: {selected.detail}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-muted">
            透明度
            <input type="range" min={0} max={60} value={concreteOpacity * 100} onChange={e => setConcreteOpacity(+e.target.value / 100)}
              className="w-16 h-1 accent-blue-500" />
          </label>
          <div className="flex items-center gap-1">
            {PILECAP_CONSTRUCTION_STEPS.map((step, i) => (
              <button key={i} onClick={() => setStepIdx(i)}
                className={`px-2 py-0.5 rounded text-[11px] cursor-pointer transition-all ${i === stepIdx ? 'bg-accent text-white' : 'bg-gray-100 text-muted hover:bg-gray-200'}`}>
                {step.label}
              </button>
            ))}
          </div>
          <button onClick={fsToggle} className="p-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 cursor-pointer transition-colors">
            {fsActive ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
      {/* Canvas */}
      <div className="relative bg-gradient-to-br from-slate-50 to-gray-100">
        <Canvas camera={{ position: [3, 3, 3], fov: 40 }} gl={{ antialias: true, alpha: true }}
          style={{ height: fsActive ? '100%' : '500px' }}>
          <CameraController targetPosition={cameraTarget} />
          <ambientLight intensity={0.6} />
          <directionalLight position={[5, 8, 5]} intensity={0.8} castShadow />
          <PileCapScene params={params} selected={selected} onSelect={setSelected}
            concreteOpacity={concreteOpacity} visibleGroups={visibleGroups} />
          <Grid args={[10, 10]} position={[0, -0.01, 0]} cellColor="#E2E8F0" sectionColor="#E2E8F0" fadeDistance={15} />
          <axesHelper args={[1]} />
          <OrbitControls target={[0, totalH / 2, 0]} enableDamping dampingFactor={0.1} />
        </Canvas>
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-primary/70 text-white text-xs px-4 py-1.5 rounded-full backdrop-blur-sm pointer-events-none">
          左键旋转 · 右键平移 · 滚轮缩放 · 点击构件查看详情
        </div>
      </div>
    </div>
  );
}
