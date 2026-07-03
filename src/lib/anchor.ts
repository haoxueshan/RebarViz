/**
 * 22G101 锚固长度、搭接长度计算
 * 基于《混凝土结构设计规范》GB50010-2010 及 22G101 图集
 */

// 混凝土等级对应轴心抗拉强度设计值 ft (N/mm²)
export const FT: Record<string, number> = {
  C20: 1.10, C25: 1.27, C30: 1.43, C35: 1.57,
  C40: 1.71, C45: 1.80, C50: 1.89, C55: 1.96,
  C60: 2.04,
};

// 钢筋等级对应抗拉强度设计值 fy (N/mm²)
export const FY: Record<string, number> = {
  A: 270,  // HPB300
  B: 300,  // HRB335
  C: 360,  // HRB400
  D: 360,  // RRB400
  E: 360,  // HRBF400
  F: 435,  // HRB500
  G: 435,  // HRBF500
};

export type ConcreteGrade = 'C20' | 'C25' | 'C30' | 'C35' | 'C40' | 'C45' | 'C50' | 'C55' | 'C60';
export type SeismicGrade = '一级' | '二级' | '三级' | '四级' | '非抗震';

export const CONCRETE_GRADES: ConcreteGrade[] = ['C20', 'C25', 'C30', 'C35', 'C40', 'C45', 'C50', 'C55', 'C60'];
export const SEISMIC_GRADES: SeismicGrade[] = ['一级', '二级', '三级', '四级', '非抗震'];

// 保护层厚度推荐值 — 已集中到 construction-rules.ts，此处保持向后兼容导出
export { COVER_DEFAULT as COVER_DEFAULTS } from './construction-rules';
import {
  ANCHOR_ALPHA, SEISMIC_ANCHOR_FACTOR, BENT_ANCHOR_FACTOR,
  anchorMinLength, LAP_MIN_LENGTH, lapFactor,
  BEAM_END_STRAIGHT, BEAM_END_BENT_STRAIGHT_RATIO,
  SLAB_BOTTOM_ANCHOR, BOTTOM_BAR_MIN_ANCHOR_D_FACTOR,
  BOTTOM_BAR_LAP_H0_FACTOR, COLUMN_LAP_ZONE,
  SUPPORT_BAR_EXTEND_RATIO,
  getLabFactor, getLabEFactor,
  ANCHOR_LARGE_DIA_FACTOR, ANCHOR_LARGE_DIA_THRESHOLD,
  needsLargeDiaCorrection,
  determineJLEndAnchor, determineLPBEdgeAnchor, determineBPBEdgeAnchor,
  jlTopBarConnectionZone, jlBottomBarConnectionZone,
  getPileEmbedDepth, determinePileCapRebarEnd,
} from './construction-rules';

export {
  determineJLEndAnchor, determineLPBEdgeAnchor, determineBPBEdgeAnchor,
  jlTopBarConnectionZone, jlBottomBarConnectionZone,
  getPileEmbedDepth, determinePileCapRebarEnd,
  checkJLLDirectAnchor,
  gzhSpiralStirrupHookLen,
  JLL_FIRST_STIRRUP_FROM_COLUMN, JLL_DIRECT_ANCHOR_PAST_CENTER_D,
  JLL_ANCHOR_ZONE_STIRRUP_DIA_RATIO, JLL_ANCHOR_ZONE_STIRRUP_SPACING_D, JLL_ANCHOR_ZONE_STIRRUP_SPACING_MAX,
  GZH_SPIRAL_STIRRUP_LAP_TURNS, GZH_STIFFENER_HOOP_MIN_DIA, GZH_STIFFENER_HOOP_MIN_GRADE,
} from './construction-rules';
export type { JLEndAnchorResult, RaftSlabEdgeAnchorResult, PileCapRebarEndResult } from './construction-rules';

/**
 * 基本锚固长度 lab (mm)
 * lab = α × (fy / ft) × d
 * α: 钢筋外形系数，光圆 0.16，带肋 0.14
 */
