/**
 * 规范合规性校验 — 基于 GB50010-2010 和 22G101 图集
 * 在 AI 生成配筋参数后，自动检查是否满足规范要求
 */
import type { BeamParams, ColumnParams, SlabParams, ShearWallParams, StairParams, ComponentType } from './types';
import { parseRebar, parseStirrup, parseSlabRebar } from './rebar';
import { calcEffectiveDepth } from './layout';
import { FT, FY } from './anchor';
import type { SeismicGrade } from './anchor';

export type ComplianceStatus = 'pass' | 'warn' | 'fail';

export interface ComplianceResult {
  field: string;     // 相关字段
  rule: string;      // 规范条文
  status: ComplianceStatus;
  message: string;   // 说明
  suggestion?: string; // 修正建议
}

// ─── 通用辅助 ───

/** 单根钢筋截面面积 mm² */
function rebarArea(diameter: number): number {
  return Math.PI * diameter * diameter / 4;
}

/** 箍筋加密区最大间距 (mm) 按抗震等级 — GB50011 §6.3.3 */
function maxStirrupSpacingDense(seismicGrade: SeismicGrade, d: number): number {
  switch (seismicGrade) {
    case '一级': return Math.min(6 * d, 100);
    case '二级': return Math.min(8 * d, 100);
    case '三级': return Math.min(8 * d, 150);
    case '四级': return Math.min(8 * d, 150);
    default: return 150;
  }
}

/** 箍筋最小直径 (mm) 按抗震等级 — GB50011 §6.3.3 */
function minStirrupDiameter(seismicGrade: SeismicGrade): number {
  switch (seismicGrade) {
    case '一级': return 10;
    case '二级': return 8;
    case '三级': return 8;
    case '四级': return 6;
    default: return 6;
  }
}

// ─── 梁合规性校验 ───

