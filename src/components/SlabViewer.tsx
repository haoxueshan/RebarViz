'use client';

import { useState, useEffect } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import { Maximize2, Minimize2 } from 'lucide-react';
import { useFullscreen } from '@/lib/useFullscreen';
import * as THREE from 'three';
import type { SlabParams, RebarMeshInfo } from '@/lib/types';
import { parseSlabRebar, gradeLabel } from '@/lib/rebar';
import { S } from '@/lib/constants';

function CameraController({ targetPosition }: { targetPosition: [number, number, number] | null }) {
  const { camera } = useThree();
  useEffect(() => {
    if (targetPosition) { camera.position.set(...targetPosition); camera.updateProjectionMatrix(); }
  }, [targetPosition, camera]);
  return null;
}

function SlabBar({ position, rotation, length, diameter, color, hiColor, info, selected, onSelect }: {
  position: [number, number, number]; rotation?: [number, number, number];
  length: number; diameter: number; color: string; hiColor: string;
  info: RebarMeshInfo; selected: boolean; onSelect: (info: RebarMeshInfo | null) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const activeColor = selected ? hiColor : hovered ? hiColor : color;
  const scale = selected ? 1.3 : hovered ? 1.15 : 1;
  return (
    <mesh position={position} rotation={rotation || [0, 0, Math.PI / 2]}
      onClick={(e) => { e.stopPropagation(); onSelect(selected ? null : info); }}
      onPointerOver={(e) => { e.stopPropagation(); setHovered(true); document.body.style.cursor = 'pointer'; }}
      onPointerOut={() => { setHovered(false); document.body.style.cursor = 'auto'; }}
      scale={[scale, 1, scale]}>
      <cylinderGeometry args={[diameter * S / 2, diameter * S / 2, length, 8]} />
      <meshStandardMaterial color={activeColor} roughness={0.4} metalness={0.6}
        emissive={selected ? hiColor : '#000000'} emissiveIntensity={selected ? 0.3 : 0} />
    </mesh>
  );
}

/** Support beam wireframe at slab edge */
function SupportBeam({ position, size }: { position: [number, number, number]; size: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh>
        <boxGeometry args={size} />
        <meshPhysicalMaterial color="#94A3B8" transparent opacity={0.06} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <lineSegments>
        <edgesGeometry args={[new THREE.BoxGeometry(...size)]} />
        <lineBasicMaterial color="#64748B" linewidth={1} />
      </lineSegments>
    </group>
  );
}

/** Vertical bend segment for bottom bar at simple support (L-shape) */
function BarBend({ position, height, diameter, color }: {
  position: [number, number, number]; height: number; diameter: number; color: string;
}) {
  return (
    <mesh position={position}>
      <cylinderGeometry args={[diameter * S / 2, diameter * S / 2, height, 6]} />
      <meshStandardMaterial color={color} roughness={0.4} metalness={0.6} />
    </mesh>
  );
}

/** Downward hook for negative bar at end support */
function NegBarHook({ position, hookLen, diameter, color }: {
  position: [number, number, number]; hookLen: number; diameter: number; color: string;
}) {
  return (
    <mesh position={position}>
      <cylinderGeometry args={[diameter * S / 2, diameter * S / 2, hookLen, 6]} />
      <meshStandardMaterial color={color} roughness={0.4} metalness={0.6} />
    </mesh>
  );
}

function SlabScene({ params, selected, onSelect, concreteOpacity }: {
  params: SlabParams; selected: RebarMeshInfo | null;
  onSelect: (info: RebarMeshInfo | null) => void; concreteOpacity: number;
}) {
  const SLAB_W = params.spanX * S;
  const SLAB_D = params.spanY * S;
  const th = params.thickness * S;
  const COVER = (params.cover || 15) * S;
  const beamW = params.supportBeamWidth * S;
  const beamH = Math.max(th * 2, 0.4); // beam depth approx 2× slab thickness
  const bx = parseSlabRebar(params.bottomX);
  const by = parseSlabRebar(params.bottomY);
  const tx = params.topX ? parseSlabRebar(params.topX) : null;
  const ty = params.topY ? parseSlabRebar(params.topY) : null;
  const negX = params.supportNegX ? parseSlabRebar(params.supportNegX) : null;
  const negY = params.supportNegY ? parseSlabRebar(params.supportNegY) : null;

  // 支座负筋伸入跨中长度: 端支座ln/4, 中间支座ln/3
  const negSupportPos = params.supportType === 'continuous' ? 'middle' as const : 'end' as const;
  const negExtendX = negSupportPos === 'end' ? SLAB_W / 4 : SLAB_W / 3;
  const negExtendY = negSupportPos === 'end' ? SLAB_D / 4 : SLAB_D / 3;

  const bottomXBars = (() => {
    const spacing = bx.spacing * S;
    const bars: number[] = [];
    for (let z = -SLAB_D / 2 + COVER; z <= SLAB_D / 2 - COVER; z += spacing) bars.push(z);
    return bars;
  })();

  const bottomYBars = (() => {
    const spacing = by.spacing * S;
    const bars: number[] = [];
    for (let x = -SLAB_W / 2 + COVER; x <= SLAB_W / 2 - COVER; x += spacing) bars.push(x);
    return bars;
  })();

  const topXBars = (() => {
    if (!tx) return [];
    const spacing = tx.spacing * S;
    const bars: number[] = [];
    for (let z = -SLAB_D / 2 + COVER; z <= SLAB_D / 2 - COVER; z += spacing) bars.push(z);
    return bars;
  })();

  const topYBars = (() => {
    if (!ty) return [];
    const spacing = ty.spacing * S;
    const bars: number[] = [];
    for (let x = -SLAB_W / 2 + COVER; x <= SLAB_W / 2 - COVER; x += spacing) bars.push(x);
    return bars;
  })();

  // 支座负筋位置 (板两端支座区域)
  const negXBars = (() => {
    if (!negX) return [];
    const spacing = negX.spacing * S;
    const bars: number[] = [];
    for (let z = -SLAB_D / 2 + COVER; z <= SLAB_D / 2 - COVER; z += spacing) bars.push(z);
    return bars;
  })();

  const negYBars = (() => {
    if (!negY) return [];
    const spacing = negY.spacing * S;
    const bars: number[] = [];
    for (let x = -SLAB_W / 2 + COVER; x <= SLAB_W / 2 - COVER; x += spacing) bars.push(x);
    return bars;
  })();

  const yBottomX = COVER;
  const yBottomY = COVER + bx.diameter * S;
  const yTopX = th - COVER;
  const yTopY = th - COVER - (tx ? tx.diameter * S : 0);

  const bxInfo: RebarMeshInfo = { type: 'bottomX', label: 'X向底筋', detail: `${params.bottomX} · ${gradeLabel(bx.grade)} Φ${bx.diameter}@${bx.spacing}` };
  const byInfo: RebarMeshInfo = { type: 'bottomY', label: 'Y向底筋', detail: `${params.bottomY} · ${gradeLabel(by.grade)} Φ${by.diameter}@${by.spacing}` };
  const txInfo: RebarMeshInfo = { type: 'topX', label: 'X向面筋', detail: `${params.topX} · ${tx ? `${gradeLabel(tx.grade)} Φ${tx.diameter}@${tx.spacing}` : ''}` };
  const tyInfo: RebarMeshInfo = { type: 'topY', label: 'Y向面筋', detail: `${params.topY} · ${ty ? `${gradeLabel(ty.grade)} Φ${ty.diameter}@${ty.spacing}` : ''}` };
  const negXInfo: RebarMeshInfo = { type: 'supportNegX', label: 'X向支座负筋', detail: `${params.supportNegX} · ${negX ? `${gradeLabel(negX.grade)} Φ${negX.diameter}@${negX.spacing}` : ''} · 伸入跨中 ln/4` };
  const negYInfo: RebarMeshInfo = { type: 'supportNegY', label: 'Y向支座负筋', detail: `${params.supportNegY} · ${negY ? `${gradeLabel(negY.grade)} Φ${negY.diameter}@${negY.spacing}` : ''} · 伸入跨中 ln/4` };

  return (
    <>
      <mesh position={[0, th / 2, 0]} onClick={() => onSelect(null)} visible={false}>
        <boxGeometry args={[SLAB_W + 1, th + 1, SLAB_D + 1]} />
        <meshBasicMaterial />
      </mesh>
      <mesh position={[0, th / 2, 0]}>
        <boxGeometry args={[SLAB_W, th, SLAB_D]} />
        <meshPhysicalMaterial color="#BDC3C7" transparent opacity={concreteOpacity} side={THREE.DoubleSide} depthWrite={false} roughness={0.8} />
      </mesh>
      <lineSegments position={[0, th / 2, 0]}>
        <edgesGeometry args={[new THREE.BoxGeometry(SLAB_W, th, SLAB_D)]} />
        <lineBasicMaterial color="#94A3B8" />
      </lineSegments>

      {bottomXBars.map((z, i) => (
        <SlabBar key={`bx${i}`} position={[0, yBottomX, z]} length={SLAB_W} diameter={bx.diameter}
          color="#C0392B" hiColor="#E74C3C" info={bxInfo} selected={selected?.type === 'bottomX'} onSelect={onSelect} />
      ))}
      {bottomYBars.map((x, i) => (
        <SlabBar key={`by${i}`} position={[x, yBottomY, 0]} rotation={[Math.PI / 2, 0, 0]} length={SLAB_D} diameter={by.diameter}
          color="#E67E22" hiColor="#F39C12" info={byInfo} selected={selected?.type === 'bottomY'} onSelect={onSelect} />
      ))}
      {topXBars.map((z, i) => (
        <SlabBar key={`tx${i}`} position={[0, yTopX, z]} length={SLAB_W} diameter={tx!.diameter}
          color="#8E44AD" hiColor="#9B59B6" info={txInfo} selected={selected?.type === 'topX'} onSelect={onSelect} />
      ))}
      {topYBars.map((x, i) => (
        <SlabBar key={`ty${i}`} position={[x, yTopY, 0]} rotation={[Math.PI / 2, 0, 0]} length={SLAB_D} diameter={ty!.diameter}
          color="#7D3C98" hiColor="#A569BD" info={tyInfo} selected={selected?.type === 'topY'} onSelect={onSelect} />
      ))}

      {/* 支座梁轮廓 (4条边) */}
      <SupportBeam position={[-SLAB_W / 2 - beamW / 2, -beamH / 2 + th / 2, 0]} size={[beamW, beamH, SLAB_D + 2 * beamW]} />
      <SupportBeam position={[SLAB_W / 2 + beamW / 2, -beamH / 2 + th / 2, 0]} size={[beamW, beamH, SLAB_D + 2 * beamW]} />
      <SupportBeam position={[0, -beamH / 2 + th / 2, -SLAB_D / 2 - beamW / 2]} size={[SLAB_W, beamH, beamW]} />
      <SupportBeam position={[0, -beamH / 2 + th / 2, SLAB_D / 2 + beamW / 2]} size={[SLAB_W, beamH, beamW]} />

      {/* 底筋弯折 (简支端L形) */}
      {params.supportType === 'simple' && bottomXBars.map((z, i) => {
        const bendH = th - 2 * COVER;
        return (
          <group key={`bxbend${i}`}>
            <BarBend position={[-SLAB_W / 2, yBottomX + bendH / 2, z]} height={bendH} diameter={bx.diameter} color="#C0392B" />
            <BarBend position={[SLAB_W / 2, yBottomX + bendH / 2, z]} height={bendH} diameter={bx.diameter} color="#C0392B" />
          </group>
        );
      })}
      {params.supportType === 'simple' && bottomYBars.map((x, i) => {
        const bendH = th - 2 * COVER;
        return (
          <group key={`bybend${i}`}>
            <BarBend position={[x, yBottomY + bendH / 2, -SLAB_D / 2]} height={bendH} diameter={by.diameter} color="#E67E22" />
            <BarBend position={[x, yBottomY + bendH / 2, SLAB_D / 2]} height={bendH} diameter={by.diameter} color="#E67E22" />
          </group>
        );
      })}

      {/* 支座负筋 — X向: 端支座=两侧各ln/4+弯钩, 中间支座=直通ln/3×2+梁宽 */}
      {negXBars.map((z, i) => {
        if (negSupportPos === 'middle') {
          // 中间支座: 一根直通过支座，两侧各伸入 ln/3
          const totalNegLen = negExtendX * 2 + beamW;
          return (
            <SlabBar key={`negx${i}`} position={[0, yTopX, z]} length={totalNegLen} diameter={negX!.diameter}
              color="#2980B9" hiColor="#3498DB" info={negXInfo} selected={selected?.type === 'supportNegX'} onSelect={onSelect} />
          );
        }
        // 端支座: 两侧各一根，带 12d 向下弯钩
        const hookLen = 12 * negX!.diameter * S;
        return (
          <group key={`negx${i}`}>
            <SlabBar position={[-SLAB_W / 2 + negExtendX / 2, yTopX, z]} length={negExtendX} diameter={negX!.diameter}
              color="#2980B9" hiColor="#3498DB" info={negXInfo} selected={selected?.type === 'supportNegX'} onSelect={onSelect} />
            <SlabBar position={[SLAB_W / 2 - negExtendX / 2, yTopX, z]} length={negExtendX} diameter={negX!.diameter}
              color="#2980B9" hiColor="#3498DB" info={negXInfo} selected={selected?.type === 'supportNegX'} onSelect={onSelect} />
            <NegBarHook position={[-SLAB_W / 2, yTopX - hookLen / 2, z]} hookLen={hookLen} diameter={negX!.diameter} color="#2980B9" />
            <NegBarHook position={[SLAB_W / 2, yTopX - hookLen / 2, z]} hookLen={hookLen} diameter={negX!.diameter} color="#2980B9" />
          </group>
        );
      })}
      {/* 支座负筋 — Y向: 端支座=两侧各ln/4+弯钩, 中间支座=直通ln/3×2+梁宽 */}
      {negYBars.map((x, i) => {
        if (negSupportPos === 'middle') {
          const totalNegLen = negExtendY * 2 + beamW;
          return (
            <SlabBar key={`negy${i}`} position={[x, yTopY, 0]} rotation={[Math.PI / 2, 0, 0]} length={totalNegLen} diameter={negY!.diameter}
              color="#16A085" hiColor="#1ABC9C" info={negYInfo} selected={selected?.type === 'supportNegY'} onSelect={onSelect} />
          );
        }
        const hookLen = 12 * negY!.diameter * S;
        return (
          <group key={`negy${i}`}>
            <SlabBar position={[x, yTopY, -SLAB_D / 2 + negExtendY / 2]} rotation={[Math.PI / 2, 0, 0]} length={negExtendY} diameter={negY!.diameter}
              color="#16A085" hiColor="#1ABC9C" info={negYInfo} selected={selected?.type === 'supportNegY'} onSelect={onSelect} />
            <SlabBar position={[x, yTopY, SLAB_D / 2 - negExtendY / 2]} rotation={[Math.PI / 2, 0, 0]} length={negExtendY} diameter={negY!.diameter}
              color="#16A085" hiColor="#1ABC9C" info={negYInfo} selected={selected?.type === 'supportNegY'} onSelect={onSelect} />
            <NegBarHook position={[x, yTopY - hookLen / 2, -SLAB_D / 2]} hookLen={hookLen} diameter={negY!.diameter} color="#16A085" />
            <NegBarHook position={[x, yTopY - hookLen / 2, SLAB_D / 2]} hookLen={hookLen} diameter={negY!.diameter} color="#16A085" />
          </group>
        );
      })}
    </>
  );
}

function InfoTooltip({ info }: { info: RebarMeshInfo }) {
  const colorMap: Record<string, string> = {
    bottomX: 'bg-red-50 border-red-200 text-red-800',
    bottomY: 'bg-orange-50 border-orange-200 text-orange-800',
    topX: 'bg-purple-50 border-purple-200 text-purple-800',
    topY: 'bg-purple-50 border-purple-200 text-purple-800',
    distribution: 'bg-green-50 border-green-200 text-green-800',
    supportNegX: 'bg-sky-50 border-sky-200 text-sky-800',
    supportNegY: 'bg-teal-50 border-teal-200 text-teal-800',
  };
  const cls = colorMap[info.type] || 'bg-gray-50 border-gray-200 text-gray-800';
  return (
    <div className={`absolute top-3 right-3 px-4 py-3 rounded-xl border text-sm shadow-lg backdrop-blur-sm z-10 max-w-xs ${cls}`}>
      <p className="font-semibold">{info.label}</p>
      <p className="text-xs mt-1 opacity-80">{info.detail}</p>
    </div>
  );
}

export default function SlabViewer({ params }: { params: SlabParams }) {
  const [selected, setSelected] = useState<RebarMeshInfo | null>(null);
  const [concreteOpacity, setConcreteOpacity] = useState(0.12);
  const [cameraTarget, setCameraTarget] = useState<[number, number, number] | null>(null);
  const { isFullscreen: fsActive, toggle: fsToggle, containerRef: fsContainerRef, containerClass: fsClass } = useFullscreen();
  const th = params.thickness * S;
  const sw = params.spanX * S;
  const sd = params.spanY * S;
  const camDist = Math.max(sw, sd, 3) * 1.2;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
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
            { name: '正面', pos: [0, 0.2, camDist] as [number, number, number] },
            { name: '侧面', pos: [camDist, 0.2, 0] as [number, number, number] },
            { name: '俯视', pos: [0, camDist * 1.2, 0.1] as [number, number, number] },
            { name: '透视', pos: [camDist * 0.7, camDist * 0.5, camDist * 0.7] as [number, number, number] },
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

        <Canvas camera={{ position: [camDist * 0.7, camDist * 0.5, camDist * 0.7], fov: 45 }} scene={{ background: new THREE.Color('#f8fafc') }}>
          <CameraController targetPosition={cameraTarget} />
          <ambientLight intensity={0.6} />
          <directionalLight position={[5, 8, 5]} intensity={0.8} castShadow />
          <SlabScene params={params} selected={selected} onSelect={setSelected} concreteOpacity={concreteOpacity} />
          <Grid args={[Math.ceil(camDist * 2), Math.ceil(camDist * 2)]} position={[0, -0.01, 0]} cellColor="#E2E8F0" sectionColor="#E2E8F0" fadeDistance={camDist * 3} />
          <axesHelper args={[1]} />
          <OrbitControls target={[0, th / 2, 0]} enableDamping dampingFactor={0.1} />
        </Canvas>
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-primary/70 text-white text-xs px-4 py-1.5 rounded-full backdrop-blur-sm pointer-events-none">
          左键旋转 · 右键平移 · 滚轮缩放 · 点击钢筋查看详情
        </div>
      </div>
    </div>
  );
}
