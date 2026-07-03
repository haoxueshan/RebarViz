import * as THREE from 'three';
import { S, STIRRUP_CURVE_SAMPLES } from './constants';

export type StirrupPlane = 'yz' | 'xz';

export interface CreateStirrupCurvesParams {
  width: number;
  height: number;
  diameter: number;
  cornerRadius?: number;
  plane: StirrupPlane;
}

export interface StirrupCurves {
  outerCurve: THREE.CatmullRomCurve3;
  hookCurves: THREE.CatmullRomCurve3[];
}

export interface ResolveInnerLegPositionsParams {
  legs: number;
  width: number;
  barPositions?: number[];
}

export interface CreateTieBarHookPointsParams {
  sideOffset: number;
  tieDiameter: number;
  sideBarDiameter: number;
  hookAngle?: number;
  hookVisualScale?: number;
  arcSegments?: number;
}

export interface CalculateStirrupLengthParams {
  width: number;
  height: number;
  diameter: number;
  cornerRadius?: number;
}

export interface CreateStirrupShapeSpecParams {
  widthMm: number;
  heightMm: number;
  diameterMm: number;
  cornerRadiusMm?: number;
}

export interface StirrupShapeSpec {
  widthMm: number;
  heightMm: number;
  diameterMm: number;
  cornerRadiusMm: number;
  bendRadiusMm: number;
  hookLenMm: number;
  hookAngleDeg: 135;
  bodyLenMm: number;
  lengthMm: number;
}

export interface CreateTieBarShapeSpecParams {
  sideOffsetMm: number;
  tieDiameterMm: number;
  sideBarDiameterMm: number;
  hookAngleDeg?: number;
  arcSegments?: number;
}

export interface TieBarShapeSpec {
  sideOffsetMm: number;
  tieDiameterMm: number;
  sideBarDiameterMm: number;
  bendRadiusMm: number;
  hookLenMm: number;
  hookAngleDeg: number;
  bodyLenMm: number;
  lengthMm: number;
}

export interface ResolveTieSideOffsetMmParams {
  sectionWidthMm: number;
  coverMm: number;
  stirrupDiameterMm: number;
  sideBarDiameterMm: number;
}

function toPlanePoint(plane: StirrupPlane, u: number, v: number): THREE.Vector3 {
  return plane === 'yz'
    ? new THREE.Vector3(0, v, u)
    : new THREE.Vector3(u, 0, v);
}

function tieBarClearance(diameter: number, sideBarDiameter: number): number {
  return sideBarDiameter / 2 + diameter / 2 + Math.max(diameter * 0.25, 1);
}