export function checkBeamCompliance(p: BeamParams): ComplianceResult[] {
  const results: ComplianceResult[] = [];
  const top = parseRebar(p.top);
  const bot = parseRebar(p.bottom);
  const stir = parseStirrup(p.stirrup);
  const cover = p.cover || 25;

  const ft = FT[p.concreteGrade] || 1.43;
  const fyTop = FY[top.grade] || 360;
  const fyBot = FY[bot.grade] || 360;

  // 1. 配筋率校验 GB50010 §8.5.1 (多排钢筋取合力点)
  const { h0: h0Top } = calcEffectiveDepth(p.h, cover, stir.diameter, top.diameter, top.count, top.rows, top.perRow);
  const { h0: h0Bot } = calcEffectiveDepth(p.h, cover, stir.diameter, bot.diameter, bot.count, bot.rows, bot.perRow);
  const AsTop = top.count * rebarArea(top.diameter);
  const AsBot = bot.count * rebarArea(bot.diameter);
  const rhoTop = AsTop / (p.b * h0Top);
  const rhoBot = AsBot / (p.b * h0Bot);
  const rhoMinTop = Math.max(0.002, 0.45 * ft / fyTop);
  const rhoMinBot = Math.max(0.002, 0.45 * ft / fyBot);
  const rhoMax = 0.025;

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
  if (top.count < 2) {
    results.push({
      field: 'top', rule: '22G101 构造要求',
      status: 'fail',
      message: '上部通长筋不应少于2根',
      suggestion: '建议配置至少2根上部通长筋',
    });
  }
  if (bot.count < 2) {
    results.push({
      field: 'bottom', rule: '22G101 构造要求',
      status: 'fail',
      message: '下部通长筋不应少于2根',
      suggestion: '建议配置至少2根下部通长筋',
    });
  }

  // 5. 梁高 hw > 450 时需配腰筋 GB50010 §9.2.13
  const hw = p.h - 2 * cover;
  if (hw > 450 && !p.sideBar) {
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
  const main = parseRebar(p.main);
  const stir = parseStirrup(p.stirrup);

  // 1. 柱纵筋配筋率 GB50010 §8.5.1: ρmin 取决于抗震等级
  const Ag = p.b * p.h; // 全截面面积
  const AsMain = main.count * rebarArea(main.diameter);
  const rho = AsMain / Ag;
  const rhoMinMap: Record<string, number> = {
    '一级': 0.01, '二级': 0.008, '三级': 0.007, '四级': 0.006, '非抗震': 0.006,
  };
  const rhoMin = rhoMinMap[p.seismicGrade] || 0.006;
  const rhoMax = 0.05;

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

  // 2. 纵筋最小直径 GB50010 §8.5.1: 柱纵筋≥14mm（一般）
  const minMainDia = (p.seismicGrade === '一级' || p.seismicGrade === '二级') ? 16 : 14;
  if (main.diameter < minMainDia) {
    results.push({
      field: 'main', rule: 'GB50010 §8.5.1',
      status: 'warn',
      message: `柱纵筋直径 ${main.diameter}mm < 建议最小 ${minMainDia}mm（${p.seismicGrade}）`,
      suggestion: `建议纵筋直径 ≥${minMainDia}mm`,
    });
  }

  // 3. 纵筋最少根数: 矩形截面每侧≥2根
  if (main.count < 4) {
    results.push({
      field: 'main', rule: 'GB50010 §8.5.1',
      status: 'fail',
      message: `柱纵筋 ${main.count} 根 < 最少4根（矩形截面每侧至少2根）`,
      suggestion: '建议至少配置4根纵筋',
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
  const minThickness = 60;
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
  const maxSpacing = p.thickness <= 150 ? 200 : Math.min(1.5 * p.thickness, 250);
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
  const rhoMinWall = 0.0025; // 抗震时 ≥ 0.25%

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
  if (vert.spacing > 300) {
    results.push({
      field: 'vertBar', rule: 'GB50010 §11.7.12',
      status: 'warn',
      message: `竖向分布筋间距 ${vert.spacing}mm > 300mm`,
      suggestion: '建议间距 ≤300mm',
    });
  }
  if (horiz.spacing > 300) {
    results.push({
      field: 'horizBar', rule: 'GB50010 §11.7.12',
      status: 'warn',
      message: `水平分布筋间距 ${horiz.spacing}mm > 300mm`,
      suggestion: '建议间距 ≤300mm',
    });
  }

  // 3. 分布筋最小直径 ≥ 8mm
  if (vert.diameter < 8) {
    results.push({
      field: 'vertBar', rule: 'GB50010 §11.7.12',
      status: 'warn',
      message: `竖向分布筋直径 ${vert.diameter}mm < 建议最小 8mm`,
    });
  }

  // 4. 边缘构件纵筋最少根数
  if (boundaryR.count < 4) {
    results.push({
      field: 'boundaryMain', rule: 'GB50010 §11.7.14',
      status: 'fail',
      message: `边缘构件纵筋 ${boundaryR.count} 根 < 最少4根`,
      suggestion: '建议至少配置4根边缘纵筋',
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
  if (comfortVal < 550 || comfortVal > 650) {
    results.push({
      field: 'stepHeight/stepWidth',
      rule: 'GB50352 §6.7.7',
      status: comfortVal < 500 || comfortVal > 700 ? 'fail' : 'warn',
      message: `踏步舒适度 2h+b = ${comfortVal}mm，宜在 550~650mm 范围`,
      suggestion: `调整踏步高 h=${p.stepHeight}mm 或踏步宽 b=${p.stepWidth}mm，使 2h+b ≈ 600mm`,
    });
  }

  // 2. 踏步高度限值: 住宅 ≤175mm，公共 ≤150mm (取宽松标准)
  if (p.stepHeight > 200) {
    results.push({
      field: 'stepHeight', rule: 'GB50352 §6.7.7',
      status: 'fail',
      message: `踏步高 ${p.stepHeight}mm > 200mm (绝对上限)`,
      suggestion: '住宅楼梯踏步高宜 ≤175mm，公建宜 ≤150mm',
    });
  } else if (p.stepHeight > 175) {
    results.push({
      field: 'stepHeight', rule: 'GB50352 §6.7.7',
      status: 'warn',
      message: `踏步高 ${p.stepHeight}mm > 175mm (住宅推荐上限)`,
      suggestion: '建议踏步高 ≤175mm',
    });
  }

  // 3. 踏步宽度最小值: 住宅 ≥260mm
  if (p.stepWidth < 220) {
    results.push({
      field: 'stepWidth', rule: 'GB50352 §6.7.7',
      status: 'fail',
      message: `踏步宽 ${p.stepWidth}mm < 220mm (绝对下限)`,
      suggestion: '住宅楼梯踏步宽宜 ≥260mm',
    });
  } else if (p.stepWidth < 260) {
    results.push({
      field: 'stepWidth', rule: 'GB50352 §6.7.7',
      status: 'warn',
      message: `踏步宽 ${p.stepWidth}mm < 260mm (住宅推荐下限)`,
      suggestion: '建议踏步宽 ≥260mm',
    });
  }

  // 4. 梯板厚度: 宜取 L/25 ~ L/30 (L为梯板斜长)
  const tMin = Math.round(slabLen / 30);
  const tMax = Math.round(slabLen / 25);
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
  if (botR.diameter < 8) {
    results.push({
      field: 'bottomBar', rule: 'GB50010 §8.5.1',
      status: 'fail',
      message: `下部纵筋 Φ${botR.diameter} < 8mm (板受力筋最小直径)`,
      suggestion: '建议纵筋直径 ≥8mm',
    });
  }

  // 6. 下部纵筋间距: ≤200mm 且 ≥70mm
  if (botR.spacing > 200) {
    results.push({
      field: 'bottomBar', rule: 'GB50010 §9.1.3',
      status: 'fail',
      message: `下部纵筋间距 ${botR.spacing}mm > 200mm`,
      suggestion: '板受力钢筋间距不应大于 200mm',
    });
  }
  if (botR.spacing < 70) {
    results.push({
      field: 'bottomBar', rule: 'GB50010 §9.1.3',
      status: 'warn',
      message: `下部纵筋间距 ${botR.spacing}mm < 70mm，施工困难`,
      suggestion: '建议间距不小于 70mm',
    });
  }

  // 7. 分布筋要求: 直径 ≥6mm，间距 ≤250mm (22G101-2)
  if (distR.diameter < 6) {
    results.push({
      field: 'distBar', rule: 'GB50010 §9.1.6',
      status: 'fail',
      message: `分布筋 Φ${distR.diameter} < 6mm (最小直径)`,
      suggestion: '分布筋直径不应小于 6mm',
    });
  }
  if (distR.spacing > 250) {
    results.push({
      field: 'distBar', rule: 'GB50010 §9.1.6',
      status: 'fail',
      message: `分布筋间距 ${distR.spacing}mm > 250mm`,
      suggestion: '分布筋间距不应大于 250mm',
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
  if (p.flightWidth < 1000) {
    results.push({
      field: 'flightWidth', rule: 'GB50352 §6.7.5',
      status: 'warn',
      message: `梯段宽 ${p.flightWidth}mm < 1000mm`,
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

// ─── 统一入口 ───

export function checkCompliance(
  componentType: ComponentType,
  params: BeamParams | ColumnParams | SlabParams | ShearWallParams | StairParams,
): ComplianceResult[] {
  switch (componentType) {
    case 'beam': return checkBeamCompliance(params as BeamParams);
    case 'column': return checkColumnCompliance(params as ColumnParams);
    case 'slab': return checkSlabCompliance(params as SlabParams);
    case 'shearwall': return checkShearWallCompliance(params as ShearWallParams);
    case 'stair': return checkStairCompliance(params as StairParams);
    case 'joint': return [{ field: '-', rule: 'GB50010', status: 'pass', message: '节点构造校验暂未实现' }];
    default: return [{ field: '-', rule: '-', status: 'pass', message: '暂未实现' }];
  }
}
