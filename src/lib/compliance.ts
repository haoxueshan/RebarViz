/**
 * 规范合规性校验 — 基于 GB50010-2010 和 22G101 图集
 * 在 AI 生成配筋参数后，自动检查是否满足规范要求
 */
import type { BeamParams, ColumnParams, SlabParams, ShearWallParams, StairParams, RaftFoundationParams, ComponentType } from './types';
import { parseRebar, parseRebarBottom, parseStirrup, parseSlabRebar, resolveColumnBars } from './rebar';
import { calcEffectiveDepth } from './layout';
import { FT, FY, calcLaE } from './anchor';
import type { SeismicGrade } from './anchor';
import {
  rebarArea,
  beamRhoMin, BEAM_RHO_MAX, BEAM_MIN_THROUGH_BAR_COUNT,
  COLUMN_RHO_MIN, COLUMN_RHO_MAX, COLUMN_MIN_MAIN_BAR_COUNT,
  columnMinMainDiameter,
  maxStirrupSpacingDense, minStirrupDiameter,
  SIDE_BAR_REQUIRED_HW,
  SLAB_MIN_THICKNESS, slabMaxBarSpacing,
  WALL_RHO_MIN, WALL_DIST_MAX_SPACING, WALL_DIST_MIN_DIAMETER, WALL_BOUNDARY_MIN_BAR_COUNT,
  STAIR_COMFORT, STAIR_STEP_HEIGHT, STAIR_STEP_WIDTH, STAIR_MIN_FLIGHT_WIDTH,
  stairSlabThicknessRange, STAIR_MIN_BAR_DIAMETER, STAIR_BAR_SPACING,
  SLAB_DIST_MIN_DIAMETER, SLAB_DIST_MAX_SPACING,
  determineColFoundAnchor,
  COL_FOUND_STIRRUP_MIN_COUNT, COL_FOUND_STIRRUP_ZONE_SPACING_MAX,
  COL_FOUND_CORNER_ONLY_H_AXIAL,
} from './construction-rules';

export type ComplianceStatus = 'pass' | 'warn' | 'fail';

export interface ComplianceResult {
  field: string;     // 相关字段
  rule: string;      // 规范条文
  status: ComplianceStatus;
  message: string;   // 说明
  suggestion?: string; // 修正建议
}

// ─── 通用辅助 (构造规则已集中到 construction-rules.ts) ───

// ─── 梁合规性校验 ───