export function createStirrupCurves({
  width,
  height,
  diameter,
  cornerRadius,
  plane,
}: CreateStirrupCurvesParams): StirrupCurves {
  const w2 = width / 2;
  const h2 = height / 2;
  const dS = diameter * S;
  const innerBendR = Math.max(2 * dS, 0.01);
  const r = cornerRadius ?? innerBendR + dS / 2;
  const rC = Math.min(r, w2 * 0.45, h2 * 0.45);

  const path2d = new THREE.Path();
  path2d.moveTo(-w2 + rC, -h2);
  path2d.lineTo(w2 - rC, -h2);
  path2d.absarc(w2 - rC, -h2 + rC, rC, -Math.PI / 2, 0, false);
  path2d.lineTo(w2, h2 - rC);
  path2d.absarc(w2 - rC, h2 - rC, rC, 0, Math.PI / 2, false);
  path2d.lineTo(-w2 + rC, h2);
  path2d.absarc(-w2 + rC, h2 - rC, rC, Math.PI / 2, Math.PI, false);
  path2d.lineTo(-w2, -h2 + rC);
  path2d.absarc(-w2 + rC, -h2 + rC, rC, Math.PI, Math.PI * 1.5, false);

  const pts2d = path2d.getSpacedPoints(STIRRUP_CURVE_SAMPLES);
  const outerCurve = new THREE.CatmullRomCurve3(
    pts2d.map((p) => toPlanePoint(plane, p.x, p.y)),
    true,
    'centripetal',
  );

  const hookLen = Math.max(10 * dS, 0.075);
  const hookBendR = Math.max(2.5 * dS, 0.006);
  const c45 = Math.SQRT1_2;
  const arcSteps = 12;

  const uC1 = -w2 + rC;
  const vC1 = h2 - hookBendR;
  const h1pts: THREE.Vector3[] = [];
  for (let t = 0; t <= 1; t += 0.25) {
    h1pts.push(toPlanePoint(plane, uC1 + hookBendR * 2 * (1 - t), h2));
  }
  for (let i = 0; i <= arcSteps; i++) {
    const a = ((3 * Math.PI) / 4) * (i / arcSteps);
    h1pts.push(toPlanePoint(
      plane,
      uC1 - hookBendR * Math.sin(a),
      vC1 + hookBendR * Math.cos(a),
    ));
  }
  const endU1 = uC1 - hookBendR * Math.sin((3 * Math.PI) / 4);
  const endV1 = vC1 + hookBendR * Math.cos((3 * Math.PI) / 4);
  for (let t = 0.1; t <= 1; t += 0.1) {
    h1pts.push(toPlanePoint(plane, endU1 + hookLen * c45 * t, endV1 - hookLen * c45 * t));
  }

  const vC2 = h2 - hookBendR;
  const h2pts: THREE.Vector3[] = [];
  for (let t = 0; t <= 1; t += 0.25) {
    h2pts.push(toPlanePoint(plane, -w2, vC2 - hookBendR * 2 * (1 - t)));
  }
  for (let i = 0; i <= arcSteps; i++) {
    const a = ((3 * Math.PI) / 4) * (i / arcSteps);
    h2pts.push(toPlanePoint(
      plane,
      -w2 + hookBendR * (1 - Math.cos(a)),
      vC2 + hookBendR * Math.sin(a),
    ));
  }
  const endU2 = -w2 + hookBendR * (1 - Math.cos((3 * Math.PI) / 4));
  const endV2 = vC2 + hookBendR * Math.sin((3 * Math.PI) / 4);
  for (let t = 0.1; t <= 1; t += 0.1) {
    h2pts.push(toPlanePoint(plane, endU2 + hookLen * c45 * t, endV2 - hookLen * c45 * t));
  }

  return {
    outerCurve,
    hookCurves: [
      new THREE.CatmullRomCurve3(h1pts, false, 'centripetal'),
      new THREE.CatmullRomCurve3(h2pts, false, 'centripetal'),
    ],
  };
}

export function resolveInnerLegPositions({
  legs,
  width,
  barPositions,
}: ResolveInnerLegPositionsParams): number[] {
  if (legs <= 2) return [];
  const innerLegs = legs - 2;

  if (barPositions && barPositions.length >= 2) {
    const sorted = [...new Set(barPositions)].sort((a, b) => a - b);
    const gaps: number[] = [];
    for (let i = 0; i < sorted.length - 1; i++) {
      gaps.push((sorted[i] + sorted[i + 1]) / 2);
    }

    if (gaps.length >= innerLegs) {
      const step = gaps.length / innerLegs;
      return Array.from({ length: innerLegs }, (_, i) =>
        gaps[Math.min(Math.round(step * i + step / 2 - 0.5), gaps.length - 1)],
      );
    }
    return gaps.slice(0, innerLegs);
  }

  const spacing = width / (legs - 1);
  return Array.from({ length: innerLegs }, (_, i) => -width / 2 + (i + 1) * spacing);
}

export function createTieBarHookPoints({
  sideOffset,
  tieDiameter,
  sideBarDiameter,
  hookAngle = (3 * Math.PI) / 4,
  hookVisualScale = 1,
}: CreateTieBarHookPointsParams): THREE.Vector3[] {
  const tieDiaS = tieDiameter * S;
  const sideDiaS = sideBarDiameter * S;
  const bendR = Math.max(sideDiaS / 2 + tieDiaS, tieDiaS * 3);
  const hookLen = Math.max(10 * tieDiaS, bendR * 1.5);
  const visualHookLen = hookLen * hookVisualScale;
  const points: THREE.Vector3[] = [];
  const clearance = tieBarClearance(tieDiameter, sideBarDiameter) * S;
  const bodyHalf = Math.max(sideOffset - clearance, 0);
  const leftBody = new THREE.Vector3(0, 0, -bodyHalf);
  const rightBody = new THREE.Vector3(0, 0, bodyHalf);

  if (hookVisualScale <= 0) {
    return [leftBody, rightBody];
  }

  const hookDrop = Math.max(visualHookLen * Math.sin(hookAngle - Math.PI / 2), 2.4 * tieDiaS);
  const hookTail = Math.max(visualHookLen * Math.cos(hookAngle - Math.PI / 2), 2.4 * tieDiaS);

  points.push(new THREE.Vector3(0, -hookDrop - hookTail * 0.35, -bodyHalf + hookTail));
  points.push(new THREE.Vector3(0, -hookDrop, -bodyHalf));
  points.push(leftBody);
  points.push(rightBody);
  points.push(new THREE.Vector3(0, -hookDrop, bodyHalf));
  points.push(new THREE.Vector3(0, -hookDrop - hookTail * 0.35, bodyHalf - hookTail));

  return points;
}

