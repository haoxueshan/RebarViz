'use client';

import { useMemo, useState, useCallback, useEffect } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import { Camera, Maximize2, Minimize2 } from 'lucide-react';
import { useFullscreen } from '@/lib/useFullscreen';
import * as THREE from 'three';
import type { BeamParams, RebarMeshInfo } from '@/lib/types';
import { parseRebar, parseRebarBottom, parseStirrup, parseSideBar, parseTieBar, autoTieBar, tieBarToString, gradeLabel } from '@/lib/rebar';
import { calcSupportRebarLength, calcBeamEndAnchor, calcLaE } from '@/lib/anchor';
import { beamDenseZoneLength } from '@/lib/construction-rules';
import { RebarDetailPanel } from './RebarDetailPanel';
import {
  S,
  COLOR_REBAR, COLOR_REBAR_HI,
  COLOR_STIRRUP, COLOR_STIRRUP_HI,
  COLOR_STIRRUP_DENSE, COLOR_STIRRUP_DENSE_HI,
  COLOR_STIRRUP_NORMAL, COLOR_STIRRUP_NORMAL_HI,
  COLOR_SUPPORT, COLOR_SUPPORT_HI,
  COLOR_ERECTION, COLOR_ERECTION_HI,
  COLOR_HAUNCH, COLOR_HAUNCH_HI,
  COLOR_SIDEBAR, COLOR_SIDEBAR_HI,
  BEAM_CONSTRUCTION_STEPS,
} from '@/lib/constants';
import { layoutBars, formatAnchorDesc } from '@/lib/layout';
import {
  RebarBar,
  SlopedRebarBar,
  StirrupRing,
  BentRebarEnd,
  TieBarMesh,
  DimLine,
  VDimLine,
  DenseZoneMark,
  ColumnStub,
  SectionCutPlane,
} from './three';
import { useKeyboard, createViewerBindings } from '@/lib/useKeyboard';
import { KeyboardHelp } from './KeyboardHelp';

/* Haunch (加腋) concrete geometry */
function HaunchShape({ beamLen, beamH, beamB, haunchLen, haunchH, haunchType, side, opacity }: {
  beamLen: number; beamH: number; beamB: number;
  haunchLen: number; haunchH: number; haunchType: 'horizontal' | 'vertical';
  side: 'left' | 'right'; opacity: number;
}) {
  // Use BufferGeometry for precise wedge shape
  const { meshGeo, edgeGeo } = useMemo(() => {
    const halfB = beamB / 2;
    // Direction: left haunch extends from -beamLen/2 rightward, right from +beamLen/2 leftward
    const xStart = side === 'left' ? -beamLen / 2 : beamLen / 2;
    const xEnd = side === 'left' ? -beamLen / 2 + haunchLen : beamLen / 2 - haunchLen;

    if (haunchType === 'horizontal') {
      // 水平加腋: 梁底部向下的三角形楔体
      // 柱面处厚度 = haunchH, 跨中端厚度 = 0
      // 8 vertices forming a wedge (triangular prism along Z)
      const vertices = new Float32Array([
        // Bottom face (triangle): at column face full depth, at span end zero depth
        xStart, 0, -halfB,           // 0: column face, beam bottom, front
        xStart, 0, halfB,            // 1: column face, beam bottom, back
        xStart, -haunchH, -halfB,    // 2: column face, haunch bottom, front
        xStart, -haunchH, halfB,     // 3: column face, haunch bottom, back
        xEnd, 0, -halfB,             // 4: span end, beam bottom, front
        xEnd, 0, halfB,              // 5: span end, beam bottom, back
      ]);
      // 6 triangles (12 indices for 4 faces)
      const indices = [
        // Column face (rectangle: 0,1,3,2)
        0, 1, 3,  0, 3, 2,
        // Front face (triangle: 0, 2, 4)
        0, 2, 4,
        // Back face (triangle: 1, 5, 3)
        1, 5, 3,
        // Bottom face (triangle: 2, 3, 4 and 3, 5, 4)
        2, 3, 4,  3, 5, 4,
        // Top face (rectangle: 0, 4, 5, 1)
        0, 4, 5,  0, 5, 1,
      ];
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
      geo.setIndex(indices);
      geo.computeVertexNormals();
      return { meshGeo: geo, edgeGeo: new THREE.EdgesGeometry(geo) };
    } else {
      // 竖向加腋: 梁顶部两侧向外扩展的楔体
      // 柱面处宽度增加 haunchH (每侧), 跨中端增加 0
      const vertices = new Float32Array([
        // Front side wedge (+Z side)
        xStart, beamH, halfB,              // 0: column face, beam top, outer edge
        xStart, 0, halfB,                  // 1: column face, beam bottom, outer edge
        xStart, beamH, halfB + haunchH,    // 2: column face, beam top, haunch outer
        xStart, 0, halfB + haunchH,        // 3: column face, beam bottom, haunch outer
        xEnd, beamH, halfB,                // 4: span end, beam top, outer edge
        xEnd, 0, halfB,                    // 5: span end, beam bottom, outer edge
      ]);
      const indices = [
        // Column face (rect: 0,1,3,2)
        0, 1, 3,  0, 3, 2,
        // Outer face (tri: 2,3,4 and 3,5,4)
        2, 3, 4,  3, 5, 4,
        // Top face (tri: 0,2,4)
        0, 2, 4,
        // Bottom face (tri: 1,5,3)
        1, 5, 3,
        // Inner face (rect: 0,4,5,1)
        0, 4, 5,  0, 5, 1,
      ];
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
      geo.setIndex(indices);
      geo.computeVertexNormals();

      // Back side wedge (-Z side) - mirror
      const verticesBack = new Float32Array([
        xStart, beamH, -halfB,              // 0
        xStart, 0, -halfB,                  // 1
        xStart, beamH, -halfB - haunchH,    // 2
        xStart, 0, -halfB - haunchH,        // 3
        xEnd, beamH, -halfB,                // 4
        xEnd, 0, -halfB,                    // 5
      ]);
      const geoBack = new THREE.BufferGeometry();
      geoBack.setAttribute('position', new THREE.BufferAttribute(verticesBack, 3));
      geoBack.setIndex(indices);
      geoBack.computeVertexNormals();

      // Merge both sides
      const merged = new THREE.BufferGeometry();
      const allVerts = new Float32Array(12 * 3);
      allVerts.set(vertices, 0);
      allVerts.set(verticesBack, 18);
      const allIndices = [...indices, ...indices.map(i => i + 6)];
      merged.setAttribute('position', new THREE.BufferAttribute(allVerts, 3));
      merged.setIndex(allIndices);
      merged.computeVertexNormals();

      return { meshGeo: merged, edgeGeo: new THREE.EdgesGeometry(merged) };
    }
  }, [beamLen, beamH, beamB, haunchLen, haunchH, haunchType, side]);

  return (
    <group>
      <mesh geometry={meshGeo}>
        <meshPhysicalMaterial color="#A0AEC0" transparent opacity={opacity} side={THREE.DoubleSide} depthWrite={false} roughness={0.8} />
      </mesh>
      <lineSegments geometry={edgeGeo}>
        <lineBasicMaterial color="#718096" transparent opacity={0.6} />
      </lineSegments>
    </group>
  );
}

/* Camera controller */
function CameraController({ targetPosition }: { targetPosition: [number, number, number] | null }) {
  const { camera } = useThree();
  useEffect(() => {
    if (targetPosition) {
      camera.position.set(...targetPosition);
      camera.updateProjectionMatrix();
    }
  }, [targetPosition, camera]);
  return null;
}