export function checkBeamCompliance(p: BeamParams): ComplianceResult[] {
  const results: ComplianceResult[] = [];
  const top = parseRebar(p.top);
  const bot = parseRebarBottom(p.bottom);
  const stir = parseStirrup(p.stirrup);
  const cover = p.cover || 25;

  const ft = FT[p.concreteGrade] || 1.43;
  const fyTop = FY[top.grade] || 360;
  const fyBot = FY[bot.grade] || 360;

  // 1. 配筋率校验 GB50010 §8.5.1 (多排钢筋取合力点)
  const { h0: h0Top } = calcEffectiveDepth(p.h, cover, stir.diameter, top.diameter, top.count, top.rows, top.perRow, top.segments);
  const { h0: h0Bot } = calcEffectiveDepth(p.h, cover, stir.diameter, bot.diameter, bot.count, bot.rows, bot.perRow, bot.segments);
  const segArea = (segs: {count:number;diameter:number}[]) => segs.reduce((s, seg) => s + seg.count * rebarArea(seg.diameter), 0);
  const AsTop = top.segments ? segArea(top.segments) : top.count * rebarArea(top.diameter);
  const AsBot = bot.segments ? segArea(bot.segments) : bot.count * rebarArea(bot.diameter);
  const rhoTop = AsTop / (p.b * h0Top);
  const rhoBot = AsBot / (p.b * h0Bot);
  const rhoMinTop = beamRhoMin(ft, fyTop);
  const rhoMinBot = beamRhoMin(ft, fyBot);
  const rhoMax = BEAM_RHO_MAX;

  if (rhoTop < rhoMinTop) {
    const minAs = Math.ceil(rhoMinTop * p.b * h0Top);
    results.push({
      field: 'top', rule: 'GB50010 §8.5.1',
      status: 'fail',
      message: `上部筋配筋率 ${(rhoTop * 100).toFixed(2)}% < 最小配筋率 ${(rhoMinTop * 100).toFixed(2)}%`,
      suggestion: `建议增大上部筋面积，最小需 ${minAs}mm²`,
    });
  }
  if (rhoBot < rhoMinBot) {
    const minAs = Math.ceil(rhoMinBot * p.b * h0Bot);
    results.push({
      field: 'bottom', rule: 'GB50010 §8.5.1',
      status: 'fail',
      message: `下部筋配筋率 ${(rhoBot * 100).toFixed(2)}% < 最小配筋率 ${(rhoMinBot * 100).toFixed(2)}%`,
      suggestion: `建议增大下部筋面积，最小需 ${minAs}mm²`,
    });
  }
  if (rhoTop > rhoMax) {
    results.push({
      field: 'top', rule: 'GB50010 §8.5.1',
      status: 'warn',
      message: `上部筋配筋率 ${(rhoTop * 100).toFixed(2)}% > 2.5%，超筋`,
      suggestion: '建议增大截面尺寸或降低钢筋面积',
    });
  }
  if (rhoBot > rhoMax) {
    results.push({
      field: 'bottom', rule: 'GB50010 §8.5.1',
      status: 'warn',
      message: `下部筋配筋率 ${(rhoBot * 100).toFixed(2)}% > 2.5%，超筋`,
      suggestion: '建议增大截面尺寸或降低钢筋面积',
    });
  }

  // 2. 箍筋加密区间距校验
  const maxDense = maxStirrupSpacingDense(p.seismicGrade, Math.min(top.diameter, bot.diameter));
  if (stir.spacingDense > maxDense) {
    results.push({
      field: 'stirrup', rule: 'GB50011 §6.3.3',
      status: 'fail',
      message: `箍筋加密区间距 ${stir.spacingDense}mm > 允许最大 ${maxDense}mm（${p.seismicGrade}）`,
      suggestion: `建议将加密区间距改为 ≤${maxDense}mm`,
    });
  }

  // 3. 箍筋最小直径
  const minStirDia = minStirrupDiameter(p.seismicGrade);
  if (stir.diameter < minStirDia) {
    results.push({
      field: 'stirrup', rule: 'GB50011 §6.3.3',
      status: 'fail',
      message: `箍筋直径 ${stir.diameter}mm < 最小要求 ${minStirDia}mm（${p.seismicGrade}）`,
      suggestion: `建议箍筋直径改为 ≥${minStirDia}mm`,
    });
  }

  // 4. 纵筋最少根数（截面宽>200mm 时上部至少2根）
  if (top.count < BEAM_MIN_THROUGH_BAR_COUNT) {
    results.push({
      field: 'top', rule: '22G101 构造要求',
      status: 'fail',
      message: `上部通长筋不应少于${BEAM_MIN_THROUGH_BAR_COUNT}根`,
      suggestion: `建议配置至少${BEAM_MIN_THROUGH_BAR_COUNT}根上部通长筋`,
    });
  }
  if (bot.count < BEAM_MIN_THROUGH_BAR_COUNT) {
    results.push({
      field: 'bottom', rule: '22G101 构造要求',
      status: 'fail',
      message: `下部通长筋不应少于${BEAM_MIN_THROUGH_BAR_COUNT}根`,
      suggestion: `建议配置至少${BEAM_MIN_THROUGH_BAR_COUNT}根下部通长筋`,
    });
  }

  // 5. 梁高 hw > 450 时需配腰筋 GB50010 §9.2.13
  const hw = p.h - 2 * cover;
  if (hw > SIDE_BAR_REQUIRED_HW && !p.sideBar) {
    results.push({
      field: 'sideBar', rule: 'GB50010 §9.2.13',
      status: 'warn',
      message: `腹板高度 ${hw}mm > 450mm，宜配置构造腰筋`,
      suggestion: '建议添加构造腰筋，如 G4C12',
    });
  }

  // 合规则返回一个 pass
  if (results.length === 0) {
    results.push({ field: '-', rule: 'GB50010', status: 'pass', message: '梁配筋满足规范要求' });
  }

  return results;
}

// ─── 柱合规性校验 ───