export function calcLab(rebarGrade: string, diameter: number, concreteGrade: ConcreteGrade): number {
  const fy = FY[rebarGrade] || 360;
  const ft = FT[concreteGrade] || 1.43;
  const alpha = rebarGrade === 'A' ? ANCHOR_ALPHA.plain : ANCHOR_ALPHA.deformed;
  const lab = alpha * (fy / ft) * diameter;
  return Math.ceil(lab);
}

/**
 * 锚固长度 la (mm)
 * la = ζa × lab，且 ≥ max(200, 10d)
 * ζa: 锚固长度修正系数
 */
export function calcLa(rebarGrade: string, diameter: number, concreteGrade: ConcreteGrade): number {
  const lab = calcLab(rebarGrade, diameter, concreteGrade);
  const zetaA = 1.0; // 简化：普通钢筋，非环氧涂层
  // GB50010 §8.3.1: 带肋钢筋 d>25mm 时 la 乘以 1.1 修正
  const largeDiaFactor = needsLargeDiaCorrection(rebarGrade, diameter) ? ANCHOR_LARGE_DIA_FACTOR : 1.0;
  const la = Math.ceil(zetaA * lab * largeDiaFactor);
  return anchorMinLength(la, diameter);
}

/**
 * 抗震锚固长度 laE (mm)
 * laE = ζaE × la
 * ζaE: 抗震等级修正系数
 */
export function calcLaE(
  rebarGrade: string, diameter: number,
  concreteGrade: ConcreteGrade, seismicGrade: SeismicGrade
): number {
  const la = calcLa(rebarGrade, diameter, concreteGrade);
  const zetaAE = seismicGrade === '非抗震' ? SEISMIC_ANCHOR_FACTOR.nonSeismic : SEISMIC_ANCHOR_FACTOR.seismic;
  const laE = Math.ceil(zetaAE * la);
  return anchorMinLength(laE, diameter);
}

/**
 * 基本搭接长度 ll (mm)
 * ll = ζl × la
 * ζl: 搭接长度修正系数，按搭接百分率
 */
export function calcLl(
  rebarGrade: string, diameter: number,
  concreteGrade: ConcreteGrade, lapPercent: number = 50
): number {
  const la = calcLa(rebarGrade, diameter, concreteGrade);
  const zetaL = lapFactor(lapPercent);
  const ll = Math.ceil(zetaL * la);
  return Math.max(ll, LAP_MIN_LENGTH);
}

/**
 * 抗震搭接长度 llE (mm)
 */
export function calcLlE(
  rebarGrade: string, diameter: number,
  concreteGrade: ConcreteGrade, seismicGrade: SeismicGrade,
  lapPercent: number = 50
): number {
  const laE = calcLaE(rebarGrade, diameter, concreteGrade, seismicGrade);
  const zetaL = lapFactor(lapPercent);
  const llE = Math.ceil(zetaL * laE);
  return Math.max(llE, LAP_MIN_LENGTH);
}

/**
 * 弯锚弯折段长度 (mm)
 * 22G101: 弯折段 = 15d (梁筋弯锚入柱，22G101-1 标准)
 */
export function calcBendLength(diameter: number): number {
  return BENT_ANCHOR_FACTOR * diameter;
}

/**
 * 梁端支座锚固判断与计算 (22G101-1)
 * 直锚条件: laE ≤ hc - 保护层 (即柱宽足够容纳直锚)
 * 直锚长度: max(laE, 0.5*hc + 5d)
 * 弯锚: 直段 ≥ max(0.4*laE, 0.5*hc+5d 不适用时)，弯折15d
 *        伸至柱外侧纵筋内侧
 */
export interface BeamEndAnchor {
  canStraight: boolean;     // 是否满足直锚条件
  straightLen: number;      // 直锚长度 mm
  bentStraightPart: number; // 弯锚直段长度 mm (≥0.4laE)
  bentBendPart: number;     // 弯锚弯折段 15d mm
  laE: number;              // 抗震锚固长度
  hc: number;               // 柱截面宽度
}

export type BeamSideBarPrefix = 'G' | 'N';