export function resolveTieSideOffsetMm({
  sectionWidthMm,
  coverMm,
  stirrupDiameterMm,
  sideBarDiameterMm,
}: ResolveTieSideOffsetMmParams): number {
  const stirrupCenterWidth = sectionWidthMm - 2 * coverMm - stirrupDiameterMm;
  return Math.max(stirrupCenterWidth / 2 - stirrupDiameterMm / 2 - sideBarDiameterMm / 2, 0);
}

export function measurePolylineLength(points: THREE.Vector3[]): number {
  return points.slice(0, -1).reduce((sum, point, index) => {
    return sum + point.distanceTo(points[index + 1]);
  }, 0);
}

export function createTieBarShapeSpec({
  sideOffsetMm,
  tieDiameterMm,
  sideBarDiameterMm,
  hookAngleDeg = 135,
}: CreateTieBarShapeSpecParams): TieBarShapeSpec {
  const bendRadiusMm = Math.max(sideBarDiameterMm / 2 + tieDiameterMm, tieDiameterMm * 3);
  const hookLenMm = Math.max(10 * tieDiameterMm, bendRadiusMm * 1.5);
  const clearanceMm = tieBarClearance(tieDiameterMm, sideBarDiameterMm);
  const bodyLenMm = Math.max(0, sideOffsetMm * 2 - clearanceMm * 2);
  const hookBendArcMm = bendRadiusMm * (hookAngleDeg * Math.PI / 180);
  const lengthMm = Math.round(bodyLenMm + 2 * (hookBendArcMm + hookLenMm));

  return {
    sideOffsetMm,
    tieDiameterMm,
    sideBarDiameterMm,
    bendRadiusMm,
    hookLenMm,
    hookAngleDeg,
    bodyLenMm,
    lengthMm,
  };
}

export function calculateTieBarLengthMm(params: CreateTieBarHookPointsParams): number {
  return createTieBarShapeSpec({
    sideOffsetMm: params.sideOffset / S,
    tieDiameterMm: params.tieDiameter,
    sideBarDiameterMm: params.sideBarDiameter,
    hookAngleDeg: params.hookAngle ? params.hookAngle * 180 / Math.PI : 135,
    arcSegments: params.arcSegments,
  }).lengthMm;
}

export function createStirrupShapeSpec({
  widthMm,
  heightMm,
  diameterMm,
  cornerRadiusMm,
}: CreateStirrupShapeSpecParams): StirrupShapeSpec {
  const safeWidthMm = Math.max(widthMm, 0);
  const safeHeightMm = Math.max(heightMm, 0);
  const dS = diameterMm * S;
  const innerBendR = Math.max(2 * dS, 0.01);
  const defaultCornerRadiusMm = (innerBendR + dS / 2) / S;
  const resolvedCornerRadiusMm = cornerRadiusMm ?? defaultCornerRadiusMm;
  const rC = Math.min(
    Math.max(resolvedCornerRadiusMm, 0),
    (safeWidthMm / 2) * 0.45,
    (safeHeightMm / 2) * 0.45,
  );
  const bendRadiusMm = Math.max(2.5 * diameterMm, 6);
  const hookLenMm = Math.max(10 * diameterMm, 75);
  const bodyLenMm = Math.max(0, 2 * (safeWidthMm + safeHeightMm) - 8 * rC + 2 * Math.PI * rC);
  const hookBendArcMm = bendRadiusMm * (135 * Math.PI / 180);
  const lengthMm = Math.round(bodyLenMm + 2 * (hookBendArcMm + hookLenMm));

  return {
    widthMm: safeWidthMm,
    heightMm: safeHeightMm,
    diameterMm,
    cornerRadiusMm: resolvedCornerRadiusMm,
    bendRadiusMm,
    hookLenMm,
    hookAngleDeg: 135,
    bodyLenMm,
    lengthMm,
  };
}

export function calculateStirrupLengthMm({
  width,
  height,
  diameter,
  cornerRadius,
}: CalculateStirrupLengthParams): number {
  return createStirrupShapeSpec({
    widthMm: width / S,
    heightMm: height / S,
    diameterMm: diameter,
    cornerRadiusMm: cornerRadius === undefined ? undefined : cornerRadius / S,
  }).lengthMm;
}