export function checkColumnCompliance(p: ColumnParams): ComplianceResult[] {
  const results: ComplianceResult[] = [];
  const stir = parseStirrup(p.stirrup);

  // Resolve bars using 22G101-1 detailed or legacy notation
  const coverMm = p.cover || 25;
  const innerW = p.b - 2 * coverMm;
  const innerH = p.h - 2 * coverMm;
  const resolved = resolveColumnBars(p.main, p.cornerMain, p.bMiddleMain, p.hMiddleMain, innerW, innerH);

  // 1. 柱纵筋配筋率 GB50010 §8.5.1: ρmin 取决于抗震等级
  const Ag = p.b * p.h;
  const AsMain = resolved.bars.reduce((sum, bar) => sum + rebarArea(bar.diameter), 0);
  const rho = AsMain / Ag;
  const rhoMin = COLUMN_RHO_MIN[p.seismicGrade] || 0.006;
  const rhoMax = COLUMN_RHO_MAX;

  if (rho < rhoMin) {
    const minAs = Math.ceil(rhoMin * Ag);
    results.push({
      field: 'main', rule: 'GB50010 §8.5.1',
      status: 'fail',
      message: `柱纵筋配筋率 ${(rho * 100).toFixed(2)}% < 最小 ${(rhoMin * 100).toFixed(1)}%（${p.seismicGrade}）`,
      suggestion: `建议增大纵筋面积，最小需 ${minAs}mm²`,
    });
  }
  if (rho > rhoMax) {
    results.push({
      field: 'main', rule: 'GB50010 §8.5.1',
      status: 'fail',
      message: `柱纵筋配筋率 ${(rho * 100).toFixed(2)}% > 5%，不满足规范上限`,
      suggestion: '建议增大柱截面尺寸或减少纵筋',
    });
  }

  // 2. 纵筋最小直径 GB50010 §8.5.1
  const minMainDia = columnMinMainDiameter(p.seismicGrade);
  const minBarDia = Math.min(...resolved.bars.map(b => b.diameter));
  if (minBarDia < minMainDia) {
    results.push({
      field: 'main', rule: 'GB50010 §8.5.1',
      status: 'warn',
      message: `柱纵筋最小直径 ${minBarDia}mm < 建议最小 ${minMainDia}mm（${p.seismicGrade}）`,
      suggestion: `建议纵筋直径 ≥${minMainDia}mm`,
    });
  }

  // 3. 纵筋最少根数: 矩形截面每侧≥2根
  if (resolved.totalCount < COLUMN_MIN_MAIN_BAR_COUNT) {
    results.push({
      field: 'main', rule: 'GB50010 §8.5.1',
      status: 'fail',
      message: `柱纵筋 ${resolved.totalCount} 根 < 最少${COLUMN_MIN_MAIN_BAR_COUNT}根（矩形截面每侧至少2根）`,
      suggestion: `建议至少配置${COLUMN_MIN_MAIN_BAR_COUNT}根纵筋`,
    });
  }

  // 4. 箍筋要求
  const minStirDia = minStirrupDiameter(p.seismicGrade);
  if (stir.diameter < minStirDia) {
    results.push({
      field: 'stirrup', rule: 'GB50011 §6.3.7',
      status: 'fail',
      message: `箍筋直径 ${stir.diameter}mm < 最小要求 ${minStirDia}mm（${p.seismicGrade}）`,
      suggestion: `建议箍筋直径改为 ≥${minStirDia}mm`,
    });
  }

  // 5. 22G101-1 分项标注额外校验
  if (resolved.isDetailed) {
    // 角筋必须为4根
    if (resolved.corner.count !== 4) {
      results.push({
        field: 'cornerMain', rule: '22G101-1',
        status: 'warn',
        message: `角筋数量 ${resolved.corner.count} ≠ 4根，矩形截面角筋应为4根`,
        suggestion: '建议角筋标注为 4CXX',
      });
    }
    // 中部筋直径不应大于角筋
    if (resolved.bMiddle && resolved.bMiddle.diameter > resolved.corner.diameter) {
      results.push({
        field: 'bMiddleMain', rule: '22G101-1',
        status: 'warn',
        message: `b边中部筋直径 Φ${resolved.bMiddle.diameter} > 角筋 Φ${resolved.corner.diameter}`,
        suggestion: '中部筋直径一般不大于角筋直径',
      });
    }
    if (resolved.hMiddle && resolved.hMiddle.diameter > resolved.corner.diameter) {
      results.push({
        field: 'hMiddleMain', rule: '22G101-1',
        status: 'warn',
        message: `h边中部筋直径 Φ${resolved.hMiddle.diameter} > 角筋 Φ${resolved.corner.diameter}`,
        suggestion: '中部筋直径一般不大于角筋直径',
      });
    }
  }

  if (results.length === 0) {
    results.push({ field: '-', rule: 'GB50010', status: 'pass', message: '柱配筋满足规范要求' });
  }

  return results;
}

// ─── 板合规性校验 ───

