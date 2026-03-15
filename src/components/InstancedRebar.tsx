'use client';

import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { RebarMeshInfo } from '@/lib/types';

// ─── Shared cylinder segment count ───
const SEGMENTS = 8;

// ─── Camera position controller (shared across all 3D viewers) ───
export function CameraController({ targetPosition }: { targetPosition: [number, number, number] | null }) {
  const { camera } = useThree();
  useEffect(() => {
    if (targetPosition) { camera.position.set(...targetPosition); camera.updateProjectionMatrix(); }
  }, [targetPosition, camera]);
  return null;
}

// ─── InstancedMesh rebar group: one draw call for N identical bars ───
export function InstancedRebarGroup({ matrices, radius, length, color, hiColor, info, selected, onSelect, visible }: {
  matrices: THREE.Matrix4[]; radius: number; length: number;
  color: string; hiColor: string; info: RebarMeshInfo;
  selected: boolean; onSelect: (info: RebarMeshInfo | null) => void;
  visible: boolean;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const [hovered, setHovered] = useState(false);
  const count = matrices.length;
  const activeColor = selected ? hiColor : hovered ? hiColor : color;
  const geo = useMemo(() => new THREE.CylinderGeometry(radius, radius, length, SEGMENTS), [radius, length]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || count === 0) return;
    for (let i = 0; i < count; i++) mesh.setMatrixAt(i, matrices[i]);
    mesh.instanceMatrix.needsUpdate = true;
  }, [matrices, count]);

  const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onSelect(selected ? null : info); }, [selected, info, onSelect]);
  const handleOver = useCallback((e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); setHovered(true); document.body.style.cursor = 'pointer'; }, []);
  const handleOut = useCallback(() => { setHovered(false); document.body.style.cursor = 'auto'; }, []);

  if (!visible || count === 0) return null;
  return (
    <instancedMesh ref={meshRef} args={[geo, undefined, count]} onClick={handleClick} onPointerOver={handleOver} onPointerOut={handleOut}>
      <meshStandardMaterial color={activeColor} roughness={0.4} metalness={0.6} emissive={selected ? hiColor : '#000000'} emissiveIntensity={selected ? 0.3 : 0} />
    </instancedMesh>
  );
}

// ─── Matrix builder: horizontal bars along Z-axis (X-direction bars) ───
export function buildZBarMatrices(positions: number[], y: number, zStart: number, zEnd: number): THREE.Matrix4[] {
  const midZ = (zStart + zEnd) / 2;
  const rot = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1));
  return positions.map(x => {
    const m = new THREE.Matrix4();
    m.compose(new THREE.Vector3(x, y, midZ), rot, new THREE.Vector3(1, 1, 1));
    return m;
  });
}

// ─── Matrix builder: horizontal bars along X-axis (Y-direction bars) ───
export function buildXBarMatrices(positions: number[], y: number, xStart: number, xEnd: number): THREE.Matrix4[] {
  const midX = (xStart + xEnd) / 2;
  const rot = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0));
  return positions.map(z => {
    const m = new THREE.Matrix4();
    m.compose(new THREE.Vector3(midX, y, z), rot, new THREE.Vector3(1, 1, 1));
    return m;
  });
}

// ─── Matrix builder: vertical bars (column inserts) ───
export function buildVertBarMatrices(positions: { x: number; z: number }[], yCenter: number): THREE.Matrix4[] {
  return positions.map(p => {
    const m = new THREE.Matrix4();
    m.compose(new THREE.Vector3(p.x, yCenter, p.z), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
    return m;
  });
}

// ─── Matrix builder: column bend bars (22G101-3) — alternating X/Z direction ───
export function buildColBendMatrices(
  positions: { x: number; z: number }[],
  bendLenM: number, coverScene: number, colDiameter: number, S: number,
): THREE.Matrix4[] {
  if (positions.length === 0 || bendLenM <= 0) return [];
  const bendY = coverScene + colDiameter * S;
  const rotX = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0));
  const rotZ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1));
  return positions.map((p, i) => {
    const m = new THREE.Matrix4();
    const isEven = i % 2 === 0;
    const offset = isEven
      ? new THREE.Vector3(p.x + bendLenM / 2, bendY, p.z)
      : new THREE.Vector3(p.x, bendY, p.z + bendLenM / 2);
    m.compose(offset, isEven ? rotX : rotZ, new THREE.Vector3(1, 1, 1));
    return m;
  });
}