export function calcBeamEndAnchor(
  rebarGrade: string, diameter: number,
  concreteGrade: ConcreteGrade, seismicGrade: SeismicGrade,
  hc: number, cover: number
): BeamEndAnchor {
  const laE = calcLaE(rebarGrade, diameter, concreteGrade, seismicGrade);
  const availableDepth = hc - cover; // 柱内可用锚固深度
  const canStraight = laE <= availableDepth;
  const straightLen = Math.max(laE, Math.ceil(BEAM_END_STRAIGHT.hcFactor * hc + BEAM_END_STRAIGHT.dFactor * diameter));
  // 22G101: 弯锚直段伸至柱对侧纵筋内侧 ≈ hc-cover，且 ≥ 0.4laE
  const bentStraightPart = Math.max(Math.ceil(BEAM_END_BENT_STRAIGHT_RATIO * laE), hc - cover);
  const bentBendPart = BENT_ANCHOR_FACTOR * diameter;

  return { canStraight, straightLen, bentStraightPart, bentBendPart, laE, hc };
}

/**
 * 梁腰筋/抗扭筋端部锚固
 * G 构造腰筋按 15d 直锚表达，避免误画成梁主筋 90°弯锚；
 * N 抗扭筋受扭纵筋按梁纵筋锚固规则处理。
 */
export function calcBeamSideBarAnchor(
  prefix: BeamSideBarPrefix,
  rebarGrade: string,
  diameter: number,
  concreteGrade: ConcreteGrade,
  seismicGrade: SeismicGrade,
  hc: number,
  cover: number,
): BeamEndAnchor {
  if (prefix === 'G') {
    const straightLen = Math.max(15 * diameter, 150);
    return {
      canStraight: true,
      straightLen,
      bentStraightPart: 0,
      bentBendPart: 0,
      laE: straightLen,
      hc,
    };
  }

  return calcBeamEndAnchor(rebarGrade, diameter, concreteGrade, seismicGrade, hc, cover);
}

/**
 * 梁支座负筋伸入跨内长度 (mm)
 * 22G101: 第一排 ln/3，第二排 ln/4
 * ln: 梁净跨
 */
export function calcSupportRebarLength(beamNetSpan: number, row: 1 | 2 = 1): number {
  const ratio = row === 1 ? SUPPORT_BAR_EXTEND_RATIO.middleRow1 : SUPPORT_BAR_EXTEND_RATIO.middleRow2;
  return Math.ceil(beamNetSpan * ratio);
}

/**
 * 梁下部筋伸入支座锚固 (22G101-1)
 * 端支座: 同上部筋锚固规则 (直锚 laE 或弯锚 0.4laE+15d)
 * 中间支座: 贯穿或在节点外搭接，搭接长度 ≥ llE 且 ≥ 1.5h0
 */
export function calcBottomBarAnchor(
  rebarGrade: string, diameter: number,
  concreteGrade: ConcreteGrade, seismicGrade: SeismicGrade
): number {
  const laE = calcLaE(rebarGrade, diameter, concreteGrade, seismicGrade);
  return Math.max(laE, BOTTOM_BAR_MIN_ANCHOR_D_FACTOR * diameter);
}

/**
 * 梁下部筋中间节点搭接长度 (22G101-1)
 * 中间层中间节点: 梁下部筋在节点外搭接
 * 搭接长度 ≥ llE 且 ≥ 1.5h0 (h0 = h - cover - d/2)
 */
export function calcBottomBarLapAtMiddleJoint(
  rebarGrade: string, diameter: number,
  concreteGrade: ConcreteGrade, seismicGrade: SeismicGrade,
  beamH: number, cover: number
): number {
  const llE = calcLlE(rebarGrade, diameter, concreteGrade, seismicGrade);
  const h0 = beamH - cover - diameter / 2;
  return Math.max(llE, Math.ceil(BOTTOM_BAR_LAP_H0_FACTOR * h0));
}

/**
 * 板底筋伸入支座长度 (mm)
 * 22G101: ≥ 5d 且 ≥ la/2 (简支端)
 */
export function calcSlabBottomAnchor(
  rebarGrade: string, diameter: number,
  concreteGrade: ConcreteGrade
): number {
  const la = calcLa(rebarGrade, diameter, concreteGrade);
  return Math.max(SLAB_BOTTOM_ANCHOR.dFactor * diameter, Math.ceil(SLAB_BOTTOM_ANCHOR.laRatio * la));
}

