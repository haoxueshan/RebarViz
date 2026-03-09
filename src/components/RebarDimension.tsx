'use client';

import { useMemo } from 'react';
import * as THREE from 'three';
import { Line, Html } from '@react-three/drei';

interface DimensionLineProps {
  start: [number, number, number];
  end: [number, number, number];
  label: string;
  offset?: number; // 标注线偏移距离
  color?: string;
}

/**
 * 3D 尺寸标注线组件
 * 用于在 3D 场景中标注钢筋间距、长度等尺寸
 */
export function DimensionLine({ start, end, label, offset = 0.1, color = '#2563EB' }: DimensionLineProps) {
  const { linePoints, midPoint, arrowStart, arrowEnd } = useMemo(() => {
    const s = new THREE.Vector3(...start);
    const e = new THREE.Vector3(...end);
    const dir = new THREE.Vector3().subVectors(e, s).normalize();
    const perpendicular = new THREE.Vector3(-dir.y, dir.x, dir.z).normalize().multiplyScalar(offset);
    
    const offsetStart = s.clone().add(perpendicular);
    const offsetEnd = e.clone().add(perpendicular);
    const mid = new THREE.Vector3().addVectors(offsetStart, offsetEnd).multiplyScalar(0.5);
    
    // 箭头方向
    const arrowLen = 0.03;
    const arrowAngle = Math.PI / 6;
    const arrowS1 = offsetStart.clone().add(dir.clone().multiplyScalar(arrowLen).applyAxisAngle(new THREE.Vector3(0, 0, 1), arrowAngle));
    const arrowS2 = offsetStart.clone().add(dir.clone().multiplyScalar(arrowLen).applyAxisAngle(new THREE.Vector3(0, 0, 1), -arrowAngle));
    const arrowE1 = offsetEnd.clone().add(dir.clone().negate().multiplyScalar(arrowLen).applyAxisAngle(new THREE.Vector3(0, 0, 1), arrowAngle));
    const arrowE2 = offsetEnd.clone().add(dir.clone().negate().multiplyScalar(arrowLen).applyAxisAngle(new THREE.Vector3(0, 0, 1), -arrowAngle));
    
    return {
      linePoints: [offsetStart.toArray(), offsetEnd.toArray()] as [number, number, number][],
      midPoint: mid.toArray() as [number, number, number],
      arrowStart: [
        [offsetStart.toArray(), arrowS1.toArray()],
        [offsetStart.toArray(), arrowS2.toArray()],
      ] as [number, number, number][][],
      arrowEnd: [
        [offsetEnd.toArray(), arrowE1.toArray()],
        [offsetEnd.toArray(), arrowE2.toArray()],
      ] as [number, number, number][][],
    };
  }, [start, end, offset]);

  return (
    <group>
      {/* 主标注线 */}
      <Line points={linePoints} color={color} lineWidth={1.5} />
      
      {/* 起点箭头 */}
      {arrowStart.map((pts, i) => (
        <Line key={`as${i}`} points={pts} color={color} lineWidth={1.5} />
      ))}
      
      {/* 终点箭头 */}
      {arrowEnd.map((pts, i) => (
        <Line key={`ae${i}`} points={pts} color={color} lineWidth={1.5} />
      ))}
      
      {/* 文字标注 */}
      <Html position={midPoint} center distanceFactor={8}>
        <div className="bg-white/90 backdrop-blur-sm px-2 py-0.5 rounded text-[10px] font-medium text-blue-700 border border-blue-200 shadow-sm whitespace-nowrap pointer-events-none">
          {label}
        </div>
      </Html>
    </group>
  );
}

interface SpacingIndicatorProps {
  positions: number[]; // X 坐标数组
  y: number;
  z: number;
  label: string;
}

/**
 * 钢筋间距指示器
 * 显示多根钢筋之间的间距标注
 */
export function SpacingIndicator({ positions, y, z, label }: SpacingIndicatorProps) {
  if (positions.length < 2) return null;

  const midIdx = Math.floor(positions.length / 2);
  
  return (
    <DimensionLine
      start={[positions[midIdx - 1], y, z]}
      end={[positions[midIdx], y, z]}
      label={label}
      offset={0.08}
      color="#10B981"
    />
  );
}

interface AnchorLengthIndicatorProps {
  x: number; // 梁端位置
  anchorLength: number; // 锚固长度 (m)
  y: number;
  z: number;
  side: 'left' | 'right';
}

/**
 * 锚固长度标注
 * 显示钢筋在柱内的锚固长度
 */
export function AnchorLengthIndicator({ x, anchorLength, y, z, side }: AnchorLengthIndicatorProps) {
  const sign = side === 'left' ? -1 : 1;
  
  return (
    <DimensionLine
      start={[x, y, z]}
      end={[x + sign * anchorLength, y, z]}
      label={`laE=${(anchorLength * 1000).toFixed(0)}mm`}
      offset={0.12}
      color="#8B5CF6"
    />
  );
}