function BeamScene({ params, selected, onSelect, cutPosition, concreteOpacity, showDimensions, visibleGroups }: {
  params: BeamParams; selected: RebarMeshInfo | null;
  onSelect: (info: RebarMeshInfo | null) => void; cutPosition: number | null; concreteOpacity: number;
  showDimensions: boolean; visibleGroups?: Set<string>;
}) {
  const bm = params.b * S;
  const hm = params.h * S;
  const COVER = (params.cover || 25) * S;
  const HC = (params.hc || 500) * S; // 柱截面宽度

  // ============ 多跨布局 (支持各跨独立宽度/跨长) ============
  const spanCount = params.spanCount || 1;
  const spanLengthsMm: number[] = (params.spanLengths && params.spanLengths.length === spanCount)
    ? params.spanLengths
    : Array(spanCount).fill(params.spanLength || 4000);
  const spanWidthsMm: number[] = (params.spanWidths && params.spanWidths.length === spanCount)
    ? params.spanWidths
    : Array(spanCount).fill(params.b);
  const TOTAL_NET = spanLengthsMm.reduce((s, l) => s + l * S, 0) + (spanCount - 1) * HC;
  const spanLayouts = useMemo(() => {
    const arr: { center: number; leftFace: number; rightFace: number; lenS: number; bS: number }[] = [];
    let cursor = -TOTAL_NET / 2;
    for (let i = 0; i < spanCount; i++) {
      const lenS = spanLengthsMm[i] * S;
      const leftFace = cursor;
      const rightFace = leftFace + lenS;
      arr.push({ leftFace, rightFace, center: (leftFace + rightFace) / 2, lenS, bS: spanWidthsMm[i] * S });
      cursor = rightFace + HC;
    }
    return arr;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spanCount, TOTAL_NET, HC, JSON.stringify(spanLengthsMm), JSON.stringify(spanWidthsMm)]);
  // 柱位置 (n+1 根)
  const colPositions = useMemo(() => {
    const cols: number[] = [];
    cols.push(spanLayouts[0].leftFace - HC / 2); // 左端柱
    for (let i = 1; i < spanCount; i++) cols.push(spanLayouts[i].leftFace - HC / 2); // 中间柱
    cols.push(spanLayouts[spanCount - 1].rightFace + HC / 2); // 右端柱
    return cols;
  }, [spanLayouts, HC, spanCount]);

  const topR = parseRebar(params.top);
  const botR = parseRebarBottom(params.bottom);
  const stir = parseStirrup(params.stirrup);
  const leftR = params.leftSupport ? parseRebar(params.leftSupport) : null;
  const rightR = params.rightSupport ? parseRebar(params.rightSupport) : null;
  const leftR2 = params.leftSupport2 ? parseRebar(params.leftSupport2) : null;
  const rightR2 = params.rightSupport2 ? parseRebar(params.rightSupport2) : null;
  const innerR = (spanCount > 1 && params.innerSupport) ? parseRebar(params.innerSupport) : null;
  const STIR_D = stir.diameter * S; // 箍筋直径

  // 箍筋中心线尺寸（保护层外皮→箍筋中心）
  // GB50010: 保护层 = 混凝土表面到最近钢筋（箍筋）外皮的距离
  const stirCenterW = bm - 2 * COVER - STIR_D;   // 箍筋中心线宽度
  const stirCenterH = hm - 2 * COVER - STIR_D;   // 箍筋中心线高度
  // 兼容原有变量名（加腋区等处使用）
  const innerW = stirCenterW;
  const innerH = stirCenterH;

  // Haunch parameters
  const haunchType = params.haunchType || 'none';
  const haunchLen = (params.haunchLength || 0) * S;
  const haunchH = (params.haunchHeight || 0) * S;
  const haunchSide = params.haunchSide || 'both';
  const hasLeftHaunch = haunchType !== 'none' && haunchLen > 0 && haunchH > 0 && (haunchSide === 'both' || haunchSide === 'left');
  const hasRightHaunch = haunchType !== 'none' && haunchLen > 0 && haunchH > 0 && (haunchSide === 'both' || haunchSide === 'right');

  // 22G101 anchor calculations
  const topAnchor = calcBeamEndAnchor(topR.grade, topR.diameter, params.concreteGrade, params.seismicGrade, params.hc || 500, params.cover || 25);
  const botAnchor = calcBeamEndAnchor(botR.grade, botR.diameter, params.concreteGrade, params.seismicGrade, params.hc || 500, params.cover || 25);

  // 22G101 dense zone: max(2h, 500mm) from column face
  const denseZoneMm = beamDenseZoneLength(params.h);
  const denseZone = denseZoneMm * S;
  // stirrups useMemo 专用原始值（避免依赖整个 params）
  const botDiaBase = botR.diameter;
  const seismicGrade = params.seismicGrade;
  const beamH = params.h;

  // Per-span stirrup positions (relative to each span's center)
  const stirrupsPerSpan = useMemo(() => {
    const denseS = stir.spacingDense * S;
    const normalS = stir.spacingNormal * S;
    const h0 = hm - COVER - (botDiaBase * S / 2);
    const hbCoeff = seismicGrade === '一级' ? 2.0 : 1.5;

    return spanLayouts.map((span, si) => {
      const positions: { x: number; zone: 'dense' | 'normal' }[] = [];
      const halfLen = span.lenS / 2;
      const haunchDense1 = haunchType !== 'none'
        ? Math.max(hbCoeff * beamH * S, 0.5, (haunchLen + 0.5 * h0))
        : 0;
      const leftSkip = (si === 0 && hasLeftHaunch) ? haunchDense1 : 0;
      const rightSkip = (si === spanLayouts.length - 1 && hasRightHaunch) ? haunchDense1 : 0;

      const leftStart = -halfLen + leftSkip + 0.05;
      for (let x = leftStart; x < -halfLen + denseZone; x += denseS) positions.push({ x, zone: 'dense' });
      for (let x = -halfLen + denseZone; x < halfLen - denseZone; x += normalS) positions.push({ x, zone: 'normal' });
      const rightEnd = halfLen - rightSkip - 0.05;
      for (let x = halfLen - denseZone; x < rightEnd; x += denseS) positions.push({ x, zone: 'dense' });
      return positions;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stir.spacingDense, stir.spacingNormal, denseZone, haunchType, hasLeftHaunch, hasRightHaunch, haunchLen, hm, COVER, botDiaBase, seismicGrade, beamH, JSON.stringify(spanLayouts)]);


  // ============ 钢筋 Y 坐标计算 (22G101 构造) ============
  // 各排直径辅助 (混合直径时各排不同)
  const topDia = (row: number) => topR.segments?.[row]?.diameter ?? topR.diameter;
  const botDia = (row: number) => botR.segments?.[row]?.diameter ?? botR.diameter;

  // 上部钢筋多排布置
  const topBarY1 = hm - COVER - STIR_D - topDia(0) * S / 2;
  const topRowCount = topR.rows || (topR.perRow ? topR.perRow.length : 1);
  const topBarYPositions = (() => {
    const positions = [topBarY1];
    for (let i = 1; i < topRowCount; i++) {
      const dPrev = topDia(i - 1);
      const dCur = topDia(i);
      const clearV = Math.max(Math.max(dPrev, dCur) * S, 25 * S);
      positions.push(positions[i - 1] - dPrev * S / 2 - clearV - dCur * S / 2);
    }
    return positions;
  })();

  // 下部钢筋多排布置
  const botBarY1 = COVER + STIR_D + botDia(0) * S / 2;
  const botRowCount = botR.rows || (botR.perRow ? botR.perRow.length : 1);
  const botBarYPositions = (() => {
    const positions = [botBarY1];
    for (let i = 1; i < botRowCount; i++) {
      const dPrev = botDia(i - 1);
      const dCur = botDia(i);
      const clearV = Math.max(Math.max(dPrev, dCur) * S, 25 * S);
      positions.push(positions[i - 1] + dPrev * S / 2 + clearV + dCur * S / 2);
    }
    return positions;
  })();

  // 支座负筋 Y: 在上部通长筋下方（紧贴，实际施工中钢筋紧挨绑扎）
  const supportDia = (leftR?.diameter || rightR?.diameter || topR.diameter) * S;
  // 贴合间距: 仅留半径和，不加额外净距（搅接区钢筋紧贴）
  const supportBarY1 = topBarY1 - topR.diameter * S / 2 - supportDia / 2;
  const supportBarY2 = supportBarY1 - supportDia / 2 - Math.max(supportDia, 25 * S) - supportDia / 2;

  // ============ 钢筋 Z 坐标计算 ============
  const topBarZRange = stirCenterW - STIR_D - topR.diameter * S;
  const botBarZRange = stirCenterW - STIR_D - botR.diameter * S;

  const topBars = layoutBars(topR, topBarZRange, topBarYPositions);

  const botBars = layoutBars(botR, botBarZRange, botBarYPositions);

  const supportLenMm = calcSupportRebarLength(spanLengthsMm[0]);
  const supportLen = supportLenMm * S;
  const leftBars = useMemo(() => {
    if (!leftR) return [];
    const range = stirCenterW - STIR_D - leftR.diameter * S;
    return layoutBars(leftR, range, [supportBarY1]);
  }, [leftR, stirCenterW, STIR_D, supportBarY1]);

  const rightBars = useMemo(() => {
    if (!rightR) return [];
    const range = stirCenterW - STIR_D - rightR.diameter * S;
    return layoutBars(rightR, range, [supportBarY1]);
  }, [rightR, stirCenterW, STIR_D, supportBarY1]);

  // 第二排支座负筋 Y 坐标: 在第一排支座筋下方
  const leftBars2 = useMemo(() => {
    if (!leftR2) return [];
    const range = stirCenterW - STIR_D - leftR2.diameter * S;
    return layoutBars(leftR2, range, [supportBarY2]);
  }, [leftR2, stirCenterW, STIR_D, supportBarY2]);

  const rightBars2 = useMemo(() => {
    if (!rightR2) return [];
    const range = stirCenterW - STIR_D - rightR2.diameter * S;
    return layoutBars(rightR2, range, [supportBarY2]);
  }, [rightR2, stirCenterW, STIR_D, supportBarY2]);

  // Support rebar anchor calculations (same rules as top bars since they're negative moment bars)
  const leftAnchor = leftR ? calcBeamEndAnchor(leftR.grade, leftR.diameter, params.concreteGrade, params.seismicGrade, params.hc || 500, params.cover || 25) : null;
  const rightAnchor = rightR ? calcBeamEndAnchor(rightR.grade, rightR.diameter, params.concreteGrade, params.seismicGrade, params.hc || 500, params.cover || 25) : null;
  const leftAnchor2 = leftR2 ? calcBeamEndAnchor(leftR2.grade, leftR2.diameter, params.concreteGrade, params.seismicGrade, params.hc || 500, params.cover || 25) : null;
  const rightAnchor2 = rightR2 ? calcBeamEndAnchor(rightR2.grade, rightR2.diameter, params.concreteGrade, params.seismicGrade, params.hc || 500, params.cover || 25) : null;
  const leftAnchorDesc2 = leftAnchor2 ? formatAnchorDesc(leftAnchor2) : '';
  const rightAnchorDesc2 = rightAnchor2 ? formatAnchorDesc(rightAnchor2) : '';

  const topAnchorDesc = formatAnchorDesc(topAnchor, '(laE≤hc-c)');
  const botAnchorDesc = formatAnchorDesc(botAnchor, '(laE≤hc-c)');
  const leftAnchorDesc = leftAnchor ? formatAnchorDesc(leftAnchor) : '';
  const rightAnchorDesc = rightAnchor ? formatAnchorDesc(rightAnchor) : '';

  const isSelected = (type: string) => selected?.type === type;
  const gv = (g: string) => !visibleGroups || visibleGroups.has(g);

  // 收集所有纵筋 Z 坐标，供多肢箍拉筋避让
  const allBarZPositions = (() => {
    const zSet = new Set<number>();
    topBars.forEach(b => zSet.add(b.z));
    botBars.forEach(b => zSet.add(b.z));
    return [...zSet];
  })();

  // parseSideBar 缓存（避免多处重复解析）
  const sideInfo = useMemo(() => params.sideBar ? parseSideBar(params.sideBar) : null, [params.sideBar]);

  // 拉筋曲线缓存（参数不随跨变化，提到循环外）
  // 22G101: 拉筋两端135°弯钩勾住腰筋
  // 用折线点数组(polyline)代替 CatmullRomCurve3，弯折处用小弧线离散化
  const memoTiePoints = useMemo((): THREE.Vector3[] | null => {
    if (!sideInfo) return null;
    const sideZ = (stirCenterW / 2) - STIR_D / 2;
    const tieInfo = params.tieBar ? parseTieBar(params.tieBar) : autoTieBar(params.b, stir.grade, stir.diameter);
    if (!tieInfo) return null;
    const tieDiaS = tieInfo.diameter * S;
    const sideDiaS = sideInfo.diameter * S;
    // 弯折内半径: 规范要求 ≥ 2.5d(拉筋), 取 max(3d, 腰筋半径+拉筋直径)
    const bendR = Math.max(sideDiaS / 2 + tieDiaS, tieDiaS * 3);
    const hookLen = Math.max(10 * tieDiaS, bendR * 1.5);

    // 135° 弯钩: 弧转角 = 3π/4
    // 弯钩方向: 从水平向下弯，尾端朝混凝土核心方向
    const bendAngle = Math.PI * 3 / 4;
    const arcSegs = 8;

    const pts: THREE.Vector3[] = [];

    // ── 左侧 135° 弯钩 ──
    // 22G101: 弯钩尾端应朝向混凝土核心(+Z方向)
    // 弧心在直线段端点正下方: (0, -bendR, -sideZ)
    // 弧从 π/2(顶部=直线段端点) 逆时针转 3π/4 到 5π/4
    const leftCy = -bendR, leftCz = -sideZ;
    const leftEndAngle = Math.PI / 2 + bendAngle; // 5π/4
    const leftArcEndY = leftCy + bendR * Math.sin(leftEndAngle);
    const leftArcEndZ = leftCz + bendR * Math.cos(leftEndAngle);
    // 弧在末端的切线方向(逆时针): (cos(a), -sin(a))
    const leftTailDY = Math.cos(leftEndAngle);
    const leftTailDZ = -Math.sin(leftEndAngle);
    pts.push(new THREE.Vector3(0, leftArcEndY + hookLen * leftTailDY, leftArcEndZ + hookLen * leftTailDZ));
    // 弧线: 从末端(5π/4)→起点(π/2)（反向遍历保持点序从尾→头）
    for (let i = arcSegs; i >= 0; i--) {
      const a = Math.PI / 2 + (i / arcSegs) * bendAngle;
      pts.push(new THREE.Vector3(0, leftCy + bendR * Math.sin(a), leftCz + bendR * Math.cos(a)));
    }
    // 弧在 i=0 处 a=π/2: y=0, z=-sideZ，与直线段左端重合

    // ── 中间直线段 ──
    pts.push(new THREE.Vector3(0, 0, sideZ));

    // ── 右侧 135° 弯钩 (镜像) ──
    // 弧心: (0, -bendR, +sideZ)
    // 弧从 π/2(顶部) 顺时针转 3π/4 到 -π/4
    const rightCy = -bendR, rightCz = sideZ;
    const rightEndAngle = Math.PI / 2 - bendAngle; // -π/4
    for (let i = 0; i <= arcSegs; i++) {
      const a = Math.PI / 2 - (i / arcSegs) * bendAngle;
      pts.push(new THREE.Vector3(0, rightCy + bendR * Math.sin(a), rightCz + bendR * Math.cos(a)));
    }
    // 弧在末端的切线方向(顺时针): (-cos(a), sin(a))
    const rightArcEndY = rightCy + bendR * Math.sin(rightEndAngle);
    const rightArcEndZ = rightCz + bendR * Math.cos(rightEndAngle);
    const rightTailDY = -Math.cos(rightEndAngle);
    const rightTailDZ = Math.sin(rightEndAngle);
    pts.push(new THREE.Vector3(0, rightArcEndY + hookLen * rightTailDY, rightArcEndZ + hookLen * rightTailDZ));

    return pts;
  }, [sideInfo, params.tieBar, params.b, stir.grade, stir.diameter, stirCenterW, STIR_D]);

  return (
    <>
      <mesh position={[0, hm / 2, 0]} onClick={() => onSelect(null)} visible={false}>
        <boxGeometry args={[TOTAL_NET + HC * 2 + 1, hm + 1, bm + 1]} />
        <meshBasicMaterial />
      </mesh>

      {/* Column stubs (all n+1) */}
      {colPositions.map((cx, ci) => {
        const isEnd = ci === 0 || ci === colPositions.length - 1;
        const isLeft = ci === 0;
        const depthV = isEnd && haunchType === 'vertical'
          ? (isLeft ? (hasLeftHaunch ? bm + 2 * haunchH : bm * 1.2) : (hasRightHaunch ? bm + 2 * haunchH : bm * 1.2))
          : bm * 1.2;
        const haunchD = isEnd && haunchType === 'horizontal'
          ? (isLeft ? (hasLeftHaunch ? haunchH : 0) : (hasRightHaunch ? haunchH : 0))
          : 0;
        return <ColumnStub key={`col-${ci}`} x={cx} width={HC} beamH={hm} depth={depthV} haunchDepth={haunchD} />;
      })}

      {/* Beam concrete body — per-span to support variable widths */}
      <group visible={gv('concrete')}>
      {spanLayouts.map((span, si) => (
        <group key={`beam-body-${si}`}>
          <mesh position={[span.center, hm / 2, 0]}>
            <boxGeometry args={[span.lenS, hm, span.bS]} />
            <meshPhysicalMaterial color="#BDC3C7" transparent opacity={concreteOpacity} side={THREE.DoubleSide} depthWrite={false} roughness={0.8} />
          </mesh>
          <lineSegments position={[span.center, hm / 2, 0]}>
            <edgesGeometry args={[new THREE.BoxGeometry(span.lenS, hm, span.bS)]} />
            <lineBasicMaterial color="#94A3B8" />
          </lineSegments>
        </group>
      ))}

      {/* Haunch geometry (per-span) */}
      {spanLayouts.map((span, si) => (
        <group key={`haunch-geo-${si}`} position={[span.center, 0, 0]}>
          {hasLeftHaunch && (
            <HaunchShape beamLen={span.lenS} beamH={hm} beamB={span.bS}
              haunchLen={haunchLen} haunchH={haunchH} haunchType={haunchType as 'horizontal' | 'vertical'}
              side="left" opacity={concreteOpacity * 1.5} />
          )}
          {hasRightHaunch && (
            <HaunchShape beamLen={span.lenS} beamH={hm} beamB={span.bS}
              haunchLen={haunchLen} haunchH={haunchH} haunchType={haunchType as 'horizontal' | 'vertical'}
              side="right" opacity={concreteOpacity * 1.5} />
          )}
        </group>
      ))}
      </group>

      {/* Top through bars (full beam length) */}
      <group visible={gv('top')}>
      {topBars.map((bar, i) => {
        const d = bar.diameter || topR.diameter;
        return (
        <RebarBar key={`t${i}`} position={[0, bar.y, bar.z]} length={TOTAL_NET} diameter={d}
          color={COLOR_REBAR} hiColor={COLOR_REBAR_HI}
          info={{ type: 'top', label: '上部通长筋', detail: `${params.top} · ${topR.count}根 ${topR.segments ? '混合直径' : `${gradeLabel(topR.grade)} Φ${topR.diameter}`}，端锚: ${topAnchorDesc}` }}
          selected={isSelected('top')} onSelect={onSelect} />
        );
      })}

      {/* Top bar anchor bends at end columns */}
      {!topAnchor.canStraight && topBars.map((bar, i) => {
        const d = bar.diameter || topR.diameter;
        const barAnchor = d !== topR.diameter
          ? calcBeamEndAnchor(topR.grade, d, params.concreteGrade, params.seismicGrade, params.hc || 500, params.cover || 25)
          : topAnchor;
        return (
        <group key={`ta-l${i}`}>
          <BentRebarEnd
            position={[-TOTAL_NET / 2, bar.y, bar.z]}
            straightLen={barAnchor.bentStraightPart * S}
            bendLen={barAnchor.bentBendPart * S}
            diameter={d} direction="down" color={COLOR_REBAR}
            hiColor={COLOR_REBAR_HI}
            info={{ type: 'top', label: '上部筋弯锚', detail: topAnchorDesc }}
            selected={isSelected('top')} onSelect={onSelect}
            xDir={-1} />
          <BentRebarEnd
            position={[TOTAL_NET / 2, bar.y, bar.z]}
            straightLen={barAnchor.bentStraightPart * S}
            bendLen={barAnchor.bentBendPart * S}
            diameter={d} direction="down" color={COLOR_REBAR}
            hiColor={COLOR_REBAR_HI}
            info={{ type: 'top', label: '上部筋弯锚', detail: topAnchorDesc }}
            selected={isSelected('top')} onSelect={onSelect}
            xDir={1} />
        </group>
        );
      })}

      {/* Top bar straight anchor extensions into end columns */}
      {topAnchor.canStraight && topBars.map((bar, i) => {
        const d = bar.diameter || topR.diameter;
        const barAnchor = d !== topR.diameter
          ? calcBeamEndAnchor(topR.grade, d, params.concreteGrade, params.seismicGrade, params.hc || 500, params.cover || 25)
          : topAnchor;
        return (
        <group key={`ta-s${i}`}>
          <RebarBar position={[-TOTAL_NET / 2 - barAnchor.straightLen * S / 2, bar.y, bar.z]}
            length={barAnchor.straightLen * S} diameter={d}
            color={COLOR_REBAR} hiColor={COLOR_REBAR_HI}
            info={{ type: 'top', label: '上部筋直锚', detail: topAnchorDesc }}
            selected={isSelected('top')} onSelect={onSelect} />
          <RebarBar position={[TOTAL_NET / 2 + barAnchor.straightLen * S / 2, bar.y, bar.z]}
            length={barAnchor.straightLen * S} diameter={d}
            color={COLOR_REBAR} hiColor={COLOR_REBAR_HI}
            info={{ type: 'top', label: '上部筋直锚', detail: topAnchorDesc }}
            selected={isSelected('top')} onSelect={onSelect} />
        </group>
        );
      })}

      </group>

      {/* Bottom through bars (full beam length) */}
      <group visible={gv('bottom')}>
      {botBars.map((bar, i) => {
        const d = bar.diameter || botR.diameter;
        return (
        <RebarBar key={`b${i}`} position={[0, bar.y, bar.z]} length={TOTAL_NET} diameter={d}
          color={COLOR_REBAR} hiColor={COLOR_REBAR_HI}
          info={{ type: 'bottom', label: '下部通长筋', detail: `${params.bottom} · ${botR.count}根 ${botR.segments ? '混合直径' : `${gradeLabel(botR.grade)} Φ${botR.diameter}`}，端锚: ${botAnchorDesc}` }}
          selected={isSelected('bottom')} onSelect={onSelect} />
        );
      })}

      {/* Bottom bar anchor bends at end columns */}
      {!botAnchor.canStraight && botBars.map((bar, i) => {
        const d = bar.diameter || botR.diameter;
        const barAnchor = d !== botR.diameter
          ? calcBeamEndAnchor(botR.grade, d, params.concreteGrade, params.seismicGrade, params.hc || 500, params.cover || 25)
          : botAnchor;
        return (
        <group key={`ba-l${i}`}>
          <BentRebarEnd
            position={[-TOTAL_NET / 2, bar.y, bar.z]}
            straightLen={barAnchor.bentStraightPart * S}
            bendLen={barAnchor.bentBendPart * S}
            diameter={d} direction="up" color={COLOR_REBAR}
            hiColor={COLOR_REBAR_HI}
            info={{ type: 'bottom', label: '下部筋弯锚', detail: botAnchorDesc }}
            selected={isSelected('bottom')} onSelect={onSelect}
            xDir={-1} />
          <BentRebarEnd
            position={[TOTAL_NET / 2, bar.y, bar.z]}
            straightLen={barAnchor.bentStraightPart * S}
            bendLen={barAnchor.bentBendPart * S}
            diameter={d} direction="up" color={COLOR_REBAR}
            hiColor={COLOR_REBAR_HI}
            info={{ type: 'bottom', label: '下部筋弯锚', detail: botAnchorDesc }}
            selected={isSelected('bottom')} onSelect={onSelect}
            xDir={1} />
        </group>
        );
      })}

      {/* Bottom bar straight anchor extensions into end columns */}
      {botAnchor.canStraight && botBars.map((bar, i) => {
        const d = bar.diameter || botR.diameter;
        const barAnchor = d !== botR.diameter
          ? calcBeamEndAnchor(botR.grade, d, params.concreteGrade, params.seismicGrade, params.hc || 500, params.cover || 25)
          : botAnchor;
        return (
        <group key={`ba-s${i}`}>
          <RebarBar position={[-TOTAL_NET / 2 - barAnchor.straightLen * S / 2, bar.y, bar.z]}
            length={barAnchor.straightLen * S} diameter={d}
            color={COLOR_REBAR} hiColor={COLOR_REBAR_HI}
            info={{ type: 'bottom', label: '下部筋直锚', detail: botAnchorDesc }}
            selected={isSelected('bottom')} onSelect={onSelect} />
          <RebarBar position={[TOTAL_NET / 2 + barAnchor.straightLen * S / 2, bar.y, bar.z]}
            length={barAnchor.straightLen * S} diameter={d}
            color={COLOR_REBAR} hiColor={COLOR_REBAR_HI}
            info={{ type: 'bottom', label: '下部筋直锚', detail: botAnchorDesc }}
            selected={isSelected('bottom')} onSelect={onSelect} />
        </group>
        );
      })}

      </group>

      {/* ====== Per-span elements (support bars, erection bars) ====== */}
      {spanLayouts.map((span, si) => {
        // Per-span support lengths
        const spanLenMmI = spanLengthsMm[si];
        const supportLenI = calcSupportRebarLength(spanLenMmI) * S;
        const supportLenMmI = calcSupportRebarLength(spanLenMmI);
        const supportLen2I = calcSupportRebarLength(spanLenMmI, 2) * S;
        const supportLenMm2I = calcSupportRebarLength(spanLenMmI, 2);
        return (
        <group key={`span-se-${si}`} position={[span.center, 0, 0]} visible={gv('support')}>
          {/* Left support rebars (ln/3 from column face) */}
          {leftR && leftBars.map((bar, i) => (
            <RebarBar key={`ls${i}`} position={[-span.lenS / 2 + supportLenI / 2, bar.y, bar.z]} length={supportLenI} diameter={leftR.diameter}
              color={COLOR_SUPPORT} hiColor={COLOR_SUPPORT_HI}
              info={{ type: 'leftSupport', label: '左支座负筋(第一排)', detail: `${params.leftSupport} · ${leftR.count}根 ${gradeLabel(leftR.grade)} Φ${leftR.diameter}，伸入跨内 ln/3=${supportLenMmI}mm，端锚: ${leftAnchorDesc}` }}
              selected={isSelected('leftSupport')} onSelect={onSelect} />
          ))}
          {leftR && leftAnchor && !leftAnchor.canStraight && leftBars.map((bar, i) => (
            <BentRebarEnd key={`lsa-b${i}`}
              position={[-span.lenS / 2, bar.y, bar.z]}
              straightLen={leftAnchor.bentStraightPart * S}
              bendLen={leftAnchor.bentBendPart * S}
              diameter={leftR.diameter} direction="down" color={COLOR_SUPPORT}
              hiColor={COLOR_SUPPORT_HI}
              info={{ type: 'leftSupport', label: '左支座负筋弯锚', detail: leftAnchorDesc }}
              selected={isSelected('leftSupport')} onSelect={onSelect}
              xDir={-1} />
          ))}
          {leftR && leftAnchor && leftAnchor.canStraight && leftBars.map((bar, i) => (
            <RebarBar key={`lsa-s${i}`}
              position={[-span.lenS / 2 - leftAnchor.straightLen * S / 2, bar.y, bar.z]}
              length={leftAnchor.straightLen * S} diameter={leftR.diameter}
              color={COLOR_SUPPORT} hiColor={COLOR_SUPPORT_HI}
              info={{ type: 'leftSupport', label: '左支座负筋直锚', detail: leftAnchorDesc }}
              selected={isSelected('leftSupport')} onSelect={onSelect} />
          ))}

          {/* Right support rebars */}
          {rightR && rightBars.map((bar, i) => (
            <RebarBar key={`rs${i}`} position={[span.lenS / 2 - supportLenI / 2, bar.y, bar.z]} length={supportLenI} diameter={rightR.diameter}
              color={COLOR_SUPPORT} hiColor={COLOR_SUPPORT_HI}
              info={{ type: 'rightSupport', label: '右支座负筋(第一排)', detail: `${params.rightSupport} · ${rightR.count}根 ${gradeLabel(rightR.grade)} Φ${rightR.diameter}，伸入跨内 ln/3=${supportLenMmI}mm，端锚: ${rightAnchorDesc}` }}
              selected={isSelected('rightSupport')} onSelect={onSelect} />
          ))}
          {rightR && rightAnchor && !rightAnchor.canStraight && rightBars.map((bar, i) => (
            <BentRebarEnd key={`rsa-b${i}`}
              position={[span.lenS / 2, bar.y, bar.z]}
              straightLen={rightAnchor.bentStraightPart * S}
              bendLen={rightAnchor.bentBendPart * S}
              diameter={rightR.diameter} direction="down" color={COLOR_SUPPORT}
              hiColor={COLOR_SUPPORT_HI}
              info={{ type: 'rightSupport', label: '右支座负筋弯锚', detail: rightAnchorDesc }}
              selected={isSelected('rightSupport')} onSelect={onSelect}
              xDir={1} />
          ))}
          {rightR && rightAnchor && rightAnchor.canStraight && rightBars.map((bar, i) => (
            <RebarBar key={`rsa-s${i}`}
              position={[span.lenS / 2 + rightAnchor.straightLen * S / 2, bar.y, bar.z]}
              length={rightAnchor.straightLen * S} diameter={rightR.diameter}
              color={COLOR_SUPPORT} hiColor={COLOR_SUPPORT_HI}
              info={{ type: 'rightSupport', label: '右支座负筋直锚', detail: rightAnchorDesc }}
              selected={isSelected('rightSupport')} onSelect={onSelect} />
          ))}

          {/* Left support rebars row 2 (ln/4 from column face) */}
          {leftR2 && leftBars2.map((bar, i) => (
            <RebarBar key={`ls2-${i}`} position={[-span.lenS / 2 + supportLen2I / 2, bar.y, bar.z]} length={supportLen2I} diameter={leftR2.diameter}
              color={COLOR_SUPPORT} hiColor={COLOR_SUPPORT_HI}
              info={{ type: 'leftSupport2', label: '左支座负筋(第二排)', detail: `${params.leftSupport2} · ${leftR2.count}根 ${gradeLabel(leftR2.grade)} Φ${leftR2.diameter}，伸入跨内 ln/4=${supportLenMm2I}mm，端锚: ${leftAnchorDesc2}` }}
              selected={isSelected('leftSupport2')} onSelect={onSelect} />
          ))}
          {leftR2 && leftAnchor2 && !leftAnchor2.canStraight && leftBars2.map((bar, i) => (
            <BentRebarEnd key={`ls2a-b${i}`}
              position={[-span.lenS / 2, bar.y, bar.z]}
              straightLen={leftAnchor2.bentStraightPart * S}
              bendLen={leftAnchor2.bentBendPart * S}
              diameter={leftR2.diameter} direction="down" color={COLOR_SUPPORT}
              hiColor={COLOR_SUPPORT_HI}
              info={{ type: 'leftSupport2', label: '左支座负筋(二排)弯锚', detail: leftAnchorDesc2 }}
              selected={isSelected('leftSupport2')} onSelect={onSelect}
              xDir={-1} />
          ))}
          {leftR2 && leftAnchor2 && leftAnchor2.canStraight && leftBars2.map((bar, i) => (
            <RebarBar key={`ls2a-s${i}`}
              position={[-span.lenS / 2 - leftAnchor2.straightLen * S / 2, bar.y, bar.z]}
              length={leftAnchor2.straightLen * S} diameter={leftR2.diameter}
              color={COLOR_SUPPORT} hiColor={COLOR_SUPPORT_HI}
              info={{ type: 'leftSupport2', label: '左支座负筋(二排)直锚', detail: leftAnchorDesc2 }}
              selected={isSelected('leftSupport2')} onSelect={onSelect} />
          ))}

          {/* Right support rebars row 2 */}
          {rightR2 && rightBars2.map((bar, i) => (
            <RebarBar key={`rs2-${i}`} position={[span.lenS / 2 - supportLen2I / 2, bar.y, bar.z]} length={supportLen2I} diameter={rightR2.diameter}
              color={COLOR_SUPPORT} hiColor={COLOR_SUPPORT_HI}
              info={{ type: 'rightSupport2', label: '右支座负筋(第二排)', detail: `${params.rightSupport2} · ${rightR2.count}根 ${gradeLabel(rightR2.grade)} Φ${rightR2.diameter}，伸入跨内 ln/4=${supportLenMm2I}mm，端锚: ${rightAnchorDesc2}` }}
              selected={isSelected('rightSupport2')} onSelect={onSelect} />
          ))}
          {rightR2 && rightAnchor2 && !rightAnchor2.canStraight && rightBars2.map((bar, i) => (
            <BentRebarEnd key={`rs2a-b${i}`}
              position={[span.lenS / 2, bar.y, bar.z]}
              straightLen={rightAnchor2.bentStraightPart * S}
              bendLen={rightAnchor2.bentBendPart * S}
              diameter={rightR2.diameter} direction="down" color={COLOR_SUPPORT}
              hiColor={COLOR_SUPPORT_HI}
              info={{ type: 'rightSupport2', label: '右支座负筋(二排)弯锚', detail: rightAnchorDesc2 }}
              selected={isSelected('rightSupport2')} onSelect={onSelect}
              xDir={1} />
          ))}
          {rightR2 && rightAnchor2 && rightAnchor2.canStraight && rightBars2.map((bar, i) => (
            <RebarBar key={`rs2a-s${i}`}
              position={[span.lenS / 2 + rightAnchor2.straightLen * S / 2, bar.y, bar.z]}
              length={rightAnchor2.straightLen * S} diameter={rightR2.diameter}
              color={COLOR_SUPPORT} hiColor={COLOR_SUPPORT_HI}
              info={{ type: 'rightSupport2', label: '右支座负筋(二排)直锚', detail: rightAnchorDesc2 }}
              selected={isSelected('rightSupport2')} onSelect={onSelect} />
          ))}

          {/* Erection bars (架立筋) */}
          {(leftR || rightR || params.erectionBar) && (() => {
            const erUser = params.erectionBar ? parseRebar(params.erectionBar) : null;
            const LAP_LEN = 150 * S;
            const leftSupportLen = leftR ? supportLenI : 0;
            const rightSupportLen = rightR ? supportLenI : 0;
            let erectionLen: number;
            let erectionX: number;
            if (leftR && rightR) {
              erectionLen = span.lenS - leftSupportLen - rightSupportLen + 2 * LAP_LEN;
              erectionX = 0;
            } else if (leftR) {
              erectionLen = span.lenS - leftSupportLen + LAP_LEN;
              erectionX = (-span.lenS / 2 + leftSupportLen - LAP_LEN + span.lenS / 2) / 2;
            } else if (rightR) {
              erectionLen = span.lenS - rightSupportLen + LAP_LEN;
              erectionX = (-span.lenS / 2 + span.lenS / 2 - rightSupportLen + LAP_LEN) / 2;
            } else {
              erectionLen = span.lenS;
              erectionX = 0;
            }
            if (erectionLen <= 0.05) return null;
            const spanMm = spanLengthsMm[0];
            const minDia = spanMm <= 4000 ? 10 : 12;
            const erectionDia = erUser ? erUser.diameter : Math.max(minDia, 8);
            const erectionCount = erUser ? erUser.count : 2;
            const refBars = leftBars.length > 0 ? leftBars : rightBars;
            let finalErZs: number[];
            const erZRange = stirCenterW - STIR_D - erectionDia * S;
            if (erectionCount <= 2) {
              if (refBars.length >= 2) {
                const sorted = [...refBars].sort((a, b) => a.z - b.z);
                finalErZs = [
                  sorted[0].z + (supportDia / 2 + erectionDia * S / 2),
                  sorted[sorted.length - 1].z - (supportDia / 2 + erectionDia * S / 2),
                ];
              } else if (refBars.length === 1) {
                finalErZs = [
                  refBars[0].z + (supportDia / 2 + erectionDia * S / 2),
                  refBars[0].z - (supportDia / 2 + erectionDia * S / 2),
                ];
              } else {
                finalErZs = [-erZRange / 2, erZRange / 2];
              }
            } else {
              // erectionCount > 2: distribute evenly across stirrup width
              finalErZs = [];
              for (let ei = 0; ei < erectionCount; ei++) {
                finalErZs.push(-erZRange / 2 + (erZRange / Math.max(erectionCount - 1, 1)) * ei);
              }
            }
            const lapLenMm = 150;
            const LAP_LEN_VIS = lapLenMm * S;
            const lapHeight = Math.max(supportDia * 4, 0.018);
            const lapZones: React.ReactNode[] = [];
            if (leftR) {
              const lapCenterX = -span.lenS / 2 + leftSupportLen - LAP_LEN_VIS / 2;
              lapZones.push(
                <mesh key="lap-zone-l" position={[lapCenterX, supportBarY1, 0]}>
                  <boxGeometry args={[LAP_LEN_VIS, lapHeight, bm * 0.92]} />
                  <meshBasicMaterial color="#D97706" transparent opacity={0.12} side={THREE.DoubleSide} depthWrite={false} />
                </mesh>
              );
              lapZones.push(
                <lineSegments key="lap-edge-l" position={[lapCenterX, supportBarY1, 0]}>
                  <edgesGeometry args={[new THREE.BoxGeometry(LAP_LEN_VIS, lapHeight, bm * 0.92)]} />
                  <lineBasicMaterial color="#D97706" transparent opacity={0.35} />
                </lineSegments>
              );
            }
            if (rightR) {
              const lapCenterX = span.lenS / 2 - rightSupportLen + LAP_LEN_VIS / 2;
              lapZones.push(
                <mesh key="lap-zone-r" position={[lapCenterX, supportBarY1, 0]}>
                  <boxGeometry args={[LAP_LEN_VIS, lapHeight, bm * 0.92]} />
                  <meshBasicMaterial color="#D97706" transparent opacity={0.12} side={THREE.DoubleSide} depthWrite={false} />
                </mesh>
              );
              lapZones.push(
                <lineSegments key="lap-edge-r" position={[lapCenterX, supportBarY1, 0]}>
                  <edgesGeometry args={[new THREE.BoxGeometry(LAP_LEN_VIS, lapHeight, bm * 0.92)]} />
                  <lineBasicMaterial color="#D97706" transparent opacity={0.35} />
                </lineSegments>
              );
            }
            return [
              ...finalErZs.map((erZ, idx) => (
                <RebarBar key={`erection-${idx}`} position={[erectionX, supportBarY1, erZ]} length={erectionLen} diameter={erectionDia}
                  color={COLOR_ERECTION} hiColor={COLOR_ERECTION_HI}
                  info={{ type: 'erection', label: '架立筋', detail: `${params.erectionBar || `${erectionCount}Φ${erectionDia}`}${(leftR || rightR) ? `，与支座负筋搭接${lapLenMm}mm(≥150mm)${leftR && rightR ? '，连接两侧支座负筋' : '，延伸至对侧柱面'}` : '，通长布置'}` }}
                  selected={isSelected('erection')} onSelect={onSelect} />
              )),
              ...lapZones,
            ];
          })()}
        </group>
        );
      })}

      {/* Inner support bars (中间支座负筋) — one bar per intermediate column, spans ln/3 left + hc + ln/3 right */}
      {innerR && spanCount > 1 && (() => {
        const innerBarZRange = stirCenterW - STIR_D - innerR.diameter * S;
        const innerBarsZ = layoutBars(innerR, innerBarZRange, [supportBarY1]);
        const nodes: React.ReactNode[] = [];
        for (let ci = 0; ci < spanCount - 1; ci++) {
          const leftSpanLen = spanLengthsMm[ci];
          const rightSpanLen = spanLengthsMm[ci + 1];
          const leftLen = calcSupportRebarLength(leftSpanLen) * S;
          const rightLen = calcSupportRebarLength(rightSpanLen) * S;
          const barTotalLen = leftLen + HC + rightLen;
          const barCenterX = (spanLayouts[ci].rightFace - leftLen + spanLayouts[ci + 1].leftFace + rightLen) / 2;
          const leftLenMm = calcSupportRebarLength(leftSpanLen);
          const rightLenMm = calcSupportRebarLength(rightSpanLen);
          innerBarsZ.forEach((bar, bi) => {
            nodes.push(
              <RebarBar key={`inner-${ci}-${bi}`}
                position={[barCenterX, bar.y, bar.z]}
                length={barTotalLen}
                diameter={innerR.diameter}
                color={COLOR_SUPPORT} hiColor={COLOR_SUPPORT_HI}
                info={{ type: 'innerSupport', label: `中间支座负筋(第${ci + 1}内柱)`, detail: `${params.innerSupport} · ${innerR.count}根 ${gradeLabel(innerR.grade)} Φ${innerR.diameter}，左跨 ln/3=${leftLenMm}mm，右跨 ln/3=${rightLenMm}mm，贯通柱 hc=${params.hc || 500}mm` }}
                selected={isSelected('innerSupport')} onSelect={onSelect} />
            );
          });
        }
        return <group visible={gv('support')}>{nodes}</group>;
      })()}

      {/* Side bars (腰筋/抗扭筋) - G前缀构造腰筋, N前缀抗扭筋 */}
      <group visible={gv('sideBar')}>
      {sideInfo && (() => {
        const perSide = Math.ceil(sideInfo.count / 2); // 每侧根数 (总数/2，两侧对称)
        const sideDia = sideInfo.diameter;
        // Y 坐标: 在上部筋和下部筋之间均匀分布
        const yTop = topBarY1 - topR.diameter * S / 2 - Math.max(sideDia * S, 25 * S);
        const yBot = botBarY1 + botR.diameter * S / 2 + Math.max(sideDia * S, 25 * S);
        // 22G101: 腰筋均匀分布在梁腹中部，不贴近上下主筋
        // 将上下主筋之间分成 (perSide+1) 等份，腰筋在内部等分点
        const yPositions: number[] = [];
        for (let i = 0; i < perSide; i++) {
          yPositions.push(yBot + (yTop - yBot) * (i + 1) / (perSide + 1));
        }
        // Z 坐标: 紧贴箍筋内侧，梁两侧面
        const sideZ = (stirCenterW / 2) - STIR_D / 2;
        const prefixLabel = sideInfo.prefix === 'G' ? '构造腰筋' : '抗扭筋';
        // 22G101: 腰筋锚固 — G构造腰筋锚固15d, N抗扭筋同纵筋(laE)
        const sideAnchor = calcBeamEndAnchor(sideInfo.grade, sideDia, params.concreteGrade, params.seismicGrade, params.hc || 500, params.cover || 25);
        const sideAnchorDesc = formatAnchorDesc(sideAnchor);
        const bars: React.ReactNode[] = [];
        const zSides = [sideZ, -sideZ];
        yPositions.forEach((y, yi) => {
          zSides.forEach((z, zi) => {
            const sideKey = zi === 0 ? 'f' : 'b';
            // 梁内主体
            bars.push(
              <RebarBar key={`side-${sideKey}-${yi}`} position={[0, y, z]} length={TOTAL_NET} diameter={sideDia}
                color={COLOR_SIDEBAR} hiColor={COLOR_SIDEBAR_HI}
                info={{ type: 'sideBar', label: prefixLabel, detail: `${params.sideBar} · ${sideInfo.count}根(每侧${perSide}根) ${gradeLabel(sideInfo.grade)} Φ${sideDia}，端锚: ${sideAnchorDesc}` }}
                selected={isSelected('sideBar')} onSelect={onSelect} />
            );
            // 左端锚固
            if (sideAnchor.canStraight) {
              bars.push(
                <RebarBar key={`side-${sideKey}-${yi}-la`}
                  position={[-TOTAL_NET / 2 - sideAnchor.straightLen * S / 2, y, z]}
                  length={sideAnchor.straightLen * S} diameter={sideDia}
                  color={COLOR_SIDEBAR} hiColor={COLOR_SIDEBAR_HI}
                  info={{ type: 'sideBar', label: `${prefixLabel}直锚`, detail: sideAnchorDesc }}
                  selected={isSelected('sideBar')} onSelect={onSelect} />
              );
            } else {
              bars.push(
                <BentRebarEnd key={`side-${sideKey}-${yi}-la`}
                  position={[-TOTAL_NET / 2, y, z]}
                  straightLen={sideAnchor.bentStraightPart * S}
                  bendLen={sideAnchor.bentBendPart * S}
                  diameter={sideDia} direction="down" color={COLOR_SIDEBAR}
                  hiColor={COLOR_SIDEBAR_HI}
                  info={{ type: 'sideBar', label: `${prefixLabel}弯锚`, detail: sideAnchorDesc }}
                  selected={isSelected('sideBar')} onSelect={onSelect}
                  xDir={-1} />
              );
            }
            // 右端锚固
            if (sideAnchor.canStraight) {
              bars.push(
                <RebarBar key={`side-${sideKey}-${yi}-ra`}
                  position={[TOTAL_NET / 2 + sideAnchor.straightLen * S / 2, y, z]}
                  length={sideAnchor.straightLen * S} diameter={sideDia}
                  color={COLOR_SIDEBAR} hiColor={COLOR_SIDEBAR_HI}
                  info={{ type: 'sideBar', label: `${prefixLabel}直锚`, detail: sideAnchorDesc }}
                  selected={isSelected('sideBar')} onSelect={onSelect} />
              );
            } else {
              bars.push(
                <BentRebarEnd key={`side-${sideKey}-${yi}-ra`}
                  position={[TOTAL_NET / 2, y, z]}
                  straightLen={sideAnchor.bentStraightPart * S}
                  bendLen={sideAnchor.bentBendPart * S}
                  diameter={sideDia} direction="down" color={COLOR_SIDEBAR}
                  hiColor={COLOR_SIDEBAR_HI}
                  info={{ type: 'sideBar', label: `${prefixLabel}弯锚`, detail: sideAnchorDesc }}
                  selected={isSelected('sideBar')} onSelect={onSelect}
                  xDir={1} />
              );
            }
          });
        });
        return bars;
      })()}

      </group>

      {/* ====== Per-span elements (tie bars, stirrups) ====== */}
      {spanLayouts.map((span, si) => (
        <group key={`span-ts-${si}`} position={[span.center, 0, 0]}>
          {/* Tie bars (拉筋) */}
          <group visible={gv('sideBar')}>
          {sideInfo && memoTiePoints && (() => {
            const perSide = Math.ceil(sideInfo.count / 2);
            const sideDia = sideInfo.diameter;
            const yTop = topBarY1 - topR.diameter * S / 2 - Math.max(sideDia * S, 25 * S);
            const yBot = botBarY1 + botR.diameter * S / 2 + Math.max(sideDia * S, 25 * S);
            const tieYPositions: number[] = [];
            for (let i = 0; i < perSide; i++) {
              tieYPositions.push(yBot + (yTop - yBot) * (i + 1) / (perSide + 1));
            }
            const tieInfo = params.tieBar ? parseTieBar(params.tieBar) : autoTieBar(params.b, stir.grade, stir.diameter);
            if (!tieInfo) return null;
            const tieDia = tieInfo.diameter;
            const tieLabel = params.tieBar || tieBarToString(tieInfo);
            const tieDiaS = tieDia * S;
            const tieDetail = `${tieLabel} · ${gradeLabel(tieInfo.grade)} Φ${tieDia}，间距${stir.spacingNormal}mm(同箍筋非加密区)，两端135°弯钩`;
            const tieSpacing = stir.spacingNormal * S;
            const tieBars: React.ReactNode[] = [];
            for (let sx = -span.lenS / 2 + tieSpacing * 1.5; sx < span.lenS / 2 - tieSpacing * 0.5; sx += tieSpacing) {
              tieYPositions.forEach((y, yi) => {
                tieBars.push(
                  <TieBarMesh key={`tie-${si}-${yi}-${sx.toFixed(4)}`}
                    position={[sx, y, 0]} points={memoTiePoints} radius={tieDiaS / 2}
                    info={{ type: 'tieBar', label: '拉筋', detail: tieDetail }}
                    selected={isSelected('tieBar')} onSelect={onSelect} />
                );
              });
            }
            return tieBars;
          })()}

          </group>
          {/* Stirrups */}
          <group visible={gv('stirrup')}>
          {(stirrupsPerSpan[si] || []).map((s, i) => {
            const zoneColor = s.zone === 'dense' ? COLOR_STIRRUP_DENSE : COLOR_STIRRUP_NORMAL;
            const zoneHiColor = s.zone === 'dense' ? COLOR_STIRRUP_DENSE_HI : COLOR_STIRRUP_NORMAL_HI;
            const zoneLabel = s.zone === 'dense' ? '箍筋(加密区)' : '箍筋(非加密区)';
            return (
              <StirrupRing key={`s${si}-${i}`} x={s.x} width={span.bS - 2 * COVER - STIR_D} height={stirCenterH} diameter={stir.diameter}
                color={zoneColor} hiColor={zoneHiColor} cover={COVER + STIR_D / 2} legs={stir.legs}
                barZPositions={allBarZPositions}
                info={{ type: 'stirrup', label: zoneLabel, detail: `${params.stirrup} · ${gradeLabel(stir.grade)} Φ${stir.diameter} 加密区${denseZoneMm}mm(=max(2h,500))/${stir.spacingDense} 非加密区/${stir.spacingNormal} ${stir.legs}肢箍` }}
                selected={isSelected('stirrup')} onSelect={onSelect} />
            );
          })}
          </group>
        </group>
      ))}

      {/* Haunch additional bars (附加筋) and haunch zone stirrups — per-span */}
      {spanLayouts.map((span, si) => (
        <group key={`span-haunch-${si}`} position={[span.center, 0, 0]} visible={gv('haunch')}>
      {haunchType === 'horizontal' && (() => {
        // 22G101-1 2-36: 水平加腋构造
        // 附加筋: 柱内水平锚固(≥laE) → 沿加腋斜面延伸穿入梁内(≥laE)
        const haunchBars: React.ReactNode[] = [];
        const sides: ('left' | 'right')[] = [];
        if (hasLeftHaunch) sides.push('left');
        if (hasRightHaunch) sides.push('right');

        const haunchLaE = calcLaE(botR.grade, botR.diameter, params.concreteGrade, params.seismicGrade);
        const anchorInCol = Math.min(haunchLaE * S, HC - COVER);

        // 斜面几何: 柱面(y=0, 梁底) → c₁处(y=haunchH, 从加腋底算)
        // 加腋底面斜率 = haunchH / haunchLen
        const slopeLen = Math.sqrt(haunchLen * haunchLen + haunchH * haunchH);
        // 斜面需延伸≥laE（从柱面算起的斜面长度）
        const extRatio = Math.max((haunchLaE * S) / slopeLen, 1.0);
        // 不超过梁跨中
        const maxRatio = (span.lenS / 2) / haunchLen * 0.85;
        const finalRatio = Math.min(extRatio, maxRatio);

        // 附加筋根数 = 梁底纵筋第一排根数（22G101: 同梁纵筋第一排）
        const maxPerRow = Math.floor(innerW / (botR.diameter * S * 2.5)) + 1;
        const firstRowCount = botR.count > maxPerRow ? Math.ceil(botR.count / 2) : botR.count;
        const barCount = firstRowCount;
        const barSpacing = innerW / Math.max(barCount - 1, 1);

        // 箍筋加密区1范围 (22G101-1 2-36)
        // 一级: ≥2.0hb 且 ≥500 且 ≥ c₁+0.5h₀
        // 二~四级: ≥1.5hb 且 ≥500 且 ≥ c₁+0.5h₀
        const h0 = hm - COVER - botR.diameter * S / 2; // 有效高度
        const h0mm = h0 / S;
        const hbCoeff = params.seismicGrade === '一级' ? 2.0 : 1.5;
        const denseZone1mm = Math.max(hbCoeff * params.h, 500, (params.haunchLength || 0) + 0.5 * h0mm);
        const denseZone1 = denseZone1mm * S;

        sides.forEach(sd => {
          const sign = sd === 'left' ? -1 : 1;
          const xColFace = sign * span.lenS / 2;
          const xColInner = xColFace + sign * anchorInCol;

          // 斜面延伸终点
          const xSlopeEnd = xColFace - sign * haunchLen * finalRatio;
          const ySlopeEnd = Math.min(-haunchH + haunchH * finalRatio + COVER, hm - COVER);

          for (let i = 0; i < barCount; i++) {
            const z = -innerW / 2 + i * barSpacing;

            // 柱内水平锚固段 (y = -haunchH + COVER)
            haunchBars.push(
              <RebarBar key={`hba-${sd}-${i}`}
                position={[(xColInner + xColFace) / 2, -haunchH + COVER, z]}
                length={anchorInCol} diameter={botR.diameter}
                color={COLOR_HAUNCH} hiColor={COLOR_HAUNCH_HI}
                renderOrder={2}
                info={{ type: 'bottom', label: '附加筋(柱内锚固)', detail: `伸入柱内${Math.round(anchorInCol / S)}mm(≥laE=${haunchLaE}mm)，Φ${botR.diameter}` }}
                selected={isSelected('bottom')} onSelect={onSelect} />
            );
            // 斜面段: 从柱面沿斜面穿过梁底纵筋延伸入梁内
            haunchBars.push(
              <SlopedRebarBar key={`hbs-${sd}-${i}`}
                start={[xColFace, -haunchH + COVER, z]}
                end={[xSlopeEnd, ySlopeEnd, z]}
                diameter={botR.diameter}
                color={COLOR_HAUNCH} hiColor={COLOR_HAUNCH_HI}
                info={{ type: 'bottom', label: '附加筋(斜面)', detail: `沿加腋斜面延伸入梁内，斜面长≥laE=${haunchLaE}mm，Φ${botR.diameter}` }}
                selected={isSelected('bottom')} onSelect={onSelect} />
            );
          }

          // 加腋区箍筋: 加密区1范围内，间距同梁端加密区
          // 箍筋从柱面到 min(denseZone1, span.lenS/2) 范围
          const stirZoneLen = Math.min(denseZone1, span.lenS / 2 - 0.05);
          const haunchStirCount = Math.max(Math.ceil(stirZoneLen / (stir.spacingDense * S)), 1);
          for (let j = 0; j < haunchStirCount; j++) {
            const t = (j + 0.5) / haunchStirCount;
            const sxActual = xColFace - sign * stirZoneLen * t;
            // 当前位置的加腋深度 (在加腋范围内才有)
            const distFromCol = Math.abs(sxActual - xColFace);
            const inHaunchZone = distFromCol <= haunchLen;
            const localDepth = inHaunchZone ? haunchH * (1 - distFromCol / haunchLen) : 0;
            // 箍筋高度: 梁高 + 当前加腋深度
            const totalH = (hm - COVER) - (-localDepth + COVER);
            haunchBars.push(
              <StirrupRing key={`hs-${sd}-${j}`}
                x={sxActual}
                width={(span.bS - 2 * COVER - STIR_D) + stir.diameter * S}
                height={totalH + stir.diameter * S}
                diameter={stir.diameter}
                color={COLOR_STIRRUP} hiColor={COLOR_STIRRUP_HI}
                cover={-localDepth + COVER} legs={stir.legs}
                info={{ type: 'stirrup', label: '加腋区箍筋', detail: `加密区1=${Math.round(denseZone1mm)}mm，间距${stir.spacingDense}mm${inHaunchZone ? '，高度含加腋' : ''}` }}
                selected={isSelected('stirrup')} onSelect={onSelect} />
            );
          }
        });
        return haunchBars;
      })()}

      {haunchType === 'vertical' && (() => {
        const haunchBars: React.ReactNode[] = [];
        const sides: ('left' | 'right')[] = [];
        if (hasLeftHaunch) sides.push('left');
        if (hasRightHaunch) sides.push('right');
        // 使用实际 laE 计算锚固长度
        const haunchLaE = calcLaE(botR.grade, botR.diameter, params.concreteGrade, params.seismicGrade);
        const anchorInCol = Math.min(haunchLaE * S, HC - COVER);
        const halfB = bm / 2;

        sides.forEach(sd => {
          const sign = sd === 'left' ? -1 : 1;
          const xColFace = sign * span.lenS / 2;
          // 柱内锚固终点 (sign 方向，远离梁)
          const xColInner = xColFace + sign * anchorInCol;
          // 加腋终点 (-sign 方向，朝梁跨中)
          const xHaunchEnd = xColFace - sign * haunchLen;

          [1, -1].forEach((zSign, zi) => {
            // 附加筋柱内锚固 + 斜面段 (上下各一根)
            // 下部
            haunchBars.push(
              <RebarBar key={`vba-${sd}-${zi}`}
                position={[(xColInner + xColFace) / 2, COVER, zSign * (halfB + haunchH - COVER)]}
                length={anchorInCol} diameter={botR.diameter}
                color={COLOR_HAUNCH} hiColor={COLOR_HAUNCH_HI}
                renderOrder={2}
                info={{ type: 'bottom', label: '附加筋(柱内)', detail: `竖向加腋，伸入柱内${Math.round(anchorInCol / S)}mm(≥laE)` }}
                selected={isSelected('bottom')} onSelect={onSelect} />
            );
            haunchBars.push(
              <SlopedRebarBar key={`vbs-${sd}-${zi}`}
                start={[xColFace, COVER, zSign * (halfB + haunchH - COVER)]}
                end={[xHaunchEnd, COVER, zSign * (halfB - COVER)]}
                diameter={botR.diameter}
                color={COLOR_HAUNCH} hiColor={COLOR_HAUNCH_HI}
                info={{ type: 'bottom', label: '下部附加筋(斜面)', detail: '竖向加腋，沿斜面' }}
                selected={isSelected('bottom')} onSelect={onSelect} />
            );
            // 上部
            haunchBars.push(
              <RebarBar key={`vta-${sd}-${zi}`}
                position={[(xColInner + xColFace) / 2, hm - COVER, zSign * (halfB + haunchH - COVER)]}
                length={anchorInCol} diameter={topR.diameter}
                color={COLOR_HAUNCH} hiColor={COLOR_HAUNCH_HI}
                renderOrder={2}
                info={{ type: 'top', label: '附加筋(柱内)', detail: `竖向加腋，伸入柱内${Math.round(anchorInCol / S)}mm(≥laE)` }}
                selected={isSelected('top')} onSelect={onSelect} />
            );
            haunchBars.push(
              <SlopedRebarBar key={`vts-${sd}-${zi}`}
                start={[xColFace, hm - COVER, zSign * (halfB + haunchH - COVER)]}
                end={[xHaunchEnd, hm - COVER, zSign * (halfB - COVER)]}
                diameter={topR.diameter}
                color={COLOR_HAUNCH} hiColor={COLOR_HAUNCH_HI}
                info={{ type: 'top', label: '上部附加筋(斜面)', detail: '竖向加腋，沿斜面' }}
                selected={isSelected('top')} onSelect={onSelect} />
            );
          });

          // 竖向加腋区箍筋
          const haunchStirCount = Math.ceil((params.haunchLength || 0) / stir.spacingDense);
          for (let j = 0; j < haunchStirCount; j++) {
            const t = (j + 0.5) / haunchStirCount;
            const sx = xColFace + (xHaunchEnd - xColFace) * t;
            const localW = haunchH * (1 - t);
            haunchBars.push(
              <StirrupRing key={`vhs-${sd}-${j}`}
                x={sx} width={(span.bS - 2 * COVER - STIR_D) + 2 * localW + stir.diameter * S}
                height={innerH + stir.diameter * S} diameter={stir.diameter}
                color={COLOR_STIRRUP} hiColor={COLOR_STIRRUP_HI} cover={COVER} legs={stir.legs}
                info={{ type: 'stirrup', label: '加腋区箍筋', detail: `加密区2，间距${stir.spacingDense}mm` }}
                selected={isSelected('stirrup')} onSelect={onSelect} />
            );
          }
        });
        return haunchBars;
      })()}
        </group>
      ))}

      {/* 尺寸标注 */}
      {showDimensions && (
        <>
          {/* Per-span dimension annotations */}
          {spanLayouts.map((span, si) => {
            const dimSupportLenI = calcSupportRebarLength(spanLengthsMm[si]) * S;
            const dimSupportLenMmI = calcSupportRebarLength(spanLengthsMm[si]);
            return (
            <group key={`dim-span-${si}`} position={[span.center, 0, 0]}>
              <DenseZoneMark x={-span.lenS / 2 + denseZone} beamH={hm} />
              <DenseZoneMark x={span.lenS / 2 - denseZone} beamH={hm} />
              <DimLine
                start={-span.lenS / 2} end={-span.lenS / 2 + denseZone}
                offset={hm + hm * 0.38}
                label={`加密区 ${denseZoneMm}`}
                color="#D97706"
              />
              <DimLine
                start={span.lenS / 2 - denseZone} end={span.lenS / 2}
                offset={hm + hm * 0.38}
                label={`加密区 ${denseZoneMm}`}
                color="#D97706"
              />
              <DimLine
                start={-span.lenS / 2} end={span.lenS / 2}
                offset={-(hm * 0.25)}
                label={`ln=${spanLengthsMm[si]}mm${spanCount > 1 ? ` (跨${si + 1})` : ''}`}
                color="#2563EB"
              />
              {leftR && (
                <DimLine
                  start={-span.lenS / 2} end={-span.lenS / 2 + dimSupportLenI}
                  offset={hm + hm * 0.2}
                  label={`ln/3=${dimSupportLenMmI}`}
                  color="#7C3AED"
                />
              )}
              {rightR && (
                <DimLine
                  start={span.lenS / 2 - dimSupportLenI} end={span.lenS / 2}
                  offset={hm + hm * 0.2}
                  label={`ln/3=${dimSupportLenMmI}`}
                  color="#7C3AED"
                />
              )}
            </group>
            );
          })}

          {/* Global dimension annotations */}
          {/* 左柱宽 hc */}
          <DimLine
            start={-TOTAL_NET / 2 - HC} end={-TOTAL_NET / 2}
            offset={-(hm * 0.45)}
            label={`hc=${params.hc || 500}`}
            color="#64748B"
          />
          {/* 右柱宽 hc */}
          <DimLine
            start={TOTAL_NET / 2} end={TOTAL_NET / 2 + HC}
            offset={-(hm * 0.45)}
            label={`hc=${params.hc || 500}`}
            color="#64748B"
          />

          {/* 梁高 h */}
          <VDimLine
            x={TOTAL_NET / 2 + HC}
            bottom={0} top={hm}
            offset={hm * 0.3}
            label={`h=${params.h}`}
            color="#475569"
          />

          {/* ====== 锚固长度标注 (z 偏移到前立面) ====== */}
          {(() => {
            const zFront = -bm * 0.8;
            const nodes: React.ReactNode[] = [];

            // --- 上部筋锚固 (右端) ---
            if (topAnchor.canStraight) {
              nodes.push(
                <DimLine key="dim-top-anc"
                  start={TOTAL_NET / 2} end={TOTAL_NET / 2 + topAnchor.straightLen * S}
                  offset={topBarY1} label={`上部筋直锚 laE=${topAnchor.straightLen}`}
                  color="#DC2626" z={zFront} />
              );
            } else {
              nodes.push(
                <DimLine key="dim-top-anc-b"
                  start={TOTAL_NET / 2} end={TOTAL_NET / 2 + topAnchor.bentStraightPart * S}
                  offset={topBarY1} label={`上部筋弯锚 0.4laE=${topAnchor.bentStraightPart}`}
                  color="#DC2626" z={zFront} />
              );
              nodes.push(
                <VDimLine key="dim-top-anc-bend"
                  x={TOTAL_NET / 2 + topAnchor.bentStraightPart * S}
                  bottom={topBarY1 - topAnchor.bentBendPart * S} top={topBarY1}
                  offset={hm * 0.15} label={`15d=${topAnchor.bentBendPart}`}
                  color="#DC2626" z={zFront} />
              );
            }

            // --- 下部筋锚固 (右端) ---
            if (botAnchor.canStraight) {
              nodes.push(
                <DimLine key="dim-bot-anc"
                  start={TOTAL_NET / 2} end={TOTAL_NET / 2 + botAnchor.straightLen * S}
                  offset={botBarY1} label={`下部筋直锚 laE=${botAnchor.straightLen}`}
                  color="#DC2626" z={zFront} />
              );
            } else {
              nodes.push(
                <DimLine key="dim-bot-anc-b"
                  start={TOTAL_NET / 2} end={TOTAL_NET / 2 + botAnchor.bentStraightPart * S}
                  offset={botBarY1} label={`下部筋弯锚 0.4laE=${botAnchor.bentStraightPart}`}
                  color="#DC2626" z={zFront} />
              );
              nodes.push(
                <VDimLine key="dim-bot-anc-bend"
                  x={TOTAL_NET / 2 + botAnchor.bentStraightPart * S}
                  bottom={botBarY1} top={botBarY1 + botAnchor.bentBendPart * S}
                  offset={hm * 0.15} label={`15d=${botAnchor.bentBendPart}`}
                  color="#DC2626" z={zFront} />
              );
            }

            // --- 支座负筋锚固 (左端, first span) ---
            if (leftR && leftAnchor) {
              const xL = spanLayouts[0].leftFace;
              if (leftAnchor.canStraight) {
                nodes.push(
                  <DimLine key="dim-ls-anc"
                    start={xL - leftAnchor.straightLen * S} end={xL}
                    offset={supportBarY1} label={`支座筋直锚 laE=${leftAnchor.straightLen}`}
                    color="#7C3AED" z={zFront} />
                );
              } else {
                nodes.push(
                  <DimLine key="dim-ls-anc-b"
                    start={xL - leftAnchor.bentStraightPart * S} end={xL}
                    offset={supportBarY1} label={`支座筋弯锚 0.4laE=${leftAnchor.bentStraightPart}`}
                    color="#7C3AED" z={zFront} />
                );
                nodes.push(
                  <VDimLine key="dim-ls-anc-bend"
                    x={xL - leftAnchor.bentStraightPart * S}
                    bottom={supportBarY1 - leftAnchor.bentBendPart * S} top={supportBarY1}
                    offset={-(hm * 0.15)} label={`15d=${leftAnchor.bentBendPart}`}
                    color="#7C3AED" z={zFront} />
                );
              }
            }

            // --- 支座负筋锚固 (右端, last span) ---
            if (rightR && rightAnchor) {
              const xR = spanLayouts[spanCount - 1].rightFace;
              if (rightAnchor.canStraight) {
                nodes.push(
                  <DimLine key="dim-rs-anc"
                    start={xR} end={xR + rightAnchor.straightLen * S}
                    offset={supportBarY1} label={`支座筋直锚 laE=${rightAnchor.straightLen}`}
                    color="#7C3AED" z={zFront} />
                );
              } else {
                nodes.push(
                  <DimLine key="dim-rs-anc-b"
                    start={xR} end={xR + rightAnchor.bentStraightPart * S}
                    offset={supportBarY1} label={`支座筋弯锚 0.4laE=${rightAnchor.bentStraightPart}`}
                    color="#7C3AED" z={zFront} />
                );
                nodes.push(
                  <VDimLine key="dim-rs-anc-bend"
                    x={xR + rightAnchor.bentStraightPart * S}
                    bottom={supportBarY1 - rightAnchor.bentBendPart * S} top={supportBarY1}
                    offset={hm * 0.15} label={`15d=${rightAnchor.bentBendPart}`}
                    color="#7C3AED" z={zFront} />
                );
              }
            }

            // --- 架立筋搭接长度 (first span) ---
            {
              const lapMm = 150;
              const lapLen = lapMm * S;
              const s0 = spanLayouts[0];
              if (leftR) {
                nodes.push(
                  <DimLine key="dim-lap-l"
                    start={s0.leftFace + supportLen - lapLen} end={s0.leftFace + supportLen}
                    offset={hm + hm * 0.42}
                    label={`搭接${lapMm}mm(≥150)`}
                    color="#D97706" z={zFront} />
                );
              }
              if (rightR) {
                nodes.push(
                  <DimLine key="dim-lap-r"
                    start={s0.rightFace - supportLen} end={s0.rightFace - supportLen + lapLen}
                    offset={hm + hm * 0.42}
                    label={`搭接${lapMm}mm(≥150)`}
                    color="#D97706" z={zFront} />
                );
              }
            }

            // --- 加腋尺寸标注 (single-span only) ---
            if (spanCount === 1 && haunchType === 'horizontal') {
              const haunchLenMm = params.haunchLength || 0;
              const haunchHMm = params.haunchHeight || 0;
              const span0lenS = spanLayouts[0].lenS;
              if (hasLeftHaunch) {
                nodes.push(
                  <DimLine key="dim-haunch-l-len"
                    start={-span0lenS / 2} end={-span0lenS / 2 + haunchLen}
                    offset={-(hm * 0.15 + haunchH)}
                    label={`c₁=${haunchLenMm}`}
                    color="#E67E22" />
                );
                nodes.push(
                  <VDimLine key="dim-haunch-l-h"
                    x={-span0lenS / 2}
                    bottom={-haunchH} top={0}
                    offset={-(hm * 0.2)}
                    label={`${haunchHMm}`}
                    color="#E67E22" />
                );
              }
              if (hasRightHaunch) {
                nodes.push(
                  <DimLine key="dim-haunch-r-len"
                    start={span0lenS / 2 - haunchLen} end={span0lenS / 2}
                    offset={-(hm * 0.15 + haunchH)}
                    label={`c₁=${haunchLenMm}`}
                    color="#E67E22" />
                );
                nodes.push(
                  <VDimLine key="dim-haunch-r-h"
                    x={span0lenS / 2}
                    bottom={-haunchH} top={0}
                    offset={hm * 0.2}
                    label={`${haunchHMm}`}
                    color="#E67E22" />
                );
              }
            }
            if (spanCount === 1 && haunchType === 'vertical') {
              const haunchLenMm = params.haunchLength || 0;
              const haunchHMm = params.haunchHeight || 0;
              const span0lenS = spanLayouts[0].lenS;
              if (hasLeftHaunch) {
                nodes.push(
                  <DimLine key="dim-haunch-l-len"
                    start={-span0lenS / 2} end={-span0lenS / 2 + haunchLen}
                    offset={-(hm * 0.25)}
                    label={`c₁=${haunchLenMm}`}
                    color="#E67E22" z={bm / 2 + haunchH + 0.02} />
                );
                nodes.push(
                  <DimLine key="dim-haunch-l-w"
                    start={bm / 2} end={bm / 2 + haunchH}
                    offset={-(hm * 0.15)}
                    label={`${haunchHMm}`}
                    color="#E67E22" z={0} />
                );
              }
              if (hasRightHaunch) {
                nodes.push(
                  <DimLine key="dim-haunch-r-len"
                    start={span0lenS / 2 - haunchLen} end={span0lenS / 2}
                    offset={-(hm * 0.25)}
                    label={`c₁=${haunchLenMm}`}
                    color="#E67E22" z={bm / 2 + haunchH + 0.02} />
                );
              }
            }

            // --- 保护层厚度 ---
            nodes.push(
              <VDimLine key="dim-cover"
                x={-TOTAL_NET / 2}
                bottom={hm - COVER} top={hm}
                offset={-(hm * 0.35)}
                label={`c=${params.cover || 25}`}
                color="#6B7280" z={zFront} />
            );

            return nodes;
          })()}
        </>
      )}

      {cutPosition !== null && <SectionCutPlane position={cutPosition} height={hm} width={bm} />}
    </>
  );
}

export default function BeamViewer({ params, cutPosition, showCut, onCutPositionChange, onShowCutChange }: {
  params: BeamParams;
  cutPosition: number | null;
  showCut: boolean;
  onCutPositionChange: (v: number | null) => void;
  onShowCutChange: (v: boolean) => void;
}) {
  const hm = params.h * S;
  const spanCount = params.spanCount || 1;
  const HC_EXT = (params.hc || 500) * S;
  const spanLensExt: number[] = (params.spanLengths && params.spanLengths.length === spanCount)
    ? params.spanLengths
    : Array(spanCount).fill(params.spanLength || 4000);
  const TOTAL_NET_EXT = spanLensExt.reduce((s, l) => s + l * S, 0) + (spanCount - 1) * HC_EXT;
  // 相机距离系数：根据总梁长自适应缩放
  const camScale = Math.max(TOTAL_NET_EXT / 4, 1); // 基准: 4m 梁
  const gridSize = Math.max(Math.ceil(TOTAL_NET_EXT * 2.5), 10);
  const [selected, setSelected] = useState<RebarMeshInfo | null>(null);
  const [concreteOpacity, setConcreteOpacity] = useState(0.15);
  const [showDimensions, setShowDimensions] = useState(false);
  const [cameraTarget, setCameraTarget] = useState<[number, number, number] | null>(null);
  const [animating, setAnimating] = useState(false);
  const [step, setStep] = useState(BEAM_CONSTRUCTION_STEPS.length - 1);
  const [autoPlay, setAutoPlay] = useState(false);
  const { isFullscreen: fsActive, toggle: fsToggle, containerRef: fsContainerRef, containerClass: fsClass } = useFullscreen();

  // 截图函数
  const takeScreenshot = useCallback(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-viewer="beam"] canvas');
    if (canvas) {
      const dataUrl = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.download = `${params.id || 'beam'}_${new Date().toISOString().slice(0, 10)}.png`;
      link.href = dataUrl;
      link.click();
    }
  }, [params.id]);

  // 快捷键支持
  const keyBindings = useMemo(() => createViewerBindings({
    resetView: () => setCameraTarget([3 * camScale, 2 * camScale, 4 * camScale]),
    toggleDimensions: () => setShowDimensions(d => !d),
    takeScreenshot,
    toggleAnimation: () => {
      if (animating) {
        setAutoPlay(a => !a);
      } else {
        setStep(0);
        setAnimating(true);
      }
    },
    setViewPreset: (preset) => {
      const presets: Record<string, [number, number, number]> = {
        front: [0, 0.3 * camScale, 5 * camScale],
        side: [5 * camScale, 0.3 * camScale, 0],
        top: [0, 5 * camScale, 0.1],
        iso: [3 * camScale, 2 * camScale, 4 * camScale],
      };
      setCameraTarget(presets[preset] || presets.iso);
    },
  }), [camScale, animating, takeScreenshot]);

  useKeyboard(keyBindings);

  // Auto-play timer
  useEffect(() => {
    if (!autoPlay || !animating) return;
    const id = setInterval(() => {
      setStep(s => {
        if (s >= BEAM_CONSTRUCTION_STEPS.length - 1) { setAutoPlay(false); return s; }
        return s + 1;
      });
    }, 2000);
    return () => clearInterval(id);
  }, [autoPlay, animating]);

  const visibleGroups = animating ? BEAM_CONSTRUCTION_STEPS[step].groups : undefined;

  // 根据选中钢筋类型计算附加数据
  const selectedAdditionalData = useMemo(() => {
    if (!selected) return undefined;
    const topR = parseRebar(params.top);
    const botR = parseRebar(params.bottom);
    const stir = parseStirrup(params.stirrup);
    const topAnchor = calcBeamEndAnchor(topR.grade, topR.diameter, params.concreteGrade, params.seismicGrade, params.hc || 500, params.cover || 25);
    const botAnchor = calcBeamEndAnchor(botR.grade, botR.diameter, params.concreteGrade, params.seismicGrade, params.hc || 500, params.cover || 25);

    // 钢筋线密度 kg/m (d²/162)
    const linearWeight = (d: number) => d * d / 162 / 1000;
    const sc = params.spanCount || 1;
    const spanLens: number[] = (params.spanLengths && params.spanLengths.length === sc)
      ? params.spanLengths
      : Array(sc).fill(params.spanLength || 4000);
    const beamSpan = spanLens[0];
    const totalNetMm = spanLens.reduce((s, l) => s + l, 0) + (sc - 1) * (params.hc || 500);

    switch (selected.type) {
      case 'top': {
        const anchorLen = topAnchor.canStraight ? topAnchor.straightLen : topAnchor.bentStraightPart + topAnchor.bentBendPart;
        const totalLen = totalNetMm + anchorLen * 2;
        return {
          length: totalLen,
          weight: totalLen * linearWeight(topR.diameter),
          anchorLength: topAnchor.canStraight ? topAnchor.straightLen : topAnchor.bentStraightPart,
        };
      }
      case 'bottom': {
        const anchorLen = botAnchor.canStraight ? botAnchor.straightLen : botAnchor.bentStraightPart + botAnchor.bentBendPart;
        const totalLen = totalNetMm + anchorLen * 2;
        return {
          length: totalLen,
          weight: totalLen * linearWeight(botR.diameter),
          anchorLength: botAnchor.canStraight ? botAnchor.straightLen : botAnchor.bentStraightPart,
        };
      }
      case 'stirrup': {
        const perimeter = 2 * ((params.b - (params.cover || 25) * 2) + (params.h - (params.cover || 25) * 2)) + stir.diameter * 2 * 1.9 * 2;
        return {
          length: Math.round(perimeter),
          weight: perimeter * linearWeight(stir.diameter),
          spacing: stir.spacingDense,
          ...(sc > 1 ? { hint: `×${sc}跨` } : {}),
        };
      }
      case 'leftSupport':
      case 'rightSupport': {
        const supportLenMm = calcSupportRebarLength(beamSpan);
        const r = parseRebar(selected.type === 'leftSupport' ? (params.leftSupport || '') : (params.rightSupport || ''));
        return {
          length: supportLenMm,
          weight: supportLenMm * linearWeight(r.diameter),
          ...(sc > 1 ? { hint: `×${sc}跨` } : {}),
        };
      }
      case 'leftSupport2':
      case 'rightSupport2': {
        const supportLenMm2 = calcSupportRebarLength(beamSpan, 2);
        const r2 = parseRebar(selected.type === 'leftSupport2' ? (params.leftSupport2 || '') : (params.rightSupport2 || ''));
        return {
          length: supportLenMm2,
          weight: supportLenMm2 * linearWeight(r2.diameter),
          ...(sc > 1 ? { hint: `×${sc}跨` } : {}),
        };
      }
      case 'innerSupport': {
        if (!params.innerSupport || sc < 2) return undefined;
        const ir = parseRebar(params.innerSupport);
        const leftLenMm = calcSupportRebarLength(beamSpan);
        const rightLenMm = calcSupportRebarLength(beamSpan);
        const innerBarLen = leftLenMm + (params.hc || 500) + rightLenMm;
        return {
          length: innerBarLen,
          weight: innerBarLen * linearWeight(ir.diameter),
          hint: `×${sc - 1}内柱`,
        };
      }
      case 'sideBar': {
        if (!params.sideBar) return undefined;
        const si = parseSideBar(params.sideBar);
        if (!si) return undefined;
        const sideAnchorCalc = calcBeamEndAnchor(si.grade, si.diameter, params.concreteGrade, params.seismicGrade, params.hc || 500, params.cover || 25);
        const sideAnchorLen = sideAnchorCalc.canStraight ? sideAnchorCalc.straightLen : sideAnchorCalc.bentStraightPart + sideAnchorCalc.bentBendPart;
        const sideTotalLen = totalNetMm + sideAnchorLen * 2;
        return {
          length: sideTotalLen,
          weight: sideTotalLen * linearWeight(si.diameter),
          anchorLength: sideAnchorCalc.canStraight ? sideAnchorCalc.straightLen : sideAnchorCalc.bentStraightPart,
        };
      }
      case 'tieBar': {
        const tieInfo = params.tieBar ? parseTieBar(params.tieBar) : autoTieBar(params.b, stir.grade, stir.diameter);
        if (!tieInfo) return undefined;
        const tieLen = params.b - 2 * (params.cover || 25) - stir.diameter; // 拉筋净长
        const hookLen = Math.max(10 * tieInfo.diameter, 75);
        const totalTieLen = tieLen + 2 * hookLen;
        return {
          length: Math.round(totalTieLen),
          weight: totalTieLen * linearWeight(tieInfo.diameter),
          spacing: stir.spacingNormal,
          ...(sc > 1 ? { hint: `×${sc}跨` } : {}),
        };
      }
      case 'erection': {
        const erDia = beamSpan <= 4000 ? 10 : 12;
        const erLen = beamSpan * 0.8; // approximate
        return {
          length: Math.round(erLen),
          weight: erLen * linearWeight(erDia),
          ...(sc > 1 ? { hint: `×${sc}跨` } : {}),
        };
      }
      default:
        return undefined;
    }
  }, [selected, params]);

  return (
    <div className="space-y-2" data-viewer="beam">
      <div className="flex items-center gap-1.5 flex-wrap">
        <button
          onClick={() => { onShowCutChange(!showCut); if (showCut) onCutPositionChange(null); else onCutPositionChange(0); }}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-all ${showCut ? 'bg-accent text-white shadow-sm shadow-accent/20' : 'bg-white border border-gray-200 text-muted hover:bg-gray-50 hover:border-gray-300'}`}>
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21L3 9m18 12l-4-12M12 3v18" /></svg>
          {showCut ? '关闭剖切' : '剖切视图'}
        </button>
        <button
          onClick={() => setShowDimensions(!showDimensions)}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-all ${showDimensions ? 'bg-amber-500 text-white shadow-sm shadow-amber-500/20' : 'bg-white border border-gray-200 text-muted hover:bg-gray-50 hover:border-gray-300'}`}>
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5" /></svg>
          {showDimensions ? '隐藏标注' : '尺寸标注'}
        </button>
        <button
          onClick={() => { setAnimating(a => { if (a) { setAutoPlay(false); } else { setStep(0); } return !a; }); }}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-all ${animating ? 'bg-emerald-500 text-white shadow-sm shadow-emerald-500/20' : 'bg-white border border-gray-200 text-muted hover:bg-gray-50 hover:border-gray-300'}`}>
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          {animating ? '退出动画' : '施工动画'}
        </button>
        <button
          onClick={takeScreenshot}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-all bg-white border border-gray-200 text-muted hover:bg-gray-50 hover:border-gray-300"
          title="截图 (S)">
          <Camera className="w-3.5 h-3.5" />
          截图
        </button>
        <KeyboardHelp bindings={keyBindings} />
        {selected && (
          <button onClick={() => setSelected(null)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 text-muted cursor-pointer hover:bg-gray-200 transition-colors">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            取消选中
          </button>
        )}
      </div>

      {animating && (
        <div className="flex items-center gap-3 bg-white rounded-lg border border-emerald-200 px-4 py-2">
          <button onClick={() => setStep(s => Math.max(0, s - 1))} disabled={step <= 0}
            className="px-2 py-1 rounded text-xs font-medium cursor-pointer bg-gray-100 hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed">◀</button>
          <input type="range" min={0} max={BEAM_CONSTRUCTION_STEPS.length - 1} step={1} value={step}
            onChange={e => setStep(parseInt(e.target.value))} className="flex-1 accent-emerald-500" />
          <button onClick={() => setStep(s => Math.min(BEAM_CONSTRUCTION_STEPS.length - 1, s + 1))} disabled={step >= BEAM_CONSTRUCTION_STEPS.length - 1}
            className="px-2 py-1 rounded text-xs font-medium cursor-pointer bg-gray-100 hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed">▶</button>
          <button onClick={() => { if (!autoPlay) setStep(s => Math.min(s, BEAM_CONSTRUCTION_STEPS.length - 2)); setAutoPlay(a => !a); }}
            className={`px-2 py-1 rounded text-xs font-medium cursor-pointer ${autoPlay ? 'bg-emerald-500 text-white' : 'bg-gray-100 hover:bg-gray-200'}`}>
            {autoPlay ? '⏸' : '▶ 自动'}
          </button>
          <span className="text-xs text-muted whitespace-nowrap">{step + 1}/{BEAM_CONSTRUCTION_STEPS.length} {BEAM_CONSTRUCTION_STEPS[step].label}</span>
        </div>
      )}

      {showCut && (
        <div className="flex items-center gap-3 bg-white rounded-lg border border-gray-200 px-4 py-2">
          <span className="text-xs text-muted whitespace-nowrap">剖切位置</span>
          <input type="range" min={-(TOTAL_NET_EXT / 2 * 0.95)} max={TOTAL_NET_EXT / 2 * 0.95} step={0.05} value={cutPosition ?? 0}
            onChange={e => onCutPositionChange(parseFloat(e.target.value))} className="flex-1 accent-accent" />
          <span className="text-xs text-muted w-20 text-right">{((cutPosition ?? 0) + TOTAL_NET_EXT / 2).toFixed(2)}m / {TOTAL_NET_EXT.toFixed(1)}m</span>
        </div>
      )}

      <div ref={fsContainerRef} className={`relative w-full bg-surface overflow-hidden ${fsClass}`}>
        {selected && <RebarDetailPanel info={selected} onClose={() => setSelected(null)} additionalData={selectedAdditionalData} />}

        {/* Toolbar overlay */}
        <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5">
          {[
            { name: '正面', pos: [0, 0.3 * camScale, 5 * camScale] as [number, number, number] },
            { name: '侧面', pos: [5 * camScale, 0.3 * camScale, 0] as [number, number, number] },
            { name: '俯视', pos: [0, 5 * camScale, 0.1] as [number, number, number] },
            { name: '透视', pos: [3 * camScale, 2 * camScale, 4 * camScale] as [number, number, number] },
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

        <Canvas camera={{ position: [3 * camScale, 2 * camScale, 4 * camScale], fov: 45 }} scene={{ background: new THREE.Color('#f8fafc') }}>
          <CameraController targetPosition={cameraTarget} />
          <ambientLight intensity={0.6} />
          <directionalLight position={[5 * camScale, 8, 5 * camScale]} intensity={0.8} castShadow />
          <BeamScene params={params} selected={selected} onSelect={setSelected} cutPosition={cutPosition} concreteOpacity={concreteOpacity} showDimensions={showDimensions} visibleGroups={visibleGroups} />
          <Grid args={[gridSize, gridSize]} position={[0, -0.01, 0]} cellColor="#E2E8F0" sectionColor="#E2E8F0" fadeDistance={gridSize * 1.5} />
          <axesHelper args={[1]} />
          <OrbitControls target={[0, hm / 2, 0]} enableDamping dampingFactor={0.1} />
        </Canvas>
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-black/50 text-white/80 text-[11px] px-4 py-1.5 rounded-full backdrop-blur-md pointer-events-none">
          <span>左键旋转</span>
          <span className="w-px h-3 bg-white/20" />
          <span>右键平移</span>
          <span className="w-px h-3 bg-white/20" />
          <span>滚轮缩放</span>
          <span className="w-px h-3 bg-white/20" />
          <span>点击钢筋查看详情</span>
        </div>
      </div>
    </div>
  );
}