export function checkSlabCompliance(p: SlabParams): ComplianceResult[] {
  const results: ComplianceResult[] = [];
  const bx = parseSlabRebar(p.bottomX);
  const by = parseSlabRebar(p.bottomY);

  // 1. 最小板厚 GB50010 §9.1.2
  const minThickness = SLAB_MIN_THICKNESS;
  if (p.thickness < minThickness) {
    results.push({
      field: 'thickness', rule: 'GB50010 §9.1.2',
      status: 'fail',
      message: `板厚 ${p.thickness}mm < 最小 ${minThickness}mm`,
      suggestion: `建议板厚 ≥${minThickness}mm`,
    });
  }

  // 2. 板配筋率校验 (按 1000mm 宽度计算)
  const cover = p.cover || 15;
  const h0x = p.thickness - cover - bx.diameter / 2;
  const h0y = p.thickness - cover - bx.diameter - by.diameter / 2;
  const AsX = Math.ceil(1000 / bx.spacing) * rebarArea(bx.diameter);
  const AsY = Math.ceil(1000 / by.spacing) * rebarArea(by.diameter);
  const rhoX = AsX / (1000 * h0x);
  const rhoY = AsY / (1000 * h0y);

  const ft = FT[p.concreteGrade] || 1.43;
  const fy = FY[bx.grade] || 360;
  const rhoMin = Math.max(0.002, 0.45 * ft / fy);

  if (rhoX < rhoMin) {
    results.push({
      field: 'bottomX', rule: 'GB50010 §8.5.1',
      status: 'fail',
      message: `X向底筋配筋率 ${(rhoX * 100).toFixed(2)}% < 最小 ${(rhoMin * 100).toFixed(2)}%`,
      suggestion: '建议减小间距或增大直径',
    });
  }
  if (rhoY < rhoMin) {
    results.push({
      field: 'bottomY', rule: 'GB50010 §8.5.1',
      status: 'fail',
      message: `Y向底筋配筋率 ${(rhoY * 100).toFixed(2)}% < 最小 ${(rhoMin * 100).toFixed(2)}%`,
      suggestion: '建议减小间距或增大直径',
    });
  }

  // 3. 间距校验: ≤ 200mm (板厚≤150) 或 ≤ 1.5h (板厚>150)
  const maxSpacing = slabMaxBarSpacing(p.thickness);
  if (bx.spacing > maxSpacing) {
    results.push({
      field: 'bottomX', rule: 'GB50010 §9.1.3',
      status: 'warn',
      message: `X向底筋间距 ${bx.spacing}mm > 建议最大 ${maxSpacing}mm`,
      suggestion: `建议间距 ≤${maxSpacing}mm`,
    });
  }
  if (by.spacing > maxSpacing) {
    results.push({
      field: 'bottomY', rule: 'GB50010 §9.1.3',
      status: 'warn',
      message: `Y向底筋间距 ${by.spacing}mm > 建议最大 ${maxSpacing}mm`,
      suggestion: `建议间距 ≤${maxSpacing}mm`,
    });
  }

  if (results.length === 0) {
    results.push({ field: '-', rule: 'GB50010', status: 'pass', message: '板配筋满足规范要求' });
  }

  return results;
}

// ─── 剪力墙合规性校验 ───

export function checkShearWallCompliance(p: ShearWallParams): ComplianceResult[] {
  const results: ComplianceResult[] = [];
  const vert = parseSlabRebar(p.vertBar);
  const horiz = parseSlabRebar(p.horizBar);
  const boundaryR = parseRebar(p.boundaryMain);

  // 1. 分布筋配筋率 GB50010 §11.7.12: 竖向/水平均 ≥ 0.25%
  const rhoVert = (2 * Math.ceil(p.lw / vert.spacing) * rebarArea(vert.diameter)) / (p.bw * p.lw);
  const rhoHoriz = (2 * Math.ceil(p.hw / horiz.spacing) * rebarArea(horiz.diameter)) / (p.bw * p.hw);
  const rhoMinWall = WALL_RHO_MIN;

  if (rhoVert < rhoMinWall) {
    results.push({
      field: 'vertBar', rule: 'GB50010 §11.7.12',
      status: 'fail',
      message: `竖向分布筋配筋率 ${(rhoVert * 100).toFixed(3)}% < 最小 0.25%`,
      suggestion: '建议减小间距或增大直径',
    });
  }
  if (rhoHoriz < rhoMinWall) {
    results.push({
      field: 'horizBar', rule: 'GB50010 §11.7.12',
      status: 'fail',
      message: `水平分布筋配筋率 ${(rhoHoriz * 100).toFixed(3)}% < 最小 0.25%`,
      suggestion: '建议减小间距或增大直径',
    });
  }

  // 2. 分布筋间距 ≤ 300mm
  if (vert.spacing > WALL_DIST_MAX_SPACING) {
    results.push({
      field: 'vertBar', rule: 'GB50010 §11.7.12',
      status: 'warn',
      message: `竖向分布筋间距 ${vert.spacing}mm > ${WALL_DIST_MAX_SPACING}mm`,
      suggestion: `建议间距 ≤${WALL_DIST_MAX_SPACING}mm`,
    });
  }
  if (horiz.spacing > WALL_DIST_MAX_SPACING) {
    results.push({
      field: 'horizBar', rule: 'GB50010 §11.7.12',
      status: 'warn',
      message: `水平分布筋间距 ${horiz.spacing}mm > ${WALL_DIST_MAX_SPACING}mm`,
      suggestion: `建议间距 ≤${WALL_DIST_MAX_SPACING}mm`,
    });
  }

  // 3. 分布筋最小直径
  if (vert.diameter < WALL_DIST_MIN_DIAMETER) {
    results.push({
      field: 'vertBar', rule: 'GB50010 §11.7.12',
      status: 'warn',
      message: `竖向分布筋直径 ${vert.diameter}mm < 建议最小 ${WALL_DIST_MIN_DIAMETER}mm`,
    });
  }

  // 4. 边缘构件纵筋最少根数
  if (boundaryR.count < WALL_BOUNDARY_MIN_BAR_COUNT) {
    results.push({
      field: 'boundaryMain', rule: 'GB50010 §11.7.14',
      status: 'fail',
      message: `边缘构件纵筋 ${boundaryR.count} 根 < 最少${WALL_BOUNDARY_MIN_BAR_COUNT}根`,
      suggestion: `建议至少配置${WALL_BOUNDARY_MIN_BAR_COUNT}根边缘纵筋`,
    });
  }

  if (results.length === 0) {
    results.push({ field: '-', rule: 'GB50010', status: 'pass', message: '剪力墙配筋满足规范要求' });
  }

  return results;
}