/**
 * 柱纵筋搭接区域 (mm)
 * 22G101: 柱纵筋连接区域在柱净高下部 1/6 以上、根部 500mm 以上
 */
export function calcColumnLapZone(columnNetHeight: number): { start: number; end: number } {
  const start = Math.max(COLUMN_LAP_ZONE.minStart, Math.ceil(columnNetHeight * COLUMN_LAP_ZONE.heightRatio));
  const end = start + COLUMN_LAP_ZONE.zoneLength;
  return { start, end };
}

/**
 * 综合计算结果
 */
export interface AnchorCalcResult {
  lab: number;    // 基本锚固长度
  la: number;     // 锚固长度
  laE: number;    // 抗震锚固长度
  ll: number;     // 搭接长度
  llE: number;    // 抗震搭接长度
  bendLen: number; // 弯折段长度
}

export function calcAnchorAll(
  rebarGrade: string, diameter: number,
  concreteGrade: ConcreteGrade, seismicGrade: SeismicGrade
): AnchorCalcResult {
  return {
    lab: calcLab(rebarGrade, diameter, concreteGrade),
    la: calcLa(rebarGrade, diameter, concreteGrade),
    laE: calcLaE(rebarGrade, diameter, concreteGrade, seismicGrade),
    ll: calcLl(rebarGrade, diameter, concreteGrade),
    llE: calcLlE(rebarGrade, diameter, concreteGrade, seismicGrade),
    bendLen: calcBendLength(diameter),
  };
}

// ═══════════════════════════════════════════════════════════════════
// 表格法 — 22G101-3 第2-2/2-3页（优先于公式法，更贴近图集）
// ═══════════════════════════════════════════════════════════════════

/**
 * 查表法基本锚固长度 lab (mm) — 22G101-3 第2-2页
 * lab = n × d，n 从 LAB_TABLE 查取
 */
export function calcLabTable(
  rebarGrade: string, diameter: number, concreteGrade: ConcreteGrade
): number {
  const n = getLabFactor(rebarGrade, concreteGrade);
  return n * diameter;
}

/**
 * 查表法抗震基本锚固长度 labE (mm) — 22G101-3 第2-2页
 * labE = n × d，n 从 LAB_E_TABLE 查取
 */
export function calcLabETable(
  rebarGrade: string, diameter: number,
  concreteGrade: ConcreteGrade, seismicGrade: SeismicGrade
): number {
  const n = getLabEFactor(rebarGrade, concreteGrade, seismicGrade);
  return n * diameter;
}

/**
 * 查表法锚固长度 la (mm) — 22G101-3 第2-3页
 * la = lab（d≤25）或 1.1×lab（d>25，带肋钢筋）
 * la ≥ max(200, 10d)
 */
export function calcLaTable(
  rebarGrade: string, diameter: number, concreteGrade: ConcreteGrade
): number {
  const lab = calcLabTable(rebarGrade, diameter, concreteGrade);
  const factor = needsLargeDiaCorrection(rebarGrade, diameter) ? ANCHOR_LARGE_DIA_FACTOR : 1.0;
  const la = Math.ceil(factor * lab);
  return anchorMinLength(la, diameter);
}

/**
 * 查表法抗震锚固长度 laE (mm) — 22G101-3 第2-3页
 * laE = labE（d≤25）或 1.1×labE（d>25，带肋钢筋）
 * laE ≥ max(200, 10d)
 */
export function calcLaETable(
  rebarGrade: string, diameter: number,
  concreteGrade: ConcreteGrade, seismicGrade: SeismicGrade
): number {
  const labE = calcLabETable(rebarGrade, diameter, concreteGrade, seismicGrade);
  const factor = needsLargeDiaCorrection(rebarGrade, diameter) ? ANCHOR_LARGE_DIA_FACTOR : 1.0;
  const laE = Math.ceil(factor * labE);
  return anchorMinLength(laE, diameter);
}

/** 大直径修正常量（方便外部引用） */
export { ANCHOR_LARGE_DIA_FACTOR, ANCHOR_LARGE_DIA_THRESHOLD, needsLargeDiaCorrection } from './construction-rules';