// ─── 楼梯合规性校验 (22G101-2 AT型) ───

export function checkStairCompliance(p: StairParams): ComplianceResult[] {
  const results: ComplianceResult[] = [];
  const botR = parseSlabRebar(p.bottomBar);
  const distR = parseSlabRebar(p.distBar);
  const cover = p.cover || 15;

  const totalRise = p.stepCount * p.stepHeight;
  const totalRun = p.stepCount * p.stepWidth;
  const slabLen = Math.sqrt(totalRise * totalRise + totalRun * totalRun);

  // 1. 踏步舒适度: 2h + b ≈ 600mm (550~650)
  const comfortVal = 2 * p.stepHeight + p.stepWidth;
  if (comfortVal < STAIR_COMFORT.min || comfortVal > STAIR_COMFORT.max) {
    results.push({
      field: 'stepHeight/stepWidth',
      rule: 'GB50352 §6.7.7',
      status: comfortVal < 500 || comfortVal > 700 ? 'fail' : 'warn',
      message: `踏步舒适度 2h+b = ${comfortVal}mm，宜在 ${STAIR_COMFORT.min}~${STAIR_COMFORT.max}mm 范围`,
      suggestion: `调整踏步高 h=${p.stepHeight}mm 或踏步宽 b=${p.stepWidth}mm，使 2h+b ≈ ${STAIR_COMFORT.target}mm`,
    });
  }

  // 2. 踏步高度限值: 住宅 ≤175mm，公共 ≤150mm (取宽松标准)
  if (p.stepHeight > STAIR_STEP_HEIGHT.max) {
    results.push({
      field: 'stepHeight', rule: 'GB50352 §6.7.7',
      status: 'fail',
      message: `踏步高 ${p.stepHeight}mm > ${STAIR_STEP_HEIGHT.max}mm (绝对上限)`,
      suggestion: '住宅楼梯踏步高宜 ≤175mm，公建宜 ≤150mm',
    });
  } else if (p.stepHeight > STAIR_STEP_HEIGHT.warn) {
    results.push({
      field: 'stepHeight', rule: 'GB50352 §6.7.7',
      status: 'warn',
      message: `踏步高 ${p.stepHeight}mm > ${STAIR_STEP_HEIGHT.warn}mm (住宅推荐上限)`,
      suggestion: `建议踏步高 ≤${STAIR_STEP_HEIGHT.warn}mm`,
    });
  }

  // 3. 踏步宽度最小值: 住宅 ≥260mm
  if (p.stepWidth < STAIR_STEP_WIDTH.min) {
    results.push({
      field: 'stepWidth', rule: 'GB50352 §6.7.7',
      status: 'fail',
      message: `踏步宽 ${p.stepWidth}mm < ${STAIR_STEP_WIDTH.min}mm (绝对下限)`,
      suggestion: '住宅楼梯踏步宽宜 ≥260mm',
    });
  } else if (p.stepWidth < STAIR_STEP_WIDTH.warn) {
    results.push({
      field: 'stepWidth', rule: 'GB50352 §6.7.7',
      status: 'warn',
      message: `踏步宽 ${p.stepWidth}mm < ${STAIR_STEP_WIDTH.warn}mm (住宅推荐下限)`,
      suggestion: `建议踏步宽 ≥${STAIR_STEP_WIDTH.warn}mm`,
    });
  }

  // 4. 梯板厚度: 宜取 L/25 ~ L/30 (L为梯板斜长)
  const { min: tMin, max: tMax } = stairSlabThicknessRange(slabLen);
  if (p.slabThickness < tMin * 0.85) {
    results.push({
      field: 'slabThickness', rule: '22G101-2 构造',
      status: 'fail',
      message: `梯板厚 ${p.slabThickness}mm 偏小，斜长 ${Math.round(slabLen)}mm，建议 ${tMin}~${tMax}mm (L/30~L/25)`,
      suggestion: `建议梯板厚度 ≥ ${tMin}mm`,
    });
  } else if (p.slabThickness < tMin) {
    results.push({
      field: 'slabThickness', rule: '22G101-2 构造',
      status: 'warn',
      message: `梯板厚 ${p.slabThickness}mm 接近下限，建议 ${tMin}~${tMax}mm (L/30~L/25)`,
    });
  }

  // 5. 下部纵筋直径检查: AT型板式楼梯受力筋宜 ≥8mm
  if (botR.diameter < STAIR_MIN_BAR_DIAMETER) {
    results.push({
      field: 'bottomBar', rule: 'GB50010 §8.5.1',
      status: 'fail',
      message: `下部纵筋 Φ${botR.diameter} < ${STAIR_MIN_BAR_DIAMETER}mm (板受力筋最小直径)`,
      suggestion: `建议纵筋直径 ≥${STAIR_MIN_BAR_DIAMETER}mm`,
    });
  }

  // 6. 下部纵筋间距
  if (botR.spacing > STAIR_BAR_SPACING.max) {
    results.push({
      field: 'bottomBar', rule: 'GB50010 §9.1.3',
      status: 'fail',
      message: `下部纵筋间距 ${botR.spacing}mm > ${STAIR_BAR_SPACING.max}mm`,
      suggestion: `板受力钢筋间距不应大于 ${STAIR_BAR_SPACING.max}mm`,
    });
  }
  if (botR.spacing < STAIR_BAR_SPACING.min) {
    results.push({
      field: 'bottomBar', rule: 'GB50010 §9.1.3',
      status: 'warn',
      message: `下部纵筋间距 ${botR.spacing}mm < ${STAIR_BAR_SPACING.min}mm，施工困难`,
      suggestion: `建议间距不小于 ${STAIR_BAR_SPACING.min}mm`,
    });
  }

  // 7. 分布筋要求
  if (distR.diameter < SLAB_DIST_MIN_DIAMETER) {
    results.push({
      field: 'distBar', rule: 'GB50010 §9.1.6',
      status: 'fail',
      message: `分布筋 Φ${distR.diameter} < ${SLAB_DIST_MIN_DIAMETER}mm (最小直径)`,
      suggestion: `分布筋直径不应小于 ${SLAB_DIST_MIN_DIAMETER}mm`,
    });
  }
  if (distR.spacing > SLAB_DIST_MAX_SPACING) {
    results.push({
      field: 'distBar', rule: 'GB50010 §9.1.6',
      status: 'fail',
      message: `分布筋间距 ${distR.spacing}mm > ${SLAB_DIST_MAX_SPACING}mm`,
      suggestion: `分布筋间距不应大于 ${SLAB_DIST_MAX_SPACING}mm`,
    });
  }

  // 8. 保护层厚度: 室内 15mm，室外 20mm
  if (cover < 15) {
    results.push({
      field: 'cover', rule: 'GB50010 §8.2.1',
      status: 'fail',
      message: `保护层 ${cover}mm < 15mm (板最小保护层)`,
      suggestion: '室内环境板最小保护层 15mm',
    });
  }

  // 9. 梯段宽度: 住宅 ≥1100mm (22G101-2 常用)
  if (p.flightWidth < STAIR_MIN_FLIGHT_WIDTH) {
    results.push({
      field: 'flightWidth', rule: 'GB50352 §6.7.5',
      status: 'warn',
      message: `梯段宽 ${p.flightWidth}mm < ${STAIR_MIN_FLIGHT_WIDTH}mm`,
      suggestion: '住宅楼梯梯段净宽宜 ≥1100mm',
    });
  }

  // 10. 上部纵筋伸入平台长度检查: 22G101-2 图示要求 ≥ ln/4
  const ln = slabLen; // 梯板净跨近似取斜长
  const topExtend = Math.round(ln / 4);
  if (p.topPlatformLen < topExtend && p.botPlatformLen < topExtend) {
    results.push({
      field: 'topPlatformLen', rule: '22G101-2 页2-8',
      status: 'warn',
      message: `上部纵筋需伸入平台 ≥ ln/4 = ${topExtend}mm，请确保平台长度满足`,
      suggestion: `22G101-2: 上部纵筋从梯板端部伸入平台 ≥ ln/4`,
    });
  }

  if (results.length === 0) {
    results.push({ field: '-', rule: '22G101-2 & GB50010', status: 'pass', message: 'AT型楼梯配筋满足规范要求' });
  }

  return results;
}

// ─── 筏板基础合规性校验 (GB50007 / GB50010 / 22G101-3) ───

export function checkRaftCompliance(p: RaftFoundationParams): ComplianceResult[] {
  const results: ComplianceResult[] = [];
  const botX = parseSlabRebar(p.bottomBarX);
  const botY = parseSlabRebar(p.bottomBarY);
  const cover = p.cover || 40;

  // 1. 最小板厚: 筏板厚度一般 ≥ 300mm (GB50007 §8.4.2)
  if (p.h < 300) {
    results.push({
      field: 'h', rule: 'GB50007 §8.4.2',
      status: 'fail',
      message: `筏板厚度 ${p.h}mm < 最小 300mm`,
      suggestion: '建议筏板厚度 ≥300mm',
    });
  }

  // 2. 底筋最小直径 ≥ 10mm (GB50010 §9.5.1)
  if (botX.diameter < 10) {
    results.push({
      field: 'bottomBarX', rule: 'GB50010 §9.5.1',
      status: 'fail',
      message: `X向底筋直径 Φ${botX.diameter} < 最小 Φ10`,
      suggestion: '建议底筋直径 ≥Φ10',
    });
  }
  if (botY.diameter < 10) {
    results.push({
      field: 'bottomBarY', rule: 'GB50010 §9.5.1',
      status: 'fail',
      message: `Y向底筋直径 Φ${botY.diameter} < 最小 Φ10`,
      suggestion: '建议底筋直径 ≥Φ10',
    });
  }

  // 3. 底筋间距 ≤ 200mm (GB50010 §9.5.1)
  if (botX.spacing > 200) {
    results.push({
      field: 'bottomBarX', rule: 'GB50010 §9.5.1',
      status: 'warn',
      message: `X向底筋间距 ${botX.spacing}mm > 建议最大 200mm`,
      suggestion: '建议底筋间距 ≤200mm',
    });
  }
  if (botY.spacing > 200) {
    results.push({
      field: 'bottomBarY', rule: 'GB50010 §9.5.1',
      status: 'warn',
      message: `Y向底筋间距 ${botY.spacing}mm > 建议最大 200mm`,
      suggestion: '建议底筋间距 ≤200mm',
    });
  }

  // 4. 底筋配筋率 ≥ 0.15% (GB50010 §8.5.1)
  const h0x = p.h - cover - botX.diameter / 2;
  const h0y = p.h - cover - botX.diameter - botY.diameter / 2;
  const AsX = Math.ceil(1000 / botX.spacing) * rebarArea(botX.diameter);
  const AsY = Math.ceil(1000 / botY.spacing) * rebarArea(botY.diameter);
  const rhoX = AsX / (1000 * h0x);
  const rhoY = AsY / (1000 * h0y);

  const ft = FT[p.concreteGrade] || 1.43;
  const fy = FY[botX.grade] || 360;
  const rhoMin = Math.max(0.0015, 0.45 * ft / fy);

  if (rhoX < rhoMin) {
    results.push({
      field: 'bottomBarX', rule: 'GB50010 §8.5.1',
      status: 'fail',
      message: `X向底筋配筋率 ${(rhoX * 100).toFixed(3)}% < 最小 ${(rhoMin * 100).toFixed(3)}%`,
      suggestion: '建议减小间距或增大直径',
    });
  }
  if (rhoY < rhoMin) {
    results.push({
      field: 'bottomBarY', rule: 'GB50010 §8.5.1',
      status: 'fail',
      message: `Y向底筋配筋率 ${(rhoY * 100).toFixed(3)}% < 最小 ${(rhoMin * 100).toFixed(3)}%`,
      suggestion: '建议减小间距或增大直径',
    });
  }

  // 5. 保护层厚度: 有垫层 ≥ 40mm (GB50010 §8.2.1)
  if (cover < 40) {
    results.push({
      field: 'cover', rule: 'GB50010 §8.2.1',
      status: 'warn',
      message: `保护层厚度 ${cover}mm < 建议最小 40mm（有垫层）`,
      suggestion: '建议保护层 ≥40mm（有垫层）或 ≥70mm（无垫层）',
    });
  }

  // 6. 面筋校验 (如有)
  if (p.topBarX) {
    const topX = parseSlabRebar(p.topBarX);
    if (topX.diameter < 8) {
      results.push({
        field: 'topBarX', rule: 'GB50010 §9.5.1',
        status: 'warn',
        message: `X向面筋直径 Φ${topX.diameter} < 建议最小 Φ8`,
        suggestion: '建议面筋直径 ≥Φ8',
      });
    }
    if (topX.spacing > 200) {
      results.push({
        field: 'topBarX', rule: 'GB50010 §9.5.1',
        status: 'warn',
        message: `X向面筋间距 ${topX.spacing}mm > 建议最大 200mm`,
        suggestion: '建议面筋间距 ≤200mm',
      });
    }
  }

  // 7. 柱网合理性: 柱距不宜过大 (一般 ≤ 12m)
  if (p.colSpacingX > 12000) {
    results.push({
      field: 'colSpacingX', rule: 'GB50007 §8.4',
      status: 'warn',
      message: `X向柱距 ${p.colSpacingX}mm > 12000mm，跨度偏大`,
      suggestion: '建议柱距 ≤12000mm，或增大板厚',
    });
  }
  if (p.colSpacingY > 12000) {
    results.push({
      field: 'colSpacingY', rule: 'GB50007 §8.4',
      status: 'warn',
      message: `Y向柱距 ${p.colSpacingY}mm > 12000mm，跨度偏大`,
      suggestion: '建议柱距 ≤12000mm，或增大板厚',
    });
  }

  // 8. 板厚与跨度比校验: h ≥ max(colSpacingX, colSpacingY) / 12 (板式筏板)
  const maxSpan = Math.max(p.colSpacingX, p.colSpacingY);
  const hMin = Math.ceil(maxSpan / 12);
  if (p.h < hMin) {
    results.push({
      field: 'h', rule: 'GB50007 §8.4.2',
      status: 'warn',
      message: `板厚 ${p.h}mm < 最大跨度/12 = ${hMin}mm`,
      suggestion: `建议板厚 ≥${hMin}mm（板式筏板厚跨比 ≥1/12）`,
    });
  }

  // 9. 柱纵向钢筋在基础中构造 — 22G101-3
  const colR = parseRebar(p.colMain);
  const laE = calcLaE(colR.grade, colR.diameter, p.concreteGrade, p.seismicGrade);
  const anchor = determineColFoundAnchor(p.h, cover, colR.diameter, laE);

  // 9a. 锚固类型判定提示
  const scenarioLabels: Record<string, string> = {
    a: '(a) 保护层>5d, 高度满足直锚',
    b: '(b) 保护层≤5d, 高度满足直锚',
    c: '(c) 保护层>5d, 高度不满足直锚 → 弯锚',
    d: '(d) 保护层≤5d, 高度不满足直锚 → 弯锚',
  };
  if (!anchor.canStraight) {
    results.push({
      field: 'colMain', rule: '22G101-3',
      status: 'warn',
      message: `柱插筋需弯锚: ${scenarioLabels[anchor.scenario]}，laE=${laE}mm，可用深度=${p.h - cover}mm`,
      suggestion: `底弯 ${anchor.bendLength}mm (15d)，直段 ≥${anchor.straightPortion}mm (≥0.6laE 且 ≥20d)`,
    });
  } else {
    results.push({
      field: 'colMain', rule: '22G101-3',
      status: 'pass',
      message: `柱插筋直锚: ${scenarioLabels[anchor.scenario]}，laE=${laE}mm，底弯 ${anchor.bendLength}mm (max(6d,150))`,
    });
  }

  // 9b. 保护层 ≤ 5d 时需设横向锚固区钢筋
  if (!anchor.isCoverLarge) {
    results.push({
      field: 'cover', rule: '22G101-3 注3',
      status: 'warn',
      message: `保护层 ${cover}mm ≤ 5d=${5 * colR.diameter}mm，柱插筋外皮算起 ≤5d，需设锚固区横向钢筋`,
      suggestion: '锚固区应设置横向钢筋防止劈裂',
    });
  }

  // 9c. 锚固区箍筋要求
  results.push({
    field: 'colMain', rule: '22G101-3 注2',
    status: 'pass',
    message: `锚固区箍筋: ≥${COL_FOUND_STIRRUP_MIN_COUNT}道非复合箍，间距 ≤${COL_FOUND_STIRRUP_ZONE_SPACING_MAX}mm，箍筋 ≥Φ${anchor.stirrupMinDia}@${anchor.stirrupMaxSpacing}`,
  });

  // 9d. 简化锚固条件提示 (注4)
  if (p.h >= COL_FOUND_CORNER_ONLY_H_AXIAL) {
    results.push({
      field: 'colMain', rule: '22G101-3 注4',
      status: 'pass',
      message: `h=${p.h}mm ≥ 1200mm，轴心受压时可仅角筋伸至底板网片（柱纵筋间距 ≤1000mm），其余锚固在基础顶面下 laE`,
    });
  }

  if (results.length === 0) {
    results.push({ field: '-', rule: 'GB50007/GB50010/22G101-3', status: 'pass', message: '筏板基础配筋满足规范要求' });
  }

  return results;
}

// ─── 统一入口 ───

export function checkCompliance(
  componentType: ComponentType,
  params: BeamParams | ColumnParams | SlabParams | ShearWallParams | StairParams | RaftFoundationParams,
): ComplianceResult[] {
  switch (componentType) {
    case 'beam': return checkBeamCompliance(params as BeamParams);
    case 'column': return checkColumnCompliance(params as ColumnParams);
    case 'slab': return checkSlabCompliance(params as SlabParams);
    case 'shearwall': return checkShearWallCompliance(params as ShearWallParams);
    case 'stair': return checkStairCompliance(params as StairParams);
    case 'raft': return checkRaftCompliance(params as RaftFoundationParams);
    case 'joint': return [{ field: '-', rule: 'GB50010', status: 'pass', message: '节点构造校验暂未实现' }];
    default: return [{ field: '-', rule: '-', status: 'pass', message: '暂未实现' }];
  }
}
