import { parseRebar, parseRebarBottom, parseStirrup, parseSlabRebar, parseSideBar, parseTieBar, autoTieBar, resolveColumnBars } from './rebar';
import { calcSupportRebarLength, calcLlE, calcSlabBottomAnchor, calcBeamEndAnchor, calcBeamSideBarAnchor, calcLa, calcLaE, FT, FY } from './anchor';
import { calcEffectiveDepth } from './layout';
import type { BeamParams, ColumnParams, SlabParams, ShearWallParams, StairParams, FoundationParams, StripFoundationParams, PileCapParams, RaftFoundationParams } from './types';
import { rebarWeightPerM, beamDenseZoneLength, rebarArea, slabBottomAnchorDetail, slabNegBarExtend, slabNegBarBend, stirrupCutLength, stirrupHookLen, wasteFactor, WASTE_RATE, bendAdjustment, determineColFoundAnchor } from './construction-rules';
import { createStirrupShapeSpec, createTieBarShapeSpec, resolveTieSideOffsetMm } from './rebar-shapes';

/** 钢筋理论重量 kg/m — 代理到 construction-rules */
function w(diameter: number): number {
  return rebarWeightPerM(diameter);
}

/** 生成锚固长度推导公式步骤 */
function anchorSteps(grade: string, dia: number, concreteGrade: string, seismicGrade: string): FormulaStep[] {
  const fy = FY[grade] || 360;
  const ft = FT[concreteGrade] || 1.43;
  const alpha = grade === 'A' ? 0.16 : 0.14;
  const lab = Math.ceil(alpha * (fy / ft) * dia);
  // GB50010 §8.3.1: 带肋钢筋 d>25mm ×1.1
  const isLargeDia = grade !== 'A' && dia > 25;
  const largeDiaFactor = isLargeDia ? 1.1 : 1.0;
  const la = Math.max(Math.ceil(lab * largeDiaFactor), 200, 10 * dia);
  const zetaAE = seismicGrade === '非抗震' ? 1.0 : 1.15;
  const laE = Math.max(Math.ceil(zetaAE * la), 200, 10 * dia);
  const steps: FormulaStep[] = [
    {
      label: '基本锚固长度 lab',
      formula: 'lab = α × (fy / ft) × d',
      substitution: `= ${alpha} × (${fy} / ${ft}) × ${dia}`,
      result: `= ${lab} mm`,
    },
    {
      label: '锚固长度 la',
      formula: isLargeDia ? 'la = ζa × lab × 1.1 (d>25修正) ≥ max(200, 10d)' : 'la = ζa × lab ≥ max(200, 10d)',
      substitution: isLargeDia
        ? `= 1.0 × ${lab} × 1.1，≥ max(200, ${10 * dia})`
        : `= 1.0 × ${lab}，≥ max(200, ${10 * dia})`,
      result: `= ${la} mm`,
    },
  ];
  if (seismicGrade !== '非抗震') {
    steps.push({
      label: '抗震锚固长度 laE',
      formula: 'laE = ζaE × la',
      substitution: `= ${zetaAE} × ${la}`,
      result: `= ${laE} mm`,
    });
  }
  return steps;
}

/** 生成梁端锚固判定公式步骤 */
function beamEndAnchorSteps(grade: string, dia: number, concreteGrade: string, seismicGrade: string, hc: number, cover: number): FormulaStep[] {
  const base = anchorSteps(grade, dia, concreteGrade, seismicGrade);
  const fy = FY[grade] || 360;
  const ft = FT[concreteGrade] || 1.43;
  const alpha = grade === 'A' ? 0.16 : 0.14;
  const lab = Math.ceil(alpha * (fy / ft) * dia);
  // GB50010 §8.3.1: 带肋钢筋 d>25mm ×1.1
  const largeDiaFactor = (grade !== 'A' && dia > 25) ? 1.1 : 1.0;
  const la = Math.max(Math.ceil(lab * largeDiaFactor), 200, 10 * dia);
  const zetaAE = seismicGrade === '非抗震' ? 1.0 : 1.15;
  const laE = Math.max(Math.ceil(zetaAE * la), 200, 10 * dia);
  const available = hc - cover;
  const canStraight = laE <= available;
  if (canStraight) {
    const straightLen = Math.max(laE, Math.ceil(0.5 * hc + 5 * dia));
    base.push({
      label: '直锚判定',
      formula: 'laE ≤ hc - c → 可直锚',
      substitution: `${laE} ≤ ${hc} - ${cover} = ${available}`,
      result: `直锚长度 = max(laE, 0.5hc+5d) = ${straightLen} mm`,
    });
  } else {
    const bentStr = Math.max(Math.ceil(0.4 * laE), hc - cover);
    const bentBend = 15 * dia;
    base.push({
      label: '弯锚判定',
      formula: 'laE > hc - c → 需弯锚',
      substitution: `${laE} > ${available}`,
      result: `直段 max(0.4laE, hc-c) = ${bentStr} mm，弯折15d = ${bentBend} mm`,
    });
  }
  return base;
}

/** 生成重量计算步骤 */
function weightSteps(name: string, count: number, lengthM: number, dia: number): FormulaStep {
  const unitW = w(dia);
  const total = count * lengthM * unitW;
  return {
    label: `${name}重量`,
    formula: 'W = n × L × w',
    substitution: `= ${count} × ${lengthM.toFixed(3)}m × ${unitW.toFixed(3)}kg/m`,
    result: `= ${total.toFixed(2)} kg`,
  };
}

/**
 * 弯锚下料长度 (mm)
 * = 直段 + 弯折段 − 90°弯折调整值 (0.785d)
 * 弯折时外量尺寸 > 中心线弧长，扣减差值以得到准确下料长度
 */
function bentAnchorCutLen(straightPart: number, bendPart: number, diameter: number): number {
  return straightPart + bendPart - bendAdjustment(diameter, 90);
}

function countBeamTiePositions(spanLengthMm: number, spacingMm: number): number {
  if (spanLengthMm <= 0 || spacingMm <= 0) return 0;
  let count = 0;
  for (let x = -spanLengthMm / 2 + spacingMm * 1.5; x < spanLengthMm / 2 - spacingMm * 0.5; x += spacingMm) {
    count += 1;
  }
  return count;
}

/** 构建 CalcResult，自动附加损耗信息 */
function buildResult(items: CalcItem[], total: number, componentType: string): CalcResult {
  const rate = WASTE_RATE[componentType] ?? 0.03;
  const totalWithWaste = total * (1 + rate);
  return {
    items,
    total: `${total.toFixed(2)} kg`,
    totalWithWaste: `${totalWithWaste.toFixed(2)} kg`,
    wasteRate: rate,
  };
}

export interface FormulaStep {
  label: string;        // 步骤名称, e.g. "基本锚固长度"
  formula: string;      // 公式, e.g. "lab = α × (fy/ft) × d"
  substitution: string; // 代入数值, e.g. "= 0.14 × (360/1.43) × 25"
  result: string;       // 结果, e.g. "= 882 mm"
}

export interface CalcItem {
  name: string;
  spec: string;
  length: string;      // 显示用描述
  weight: string;      // 显示用
  color: string;
  // 数值字段，用于汇总/导出
  grade: string;       // 钢种 A/B/C/D/E
  diameter: number;    // 直径 mm
  count: number;       // 根数
  lengthM: number;     // 单根长度 m
  weightKg: number;    // 该项总重 kg
  formulaSteps?: FormulaStep[]; // 计算推导过程
}

export interface CalcResult {
  items: CalcItem[];
  total: string;
  /** 含损耗总重 (kg) — 净重 × (1 + 损耗率) */
  totalWithWaste?: string;
  /** 损耗率 (小数，如 0.03 = 3%) */
  wasteRate?: number;
}

export function calcBeam(p: BeamParams): CalcResult {
  const top = parseRebar(p.top);
  const bot = parseRebarBottom(p.bottom);
  const stir = parseStirrup(p.stirrup);
  const leftR = p.leftSupport ? parseRebar(p.leftSupport) : null;
  const rightR = p.rightSupport ? parseRebar(p.rightSupport) : null;
  const cover = p.cover || 25;
  const spanCount = p.spanCount || 1;
  const hc = p.hc || 500;

  // 各跨宽度/跨长数组 (未定义则全用全局值)
  const spanLengthsArr: number[] = (p.spanLengths && p.spanLengths.length === spanCount)
    ? p.spanLengths
    : Array(spanCount).fill(p.spanLength || 4000);
  const spanWidthsArr: number[] = (p.spanWidths && p.spanWidths.length === spanCount)
    ? p.spanWidths
    : Array(spanCount).fill(p.b);

  const totalNet = spanLengthsArr.reduce((s, l) => s + l, 0) + (spanCount - 1) * hc; // 多跨总净长

  const items: CalcItem[] = [];
  let total = 0;

  function push(name: string, spec: string, length: string, grade: string, diameter: number, count: number, lengthM: number, color: string, formulaSteps?: FormulaStep[]) {
    const weightKg = count * lengthM * w(diameter);
    const steps = formulaSteps ? [...formulaSteps, weightSteps(name, count, lengthM, diameter)] : [weightSteps(name, count, lengthM, diameter)];
    items.push({ name, spec, length, weight: `${weightKg.toFixed(2)} kg`, color, grade, diameter, count, lengthM, weightKg, formulaSteps: steps });
    total += weightKg;
  }

  // 上部通长筋 (含两端锚固, 按22G101-1)
  if (top.segments && top.segments.length >= 2) {
    // 混合直径: 每段分别计算锚固和重量
    for (let si = 0; si < top.segments.length; si++) {
      const seg = top.segments[si];
      const segAnchor = calcBeamEndAnchor(seg.grade, seg.diameter, p.concreteGrade, p.seismicGrade, hc, cover);
      const segAnchorLen = segAnchor.canStraight ? segAnchor.straightLen : bentAnchorCutLen(segAnchor.bentStraightPart, segAnchor.bentBendPart, seg.diameter);
      const segL = (totalNet + 2 * segAnchorLen) / 1000;
      const bendDeduct = Math.round(bendAdjustment(seg.diameter, 90));
      const anchorDesc = segAnchor.canStraight
        ? `直锚${segAnchor.straightLen}mm` : `弯锚(直段${segAnchor.bentStraightPart}+弯折${segAnchor.bentBendPart}-弯调${bendDeduct}mm)`;
      const segFormula: FormulaStep[] = [
        ...beamEndAnchorSteps(seg.grade, seg.diameter, p.concreteGrade, p.seismicGrade, hc, cover),
        { label: '单根长度', formula: 'L = 净跨总长 + 2×锚固', substitution: `= ${totalNet} + 2×${segAnchorLen}`, result: `= ${(totalNet + 2 * segAnchorLen)} mm = ${segL.toFixed(2)} m` },
      ];
      const rowLabel = si === 0 ? '外排' : `第${si + 1}排`;
      push(`上部通长筋(${rowLabel})`, `${seg.count}${seg.grade}${seg.diameter}`, `${segL.toFixed(2)}m × ${seg.count} (${anchorDesc}×2)`,
        seg.grade, seg.diameter, seg.count, segL, '#C0392B', segFormula);
    }
  } else {
    const topAnchor = calcBeamEndAnchor(top.grade, top.diameter, p.concreteGrade, p.seismicGrade, hc, cover);
    const topAnchorLen = topAnchor.canStraight ? topAnchor.straightLen : bentAnchorCutLen(topAnchor.bentStraightPart, topAnchor.bentBendPart, top.diameter);
    const topL = (totalNet + 2 * topAnchorLen) / 1000;
    const topBendDeduct = Math.round(bendAdjustment(top.diameter, 90));
    const topAnchorDesc = topAnchor.canStraight
      ? `直锚${topAnchor.straightLen}mm` : `弯锚(直段${topAnchor.bentStraightPart}+弯折${topAnchor.bentBendPart}-弯调${topBendDeduct}mm)`;
    const topFormula: FormulaStep[] = [
      ...beamEndAnchorSteps(top.grade, top.diameter, p.concreteGrade, p.seismicGrade, hc, cover),
      { label: '单根长度', formula: 'L = 净跨总长 + 2×锚固', substitution: `= ${totalNet} + 2×${topAnchorLen}`, result: `= ${(totalNet + 2 * topAnchorLen)} mm = ${topL.toFixed(2)} m` },
    ];
    const topRowDesc = top.perRow && top.perRow.length >= 2 ? `，${top.perRow.length}排(${[...top.perRow].reverse().join('/')})` : (top.rows && top.rows >= 2 ? `，${top.rows}排` : '');
    push('上部通长筋', p.top, `${topL.toFixed(2)}m × ${top.count}${topRowDesc} (${topAnchorDesc}×2)`,
      top.grade, top.diameter, top.count, topL, '#C0392B', topFormula);
  }

  // 下部通长筋 (含两端锚固, 按22G101-1)
  if (bot.segments && bot.segments.length >= 2) {
    for (let si = 0; si < bot.segments.length; si++) {
      const seg = bot.segments[si];
      const segAnchor = calcBeamEndAnchor(seg.grade, seg.diameter, p.concreteGrade, p.seismicGrade, hc, cover);
      const segAnchorLen = segAnchor.canStraight ? segAnchor.straightLen : bentAnchorCutLen(segAnchor.bentStraightPart, segAnchor.bentBendPart, seg.diameter);
      const segL = (totalNet + 2 * segAnchorLen) / 1000;
      const bendDeduct = Math.round(bendAdjustment(seg.diameter, 90));
      const anchorDesc = segAnchor.canStraight
        ? `直锚${segAnchor.straightLen}mm` : `弯锚(直段${segAnchor.bentStraightPart}+弯折${segAnchor.bentBendPart}-弯调${bendDeduct}mm)`;
      const segFormula: FormulaStep[] = [
        ...beamEndAnchorSteps(seg.grade, seg.diameter, p.concreteGrade, p.seismicGrade, hc, cover),
        { label: '单根长度', formula: 'L = 净跨总长 + 2×锚固', substitution: `= ${totalNet} + 2×${segAnchorLen}`, result: `= ${(totalNet + 2 * segAnchorLen)} mm = ${segL.toFixed(2)} m` },
      ];
      const rowLabel = si === 0 ? '外排' : `第${si + 1}排`;
      push(`下部通长筋(${rowLabel})`, `${seg.count}${seg.grade}${seg.diameter}`, `${segL.toFixed(2)}m × ${seg.count} (${anchorDesc}×2)`,
        seg.grade, seg.diameter, seg.count, segL, '#C0392B', segFormula);
    }
  } else {
    const botAnchor = calcBeamEndAnchor(bot.grade, bot.diameter, p.concreteGrade, p.seismicGrade, hc, cover);
    const botAnchorLen = botAnchor.canStraight ? botAnchor.straightLen : bentAnchorCutLen(botAnchor.bentStraightPart, botAnchor.bentBendPart, bot.diameter);
    const botL = (totalNet + 2 * botAnchorLen) / 1000;
    const botBendDeduct = Math.round(bendAdjustment(bot.diameter, 90));
    const botAnchorDesc = botAnchor.canStraight
      ? `直锚${botAnchor.straightLen}mm` : `弯锚(直段${botAnchor.bentStraightPart}+弯折${botAnchor.bentBendPart}-弯调${botBendDeduct}mm)`;
    const botFormula: FormulaStep[] = [
      ...beamEndAnchorSteps(bot.grade, bot.diameter, p.concreteGrade, p.seismicGrade, hc, cover),
      { label: '单根长度', formula: 'L = 净跨总长 + 2×锚固', substitution: `= ${totalNet} + 2×${botAnchorLen}`, result: `= ${(totalNet + 2 * botAnchorLen)} mm = ${botL.toFixed(2)} m` },
    ];
    const botRowDesc = bot.perRow && bot.perRow.length >= 2 ? `，${bot.perRow.length}排(${[...bot.perRow].reverse().join('/')})` : (bot.rows && bot.rows >= 2 ? `，${bot.rows}排` : '');
    push('下部通长筋', p.bottom, `${botL.toFixed(2)}m × ${bot.count}${botRowDesc} (${botAnchorDesc}×2)`,
      bot.grade, bot.diameter, bot.count, botL, '#C0392B', botFormula);
  }

  // 支座负筋 (伸入跨内 ln/3 + 锚固)
  // 每跨按各自跨长计算，汇总为一条记录
  if (leftR) {
    const leftAnchor = calcBeamEndAnchor(leftR.grade, leftR.diameter, p.concreteGrade, p.seismicGrade, hc, cover);
    const anchorLen = leftAnchor.canStraight ? leftAnchor.straightLen : bentAnchorCutLen(leftAnchor.bentStraightPart, leftAnchor.bentBendPart, leftR.diameter);
    const supportLen0 = calcSupportRebarLength(spanLengthsArr[0]);
    const leftLen = (supportLen0 + anchorLen) / 1000;
    const leftSupportFormula: FormulaStep[] = [
      ...beamEndAnchorSteps(leftR.grade, leftR.diameter, p.concreteGrade, p.seismicGrade, hc, cover),
      { label: '跨内伸入长度(第1跨)', formula: '第一排: ln/3', substitution: `= ${spanLengthsArr[0]}/3`, result: `= ${supportLen0} mm` },
      { label: '单根长度', formula: 'L = ln/3 + 端支座锚固', substitution: `= ${supportLen0} + ${anchorLen}`, result: `= ${leftLen.toFixed(3)} m` },
    ];
    push('左端支座负筋', p.leftSupport!, `${leftLen.toFixed(3)}m × ${leftR.count} (第1跨ln/3+端锚)`,
      leftR.grade, leftR.diameter, leftR.count, leftLen, '#8E44AD', leftSupportFormula);
  }
  if (rightR) {
    const rightAnchor = calcBeamEndAnchor(rightR.grade, rightR.diameter, p.concreteGrade, p.seismicGrade, hc, cover);
    const anchorLen = rightAnchor.canStraight ? rightAnchor.straightLen : bentAnchorCutLen(rightAnchor.bentStraightPart, rightAnchor.bentBendPart, rightR.diameter);
    const supportLen0R = calcSupportRebarLength(spanLengthsArr[spanCount - 1]);
    const rightLen = (supportLen0R + anchorLen) / 1000;
    const rightSupportFormula: FormulaStep[] = [
      ...beamEndAnchorSteps(rightR.grade, rightR.diameter, p.concreteGrade, p.seismicGrade, hc, cover),
      { label: '跨内伸入长度(末跨)', formula: '第一排: ln/3', substitution: `= ${spanLengthsArr[spanCount - 1]}/3`, result: `= ${supportLen0R} mm` },
      { label: '单根长度', formula: 'L = ln/3 + 端支座锚固', substitution: `= ${supportLen0R} + ${anchorLen}`, result: `= ${rightLen.toFixed(3)} m` },
    ];
    push('右端支座负筋', p.rightSupport!, `${rightLen.toFixed(3)}m × ${rightR.count} (末跨ln/3+端锚)`,
      rightR.grade, rightR.diameter, rightR.count, rightLen, '#8E44AD', rightSupportFormula);
  }

  // 第二排支座负筋 (ln/4)
  const leftR2 = p.leftSupport2 ? parseRebar(p.leftSupport2) : null;
  const rightR2 = p.rightSupport2 ? parseRebar(p.rightSupport2) : null;
  if (leftR2) {
    const leftAnchor2 = calcBeamEndAnchor(leftR2.grade, leftR2.diameter, p.concreteGrade, p.seismicGrade, hc, cover);
    const anchorLen2 = leftAnchor2.canStraight ? leftAnchor2.straightLen : bentAnchorCutLen(leftAnchor2.bentStraightPart, leftAnchor2.bentBendPart, leftR2.diameter);
    const supportLen2_0 = calcSupportRebarLength(spanLengthsArr[0], 2);
    const leftLen2 = (supportLen2_0 + anchorLen2) / 1000;
    const leftFormula2: FormulaStep[] = [
      ...beamEndAnchorSteps(leftR2.grade, leftR2.diameter, p.concreteGrade, p.seismicGrade, hc, cover),
      { label: '跨内伸入长度(第1跨)', formula: '第二排: ln/4', substitution: `= ${spanLengthsArr[0]}/4`, result: `= ${supportLen2_0} mm` },
      { label: '单根长度', formula: 'L = ln/4 + 端支座锚固', substitution: `= ${supportLen2_0} + ${anchorLen2}`, result: `= ${leftLen2.toFixed(3)} m` },
    ];
    push('左端支座负筋(二排)', p.leftSupport2!, `${leftLen2.toFixed(3)}m × ${leftR2.count} (第1跨ln/4+端锚)`,
      leftR2.grade, leftR2.diameter, leftR2.count, leftLen2, '#8E44AD', leftFormula2);
  }
  if (rightR2) {
    const rightAnchor2 = calcBeamEndAnchor(rightR2.grade, rightR2.diameter, p.concreteGrade, p.seismicGrade, hc, cover);
    const anchorLen2 = rightAnchor2.canStraight ? rightAnchor2.straightLen : bentAnchorCutLen(rightAnchor2.bentStraightPart, rightAnchor2.bentBendPart, rightR2.diameter);
    const supportLen2_last = calcSupportRebarLength(spanLengthsArr[spanCount - 1], 2);
    const rightLen2 = (supportLen2_last + anchorLen2) / 1000;
    const rightFormula2: FormulaStep[] = [
      ...beamEndAnchorSteps(rightR2.grade, rightR2.diameter, p.concreteGrade, p.seismicGrade, hc, cover),
      { label: '跨内伸入长度(末跨)', formula: '第二排: ln/4', substitution: `= ${spanLengthsArr[spanCount - 1]}/4`, result: `= ${supportLen2_last} mm` },
      { label: '单根长度', formula: 'L = ln/4 + 端支座锚固', substitution: `= ${supportLen2_last} + ${anchorLen2}`, result: `= ${rightLen2.toFixed(3)} m` },
    ];
    push('右端支座负筋(二排)', p.rightSupport2!, `${rightLen2.toFixed(3)}m × ${rightR2.count} (末跨ln/4+端锚)`,
      rightR2.grade, rightR2.diameter, rightR2.count, rightLen2, '#8E44AD', rightFormula2);
  }

  // 中间支座负筋 (内跨支座，贯通中间柱，仅多跨时有效)
  const innerR = spanCount > 1 ? (p.innerSupport ? parseRebar(p.innerSupport) : (rightR ?? leftR)) : null;
  if (innerR) {
    // 每根内支座负筋长度 = 左跨 ln/3 + hc + 右跨 ln/3
    let totalInnerLen = 0;
    for (let i = 0; i < spanCount - 1; i++) {
      const lenLeft = calcSupportRebarLength(spanLengthsArr[i]);
      const lenRight = calcSupportRebarLength(spanLengthsArr[i + 1]);
      totalInnerLen += (lenLeft + hc + lenRight) * innerR.count;
    }
    const innerColCount = spanCount - 1;
    const totalInnerBars = innerR.count * innerColCount;
    const avgInnerLen = totalInnerLen / totalInnerBars / 1000; // m
    const innerFormula: FormulaStep[] = [
      { label: '内支座负筋长度', formula: 'L = ln左/3 + hc + ln右/3', substitution: `第1内柱: ${calcSupportRebarLength(spanLengthsArr[0])}+${hc}+${calcSupportRebarLength(spanLengthsArr[1])}`, result: `≈ ${(avgInnerLen).toFixed(2)} m (平均)` },
      { label: '总根数', formula: '根数 × 内柱数', substitution: `= ${innerR.count} × ${innerColCount}`, result: `= ${totalInnerBars} 根` },
    ];
    push('中间支座负筋', p.innerSupport || p.rightSupport || p.leftSupport || '', `平均${avgInnerLen.toFixed(2)}m × ${totalInnerBars} (${innerR.count}根×${innerColCount}内柱，ln/3+hc+ln/3${p.innerSupport ? '' : '，按端支座筋兜底'})`,
      innerR.grade, innerR.diameter, totalInnerBars, avgInnerLen, '#8E44AD', innerFormula);
  }

  // 架立筋 (有支座负筋时, 或用户手动指定)
  const hasErectionBar = p.erectionBar ? true : !!(leftR || rightR || innerR);
  if (hasErectionBar) {
    const erUser = p.erectionBar ? parseRebar(p.erectionBar) : null;
    const avgSpanLen = Math.round(spanLengthsArr.reduce((s, l) => s + l, 0) / spanCount);
    const erDia = erUser ? erUser.diameter : ((avgSpanLen <= 4000) ? 10 : 12);
    const erGrade = erUser ? erUser.grade : 'C'; // HRB400
    const erCount = erUser ? erUser.count : 2;
    const lap = 150;
    let erTotalLen = 0;
    for (let i = 0; i < spanCount; i++) {
      const sl = spanLengthsArr[i];
      const leftSupportLenI = ((i === 0 && leftR) || (i > 0 && innerR)) ? calcSupportRebarLength(sl) : 0;
      const rightSupportLenI = ((i === spanCount - 1 && rightR) || (i < spanCount - 1 && innerR)) ? calcSupportRebarLength(sl) : 0;
      let erLenI: number;
      if (leftSupportLenI > 0 && rightSupportLenI > 0) {
        erLenI = sl - leftSupportLenI - rightSupportLenI + 2 * lap;
      } else if (leftSupportLenI > 0) {
        erLenI = sl - leftSupportLenI + lap;
      } else if (rightSupportLenI > 0) {
        erLenI = sl - rightSupportLenI + lap;
      } else {
        erLenI = sl;
      }
      erTotalLen += Math.max(erLenI, 0) * erCount;
    }
    const erTotal = erCount * spanCount;
    const avgErLen = erTotalLen > 0 ? erTotalLen / erTotal : 0;
    if (avgErLen > 0.05) {
      const erSpec = p.erectionBar || `${erCount}Φ${erDia}`;
      const erFormula: FormulaStep[] = [
        { label: '架立筋平均长度', formula: 'L = Σ(ln_i - 支座伸入 + 搭接) / 跨数', substitution: `合计${erTotalLen.toFixed(0)}mm / ${erTotal}根`, result: `= ${avgErLen.toFixed(2)} m/根` },
      ];
      push('架立筋', erSpec, `平均${avgErLen.toFixed(2)}m × ${erTotal}${spanCount > 1 ? ` (${erCount}根×${spanCount}跨)` : ''} (搭接${lap}mm)`,
        erGrade, erDia, erTotal, avgErLen, '#F39C12', erFormula);
    }
  }

  // 箍筋 (加密区按22G101: max(2h, 500mm) from column face)
  const denseZoneLen = beamDenseZoneLength(p.h);
  const haunchType = p.haunchType || 'none';
  const haunchLenMm = p.haunchLength || 0;
  const haunchHeightMm = p.haunchHeight || 0;
  const haunchSides = haunchType !== 'none' && haunchLenMm > 0 && haunchHeightMm > 0
    ? (p.haunchSide === 'left' || p.haunchSide === 'right' ? 1 : 2)
    : 0;
  const hasLeftHaunchCalc = haunchSides > 0 && (p.haunchSide === 'both' || p.haunchSide === 'left');
  const hasRightHaunchCalc = haunchSides > 0 && (p.haunchSide === 'both' || p.haunchSide === 'right');
  const haunchH0Mm = p.h - cover - bot.diameter / 2;
  const haunchHbCoeff = p.seismicGrade === '一级' ? 2.0 : 1.5;
  const haunchDenseZoneMm = haunchSides > 0
    ? Math.max(haunchHbCoeff * p.h, 500, haunchLenMm + 0.5 * haunchH0Mm)
    : 0;
  const haunchBaseSkipMm = haunchType === 'horizontal' ? haunchDenseZoneMm : haunchLenMm;
  const countBaseStirrupsForSpan = (spanLenMm: number) => {
    const leftSkip = hasLeftHaunchCalc ? haunchBaseSkipMm : 0;
    const rightSkip = hasRightHaunchCalc ? haunchBaseSkipMm : 0;
    const leftDenseCount = Math.max(Math.ceil((denseZoneLen - leftSkip) / stir.spacingDense), 0);
    const rightDenseCount = Math.max(Math.ceil((denseZoneLen - rightSkip) / stir.spacingDense), 0);
    const normalLen = Math.max(spanLenMm - Math.max(denseZoneLen, leftSkip) - Math.max(denseZoneLen, rightSkip), 0);
    const normalCount = Math.ceil(normalLen / stir.spacingNormal);
    return { denseCount: leftDenseCount + rightDenseCount, normalCount };
  };
  let stirCount = 0;
  let stirWt = 0;
  const stirCenterB0 = Math.max(spanWidthsArr[0] - 2 * cover - stir.diameter, 0);
  const stirCenterH = Math.max(p.h - 2 * cover - stir.diameter, 0);
  const stirSpec0 = createStirrupShapeSpec({
    widthMm: stirCenterB0,
    heightMm: stirCenterH,
    diameterMm: stir.diameter,
  });
  const stirSingleL0 = stirSpec0.lengthMm / 1000;
  const stirPerSpanInfo: string[] = [];
  for (let i = 0; i < spanCount; i++) {
    const bi = spanWidthsArr[i];
    const sli = spanLengthsArr[i];
    const stirSpecI = createStirrupShapeSpec({
      widthMm: Math.max(bi - 2 * cover - stir.diameter, 0),
      heightMm: stirCenterH,
      diameterMm: stir.diameter,
    });
    const stirSingleLi = stirSpecI.lengthMm / 1000;
    const { denseCount: denseCountI, normalCount: normalCountI } = countBaseStirrupsForSpan(sli);
    const spanCountI = denseCountI + normalCountI;
    stirCount += spanCountI;
    stirWt += spanCountI * stirSingleLi * w(stir.diameter);
    stirPerSpanInfo.push(`第${i + 1}跨b=${bi}:${spanCountI}根`);
  }
  const stirSingleL = spanCount === 1 ? stirSingleL0 : stirWt / (stirCount * w(stir.diameter));
  const { denseCount: denseCountPerSpan0, normalCount: normalCountPerSpan0 } = countBaseStirrupsForSpan(spanLengthsArr[0]);
  const stirFormula: FormulaStep[] = [
    { label: '箍筋中心线尺寸(第1跨)', formula: 'b_c = b - 2c - d, h_c = h - 2c - d', substitution: `= ${spanWidthsArr[0]} - 2×${cover} - ${stir.diameter}, ${p.h} - 2×${cover} - ${stir.diameter}`, result: `= ${stirCenterB0}×${stirCenterH} mm` },
    { label: '135°弯钩长度', formula: 'hook = max(10d, 75)', substitution: `= max(10×${stir.diameter}, 75)`, result: `= ${Math.round(stirSpec0.hookLenMm)} mm` },
    { label: '单根下料长度', formula: 'L = 2(b_c+h_c)-8r+2πr + 2×(135°圆弧+hook)', substitution: `中心线${stirCenterB0}×${stirCenterH}，r=${Math.round(stirSpec0.cornerRadiusMm)}，R=${Math.round(stirSpec0.bendRadiusMm)}，hook=${Math.round(stirSpec0.hookLenMm)}`, result: `= ${stirSpec0.lengthMm} mm = ${stirSingleL0.toFixed(3)} m` },
    { label: '加密区长度', formula: 'l_dense = max(2h, 500)', substitution: `= max(2×${p.h}, 500)`, result: `= ${denseZoneLen} mm` },
    { label: '加密区根数/跨(第1跨)', formula: haunchSides > 0 ? 'n_dense = 梁端加密区扣除加腋专用箍筋区后计数' : 'n_dense = ⌈2×l_dense / s_dense⌉', substitution: haunchSides > 0 ? `加腋区由专用箍筋另计，基础箍筋剩余加密根数` : `= ⌈2×${denseZoneLen} / ${stir.spacingDense}⌉`, result: `= ${denseCountPerSpan0}` },
    { label: '非加密区根数/跨(第1跨)', formula: haunchSides > 0 ? 'n_normal = 扣除max(l_dense, l_haunch)后的中段/s_normal' : 'n_normal = ⌈(ln - 2×l_dense) / s_normal⌉', substitution: haunchSides > 0 ? `ln=${spanLengthsArr[0]}，加腋替代区=${Math.round(haunchBaseSkipMm)}mm` : `= ⌈(${spanLengthsArr[0]} - 2×${denseZoneLen}) / ${stir.spacingNormal}⌉`, result: `= ${normalCountPerSpan0}` },
    { label: '箍筋总数(各跨合计)', formula: spanCount > 1 ? stirPerSpanInfo.join('，') : `(${denseCountPerSpan0}+${normalCountPerSpan0})×${spanCount}`, substitution: '', result: `= ${stirCount} 根` },
    weightSteps('箍筋', stirCount, stirSingleL, stir.diameter),
  ];
  items.push({
    name: '箍筋', spec: p.stirrup,
    length: `${stirSingleL.toFixed(3)}m × ${stirCount}根`,
    weight: `${stirWt.toFixed(2)} kg`, color: '#27AE60',
    grade: stir.grade, diameter: stir.diameter, count: stirCount, lengthM: stirSingleL, weightKg: stirWt,
    formulaSteps: stirFormula,
  });
  total += stirWt;

  // 加腋附加筋与加腋区箍筋 (22G101-1 2-36，按当前3D表达口径计入)
  if (haunchSides > 0) {
    const haunchSideTotal = haunchSides * spanCount;
    if (haunchType === 'horizontal') {
      const haunchLaE = calcLaE(bot.grade, bot.diameter, p.concreteGrade, p.seismicGrade);
      const anchorInCol = Math.min(haunchLaE, hc - cover);
      const slopeBaseLen = Math.sqrt(haunchLenMm * haunchLenMm + haunchHeightMm * haunchHeightMm);
      const maxPerRow = Math.floor(stirCenterB0 / (bot.diameter * 2.5)) + 1;
      const firstRowCount = bot.count > maxPerRow ? Math.ceil(bot.count / 2) : bot.count;
      let haunchBarCount = 0;
      let haunchBarWtLen = 0;
      let firstSlopeLen = slopeBaseLen;
      for (let i = 0; i < spanCount; i++) {
        const maxRatio = (spanLengthsArr[i] / 2) / haunchLenMm * 0.85;
        const finalRatio = Math.min(Math.max(haunchLaE / slopeBaseLen, 1), maxRatio);
        const slopeLen = slopeBaseLen * finalRatio;
        if (i === 0) firstSlopeLen = slopeLen;
        const countI = firstRowCount * haunchSides;
        haunchBarCount += countI;
        haunchBarWtLen += countI * (anchorInCol + slopeLen) / 1000;
      }
      if (haunchBarCount > 0) {
        const avgHaunchBarLen = haunchBarWtLen / haunchBarCount;
        const haunchBarFormula: FormulaStep[] = [
          { label: '附加筋根数', formula: 'n = 底筋第一排根数 × 加腋侧数 × 跨数', substitution: `= ${firstRowCount} × ${haunchSides} × ${spanCount}`, result: `= ${haunchBarCount} 根` },
          { label: '柱内锚固', formula: 'anc = min(laE, hc-c)', substitution: `= min(${haunchLaE}, ${hc}-${cover})`, result: `= ${anchorInCol} mm` },
          { label: '斜面段(第1跨)', formula: 'L_slope = sqrt(c1²+h²) × 延伸系数', substitution: `= sqrt(${haunchLenMm}²+${haunchHeightMm}²) × ${(firstSlopeLen / slopeBaseLen).toFixed(2)}`, result: `= ${Math.round(firstSlopeLen)} mm` },
        ];
        push('加腋附加筋', `${firstRowCount}${bot.grade}${bot.diameter}`,
          `平均${avgHaunchBarLen.toFixed(3)}m × ${haunchBarCount} (水平加腋，含柱内锚固)`,
          bot.grade, bot.diameter, haunchBarCount, avgHaunchBarLen, '#E67E22', haunchBarFormula);
      }

      const h0mm = p.h - cover - bot.diameter / 2;
      const hbCoeff = p.seismicGrade === '一级' ? 2.0 : 1.5;
      const denseZone1mm = Math.max(hbCoeff * p.h, 500, haunchLenMm + 0.5 * h0mm);
      let haunchStirCount = 0;
      let haunchStirWtLen = 0;
      let firstHaunchStirLen = 0;
      for (let i = 0; i < spanCount; i++) {
        const stirZoneLen = Math.min(denseZone1mm, spanLengthsArr[i] / 2 - 50);
        const countPerSide = Math.max(Math.ceil(stirZoneLen / stir.spacingDense), 1);
        for (let side = 0; side < haunchSides; side++) {
          for (let j = 0; j < countPerSide; j++) {
            const t = (j + 0.5) / countPerSide;
            const distFromCol = stirZoneLen * t;
            const localDepth = distFromCol <= haunchLenMm ? haunchHeightMm * (1 - distFromCol / haunchLenMm) : 0;
            const spec = createStirrupShapeSpec({
              widthMm: Math.max(spanWidthsArr[i] - 2 * cover - stir.diameter, 0),
              heightMm: Math.max(p.h + localDepth - 2 * cover - stir.diameter, 0),
              diameterMm: stir.diameter,
            });
            if (firstHaunchStirLen === 0) firstHaunchStirLen = spec.lengthMm;
            haunchStirCount += 1;
            haunchStirWtLen += spec.lengthMm / 1000;
          }
        }
      }
      if (haunchStirCount > 0) {
        const avgHaunchStirLen = haunchStirWtLen / haunchStirCount;
        const haunchStirFormula: FormulaStep[] = [
          { label: '加腋加密区长度', formula: 'l_h = max(αhb, 500, c1+0.5h0)', substitution: `= max(${hbCoeff}×${p.h}, 500, ${haunchLenMm}+0.5×${Math.round(h0mm)})`, result: `= ${Math.round(denseZone1mm)} mm` },
          { label: '箍筋根数', formula: 'n = Σceil(min(l_h, ln_i/2-50)/s_dense) × 加腋侧数', substitution: `s=${stir.spacingDense}，侧数/跨=${haunchSides}`, result: `= ${haunchStirCount} 根` },
          { label: '单根长度(首道)', formula: '按加腋处变高度中心线箍筋', substitution: `中心线随局部加腋高度变化`, result: `首道约 ${firstHaunchStirLen} mm` },
        ];
        push('加腋区箍筋', p.stirrup,
          `平均${avgHaunchStirLen.toFixed(3)}m × ${haunchStirCount} (水平加腋区)`,
          stir.grade, stir.diameter, haunchStirCount, avgHaunchStirLen, '#27AE60', haunchStirFormula);
      }
    }

    if (haunchType === 'vertical') {
      const slopeLen = Math.sqrt(haunchLenMm * haunchLenMm + haunchHeightMm * haunchHeightMm);
      const bottomLaE = calcLaE(bot.grade, bot.diameter, p.concreteGrade, p.seismicGrade);
      const bottomAnchorInCol = Math.min(bottomLaE, hc - cover);
      const topLaE = calcLaE(top.grade, top.diameter, p.concreteGrade, p.seismicGrade);
      const topAnchorInCol = Math.min(topLaE, hc - cover);
      const barsPerSide = 2;
      const verticalCount = haunchSideTotal * barsPerSide;
      const bottomHaunchLen = (bottomAnchorInCol + slopeLen) / 1000;
      const topHaunchLen = (topAnchorInCol + slopeLen) / 1000;
      push('竖向加腋下部附加筋', `${barsPerSide}${bot.grade}${bot.diameter}`,
        `${bottomHaunchLen.toFixed(3)}m × ${verticalCount} (两侧斜面+柱内锚固)`,
        bot.grade, bot.diameter, verticalCount, bottomHaunchLen, '#E67E22', [
          { label: '单根长度', formula: 'L = 柱内锚固 + sqrt(c1²+b_h²)', substitution: `= ${bottomAnchorInCol} + sqrt(${haunchLenMm}²+${haunchHeightMm}²)`, result: `= ${(bottomHaunchLen * 1000).toFixed(0)} mm` },
        ]);
      push('竖向加腋上部附加筋', `${barsPerSide}${top.grade}${top.diameter}`,
        `${topHaunchLen.toFixed(3)}m × ${verticalCount} (两侧斜面+柱内锚固)`,
        top.grade, top.diameter, verticalCount, topHaunchLen, '#E67E22', [
          { label: '单根长度', formula: 'L = 柱内锚固 + sqrt(c1²+b_h²)', substitution: `= ${topAnchorInCol} + sqrt(${haunchLenMm}²+${haunchHeightMm}²)`, result: `= ${(topHaunchLen * 1000).toFixed(0)} mm` },
        ]);

      let verticalStirCount = 0;
      let verticalStirWtLen = 0;
      for (let i = 0; i < spanCount; i++) {
        const countPerSide = Math.max(Math.ceil(haunchLenMm / stir.spacingDense), 1);
        for (let side = 0; side < haunchSides; side++) {
          for (let j = 0; j < countPerSide; j++) {
            const t = (j + 0.5) / countPerSide;
            const localWidthAdd = haunchHeightMm * (1 - t);
            const spec = createStirrupShapeSpec({
              widthMm: Math.max(spanWidthsArr[i] + 2 * localWidthAdd - 2 * cover - stir.diameter, 0),
              heightMm: stirCenterH,
              diameterMm: stir.diameter,
            });
            verticalStirCount += 1;
            verticalStirWtLen += spec.lengthMm / 1000;
          }
        }
      }
      if (verticalStirCount > 0) {
        const avgVerticalStirLen = verticalStirWtLen / verticalStirCount;
        push('竖向加腋区箍筋', p.stirrup,
          `平均${avgVerticalStirLen.toFixed(3)}m × ${verticalStirCount} (竖向加腋区)`,
          stir.grade, stir.diameter, verticalStirCount, avgVerticalStirLen, '#27AE60', [
            { label: '箍筋根数', formula: 'n = ceil(c1/s_dense) × 加腋侧数 × 跨数', substitution: `= ceil(${haunchLenMm}/${stir.spacingDense}) × ${haunchSides} × ${spanCount}`, result: `= ${verticalStirCount} 根` },
          ]);
      }
    }
  }

  // 腰筋/抗扭筋
  const sideInfo = p.sideBar ? parseSideBar(p.sideBar) : null;
  if (sideInfo) {
    const sideAnchor = calcBeamSideBarAnchor(sideInfo.prefix, sideInfo.grade, sideInfo.diameter, p.concreteGrade, p.seismicGrade, hc, cover);
    const sideAnchorLen = sideAnchor.canStraight ? sideAnchor.straightLen : bentAnchorCutLen(sideAnchor.bentStraightPart, sideAnchor.bentBendPart, sideInfo.diameter);
    const sideLM = (totalNet + 2 * sideAnchorLen) / 1000;
    const sideFormula: FormulaStep[] = sideInfo.prefix === 'G'
      ? [
          { label: '构造腰筋锚固', formula: 'la = max(15d, 150)', substitution: `= max(15×${sideInfo.diameter}, 150)`, result: `= ${sideAnchorLen} mm` },
          { label: '单根长度', formula: 'L = 净跨总长 + 2×锚固', substitution: `= ${totalNet} + 2×${sideAnchorLen}`, result: `= ${(totalNet + 2 * sideAnchorLen)} mm = ${sideLM.toFixed(2)} m` },
        ]
      : [
          ...beamEndAnchorSteps(sideInfo.grade, sideInfo.diameter, p.concreteGrade, p.seismicGrade, hc, cover),
          { label: '单根长度', formula: 'L = 净跨总长 + 2×锚固', substitution: `= ${totalNet} + 2×${sideAnchorLen}`, result: `= ${(totalNet + 2 * sideAnchorLen)} mm = ${sideLM.toFixed(2)} m` },
        ];
    push('腰筋', p.sideBar!, `${sideLM.toFixed(2)}m × ${sideInfo.count} (含锚固)`,
      sideInfo.grade, sideInfo.diameter, sideInfo.count, sideLM, '#2980B9', sideFormula);
  }

  // 拉筋 (有腰筋时)
  if (sideInfo) {
    const tieInfo = p.tieBar ? parseTieBar(p.tieBar) : autoTieBar(p.b, stir.grade, stir.diameter);
    if (tieInfo) {
      const perSide = Math.ceil(sideInfo.count / 2);
      // 多跨时按各跨宽度分别计算拉筋长度和数量
      let tieTotalCount = 0;
      let tieTotalWtLen = 0;
      let tieSpec0: ReturnType<typeof createTieBarShapeSpec> | null = null;
      for (let i = 0; i < spanCount; i++) {
        const bi = spanWidthsArr[i];
        const sli = spanLengthsArr[i];
        const tieSpecI = createTieBarShapeSpec({
          sideOffsetMm: resolveTieSideOffsetMm({
            sectionWidthMm: bi,
            coverMm: cover,
            stirrupDiameterMm: stir.diameter,
            sideBarDiameterMm: sideInfo.diameter,
          }),
          tieDiameterMm: tieInfo.diameter,
          sideBarDiameterMm: sideInfo.diameter,
        });
        if (i === 0) tieSpec0 = tieSpecI;
        const tieSingleLI = tieSpecI.lengthMm / 1000;
        const tieRowsI = countBeamTiePositions(sli, stir.spacingNormal);
        const tieTotalI = tieRowsI * perSide;
        tieTotalCount += tieTotalI;
        tieTotalWtLen += tieTotalI * tieSingleLI;
      }
      const tieAvgL = tieTotalCount > 0 ? tieTotalWtLen / tieTotalCount : 0;
      if (tieTotalCount > 0) {
        const firstTieSpec = tieSpec0 ?? createTieBarShapeSpec({
          sideOffsetMm: resolveTieSideOffsetMm({
            sectionWidthMm: spanWidthsArr[0],
            coverMm: cover,
            stirrupDiameterMm: stir.diameter,
            sideBarDiameterMm: sideInfo.diameter,
          }),
          tieDiameterMm: tieInfo.diameter,
          sideBarDiameterMm: sideInfo.diameter,
        });
        const firstTieRows = countBeamTiePositions(spanLengthsArr[0], stir.spacingNormal);
        const tieFormula: FormulaStep[] = [
          { label: '拉筋主体(第1跨)', formula: 'body = 2×(sideOffset - R)', substitution: `sideOffset = (${spanWidthsArr[0]} - 2×${cover} - ${stir.diameter})/2 - ${stir.diameter}/2 - ${sideInfo.diameter}/2`, result: `= ${Math.round(firstTieSpec.bodyLenMm)} mm` },
          { label: '135°弯钩长度', formula: 'hook = max(10d, R×1.5)', substitution: `R=max(侧筋d/2+拉筋d, 3d)`, result: `= ${Math.round(firstTieSpec.hookLenMm)} mm` },
          { label: '单根下料长度', formula: 'L = body + 2×(135°圆弧 + hook)', substitution: `= ${Math.round(firstTieSpec.bodyLenMm)} + 2×(${Math.round(firstTieSpec.bendRadiusMm)}×135°弧度 + ${Math.round(firstTieSpec.hookLenMm)})`, result: `= ${firstTieSpec.lengthMm} mm = ${(firstTieSpec.lengthMm / 1000).toFixed(3)} m` },
          { label: '拉筋道数(第1跨)', formula: 'n_x = 按3D布置: 从1.5s到ln-0.5s，每s一道', substitution: `ln=${spanLengthsArr[0]}，s=${stir.spacingNormal}`, result: `= ${firstTieRows} 道` },
          { label: '拉筋总数', formula: 'n = Σ(道数×层数)', substitution: `层数=ceil(${sideInfo.count}/2)=${perSide}，各跨合计`, result: `= ${tieTotalCount} 根` },
        ];
        push('拉筋', p.tieBar || `${tieInfo.grade}${tieInfo.diameter}`,
          `平均${tieAvgL.toFixed(3)}m × ${tieTotalCount} (${perSide}层)`,
          tieInfo.grade, tieInfo.diameter, tieTotalCount, tieAvgL, '#1ABC9C', tieFormula);
      }
    }
  }

  return buildResult(items, total, 'beam');
}

/* ============ 配筋率计算 ============ */

export interface RebarRatioResult {
  As: number;       // 钢筋面积 mm²
  h0: number;       // 有效高度 mm
  rho: number;      // 配筋率 (小数, 如0.012 = 1.2%)
  rhoMin: number;   // 最小配筋率 GB50010 §8.5.1
  rhoMax: number;   // 工程常用上限
  status: 'ok' | 'low' | 'high'; // 校验状态
  formulaSteps?: FormulaStep[];
}

export interface BeamRatioResult {
  top: RebarRatioResult;
  bottom: RebarRatioResult;
}

/**
 * 梁纵向配筋率计算 (GB50010-2010 §8.5.1)
 * ρmin = max(0.2%, 0.45*ft/fy)
 * ρmax = 2.5% (工程简化上限)
 */
export function calcBeamRebarRatios(p: BeamParams): BeamRatioResult {
  const top = parseRebar(p.top);
  const bot = parseRebarBottom(p.bottom);
  const stir = parseStirrup(p.stirrup);
  const cover = p.cover || 25;
  const b = p.b;

  const ft = FT[p.concreteGrade] || 1.43;
  const fyTop = FY[top.grade] || 360;
  const fyBot = FY[bot.grade] || 360;

  // As = Σ(ni × π × di² / 4) — 混合直径时按各段分别计算
  const segArea = (segs: {count:number;diameter:number}[]) => segs.reduce((s, seg) => s + seg.count * rebarArea(seg.diameter), 0);
  const AsTop = top.segments ? segArea(top.segments) : top.count * rebarArea(top.diameter);
  const AsBot = bot.segments ? segArea(bot.segments) : bot.count * rebarArea(bot.diameter);

  // h0: 多排时按合力点加权计算，单排时 h0 = h - cover - stirDia - d/2
  const { h0: h0Top } = calcEffectiveDepth(p.h, cover, stir.diameter, top.diameter, top.count, top.rows, top.perRow, top.segments);
  const { h0: h0Bot } = calcEffectiveDepth(p.h, cover, stir.diameter, bot.diameter, bot.count, bot.rows, bot.perRow, bot.segments);
  const topIsMultiRow = (top.rows && top.rows >= 2) || (top.perRow && top.perRow.length >= 2);
  const botIsMultiRow = (bot.rows && bot.rows >= 2) || (bot.perRow && bot.perRow.length >= 2);

  // ρ = As / (b × h0)
  const rhoTop = AsTop / (b * h0Top);
  const rhoBot = AsBot / (b * h0Bot);

  // ρmin = max(0.2%, 0.45 × ft / fy)  GB50010 §8.5.1
  const rhoMinTop = Math.max(0.002, 0.45 * ft / fyTop);
  const rhoMinBot = Math.max(0.002, 0.45 * ft / fyBot);
  const rhoMax = 0.025; // 工程简化上限 2.5%

  function status(rho: number, rhoMin: number): 'ok' | 'low' | 'high' {
    if (rho < rhoMin) return 'low';
    if (rho > rhoMax) return 'high';
    return 'ok';
  }

  function ratioSteps(pos: string, n: number, d: number, fy: number, h0: number, As: number, rho: number, rhoMin: number, isMultiRow: boolean): FormulaStep[] {
    const h0Formula = isMultiRow ? 'h₀ = h - as (多排合力点加权)' : 'h₀ = h - c - d_stir - d/2';
    const h0Sub = isMultiRow
      ? `多排钢筋，合力点距边缘 as=${(p.h - h0).toFixed(0)}mm`
      : `= ${p.h} - ${cover} - ${stir.diameter} - ${d}/2`;
    return [
      { label: `${pos}钢筋面积`, formula: 'As = n × π × d² / 4', substitution: `= ${n} × π × ${d}² / 4`, result: `= ${As.toFixed(0)} mm²` },
      { label: '有效高度', formula: h0Formula, substitution: h0Sub, result: `= ${h0.toFixed(0)} mm` },
      { label: '配筋率', formula: 'ρ = As / (b × h₀)', substitution: `= ${As.toFixed(0)} / (${b} × ${h0.toFixed(0)})`, result: `= ${(rho * 100).toFixed(2)}%` },
      { label: '最小配筋率', formula: 'ρmin = max(0.2%, 0.45ft/fy)', substitution: `= max(0.2%, 0.45×${ft}/${fy})`, result: `= ${(rhoMin * 100).toFixed(2)}%` },
    ];
  }

  const topSteps = ratioSteps('上部', top.count, top.diameter, fyTop, h0Top, AsTop, rhoTop, rhoMinTop, !!topIsMultiRow);
  const botSteps = ratioSteps('下部', bot.count, bot.diameter, fyBot, h0Bot, AsBot, rhoBot, rhoMinBot, !!botIsMultiRow);

  return {
    top: { As: AsTop, h0: h0Top, rho: rhoTop, rhoMin: rhoMinTop, rhoMax, status: status(rhoTop, rhoMinTop), formulaSteps: topSteps },
    bottom: { As: AsBot, h0: h0Bot, rho: rhoBot, rhoMin: rhoMinBot, rhoMax, status: status(rhoBot, rhoMinBot), formulaSteps: botSteps },
  };
}

/* ============ 钢筋弯折详图数据 ============ */

export type BarShapeType = 'straight' | 'bentAnchor' | 'support' | 'stirrup' | 'tie';

export interface BarShape {
  name: string;
  spec: string;
  shapeType: BarShapeType;
  count: number;
  color: string;
  totalLen: number;  // mm
  setId?: string;
  relatedSetIds?: string[];
  bodyLen?: number;  // 主体水平段 mm
  anchorLen?: number; // 锚固长度 mm (每端)
  bendLen?: number;  // 弯折段长度 mm
  bendDir?: 'down' | 'up'; // 弯折方向: 上部筋向下, 下部筋向上
  width?: number;    // 箍筋宽 mm
  height?: number;   // 箍筋高 mm
  hookLen?: number;  // 弯钩长 mm
  bendRadius?: number; // 弯曲半径 mm
  hookAngleDeg?: number; // 弯钩角度
  spanLen?: number;  // 支座筋伸入跨内长度 mm
  supportRow?: number; // 支座负筋排数 1 or 2
}

export function calcBarShapes(p: BeamParams): BarShape[] {
  const shapes: BarShape[] = [];
  const top = parseRebar(p.top);
  const bot = parseRebarBottom(p.bottom);
  const stir = parseStirrup(p.stirrup);
  const cover = p.cover || 25;
  const hc = p.hc || 500;
  const spanCount = p.spanCount || 1;
  const spanLengthsArr: number[] = (p.spanLengths && p.spanLengths.length === spanCount)
    ? p.spanLengths
    : Array(spanCount).fill(p.spanLength || 4000);
  const totalNet = spanLengthsArr.reduce((s, l) => s + l, 0) + (spanCount - 1) * hc;

  // 上部通长筋
  const topA = calcBeamEndAnchor(top.grade, top.diameter, p.concreteGrade, p.seismicGrade, hc, cover);
  if (topA.canStraight) {
    shapes.push({ name: '上部通长筋', spec: p.top, shapeType: 'straight', count: top.count,
      color: '#C0392B', totalLen: totalNet + 2 * topA.straightLen, setId: 'beam.top',
      bodyLen: totalNet, anchorLen: topA.straightLen });
  } else {
    shapes.push({ name: '上部通长筋', spec: p.top, shapeType: 'bentAnchor', count: top.count,
      color: '#C0392B', totalLen: totalNet + 2 * bentAnchorCutLen(topA.bentStraightPart, topA.bentBendPart, top.diameter), setId: 'beam.top',
      bodyLen: totalNet, anchorLen: topA.bentStraightPart, bendLen: topA.bentBendPart, bendDir: 'down' });
  }

  // 下部通长筋
  const botA = calcBeamEndAnchor(bot.grade, bot.diameter, p.concreteGrade, p.seismicGrade, hc, cover);
  if (botA.canStraight) {
    shapes.push({ name: '下部通长筋', spec: p.bottom, shapeType: 'straight', count: bot.count,
      color: '#C0392B', totalLen: totalNet + 2 * botA.straightLen, setId: 'beam.bottom',
      bodyLen: totalNet, anchorLen: botA.straightLen });
  } else {
    shapes.push({ name: '下部通长筋', spec: p.bottom, shapeType: 'bentAnchor', count: bot.count,
      color: '#C0392B', totalLen: totalNet + 2 * bentAnchorCutLen(botA.bentStraightPart, botA.bentBendPart, bot.diameter), setId: 'beam.bottom',
      bodyLen: totalNet, anchorLen: botA.bentStraightPart, bendLen: botA.bentBendPart, bendDir: 'up' });
  }

  // 支座负筋
  const supportShapes = [
    { key: 'leftSupport' as const, row: 1 as 1 | 2, field: p.leftSupport },
    { key: 'rightSupport' as const, row: 1 as 1 | 2, field: p.rightSupport },
    { key: 'leftSupport2' as const, row: 2 as 1 | 2, field: p.leftSupport2 },
    { key: 'rightSupport2' as const, row: 2 as 1 | 2, field: p.rightSupport2 },
  ];
  for (const { key, row, field } of supportShapes) {
    if (!field) continue;
    const r = parseRebar(field);
    const isRight = key.startsWith('right');
    const supportSpanLen = isRight ? spanLengthsArr[spanCount - 1] : spanLengthsArr[0];
    const sLen = calcSupportRebarLength(supportSpanLen, row);
    const a = calcBeamEndAnchor(r.grade, r.diameter, p.concreteGrade, p.seismicGrade, hc, cover);
    const ancLen = a.canStraight ? a.straightLen : a.bentStraightPart;
    const bLen = a.canStraight ? 0 : a.bentBendPart;
    const bendDeduct = a.canStraight ? 0 : bendAdjustment(r.diameter, 90);
    const side = isRight ? '右端' : '左端';
    const rowLabel = row === 2 ? '(二排)' : '';
    shapes.push({ name: `${side}支座负筋${rowLabel}`, spec: field,
      shapeType: 'support', count: r.count,
      color: '#8E44AD', totalLen: sLen + ancLen + bLen - bendDeduct, setId: `beam.${key}`,
      bodyLen: sLen, anchorLen: ancLen, bendLen: bLen || undefined, spanLen: sLen, supportRow: row,
      bendDir: 'down' });
  }

  const innerR = spanCount > 1 ? (p.innerSupport ? parseRebar(p.innerSupport) : ((p.rightSupport ? parseRebar(p.rightSupport) : null) ?? (p.leftSupport ? parseRebar(p.leftSupport) : null))) : null;
  if (innerR) {
    let totalInnerLen = 0;
    for (let i = 0; i < spanCount - 1; i++) {
      totalInnerLen += calcSupportRebarLength(spanLengthsArr[i]) + hc + calcSupportRebarLength(spanLengthsArr[i + 1]);
    }
    const avgInnerLen = Math.round(totalInnerLen / (spanCount - 1));
    shapes.push({
      name: '中间支座负筋',
      spec: p.innerSupport || p.rightSupport || p.leftSupport || '',
      shapeType: 'straight',
      count: innerR.count * (spanCount - 1),
      color: '#8E44AD',
      totalLen: avgInnerLen,
      setId: 'beam.innerSupport',
      bodyLen: avgInnerLen,
    });
  }

  // 箍筋
  const stirSpec = createStirrupShapeSpec({
    widthMm: p.b - 2 * cover - stir.diameter,
    heightMm: p.h - 2 * cover - stir.diameter,
    diameterMm: stir.diameter,
  });
  shapes.push({ name: '箍筋', spec: p.stirrup, shapeType: 'stirrup',
    count: 0, color: '#27AE60', totalLen: stirSpec.lengthMm, setId: 'beam.stirrup',
    width: stirSpec.widthMm, height: stirSpec.heightMm, hookLen: stirSpec.hookLenMm,
    bendRadius: stirSpec.bendRadiusMm, hookAngleDeg: stirSpec.hookAngleDeg });

  // 拉筋
  const sideInfo = p.sideBar ? parseSideBar(p.sideBar) : null;
  if (sideInfo) {
    const tieInfo = p.tieBar ? parseTieBar(p.tieBar) : autoTieBar(p.b, stir.grade, stir.diameter);
    if (tieInfo) {
      const tieSpec = createTieBarShapeSpec({
        sideOffsetMm: resolveTieSideOffsetMm({
          sectionWidthMm: p.b,
          coverMm: cover,
          stirrupDiameterMm: stir.diameter,
          sideBarDiameterMm: sideInfo.diameter,
        }),
        tieDiameterMm: tieInfo.diameter,
        sideBarDiameterMm: sideInfo.diameter,
      });
      shapes.push({ name: '拉筋', spec: p.tieBar || `A${tieInfo.diameter}`,
        shapeType: 'tie', count: 0, color: '#1ABC9C', setId: 'beam.tieBar', relatedSetIds: ['beam.sideBar'],
        totalLen: tieSpec.lengthMm, bodyLen: tieSpec.bodyLenMm, hookLen: tieSpec.hookLenMm,
        bendRadius: tieSpec.bendRadiusMm, hookAngleDeg: tieSpec.hookAngleDeg });
    }
  }

  return shapes;
}

export function calcColumnBarShapes(p: ColumnParams): BarShape[] {
  const shapes: BarShape[] = [];
  const stir = parseStirrup(p.stirrup);
  const cover = p.cover || 25;
  const colHeight = p.height || 3000;
  const resolved = resolveColumnBars(p.main, p.cornerMain, p.bMiddleMain, p.hMiddleMain, p.b - 2 * cover, p.h - 2 * cover);

  const addMainShape = (name: string, spec: string, count: number, grade: string, diameter: number, color: string, setId: string) => {
    const lapLen = calcLlE(grade, diameter, p.concreteGrade, p.seismicGrade);
    shapes.push({
      name,
      spec,
      shapeType: 'straight',
      count,
      color,
      totalLen: colHeight + lapLen,
      bodyLen: colHeight,
      anchorLen: lapLen,
      setId,
      relatedSetIds: ['column.stirrup'],
    });
  };

  if (resolved.isDetailed) {
    addMainShape('角筋', p.cornerMain || p.main, resolved.corner.count, resolved.corner.grade, resolved.corner.diameter, '#C0392B', 'column.corner');
    if (resolved.bMiddle) {
      addMainShape('b边中部筋', p.bMiddleMain || '', resolved.bMiddle.count * 2, resolved.bMiddle.grade, resolved.bMiddle.diameter, '#E67E22', 'column.bMiddle');
    }
    if (resolved.hMiddle) {
      addMainShape('h边中部筋', p.hMiddleMain || '', resolved.hMiddle.count * 2, resolved.hMiddle.grade, resolved.hMiddle.diameter, '#8E44AD', 'column.hMiddle');
    }
  } else {
    addMainShape('纵向钢筋', p.main, resolved.totalCount, resolved.corner.grade, resolved.corner.diameter, '#C0392B', 'column.main');
  }

  const stirSpec = createStirrupShapeSpec({
    widthMm: Math.max(p.b - 2 * cover - stir.diameter, 0),
    heightMm: Math.max(p.h - 2 * cover - stir.diameter, 0),
    diameterMm: stir.diameter,
  });
  shapes.push({
    name: '箍筋',
    spec: p.stirrup,
    shapeType: 'stirrup',
    count: 0,
    color: '#27AE60',
    totalLen: stirSpec.lengthMm,
    width: stirSpec.widthMm,
    height: stirSpec.heightMm,
    hookLen: stirSpec.hookLenMm,
    bendRadius: stirSpec.bendRadiusMm,
    hookAngleDeg: stirSpec.hookAngleDeg,
    setId: 'column.stirrup',
    relatedSetIds: ['column.corner', 'column.bMiddle', 'column.hMiddle', 'column.main'],
  });

  return shapes;
}

export function calcColumn(p: ColumnParams): CalcResult {
  const stir = parseStirrup(p.stirrup);
  const colHeight = p.height || 3000;
  const cover = p.cover || 25;
  const items: CalcItem[] = [];
  let total = 0;

  // 22G101-1 分项标注解析
  const resolved = resolveColumnBars(p.main, p.cornerMain, p.bMiddleMain, p.hMiddleMain, p.b - 2 * cover, p.h - 2 * cover);

  // 箍筋加密区长度 GB50011 §6.3.3: max(Hn/6, hc, 500)，上下两端各取
  const hcVal = Math.max(p.b, p.h);
  const denseZoneLen = Math.max(Math.ceil(colHeight / 6), hcVal, 500);

  if (resolved.isDetailed) {
    // ── 角筋 (4根) ──
    const cLlE = calcLlE(resolved.corner.grade, resolved.corner.diameter, p.concreteGrade, p.seismicGrade);
    const cL = (colHeight + cLlE) / 1000;
    const cCount = resolved.corner.count;
    const cW = cCount * cL * w(resolved.corner.diameter);
    const cFormula: FormulaStep[] = [
      ...anchorSteps(resolved.corner.grade, resolved.corner.diameter, p.concreteGrade, p.seismicGrade),
      { label: '抗震搭接长度 llE', formula: 'llE = ζl × laE', substitution: `= 1.4 × laE`, result: `= ${cLlE} mm` },
      { label: '单根长度', formula: 'L = H + llE', substitution: `= ${colHeight} + ${cLlE}`, result: `= ${colHeight + cLlE} mm = ${cL.toFixed(2)} m` },
      weightSteps('角筋', cCount, cL, resolved.corner.diameter),
    ];
    items.push({ name: '角筋', spec: p.cornerMain!, length: `${cL.toFixed(2)}m × ${cCount} (含搭接${cLlE}mm)`, weight: `${cW.toFixed(2)} kg`, color: '#C0392B', grade: resolved.corner.grade, diameter: resolved.corner.diameter, count: cCount, lengthM: cL, weightKg: cW, formulaSteps: cFormula });
    total += cW;

    // ── b边中部筋 (每侧 n 根，共 2n 根) ──
    if (resolved.bMiddle) {
      const bLlE = calcLlE(resolved.bMiddle.grade, resolved.bMiddle.diameter, p.concreteGrade, p.seismicGrade);
      const bL = (colHeight + bLlE) / 1000;
      const bCount = resolved.bMiddle.count * 2;
      const bW = bCount * bL * w(resolved.bMiddle.diameter);
      const bFormula: FormulaStep[] = [
        ...anchorSteps(resolved.bMiddle.grade, resolved.bMiddle.diameter, p.concreteGrade, p.seismicGrade),
        { label: '抗震搭接长度 llE', formula: 'llE = ζl × laE', substitution: `= 1.4 × laE`, result: `= ${bLlE} mm` },
        { label: '单根长度', formula: 'L = H + llE', substitution: `= ${colHeight} + ${bLlE}`, result: `= ${colHeight + bLlE} mm = ${bL.toFixed(2)} m` },
        { label: '根数', formula: 'n = 每侧根数 × 2', substitution: `= ${resolved.bMiddle.count} × 2`, result: `= ${bCount} 根` },
        weightSteps('b边中部筋', bCount, bL, resolved.bMiddle.diameter),
      ];
      items.push({ name: 'b边中部筋', spec: p.bMiddleMain!, length: `${bL.toFixed(2)}m × ${bCount} (每侧${resolved.bMiddle.count}根，含搭接${bLlE}mm)`, weight: `${bW.toFixed(2)} kg`, color: '#E67E22', grade: resolved.bMiddle.grade, diameter: resolved.bMiddle.diameter, count: bCount, lengthM: bL, weightKg: bW, formulaSteps: bFormula });
      total += bW;
    }

    // ── h边中部筋 (每侧 n 根，共 2n 根) ──
    if (resolved.hMiddle) {
      const hLlE = calcLlE(resolved.hMiddle.grade, resolved.hMiddle.diameter, p.concreteGrade, p.seismicGrade);
      const hL = (colHeight + hLlE) / 1000;
      const hCount = resolved.hMiddle.count * 2;
      const hW = hCount * hL * w(resolved.hMiddle.diameter);
      const hFormula: FormulaStep[] = [
        ...anchorSteps(resolved.hMiddle.grade, resolved.hMiddle.diameter, p.concreteGrade, p.seismicGrade),
        { label: '抗震搭接长度 llE', formula: 'llE = ζl × laE', substitution: `= 1.4 × laE`, result: `= ${hLlE} mm` },
        { label: '单根长度', formula: 'L = H + llE', substitution: `= ${colHeight} + ${hLlE}`, result: `= ${colHeight + hLlE} mm = ${hL.toFixed(2)} m` },
        { label: '根数', formula: 'n = 每侧根数 × 2', substitution: `= ${resolved.hMiddle.count} × 2`, result: `= ${hCount} 根` },
        weightSteps('h边中部筋', hCount, hL, resolved.hMiddle.diameter),
      ];
      items.push({ name: 'h边中部筋', spec: p.hMiddleMain!, length: `${hL.toFixed(2)}m × ${hCount} (每侧${resolved.hMiddle.count}根，含搭接${hLlE}mm)`, weight: `${hW.toFixed(2)} kg`, color: '#8E44AD', grade: resolved.hMiddle.grade, diameter: resolved.hMiddle.diameter, count: hCount, lengthM: hL, weightKg: hW, formulaSteps: hFormula });
      total += hW;
    }
  } else {
    // Legacy: 用 main 统一计算
    const main = parseRebar(p.main);
    const llE = calcLlE(main.grade, main.diameter, p.concreteGrade, p.seismicGrade);
    const mainL = (colHeight + llE) / 1000;
    const mainW = main.count * mainL * w(main.diameter);
    const mainFormula: FormulaStep[] = [
      ...anchorSteps(main.grade, main.diameter, p.concreteGrade, p.seismicGrade),
      { label: '抗震搭接长度 llE', formula: 'llE = ζl × laE', substitution: `= 1.4 × laE`, result: `= ${llE} mm` },
      { label: '单根长度', formula: 'L = H + llE', substitution: `= ${colHeight} + ${llE}`, result: `= ${colHeight + llE} mm = ${mainL.toFixed(2)} m` },
      weightSteps('纵向钢筋', main.count, mainL, main.diameter),
    ];
    items.push({ name: '纵向钢筋', spec: p.main, length: `${mainL.toFixed(2)}m × ${main.count} (含搭接${llE}mm)`, weight: `${mainW.toFixed(2)} kg`, color: '#C0392B', grade: main.grade, diameter: main.diameter, count: main.count, lengthM: mainL, weightKg: mainW, formulaSteps: mainFormula });
    total += mainW;
  }

  // ── 箍筋 (中心线形状语义与3D/BBS一致) ──
  const stirCenterB = Math.max(p.b - 2 * cover - stir.diameter, 0);
  const stirCenterHCol = Math.max(p.h - 2 * cover - stir.diameter, 0);
  const colStirSpec = createStirrupShapeSpec({
    widthMm: stirCenterB,
    heightMm: stirCenterHCol,
    diameterMm: stir.diameter,
  });
  const stirSingleL = colStirSpec.lengthMm / 1000;
  const denseCount = Math.ceil((2 * denseZoneLen) / stir.spacingDense);
  const normalCount = Math.ceil(Math.max(colHeight - 2 * denseZoneLen, 0) / stir.spacingNormal);
  const stirCount = denseCount + normalCount;
  const stirW = stirCount * stirSingleL * w(stir.diameter);
  const colStirFormula: FormulaStep[] = [
    { label: '箍筋中心线尺寸', formula: 'b_c = b - 2c - d, h_c = h - 2c - d', substitution: `= ${p.b} - 2×${cover} - ${stir.diameter}, ${p.h} - 2×${cover} - ${stir.diameter}`, result: `= ${stirCenterB}×${stirCenterHCol} mm` },
    { label: '135°弯钩长度', formula: 'hook = max(10d, 75)', substitution: `= max(10×${stir.diameter}, 75)`, result: `= ${Math.round(colStirSpec.hookLenMm)} mm` },
    { label: '单根下料长度', formula: 'L = 2(b_c+h_c)-8r+2πr + 2×(135°圆弧+hook)', substitution: `中心线${stirCenterB}×${stirCenterHCol}，r=${Math.round(colStirSpec.cornerRadiusMm)}，R=${Math.round(colStirSpec.bendRadiusMm)}，hook=${Math.round(colStirSpec.hookLenMm)}`, result: `= ${colStirSpec.lengthMm} mm = ${stirSingleL.toFixed(3)} m` },
    { label: '加密区长度', formula: 'l_d = max(Hn/6, hc, 500)', substitution: `= max(⌈${colHeight}/6⌉=${Math.ceil(colHeight / 6)}, ${hcVal}, 500)`, result: `= ${denseZoneLen} mm` },
    { label: '加密区根数(上下两端)', formula: 'n_d = ⌈2×l_d / s_d⌉', substitution: `= ⌈2×${denseZoneLen} / ${stir.spacingDense}⌉`, result: `= ${denseCount}` },
    { label: '非加密区根数', formula: 'n_n = ⌈(H - 2×l_d) / s_n⌉', substitution: `= ⌈(${colHeight} - 2×${denseZoneLen}) / ${stir.spacingNormal}⌉`, result: `= ${normalCount}` },
    { label: '箍筋总数', formula: 'n = n_d + n_n', substitution: `= ${denseCount} + ${normalCount}`, result: `= ${stirCount} 根` },
    weightSteps('箍筋', stirCount, stirSingleL, stir.diameter),
  ];
  items.push({
    name: '箍筋', spec: p.stirrup,
    length: `${stirSingleL.toFixed(3)}m × ${stirCount}根`,
    weight: `${stirW.toFixed(2)} kg`, color: '#27AE60',
    grade: stir.grade, diameter: stir.diameter, count: stirCount, lengthM: stirSingleL, weightKg: stirW,
    formulaSteps: colStirFormula,
  });
  total += stirW;

  return buildResult(items, total, 'column');
}

export interface ResolvedSlabAnchors {
  useManual: boolean;
  bottomX: {
    standard: number;
    start: number;
    end: number;
  };
  bottomY: {
    standard: number;
    start: number;
    end: number;
  };
  topX: {
    standard: number;
    start: number;
    end: number;
  };
  topY: {
    standard: number;
    start: number;
    end: number;
  };
  fallbacks: string[];
}

function resolveManualAnchorValue(
  value: number | undefined,
  legacyValue: number | undefined,
  standardValue: number,
  fieldLabel: string,
  fallbacks: string[],
): number {
  if (
    value !== undefined
    && Number.isFinite(value)
    && value >= 0
  ) {
    return value;
  }

  if (
    legacyValue !== undefined
    && Number.isFinite(legacyValue)
    && legacyValue >= 0
  ) {
    fallbacks.push(`${fieldLabel}使用旧版统一锚固长度`);
    return legacyValue;
  }

  fallbacks.push(`${fieldLabel}未填写，临时回退标准长度`);
  return standardValue;
}

export function resolveSlabAnchors(p: SlabParams): ResolvedSlabAnchors {
  const bx = parseSlabRebar(p.bottomX);
  const by = parseSlabRebar(p.bottomY);
  const tx = p.topX ? parseSlabRebar(p.topX) : null;
  const ty = p.topY ? parseSlabRebar(p.topY) : null;

  const bxLa = calcLa(bx.grade, bx.diameter, p.concreteGrade);
  const byLa = calcLa(by.grade, by.diameter, p.concreteGrade);
  const bxDetail = slabBottomAnchorDetail(p.supportType, bx.diameter, bxLa);
  const byDetail = slabBottomAnchorDetail(p.supportType, by.diameter, byLa);
  const bxStandard = bxDetail.straight + bxDetail.bend;
  const byStandard = byDetail.straight + byDetail.bend;

  const txLa = tx ? calcLa(tx.grade, tx.diameter, p.concreteGrade) : 0;
  const tyLa = ty ? calcLa(ty.grade, ty.diameter, p.concreteGrade) : 0;
  const txStandard = tx
    ? p.supportType === 'cantilever'
      ? 0
      : p.supportType === 'continuous'
        ? txLa
        : Math.ceil(txLa / 2)
    : 0;
  const tyStandard = ty
    ? p.supportType === 'cantilever'
      ? 0
      : p.supportType === 'continuous'
        ? tyLa
        : Math.ceil(tyLa / 2)
    : 0;

  const useManual = p.manualAnchorEnabled === true
    && (p.supportType === 'simple' || p.supportType === 'continuous');
  const fallbacks: string[] = [];

  if (!useManual) {
    return {
      useManual: false,
      bottomX: { standard: bxStandard, start: bxStandard, end: bxStandard },
      bottomY: { standard: byStandard, start: byStandard, end: byStandard },
      topX: { standard: txStandard, start: txStandard, end: txStandard },
      topY: { standard: tyStandard, start: tyStandard, end: tyStandard },
      fallbacks,
    };
  }

  return {
    useManual: true,
    bottomX: {
      standard: bxStandard,
      start: resolveManualAnchorValue(
        p.manualBottomXStartAnchor,
        p.manualBottomAnchorLength,
        bxStandard,
        'X向底筋起点端',
        fallbacks,
      ),
      end: resolveManualAnchorValue(
        p.manualBottomXEndAnchor,
        p.manualBottomAnchorLength,
        bxStandard,
        'X向底筋终点端',
        fallbacks,
      ),
    },
    bottomY: {
      standard: byStandard,
      start: resolveManualAnchorValue(
        p.manualBottomYStartAnchor,
        p.manualBottomAnchorLength,
        byStandard,
        'Y向底筋起点端',
        fallbacks,
      ),
      end: resolveManualAnchorValue(
        p.manualBottomYEndAnchor,
        p.manualBottomAnchorLength,
        byStandard,
        'Y向底筋终点端',
        fallbacks,
      ),
    },
    topX: {
      standard: txStandard,
      start: resolveManualAnchorValue(
        p.manualTopXStartAnchor,
        p.manualTopAnchorLength,
        txStandard,
        'X向面筋起点端',
        fallbacks,
      ),
      end: resolveManualAnchorValue(
        p.manualTopXEndAnchor,
        p.manualTopAnchorLength,
        txStandard,
        'X向面筋终点端',
        fallbacks,
      ),
    },
    topY: {
      standard: tyStandard,
      start: resolveManualAnchorValue(
        p.manualTopYStartAnchor,
        p.manualTopAnchorLength,
        tyStandard,
        'Y向面筋起点端',
        fallbacks,
      ),
      end: resolveManualAnchorValue(
        p.manualTopYEndAnchor,
        p.manualTopAnchorLength,
        tyStandard,
        'Y向面筋终点端',
        fallbacks,
      ),
    },
    fallbacks,
  };
}

export function calcSlab(p: SlabParams): CalcResult {
  const slabW = p.spanX;
  const slabD = p.spanY;
  const bx = parseSlabRebar(p.bottomX);
  const by = parseSlabRebar(p.bottomY);
  const tx = p.topX ? parseSlabRebar(p.topX) : null;
  const ty = p.topY ? parseSlabRebar(p.topY) : null;
  const anchors = resolveSlabAnchors(p);
  const items: CalcItem[] = [];
  let total = 0;

  // ── 底筋 (按支座类型区分锚固) ──
  const bxLa = calcLa(bx.grade, bx.diameter, p.concreteGrade);
  const bxDetail = slabBottomAnchorDetail(p.supportType, bx.diameter, bxLa);
  const bxStandardAnchor = anchors.bottomX.standard;
  const bxCount = Math.ceil(slabD / bx.spacing);
  const bxLenMm = anchors.useManual
    ? slabW + anchors.bottomX.start + anchors.bottomX.end
    : slabW + 2 * bxStandardAnchor;
  const bxLen = bxLenMm / 1000;
  const bxW = bxCount * bxLen * w(bx.diameter);
  const supportLabel = p.supportType === 'simple' ? '简支' : p.supportType === 'continuous' ? '连续' : '悬挑';
  const bxFormula: FormulaStep[] = [
    ...(anchors.useManual
      ? [
          { label: '锚固方式', formula: '人工分别输入', substitution: '', result: `起点端${anchors.bottomX.start}mm，终点端${anchors.bottomX.end}mm` },
        ]
      : [
          { label: `锚固 (${supportLabel})`, formula: bxDetail.bend > 0 ? '直段+弯折' : '直段伸入', substitution: bxDetail.bend > 0 ? `= ${bxDetail.straight} + ${bxDetail.bend}` : `= ${bxDetail.straight}`, result: `= ${bxStandardAnchor} mm` },
          { label: '锚固说明', formula: '22G101', substitution: '', result: bxDetail.description },
        ]),
    { label: '根数', formula: 'n = ⌈D / s⌉', substitution: `= ⌈${slabD} / ${bx.spacing}⌉`, result: `= ${bxCount}` },
    ...(anchors.useManual
      ? [
          { label: '单根长度', formula: 'L = W + anc起点 + anc终点', substitution: `= ${slabW} + ${anchors.bottomX.start} + ${anchors.bottomX.end}`, result: `= ${bxLenMm} mm = ${bxLen.toFixed(3)} m` },
        ]
      : [
          { label: '单根长度', formula: 'L = W + 2×anc', substitution: `= ${slabW} + 2×${bxStandardAnchor}`, result: `= ${bxLenMm} mm = ${bxLen.toFixed(2)} m` },
        ]),
    weightSteps('X向底筋', bxCount, bxLen, bx.diameter),
  ];
  items.push({
    name: 'X向底筋', spec: p.bottomX,
    length: anchors.useManual
      ? `${bxLen.toFixed(3)}m × ${bxCount}（起点锚${anchors.bottomX.start}mm，终点锚${anchors.bottomX.end}mm）`
      : `${bxLen.toFixed(2)}m × ${bxCount} (${supportLabel}锚${bxStandardAnchor}mm×2)`,
    weight: `${bxW.toFixed(2)} kg`, color: '#C0392B',
    grade: bx.grade, diameter: bx.diameter, count: bxCount, lengthM: bxLen, weightKg: bxW,
    formulaSteps: bxFormula,
  });
  total += bxW;

  const byLa = calcLa(by.grade, by.diameter, p.concreteGrade);
  const byDetail = slabBottomAnchorDetail(p.supportType, by.diameter, byLa);
  const byStandardAnchor = anchors.bottomY.standard;
  const byCount = Math.ceil(slabW / by.spacing);
  const byLenMm = anchors.useManual
    ? slabD + anchors.bottomY.start + anchors.bottomY.end
    : slabD + 2 * byStandardAnchor;
  const byLen = byLenMm / 1000;
  const byW = byCount * byLen * w(by.diameter);
  const byFormula: FormulaStep[] = [
    ...(anchors.useManual
      ? [
          { label: '锚固方式', formula: '人工分别输入', substitution: '', result: `起点端${anchors.bottomY.start}mm，终点端${anchors.bottomY.end}mm` },
        ]
      : [
          { label: `锚固 (${supportLabel})`, formula: byDetail.bend > 0 ? '直段+弯折' : '直段伸入', substitution: byDetail.bend > 0 ? `= ${byDetail.straight} + ${byDetail.bend}` : `= ${byDetail.straight}`, result: `= ${byStandardAnchor} mm` },
          { label: '锚固说明', formula: '22G101', substitution: '', result: byDetail.description },
        ]),
    { label: '根数', formula: 'n = ⌈W / s⌉', substitution: `= ⌈${slabW} / ${by.spacing}⌉`, result: `= ${byCount}` },
    ...(anchors.useManual
      ? [
          { label: '单根长度', formula: 'L = D + anc起点 + anc终点', substitution: `= ${slabD} + ${anchors.bottomY.start} + ${anchors.bottomY.end}`, result: `= ${byLenMm} mm = ${byLen.toFixed(3)} m` },
        ]
      : [
          { label: '单根长度', formula: 'L = D + 2×anc', substitution: `= ${slabD} + 2×${byStandardAnchor}`, result: `= ${byLenMm} mm = ${byLen.toFixed(2)} m` },
        ]),
    weightSteps('Y向底筋', byCount, byLen, by.diameter),
  ];
  items.push({
    name: 'Y向底筋', spec: p.bottomY,
    length: anchors.useManual
      ? `${byLen.toFixed(3)}m × ${byCount}（起点锚${anchors.bottomY.start}mm，终点锚${anchors.bottomY.end}mm）`
      : `${byLen.toFixed(2)}m × ${byCount} (${supportLabel}锚${byStandardAnchor}mm×2)`,
    weight: `${byW.toFixed(2)} kg`, color: '#E67E22',
    grade: by.grade, diameter: by.diameter, count: byCount, lengthM: byLen, weightKg: byW,
    formulaSteps: byFormula,
  });
  total += byW;

  // ── 面筋 (含锚入支座) ──
  // 面筋伸入支座: 连续板 ≥ la, 简支板 ≥ la/2, 悬挑板全长
  if (tx) {
    const txStandardAnchor = anchors.topX.standard;
    const txCount = Math.ceil(slabD / tx.spacing);
    const txLenMm = anchors.useManual
      ? slabW + anchors.topX.start + anchors.topX.end
      : slabW + 2 * txStandardAnchor;
    const txLen = txLenMm / 1000;
    const txW = txCount * txLen * w(tx.diameter);
    const txFormula: FormulaStep[] = [
      ...(anchors.useManual
        ? [
            { label: '锚固方式', formula: '人工分别输入', substitution: '', result: `起点端${anchors.topX.start}mm，终点端${anchors.topX.end}mm` },
          ]
        : [
            { label: `面筋锚固 (${supportLabel})`, formula: p.supportType === 'continuous' ? 'anc = la' : 'anc = la/2', substitution: p.supportType === 'cantilever' ? '悬挑端无锚固' : `= ${txStandardAnchor}`, result: `= ${txStandardAnchor} mm` },
          ]),
      { label: '根数', formula: 'n = ⌈D / s⌉', substitution: `= ⌈${slabD} / ${tx.spacing}⌉`, result: `= ${txCount}` },
      ...(anchors.useManual
        ? [
            { label: '单根长度', formula: 'L = W + anc起点 + anc终点', substitution: `= ${slabW} + ${anchors.topX.start} + ${anchors.topX.end}`, result: `= ${txLenMm} mm = ${txLen.toFixed(3)} m` },
          ]
        : [
            { label: '单根长度', formula: 'L = W + 2×anc', substitution: `= ${slabW} + 2×${txStandardAnchor}`, result: `= ${txLenMm} mm = ${txLen.toFixed(2)} m` },
          ]),
      weightSteps('X向面筋', txCount, txLen, tx.diameter),
    ];
    const txLengthDesc = anchors.useManual
      ? `${txLen.toFixed(3)}m × ${txCount}（起点锚${anchors.topX.start}mm，终点锚${anchors.topX.end}mm）`
      : `${txLen.toFixed(2)}m × ${txCount}${txStandardAnchor > 0 ? ` (含锚${txStandardAnchor}mm×2)` : ''}`;
    items.push({ name: 'X向面筋', spec: p.topX, length: txLengthDesc, weight: `${txW.toFixed(2)} kg`, color: '#8E44AD',
      grade: tx.grade, diameter: tx.diameter, count: txCount, lengthM: txLen, weightKg: txW, formulaSteps: txFormula });
    total += txW;
  }
  if (ty) {
    const tyStandardAnchor = anchors.topY.standard;
    const tyCount = Math.ceil(slabW / ty.spacing);
    const tyLenMm = anchors.useManual
      ? slabD + anchors.topY.start + anchors.topY.end
      : slabD + 2 * tyStandardAnchor;
    const tyLen = tyLenMm / 1000;
    const tyW = tyCount * tyLen * w(ty.diameter);
    const tyFormula: FormulaStep[] = [
      ...(anchors.useManual
        ? [
            { label: '锚固方式', formula: '人工分别输入', substitution: '', result: `起点端${anchors.topY.start}mm，终点端${anchors.topY.end}mm` },
          ]
        : [
            { label: `面筋锚固 (${supportLabel})`, formula: p.supportType === 'continuous' ? 'anc = la' : 'anc = la/2', substitution: p.supportType === 'cantilever' ? '悬挑端无锚固' : `= ${tyStandardAnchor}`, result: `= ${tyStandardAnchor} mm` },
          ]),
      { label: '根数', formula: 'n = ⌈W / s⌉', substitution: `= ⌈${slabW} / ${ty.spacing}⌉`, result: `= ${tyCount}` },
      ...(anchors.useManual
        ? [
            { label: '单根长度', formula: 'L = D + anc起点 + anc终点', substitution: `= ${slabD} + ${anchors.topY.start} + ${anchors.topY.end}`, result: `= ${tyLenMm} mm = ${tyLen.toFixed(3)} m` },
          ]
        : [
            { label: '单根长度', formula: 'L = D + 2×anc', substitution: `= ${slabD} + 2×${tyStandardAnchor}`, result: `= ${tyLenMm} mm = ${tyLen.toFixed(2)} m` },
          ]),
      weightSteps('Y向面筋', tyCount, tyLen, ty.diameter),
    ];
    const tyLengthDesc = anchors.useManual
      ? `${tyLen.toFixed(3)}m × ${tyCount}（起点锚${anchors.topY.start}mm，终点锚${anchors.topY.end}mm）`
      : `${tyLen.toFixed(2)}m × ${tyCount}${tyStandardAnchor > 0 ? ` (含锚${tyStandardAnchor}mm×2)` : ''}`;
    items.push({ name: 'Y向面筋', spec: p.topY, length: tyLengthDesc, weight: `${tyW.toFixed(2)} kg`, color: '#7D3C98',
      grade: ty.grade, diameter: ty.diameter, count: tyCount, lengthM: tyLen, weightKg: tyW, formulaSteps: tyFormula });
    total += tyW;
  }

  // ── 支座负筋 (22G101) ──
  // 简支板→端支座: 伸入ln/4 + 梁宽/2 + 弯折12d
  // 连续板→中间支座: 伸入ln/3(第一排) + 梁宽(直通) + 伸入另侧ln/3, 无弯折
  const negSupportPos = p.supportType === 'continuous' ? 'middle' as const : 'end' as const;
  const negPosLabel = negSupportPos === 'end' ? '端支座' : '中间支座';

  const negX = p.supportNegX ? parseSlabRebar(p.supportNegX) : null;
  if (negX) {
    const negXExtend = slabNegBarExtend(slabW, negSupportPos);
    const negXBend = negSupportPos === 'end' ? slabNegBarBend(negX.diameter) : 0;
    const negXBeamPart = negSupportPos === 'end' ? Math.ceil(p.supportBeamWidth / 2) : p.supportBeamWidth;
    // 端支座: 单侧 = extend + 梁宽/2 + 12d弯折, 两侧各一根
    // 中间支座: 整根 = extend(左) + 梁宽(直通) + extend(右)
    const negXSingleLen = negSupportPos === 'end'
      ? negXExtend + negXBeamPart + negXBend
      : negXExtend + negXBeamPart + negXExtend;
    const negXCount = negSupportPos === 'end'
      ? Math.ceil(slabD / negX.spacing) * 2  // 两侧各一根
      : Math.ceil(slabD / negX.spacing);      // 中间支座一根直通
    const negXLen = negXSingleLen / 1000;
    const negXW = negXCount * negXLen * w(negX.diameter);
    const extendFormula = negSupportPos === 'end' ? 'ln/4' : 'ln/3';
    const negXFormula: FormulaStep[] = [
      { label: `伸入跨中 (${negPosLabel})`, formula: extendFormula, substitution: `= ${slabW}/${negSupportPos === 'end' ? 4 : 3}`, result: `= ${negXExtend} mm` },
      { label: '支座段', formula: negSupportPos === 'end' ? '梁宽/2' : '梁宽(直通)', substitution: `= ${negXBeamPart}`, result: `= ${negXBeamPart} mm` },
      ...(negXBend > 0 ? [{ label: '端部弯折', formula: '12d', substitution: `= 12×${negX.diameter}`, result: `= ${negXBend} mm` }] : []),
      { label: '单根长度', formula: negSupportPos === 'end' ? `L = ${extendFormula} + 梁宽/2 + 12d` : `L = ${extendFormula}×2 + 梁宽`, substitution: negSupportPos === 'end' ? `= ${negXExtend} + ${negXBeamPart} + ${negXBend}` : `= ${negXExtend}×2 + ${negXBeamPart}`, result: `= ${negXSingleLen} mm = ${negXLen.toFixed(3)} m` },
      { label: '根数', formula: negSupportPos === 'end' ? 'n = ⌈D/s⌉ × 2(两侧)' : 'n = ⌈D/s⌉(直通)', substitution: negSupportPos === 'end' ? `= ⌈${slabD}/${negX.spacing}⌉ × 2` : `= ⌈${slabD}/${negX.spacing}⌉`, result: `= ${negXCount}` },
      weightSteps('X向支座负筋', negXCount, negXLen, negX.diameter),
    ];
    const negXLenDesc = negSupportPos === 'end'
      ? `${negXLen.toFixed(3)}m × ${negXCount} (两侧, 含弯折${negXBend}mm)`
      : `${negXLen.toFixed(3)}m × ${negXCount} (直通过支座)`;
    items.push({ name: 'X向支座负筋', spec: p.supportNegX!, length: negXLenDesc, weight: `${negXW.toFixed(2)} kg`, color: '#2980B9',
      grade: negX.grade, diameter: negX.diameter, count: negXCount, lengthM: negXLen, weightKg: negXW, formulaSteps: negXFormula });
    total += negXW;
  }

  const negY = p.supportNegY ? parseSlabRebar(p.supportNegY) : null;
  if (negY) {
    const negYExtend = slabNegBarExtend(slabD, negSupportPos);
    const negYBend = negSupportPos === 'end' ? slabNegBarBend(negY.diameter) : 0;
    const negYBeamPart = negSupportPos === 'end' ? Math.ceil(p.supportBeamWidth / 2) : p.supportBeamWidth;
    const negYSingleLen = negSupportPos === 'end'
      ? negYExtend + negYBeamPart + negYBend
      : negYExtend + negYBeamPart + negYExtend;
    const negYCount = negSupportPos === 'end'
      ? Math.ceil(slabW / negY.spacing) * 2
      : Math.ceil(slabW / negY.spacing);
    const negYLen = negYSingleLen / 1000;
    const negYW = negYCount * negYLen * w(negY.diameter);
    const extendFormulaY = negSupportPos === 'end' ? 'ln/4' : 'ln/3';
    const negYFormula: FormulaStep[] = [
      { label: `伸入跨中 (${negPosLabel})`, formula: extendFormulaY, substitution: `= ${slabD}/${negSupportPos === 'end' ? 4 : 3}`, result: `= ${negYExtend} mm` },
      { label: '支座段', formula: negSupportPos === 'end' ? '梁宽/2' : '梁宽(直通)', substitution: `= ${negYBeamPart}`, result: `= ${negYBeamPart} mm` },
      ...(negYBend > 0 ? [{ label: '端部弯折', formula: '12d', substitution: `= 12×${negY.diameter}`, result: `= ${negYBend} mm` }] : []),
      { label: '单根长度', formula: negSupportPos === 'end' ? `L = ${extendFormulaY} + 梁宽/2 + 12d` : `L = ${extendFormulaY}×2 + 梁宽`, substitution: negSupportPos === 'end' ? `= ${negYExtend} + ${negYBeamPart} + ${negYBend}` : `= ${negYExtend}×2 + ${negYBeamPart}`, result: `= ${negYSingleLen} mm = ${negYLen.toFixed(3)} m` },
      { label: '根数', formula: negSupportPos === 'end' ? 'n = ⌈W/s⌉ × 2(两侧)' : 'n = ⌈W/s⌉(直通)', substitution: negSupportPos === 'end' ? `= ⌈${slabW}/${negY.spacing}⌉ × 2` : `= ⌈${slabW}/${negY.spacing}⌉`, result: `= ${negYCount}` },
      weightSteps('Y向支座负筋', negYCount, negYLen, negY.diameter),
    ];
    const negYLenDesc = negSupportPos === 'end'
      ? `${negYLen.toFixed(3)}m × ${negYCount} (两侧, 含弯折${negYBend}mm)`
      : `${negYLen.toFixed(3)}m × ${negYCount} (直通过支座)`;
    items.push({ name: 'Y向支座负筋', spec: p.supportNegY!, length: negYLenDesc, weight: `${negYW.toFixed(2)} kg`, color: '#16A085',
      grade: negY.grade, diameter: negY.diameter, count: negYCount, lengthM: negYLen, weightKg: negYW, formulaSteps: negYFormula });
    total += negYW;
  }

  // ── 分布筋 ──
  // 分布筋垂直于受力筋方向，沿底筋方向铺设
  // 按两个方向底筋各配一层分布筋，长度取对应板跨，含搭接150mm
  if (p.distribution) {
    const dist = parseSlabRebar(p.distribution);
    const lapLen = 150; // 22G101 分布筋搭接 ≥150mm

    // 分布筋沿X底筋方向 (垂直于Y方向)
    const distXCount = Math.ceil(slabW / dist.spacing);
    const distXLen = (slabD + lapLen) / 1000;
    const distXW = distXCount * distXLen * w(dist.diameter);

    // 分布筋沿Y底筋方向 (垂直于X方向)
    const distYCount = Math.ceil(slabD / dist.spacing);
    const distYLen = (slabW + lapLen) / 1000;
    const distYW = distYCount * distYLen * w(dist.diameter);

    const distTotal = distXW + distYW;
    const distTotalCount = distXCount + distYCount;
    const distFormula: FormulaStep[] = [
      { label: '沿X方向分布筋', formula: 'n₁ = ⌈W/s⌉', substitution: `= ⌈${slabW}/${dist.spacing}⌉`, result: `= ${distXCount}根` },
      { label: '沿X方向单根长', formula: 'L₁ = D + lap', substitution: `= ${slabD} + ${lapLen}`, result: `= ${slabD + lapLen}mm = ${distXLen.toFixed(3)}m` },
      { label: '沿Y方向分布筋', formula: 'n₂ = ⌈D/s⌉', substitution: `= ⌈${slabD}/${dist.spacing}⌉`, result: `= ${distYCount}根` },
      { label: '沿Y方向单根长', formula: 'L₂ = W + lap', substitution: `= ${slabW} + ${lapLen}`, result: `= ${slabW + lapLen}mm = ${distYLen.toFixed(3)}m` },
      { label: '搭接长度', formula: 'lap ≥ 150mm (22G101)', substitution: `= ${lapLen}`, result: `= ${lapLen}mm` },
      weightSteps('分布筋合计', distTotalCount, (distXW + distYW) / (distTotalCount * w(dist.diameter)) > 0 ? (distXW + distYW) / (distTotalCount * w(dist.diameter)) : 0, dist.diameter),
    ];
    // Override last step with correct combined weight
    distFormula[distFormula.length - 1] = {
      label: '分布筋重量',
      formula: 'W = (n₁×L₁ + n₂×L₂) × w',
      substitution: `= (${distXCount}×${distXLen.toFixed(3)} + ${distYCount}×${distYLen.toFixed(3)}) × ${w(dist.diameter).toFixed(4)}`,
      result: `= ${distTotal.toFixed(2)} kg`,
    };
    items.push({ name: '分布筋', spec: p.distribution, length: `X向${distXCount}根×${distXLen.toFixed(3)}m + Y向${distYCount}根×${distYLen.toFixed(3)}m (含搭接${lapLen}mm)`, weight: `${distTotal.toFixed(2)} kg`, color: '#27AE60',
      grade: dist.grade, diameter: dist.diameter, count: distTotalCount, lengthM: (distXW + distYW) / (distTotalCount * w(dist.diameter)), weightKg: distTotal, formulaSteps: distFormula });
    total += distTotal;
  }

  return buildResult(items, total, 'slab');
}

export function calcShearWall(p: ShearWallParams): CalcResult {
  const vert = parseSlabRebar(p.vertBar);
  const horiz = parseSlabRebar(p.horizBar);
  const boundaryR = parseRebar(p.boundaryMain);
  const boundaryStir = parseStirrup(p.boundaryStirrup);
  const cover = p.cover || 20;
  const items: CalcItem[] = [];
  let total = 0;

  const vertCount = Math.ceil(p.lw / vert.spacing) * 2;
  const vertL = (p.hw + 500) / 1000;
  const vertW = vertCount * vertL * w(vert.diameter);
  const vertFormula: FormulaStep[] = [
    { label: '根数', formula: 'n = ⌈lw / s⌉ × 2(双排)', substitution: `= ⌈${p.lw} / ${vert.spacing}⌉ × 2`, result: `= ${vertCount}` },
    { label: '单根长度', formula: 'L = hw + 500(锚固)', substitution: `= ${p.hw} + 500`, result: `= ${p.hw + 500} mm = ${vertL.toFixed(2)} m` },
    weightSteps('竖向分布筋', vertCount, vertL, vert.diameter),
  ];
  items.push({ name: '竖向分布筋', spec: p.vertBar, length: `${vertL.toFixed(2)}m × ${vertCount}根 (双排)`, weight: `${vertW.toFixed(2)} kg`, color: '#C0392B',
    grade: vert.grade, diameter: vert.diameter, count: vertCount, lengthM: vertL, weightKg: vertW, formulaSteps: vertFormula });
  total += vertW;

  const horizCount = Math.ceil(p.hw / horiz.spacing) * 2;
  const horizL = (p.lw + 2 * 300) / 1000;
  const horizW = horizCount * horizL * w(horiz.diameter);
  const horizFormula: FormulaStep[] = [
    { label: '根数', formula: 'n = ⌈hw / s⌉ × 2(双排)', substitution: `= ⌈${p.hw} / ${horiz.spacing}⌉ × 2`, result: `= ${horizCount}` },
    { label: '单根长度', formula: 'L = lw + 2×300(锚固)', substitution: `= ${p.lw} + 2×300`, result: `= ${p.lw + 600} mm = ${horizL.toFixed(2)} m` },
    weightSteps('水平分布筋', horizCount, horizL, horiz.diameter),
  ];
  items.push({ name: '水平分布筋', spec: p.horizBar, length: `${horizL.toFixed(2)}m × ${horizCount}根 (双排)`, weight: `${horizW.toFixed(2)} kg`, color: '#2980B9',
    grade: horiz.grade, diameter: horiz.diameter, count: horizCount, lengthM: horizL, weightKg: horizW, formulaSteps: horizFormula });
  total += horizW;

  const boundaryLen = Math.max(p.bw, 400);
  const llE = calcLlE(boundaryR.grade, boundaryR.diameter, p.concreteGrade, p.seismicGrade);
  const boundaryL = (p.hw + llE) / 1000;
  const bCount2 = boundaryR.count * 2;
  const boundaryW = bCount2 * boundaryL * w(boundaryR.diameter);
  const boundaryFormula: FormulaStep[] = [
    ...anchorSteps(boundaryR.grade, boundaryR.diameter, p.concreteGrade, p.seismicGrade),
    { label: '抗震搭接长度 llE', formula: 'llE = ζl × laE', substitution: `= 1.4 × laE`, result: `= ${llE} mm` },
    { label: '单根长度', formula: 'L = hw + llE', substitution: `= ${p.hw} + ${llE}`, result: `= ${p.hw + llE} mm = ${boundaryL.toFixed(2)} m` },
    weightSteps('边缘纵筋', bCount2, boundaryL, boundaryR.diameter),
  ];
  items.push({ name: '边缘构件纵筋', spec: p.boundaryMain, length: `${boundaryL.toFixed(2)}m × ${bCount2}根 (两端)`, weight: `${boundaryW.toFixed(2)} kg`, color: '#8E44AD',
    grade: boundaryR.grade, diameter: boundaryR.diameter, count: bCount2, lengthM: boundaryL, weightKg: boundaryW, formulaSteps: boundaryFormula });
  total += boundaryW;

  const bStir = boundaryStir;
  const bPerim = 2 * (boundaryLen + p.bw - 2 * cover) / 1000;
  const bStirCount = Math.ceil(p.hw / bStir.spacingDense) * 2;
  const bStirW = bStirCount * bPerim * w(bStir.diameter);
  const bStirFormula: FormulaStep[] = [
    { label: '边缘构件尺寸', formula: 'l_boundary = max(bw, 400)', substitution: `= max(${p.bw}, 400)`, result: `= ${boundaryLen} mm` },
    { label: '箍筋周长', formula: 'C = 2×(l_boundary + bw - 2c)', substitution: `= 2×(${boundaryLen} + ${p.bw} - 2×${cover})`, result: `= ${(bPerim * 1000).toFixed(0)} mm` },
    { label: '根数', formula: 'n = ⌈hw / s⌉ × 2(两端)', substitution: `= ⌈${p.hw} / ${bStir.spacingDense}⌉ × 2`, result: `= ${bStirCount}` },
    weightSteps('边缘箍筋', bStirCount, bPerim, bStir.diameter),
  ];
  items.push({ name: '边缘构件箍筋', spec: p.boundaryStirrup, length: `${bStirCount}根 × ${bPerim.toFixed(2)}m (两端)`, weight: `${bStirW.toFixed(2)} kg`, color: '#27AE60',
    grade: bStir.grade, diameter: bStir.diameter, count: bStirCount, lengthM: bPerim, weightKg: bStirW, formulaSteps: bStirFormula });
  total += bStirW;

  // ── 拉结筋 (墙身双排分布筋之间的拉结) — GB50010 §11.7.12 ──
  if (p.tieBar) {
    const tie = parseSlabRebar(p.tieBar);
    // 拉结筋长度 = 墙厚 - 2×保护层 + 2×弯钩(max(6d, 50mm))
    const tieStraight = p.bw - 2 * cover;
    const tieHook = Math.max(6 * tie.diameter, 50);
    const tieSingleLen = (tieStraight + 2 * tieHook) / 1000;
    // 拉结筋数量: 竖向间距 × 水平间距 铺满墙身 (边缘构件区域除外)
    const wallBodyLen = Math.max(p.lw - 2 * boundaryLen, 0);
    const tieHorizCount = Math.max(Math.floor(wallBodyLen / tie.spacing), 1);
    const tieVertCount = Math.max(Math.floor(p.hw / tie.spacing), 1);
    const tieTotalCount = tieHorizCount * tieVertCount;
    const tieWt = tieTotalCount * tieSingleLen * w(tie.diameter);
    const tieFormula: FormulaStep[] = [
      { label: '拉结筋直段', formula: 'L_straight = bw - 2c', substitution: `= ${p.bw} - 2×${cover}`, result: `= ${tieStraight} mm` },
      { label: '弯钩长度', formula: 'hook = max(6d, 50)', substitution: `= max(6×${tie.diameter}, 50)`, result: `= ${tieHook} mm` },
      { label: '单根长度', formula: 'L = L_straight + 2×hook', substitution: `= ${tieStraight} + 2×${tieHook}`, result: `= ${tieStraight + 2 * tieHook} mm = ${tieSingleLen.toFixed(3)} m` },
      { label: '水平方向根数', formula: 'n_h = ⌊(lw - 2×l_boundary) / s⌋', substitution: `= ⌊(${p.lw} - 2×${boundaryLen}) / ${tie.spacing}⌋`, result: `= ${tieHorizCount}` },
      { label: '竖向根数', formula: 'n_v = ⌊hw / s⌋', substitution: `= ⌊${p.hw} / ${tie.spacing}⌋`, result: `= ${tieVertCount}` },
      { label: '总根数', formula: 'n = n_h × n_v', substitution: `= ${tieHorizCount} × ${tieVertCount}`, result: `= ${tieTotalCount}` },
      weightSteps('拉结筋', tieTotalCount, tieSingleLen, tie.diameter),
    ];
    items.push({ name: '拉结筋', spec: p.tieBar, length: `${tieSingleLen.toFixed(3)}m × ${tieTotalCount}根`,
      weight: `${tieWt.toFixed(2)} kg`, color: '#1ABC9C',
      grade: tie.grade, diameter: tie.diameter, count: tieTotalCount, lengthM: tieSingleLen, weightKg: tieWt, formulaSteps: tieFormula });
    total += tieWt;
  }

  return buildResult(items, total, 'shearwall');
}

// ═══════════════════════════════════════════════════════════════════
// 楼梯用量计算 (22G101-2 AT型)
// ═══════════════════════════════════════════════════════════════════

export function calcStair(p: StairParams): CalcResult {
  const botR = parseSlabRebar(p.bottomBar);
  const topR = parseSlabRebar(p.topBar);
  const distR = parseSlabRebar(p.distBar);
  const cover = p.cover || 15;

  const totalRise = p.stepCount * p.stepHeight;
  const totalRun = p.stepCount * p.stepWidth;
  const slopeLen = Math.sqrt(totalRise * totalRise + totalRun * totalRun); // 踏步段斜长
  const isBT = p.stairType === 'BT';
  const botFlatLen = isBT ? (p.botFlatLen ?? 700) : 0; // BT型低端平板长
  // BT型: 纵筋沿平板水平段 + 踏步段斜面
  const slabLen = isBT ? botFlatLen + slopeLen : slopeLen;
  const flightW = p.flightWidth;

  const items: CalcItem[] = [];
  let stairTotal = 0;

  function pushStair(name: string, spec: string, length: string, grade: string, diameter: number, count: number, lengthM: number, color: string, formulaSteps?: FormulaStep[]) {
    const weightKg = count * lengthM * w(diameter);
    const steps = formulaSteps ? [...formulaSteps, weightSteps(name, count, lengthM, diameter)] : [weightSteps(name, count, lengthM, diameter)];
    items.push({ name, spec, length, weight: `${weightKg.toFixed(2)} kg`, color, grade, diameter, count, lengthM, weightKg, formulaSteps: steps });
    stairTotal += weightKg;
  }

  // 下部纵筋
  const botAnc = isBT
    ? Math.max(p.beamB / 2, 5 * botR.diameter) // BT: 低端锚入梯梁 ≥b/2 且 ≥5d
    : Math.min(Math.round(p.botPlatformLen * 0.8), 300);
  const topAnc = Math.min(Math.round(p.topPlatformLen * 0.8), 300);
  const botBarLen = slabLen + botAnc + topAnc;
  const botBarLenM = botBarLen / 1000;
  const botBarCount = Math.floor((flightW - 2 * cover) / botR.spacing) + 1;
  const botFormula: FormulaStep[] = isBT ? [
    { label: '踏步段斜长', formula: 'L_slope = √(H² + B²)', substitution: `= √(${totalRise}² + ${totalRun}²)`, result: `= ${Math.round(slopeLen)} mm` },
    { label: '低端平板水平长', formula: 'L_flat', substitution: '', result: `= ${botFlatLen} mm` },
    { label: '低端锚固', formula: 'L_anc1 = max(b/2, 5d)', substitution: `= max(${p.beamB}/2, 5×${botR.diameter})`, result: `= ${Math.round(botAnc)} mm` },
    { label: '高端锚入', formula: 'L_anc2 = min(0.8×上平台, 300)', substitution: `= min(0.8×${p.topPlatformLen}, 300)`, result: `= ${topAnc} mm` },
    { label: '单根长度', formula: 'L = L_flat + L_slope + L_anc1 + L_anc2', substitution: `= ${botFlatLen} + ${Math.round(slopeLen)} + ${Math.round(botAnc)} + ${topAnc}`, result: `= ${Math.round(botBarLen)} mm = ${botBarLenM.toFixed(2)} m` },
    { label: '根数', formula: 'n = ⌊(w - 2c) / s⌋ + 1', substitution: `= ⌊(${flightW} - 2×${cover}) / ${botR.spacing}⌋ + 1`, result: `= ${botBarCount}` },
  ] : [
    { label: '梯板斜长', formula: 'L_slab = √(H² + B²)', substitution: `= √(${totalRise}² + ${totalRun}²)`, result: `= ${Math.round(slabLen)} mm` },
    { label: '两端锚入', formula: 'L_anc = min(0.8×下平台, 300) + min(0.8×上平台, 300)', substitution: `= ${botAnc} + ${topAnc}`, result: `= ${botAnc + topAnc} mm` },
    { label: '单根长度', formula: 'L = L_slab + L_anc', substitution: `= ${Math.round(slabLen)} + ${botAnc + topAnc}`, result: `= ${Math.round(botBarLen)} mm = ${botBarLenM.toFixed(2)} m` },
    { label: '根数', formula: 'n = ⌊(w - 2c) / s⌋ + 1', substitution: `= ⌊(${flightW} - 2×${cover}) / ${botR.spacing}⌋ + 1`, result: `= ${botBarCount}` },
  ];
  pushStair('下部纵筋', p.bottomBar, `${botBarLenM.toFixed(2)}m × ${botBarCount}根`,
    botR.grade, botR.diameter, botBarCount, botBarLenM, '#C0392B', botFormula);

  // 上部纵筋 (BT与AT类似，两端各一段负筋，ln/4处截断，弯钩15d)
  const topBarLen = isBT
    ? (botFlatLen + slopeLen) / 4 * 2 + (p.beamB - cover) * 2 + 15 * topR.diameter * 2  // 两端各一段
    : slabLen + botAnc + topAnc;
  const topBarLenM = (isBT
    ? ((botFlatLen + slopeLen) / 4 + (p.beamB - cover) + 15 * topR.diameter)
    : topBarLen) / 1000;
  const topBarCount = Math.floor((flightW - 2 * cover) / topR.spacing) + 1;
  const ln4 = Math.round((botFlatLen + slopeLen) / 4);
  const topAncLen = Math.round(p.beamB - cover);
  const topHookLen = 15 * topR.diameter;
  const topFormula: FormulaStep[] = isBT ? [
    { label: '梯板总长 ln', formula: 'ln = L_flat + L_slope', substitution: `= ${botFlatLen} + ${Math.round(slopeLen)}`, result: `= ${Math.round(botFlatLen + slopeLen)} mm` },
    { label: '板内延伸', formula: 'L_ext = ln/4', substitution: `= ${Math.round(botFlatLen + slopeLen)}/4`, result: `= ${ln4} mm` },
    { label: '锚入梯梁', formula: 'L_anc = b梁 - c', substitution: `= ${p.beamB} - ${cover}`, result: `= ${topAncLen} mm` },
    { label: '端部弯钩', formula: 'L_hook = 15d', substitution: `= 15×${topR.diameter}`, result: `= ${topHookLen} mm` },
    { label: '单段长度', formula: 'L_piece = L_ext + L_anc + L_hook', substitution: `= ${ln4} + ${topAncLen} + ${topHookLen}`, result: `= ${ln4 + topAncLen + topHookLen} mm = ${((ln4 + topAncLen + topHookLen) / 1000).toFixed(2)} m` },
    { label: '根数(两端各一段)', formula: 'n = 2 × ⌊(w - 2c) / s⌋ + 1', substitution: `= 2 × ⌊(${flightW} - 2×${cover}) / ${topR.spacing}⌋ + 1`, result: `= ${topBarCount * 2}` },
  ] : [
    { label: '单根长度', formula: '同下部纵筋路径', substitution: `= ${Math.round(slabLen)} + ${botAnc + topAnc}`, result: `= ${Math.round(topBarLen)} mm = ${topBarLenM.toFixed(2)} m` },
    { label: '根数', formula: 'n = ⌊(w - 2c) / s⌋ + 1', substitution: `= ⌊(${flightW} - 2×${cover}) / ${topR.spacing}⌋ + 1`, result: `= ${topBarCount}` },
  ];
  const topPieceLen = isBT ? (ln4 + topAncLen + topHookLen) / 1000 : topBarLenM;
  const topTotalCount = isBT ? topBarCount * 2 : topBarCount;
  pushStair('上部纵筋', p.topBar, isBT
    ? `${topPieceLen.toFixed(2)}m × ${topTotalCount}根 (两端各${topBarCount})`
    : `${topBarLenM.toFixed(2)}m × ${topBarCount}根`,
    topR.grade, topR.diameter, topTotalCount, topPieceLen, '#8E44AD', topFormula);

  // 分布筋 (沿斜面等间距，上下各一层；BT型还包含平板段)
  const distBarLen = flightW - 2 * cover;
  const distBarLenM = distBarLen / 1000;
  const distTotalSpan = isBT ? (botFlatLen + slopeLen) : slopeLen;
  const distCountPerLayer = Math.floor(distTotalSpan / distR.spacing);
  const distTotalCount = distCountPerLayer * 2;
  const distFormula: FormulaStep[] = [
    { label: '单根长度', formula: 'L = 梯段宽 - 2c', substitution: `= ${flightW} - 2×${cover}`, result: `= ${distBarLen} mm = ${distBarLenM.toFixed(2)} m` },
    { label: '每层根数', formula: isBT ? 'n = ⌊(L_flat+L_slope) / s⌋' : 'n = ⌊L_slab / s⌋', substitution: `= ⌊${Math.round(distTotalSpan)} / ${distR.spacing}⌋`, result: `= ${distCountPerLayer}` },
    { label: '总根数', formula: 'N = n × 2(上下两层)', substitution: `= ${distCountPerLayer} × 2`, result: `= ${distTotalCount}` },
  ];
  pushStair('分布筋', p.distBar, `${distBarLenM.toFixed(2)}m × ${distTotalCount}根 (上下各${distCountPerLayer})`,
    distR.grade, distR.diameter, distTotalCount, distBarLenM, '#27AE60', distFormula);

  return buildResult(items, stairTotal, 'stair');
}

// ═══════════════════════════════════════════════════════════════════
// 楼梯配筋率计算 (22G101-2 AT型)
// ═══════════════════════════════════════════════════════════════════

export interface StairRatioResult {
  bottom: RebarRatioResult;
  top: RebarRatioResult;
}

export function calcStairRebarRatios(p: StairParams): StairRatioResult {
  const botR = parseSlabRebar(p.bottomBar);
  const topR = parseSlabRebar(p.topBar);
  const cover = p.cover || 15;
  const b = p.flightWidth; // 梯段宽度作为截面宽度

  const ft = FT[p.concreteGrade] || 1.43;
  const fyBot = FY[botR.grade] || 360;
  const fyTop = FY[topR.grade] || 360;

  // 板类构件: As = (b - 2c) / s + 1 根 × πd²/4
  const botCount = Math.floor((b - 2 * cover) / botR.spacing) + 1;
  const topCount = Math.floor((b - 2 * cover) / topR.spacing) + 1;
  const AsBot = botCount * rebarArea(botR.diameter);
  const AsTop = topCount * rebarArea(topR.diameter);

  // h0 = slabThickness - cover - d/2
  const h0Bot = p.slabThickness - cover - botR.diameter / 2;
  const h0Top = p.slabThickness - cover - topR.diameter / 2;

  // ρ = As / (b × h0)  — 按1000mm宽度换算
  const rhoBot = AsBot / (b * h0Bot);
  const rhoTop = AsTop / (b * h0Top);

  // ρmin = max(0.2%, 0.45×ft/fy)
  const rhoMinBot = Math.max(0.002, 0.45 * ft / fyBot);
  const rhoMinTop = Math.max(0.002, 0.45 * ft / fyTop);
  const rhoMax = 0.025;

  function status(rho: number, rhoMin: number): 'ok' | 'low' | 'high' {
    if (rho < rhoMin) return 'low';
    if (rho > rhoMax) return 'high';
    return 'ok';
  }

  function ratioSteps(pos: string, count: number, d: number, fy: number, h0: number, As: number, rho: number, rhoMin: number, spacing: number): FormulaStep[] {
    return [
      { label: `${pos}钢筋根数`, formula: 'n = ⌊(b-2c)/s⌋+1', substitution: `= ⌊(${b}-2×${cover})/${spacing}⌋+1`, result: `= ${count}` },
      { label: `${pos}钢筋面积`, formula: 'As = n × π × d² / 4', substitution: `= ${count} × π × ${d}² / 4`, result: `= ${As.toFixed(0)} mm²` },
      { label: '有效高度', formula: 'h₀ = t - c - d/2', substitution: `= ${p.slabThickness} - ${cover} - ${d}/2`, result: `= ${h0.toFixed(0)} mm` },
      { label: '配筋率', formula: 'ρ = As / (b × h₀)', substitution: `= ${As.toFixed(0)} / (${b} × ${h0.toFixed(0)})`, result: `= ${(rho * 100).toFixed(3)}%` },
      { label: '最小配筋率', formula: 'ρmin = max(0.2%, 0.45ft/fy)', substitution: `= max(0.2%, 0.45×${ft}/${fy})`, result: `= ${(rhoMin * 100).toFixed(3)}%` },
    ];
  }

  return {
    bottom: { As: AsBot, h0: h0Bot, rho: rhoBot, rhoMin: rhoMinBot, rhoMax, status: status(rhoBot, rhoMinBot), formulaSteps: ratioSteps('下部', botCount, botR.diameter, fyBot, h0Bot, AsBot, rhoBot, rhoMinBot, botR.spacing) },
    top: { As: AsTop, h0: h0Top, rho: rhoTop, rhoMin: rhoMinTop, rhoMax, status: status(rhoTop, rhoMinTop), formulaSteps: ratioSteps('上部', topCount, topR.diameter, fyTop, h0Top, AsTop, rhoTop, rhoMinTop, topR.spacing) },
  };
}

// ═══════════════════════════════════════════════════════════════════
// 楼梯弯折详图数据 (22G101-2 AT型)
// ═══════════════════════════════════════════════════════════════════

export function calcStairBarShapes(p: StairParams): BarShape[] {
  const shapes: BarShape[] = [];
  const botR = parseSlabRebar(p.bottomBar);
  const topR = parseSlabRebar(p.topBar);
  const distR = parseSlabRebar(p.distBar);
  const cover = p.cover || 15;

  const totalRise = p.stepCount * p.stepHeight;
  const totalRun = p.stepCount * p.stepWidth;
  const slopeLen = Math.sqrt(totalRise * totalRise + totalRun * totalRun);
  const isBT = p.stairType === 'BT';
  const botFlatLen = isBT ? (p.botFlatLen ?? 700) : 0;
  const beamB = p.beamB;

  const cosA = totalRun / slopeLen;
  const bot5d = 5 * botR.diameter;

  const botBarCount = Math.floor((p.flightWidth - 2 * cover) / botR.spacing) + 1;
  const topBarCount = Math.floor((p.flightWidth - 2 * cover) / topR.spacing) + 1;

  if (isBT) {
    // ── BT型 ──
    // 下部纵筋: 水平平板段 + 斜面段 + 两端锚固
    // 低端锚固: 沿延长线伸入梯梁, max(b/2, 5d)
    const botAncHorizLow = Math.max(beamB / 2, bot5d);
    const botAncSlopeLow = Math.round(botAncHorizLow); // 低端是水平锚固
    // 高端锚固: 沿斜面延长线伸入梯梁
    const botAncHorizHigh = Math.max(beamB / 2, bot5d);
    const botAncSlopeHigh = Math.round(botAncHorizHigh / cosA);
    const botBodyLen = Math.round(botFlatLen + slopeLen);
    const botTotalLen = botBodyLen + botAncSlopeLow + botAncSlopeHigh;
    shapes.push({
      name: '下部纵筋', spec: p.bottomBar, shapeType: 'straight',
      count: botBarCount, color: '#C0392B',
      totalLen: botTotalLen, bodyLen: botBodyLen,
      anchorLen: Math.round((botAncSlopeLow + botAncSlopeHigh) / 2),
    });

    // 上部纵筋 (两端各一段)
    const ln = Math.round(botFlatLen + slopeLen);
    const topLn4 = Math.round(ln / 4);
    const topAncLen = Math.round(beamB - cover);
    const topHookLen = 15 * topR.diameter;
    const topPieceLen = topLn4 + topAncLen + topHookLen;
    shapes.push({
      name: '上部纵筋', spec: p.topBar, shapeType: 'bentAnchor',
      count: topBarCount * 2, color: '#8E44AD',
      totalLen: topPieceLen, anchorLen: topAncLen, bodyLen: topLn4, hookLen: topHookLen, bendDir: 'down',
    });

    // 分布筋
    const distLen = p.flightWidth - 2 * cover;
    const distCountPerLayer = Math.floor((botFlatLen + slopeLen) / distR.spacing);
    shapes.push({
      name: '分布筋', spec: p.distBar, shapeType: 'straight',
      count: distCountPerLayer * 2, color: '#27AE60',
      totalLen: distLen, bodyLen: distLen,
    });
  } else {
    // ── AT型 ──
    const botAncHoriz = Math.max(beamB / 2, bot5d);
    const botAncSlope = Math.round(botAncHoriz / cosA);
    const topAncSlope = Math.round((beamB - cover) / cosA);
    const topHook = 15 * topR.diameter;
    const topLn4 = Math.round(slopeLen / 4);
    const distCountPerLayer = Math.floor(slopeLen / distR.spacing);

    const botBodyLen = Math.round(slopeLen);
    const botTotalLen = botBodyLen + botAncSlope * 2;
    shapes.push({
      name: '下部纵筋', spec: p.bottomBar, shapeType: 'straight',
      count: botBarCount, color: '#C0392B',
      totalLen: botTotalLen, bodyLen: botBodyLen, anchorLen: botAncSlope,
    });

    const topPieceLen = topAncSlope + topLn4 + topHook;
    shapes.push({
      name: '上部纵筋', spec: p.topBar, shapeType: 'bentAnchor',
      count: topBarCount * 2, color: '#8E44AD',
      totalLen: topPieceLen, anchorLen: topAncSlope, bodyLen: topLn4, hookLen: topHook, bendDir: 'down',
    });

    const distLen = p.flightWidth - 2 * cover;
    shapes.push({
      name: '分布筋', spec: p.distBar, shapeType: 'straight',
      count: distCountPerLayer * 2, color: '#27AE60',
      totalLen: distLen, bodyLen: distLen,
    });
  }

  return shapes;
}

// ═══════════════════════════════════════════════════════════════════
// 条形基础 (TJ) — 钢筋用量计算
// ═══════════════════════════════════════════════════════════════════

export function calcStripFoundation(p: StripFoundationParams): CalcResult {
  const items: CalcItem[] = [];
  let total = 0;
  const cover = p.cover || 40;

  function push(
    name: string,
    spec: string,
    length: string,
    grade: string,
    diameter: number,
    count: number,
    lengthM: number,
    color: string,
    formulaSteps?: FormulaStep[],
  ) {
    const weightKg = count * lengthM * w(diameter);
    const steps = formulaSteps ? [...formulaSteps, weightSteps(name, count, lengthM, diameter)] : [weightSteps(name, count, lengthM, diameter)];
    items.push({ name, spec, length, weight: `${weightKg.toFixed(2)} kg`, color, grade, diameter, count, lengthM, weightKg, formulaSteps: steps });
    total += weightKg;
  }

  const bottom = parseSlabRebar(p.bottomBar);
  const dist = parseSlabRebar(p.distBar);

  const bottomLen = Math.max((p.width - 2 * cover) / 1000, 0);
  const bottomCount = Math.max(Math.floor((p.length - 2 * cover) / bottom.spacing) + 1, 1);
  push(
    '底部横向受力筋',
    p.bottomBar,
    `${bottomLen.toFixed(2)}m × ${bottomCount}`,
    bottom.grade,
    bottom.diameter,
    bottomCount,
    bottomLen,
    '#C0392B',
    [
      { label: '单根长度', formula: 'L = b - 2c', substitution: `= ${p.width} - 2×${cover}`, result: `= ${Math.max(p.width - 2 * cover, 0)} mm` },
      { label: '根数', formula: 'n = (l - 2c) / s + 1', substitution: `= (${p.length} - 2×${cover}) / ${bottom.spacing} + 1`, result: `= ${bottomCount}` },
    ],
  );

  const distLen = Math.max((p.length - 2 * cover) / 1000, 0);
  const distCount = Math.max(Math.floor((p.width - 2 * cover) / dist.spacing) + 1, 1);
  push(
    '底部分布筋',
    p.distBar,
    `${distLen.toFixed(2)}m × ${distCount}`,
    dist.grade,
    dist.diameter,
    distCount,
    distLen,
    '#2980B9',
    [
      { label: '单根长度', formula: 'L = l - 2c', substitution: `= ${p.length} - 2×${cover}`, result: `= ${Math.max(p.length - 2 * cover, 0)} mm` },
      { label: '根数', formula: 'n = (b - 2c) / s + 1', substitution: `= (${p.width} - 2×${cover}) / ${dist.spacing} + 1`, result: `= ${distCount}` },
    ],
  );

  const clearGap = p.supportCount === 2 && p.supportSpacing
    ? Math.max(p.supportSpacing - p.supportWidth, 0)
    : 0;

  if (p.supportCount === 2 && p.topBar && clearGap > 0) {
    const top = parseSlabRebar(p.topBar);
    const topLen = Math.max(clearGap / 1000, 0);
    const topCount = Math.max(Math.floor((p.length - 2 * cover) / top.spacing) + 1, 1);
    push(
      '顶部横向受力筋',
      p.topBar,
      `${topLen.toFixed(2)}m × ${topCount}`,
      top.grade,
      top.diameter,
      topCount,
      topLen,
      '#E67E22',
      [
        { label: '净跨长度（两梁/两墙内边间）', formula: 'L = s - bw', substitution: `= ${p.supportSpacing} - ${p.supportWidth}`, result: `= ${clearGap} mm` },
        { label: '根数', formula: 'n = (l - 2c) / s + 1', substitution: `= (${p.length} - 2×${cover}) / ${top.spacing} + 1`, result: `= ${topCount}` },
      ],
    );
  }

  if (p.supportCount === 2 && p.topDistBar && clearGap > 0) {
    const topDist = parseSlabRebar(p.topDistBar);
    const topDistLen = Math.max((p.length - 2 * cover) / 1000, 0);
    const topDistCount = Math.max(Math.floor(clearGap / topDist.spacing) + 1, 1);
    push(
      '顶部分布筋',
      p.topDistBar,
      `${topDistLen.toFixed(2)}m × ${topDistCount}`,
      topDist.grade,
      topDist.diameter,
      topDistCount,
      topDistLen,
      '#27AE60',
      [
        { label: '单根长度', formula: 'L = l - 2c', substitution: `= ${p.length} - 2×${cover}`, result: `= ${Math.max(p.length - 2 * cover, 0)} mm` },
        { label: '根数（梁/墙间区域）', formula: 'n = 净跨 / s + 1', substitution: `= ${clearGap} / ${topDist.spacing} + 1`, result: `= ${topDistCount}` },
      ],
    );
  }

  if (p.supportType === 'beam' && p.jlBottom) {
    const jlBottom = parseRebar(p.jlBottom);
    const jlBottomLen = Math.max((p.length - 2 * cover) / 1000, 0);
    push(
      'JL底部纵筋',
      p.jlBottom,
      `${jlBottomLen.toFixed(2)}m × ${jlBottom.count * p.supportCount}`,
      jlBottom.grade,
      jlBottom.diameter,
      jlBottom.count * p.supportCount,
      jlBottomLen,
      '#8B4513',
      [
        { label: '单根长度', formula: 'L = l - 2c', substitution: `= ${p.length} - 2×${cover}`, result: `= ${Math.max(p.length - 2 * cover, 0)} mm` },
        { label: '总根数', formula: 'n = 每道梁纵筋根数 × 梁道数', substitution: `= ${jlBottom.count} × ${p.supportCount}`, result: `= ${jlBottom.count * p.supportCount}` },
      ],
    );
  }

  if (p.supportType === 'beam' && p.jlTop) {
    const jlTop = parseRebar(p.jlTop);
    const jlTopLen = Math.max((p.length - 2 * cover) / 1000, 0);
    push(
      'JL顶部纵筋',
      p.jlTop,
      `${jlTopLen.toFixed(2)}m × ${jlTop.count * p.supportCount}`,
      jlTop.grade,
      jlTop.diameter,
      jlTop.count * p.supportCount,
      jlTopLen,
      '#C97B36',
      [
        { label: '单根长度', formula: 'L = l - 2c', substitution: `= ${p.length} - 2×${cover}`, result: `= ${Math.max(p.length - 2 * cover, 0)} mm` },
        { label: '总根数', formula: 'n = 每道梁纵筋根数 × 梁道数', substitution: `= ${jlTop.count} × ${p.supportCount}`, result: `= ${jlTop.count * p.supportCount}` },
      ],
    );
  }

  if (p.supportType === 'beam' && p.jlStirrup) {
    const stir = parseStirrup(p.jlStirrup);
    const stirrupCountPerBeam = Math.max(Math.floor((p.length - 2 * cover) / Math.min(stir.spacingDense, stir.spacingNormal)) + 1, 2);
    const stirrupPerimeter = (2 * (p.supportWidth - 2 * cover) + 2 * (p.supportHeight - 2 * cover)) / 1000;
    push(
      'JL箍筋',
      p.jlStirrup,
      `${stirrupPerimeter.toFixed(2)}m × ${stirrupCountPerBeam * p.supportCount}`,
      stir.grade,
      stir.diameter,
      stirrupCountPerBeam * p.supportCount,
      Math.max(stirrupPerimeter, 0),
      '#2E8B57',
      [
        { label: '单个箍筋长度(简化)', formula: 'L ≈ 2(b-2c) + 2(h-2c)', substitution: `= 2×(${p.supportWidth}-${2 * cover}) + 2×(${p.supportHeight}-${2 * cover})`, result: `= ${Math.max((2 * (p.supportWidth - 2 * cover) + 2 * (p.supportHeight - 2 * cover)), 0)} mm` },
        { label: '总个数', formula: 'n = 每道梁箍筋个数 × 梁道数', substitution: `= ${stirrupCountPerBeam} × ${p.supportCount}`, result: `= ${stirrupCountPerBeam * p.supportCount}` },
      ],
    );
  }

  if (p.hasJcl && p.jclCount && p.jclCount > 0) {
    if (p.jclBottom) {
      const jclBottom = parseRebar(p.jclBottom);
      const jclLen = Math.max((p.width - 2 * cover) / 1000, 0);
      push(
        'JCL底部纵筋',
        p.jclBottom,
        `${jclLen.toFixed(2)}m × ${jclBottom.count * p.jclCount}`,
        jclBottom.grade,
        jclBottom.diameter,
        jclBottom.count * p.jclCount,
        jclLen,
        '#6B3F2A',
        [
          { label: '单根长度', formula: 'L = b - 2c', substitution: `= ${p.width} - 2×${cover}`, result: `= ${Math.max(p.width - 2 * cover, 0)} mm` },
          { label: '总根数', formula: 'n = 每道次梁纵筋根数 × 次梁道数', substitution: `= ${jclBottom.count} × ${p.jclCount}`, result: `= ${jclBottom.count * p.jclCount}` },
        ],
      );
    }
    if (p.jclTop) {
      const jclTop = parseRebar(p.jclTop);
      const jclLen = Math.max((p.width - 2 * cover) / 1000, 0);
      push(
        'JCL顶部纵筋',
        p.jclTop,
        `${jclLen.toFixed(2)}m × ${jclTop.count * p.jclCount}`,
        jclTop.grade,
        jclTop.diameter,
        jclTop.count * p.jclCount,
        jclLen,
        '#B66A2B',
        [
          { label: '单根长度', formula: 'L = b - 2c', substitution: `= ${p.width} - 2×${cover}`, result: `= ${Math.max(p.width - 2 * cover, 0)} mm` },
          { label: '总根数', formula: 'n = 每道次梁纵筋根数 × 次梁道数', substitution: `= ${jclTop.count} × ${p.jclCount}`, result: `= ${jclTop.count * p.jclCount}` },
        ],
      );
    }
    if (p.jclStirrup && p.jclB && p.jclH) {
      const stir = parseStirrup(p.jclStirrup);
      const stirrupCountPerBeam = Math.max(Math.floor((p.width - 2 * cover) / Math.min(stir.spacingDense, stir.spacingNormal)) + 1, 2);
      const stirrupPerimeter = (2 * (p.jclB - 2 * cover) + 2 * (p.jclH - 2 * cover)) / 1000;
      push(
        'JCL箍筋',
        p.jclStirrup,
        `${stirrupPerimeter.toFixed(2)}m × ${stirrupCountPerBeam * p.jclCount}`,
        stir.grade,
        stir.diameter,
        stirrupCountPerBeam * p.jclCount,
        Math.max(stirrupPerimeter, 0),
        '#3B8F6A',
        [
          { label: '单个箍筋长度(简化)', formula: 'L ≈ 2(b-2c) + 2(h-2c)', substitution: `= 2×(${p.jclB}-${2 * cover}) + 2×(${p.jclH}-${2 * cover})`, result: `= ${Math.max((2 * (p.jclB - 2 * cover) + 2 * (p.jclH - 2 * cover)), 0)} mm` },
          { label: '总个数', formula: 'n = 每道次梁箍筋个数 × 次梁道数', substitution: `= ${stirrupCountPerBeam} × ${p.jclCount}`, result: `= ${stirrupCountPerBeam * p.jclCount}` },
        ],
      );
    }
  }

  return buildResult(items, total, 'stripfoundation');
}

// ═══════════════════════════════════════════════════════════════════
// 独立基础 (DJ) — 钢筋用量计算
// ═══════════════════════════════════════════════════════════════════

export function calcFoundation(p: FoundationParams): CalcResult {
  const items: CalcItem[] = [];
  let total = 0;
  const cover = p.cover || 40;

  function push(name: string, spec: string, length: string, grade: string, diameter: number, count: number, lengthM: number, color: string, formulaSteps?: FormulaStep[]) {
    const weightKg = count * lengthM * w(diameter);
    const steps = formulaSteps ? [...formulaSteps, weightSteps(name, count, lengthM, diameter)] : [weightSteps(name, count, lengthM, diameter)];
    items.push({ name, spec, length, weight: `${weightKg.toFixed(2)} kg`, color, grade, diameter, count, lengthM, weightKg, formulaSteps: steps });
    total += weightKg;
  }

  // X 向底筋: 沿 Y 向铺设，长度 = by - 2*cover
  const barX = parseSlabRebar(p.bottomBarX);
  const barXLen = (p.by - 2 * cover) / 1000;
  const barXCount = Math.floor((p.bx - 2 * cover) / barX.spacing) + 1;
  const barXFormula: FormulaStep[] = [
    { label: '单根长度', formula: 'L = by - 2c', substitution: `= ${p.by} - 2×${cover}`, result: `= ${p.by - 2 * cover} mm` },
    { label: '根数', formula: 'n = (bx - 2c) / s + 1', substitution: `= (${p.bx} - 2×${cover}) / ${barX.spacing} + 1`, result: `= ${barXCount}` },
  ];
  push('X向底筋', p.bottomBarX, `${barXLen.toFixed(2)}m × ${barXCount}`,
    barX.grade, barX.diameter, barXCount, barXLen, '#C0392B', barXFormula);

  // Y 向底筋: 沿 X 向铺设，长度 = bx - 2*cover
  const barY = parseSlabRebar(p.bottomBarY);
  const barYLen = (p.bx - 2 * cover) / 1000;
  const barYCount = Math.floor((p.by - 2 * cover) / barY.spacing) + 1;
  const barYFormula: FormulaStep[] = [
    { label: '单根长度', formula: 'L = bx - 2c', substitution: `= ${p.bx} - 2×${cover}`, result: `= ${p.bx - 2 * cover} mm` },
    { label: '根数', formula: 'n = (by - 2c) / s + 1', substitution: `= (${p.by} - 2×${cover}) / ${barY.spacing} + 1`, result: `= ${barYCount}` },
  ];
  push('Y向底筋', p.bottomBarY, `${barYLen.toFixed(2)}m × ${barYCount}`,
    barY.grade, barY.diameter, barYCount, barYLen, '#2980B9', barYFormula);

  // 柱插筋: 按 22G101-3 判定直锚/弯锚
  if (p.colMain) {
    const colR = parseRebar(p.colMain);
    const colCount = (p.columnCount || 1);
    const fSeismic = p.seismicGrade || '非抗震';
    const fLaE = calcLaE(colR.grade, colR.diameter, p.concreteGrade, fSeismic);
    const fAnchor = determineColFoundAnchor(p.h, cover, colR.diameter, fLaE);
    const fLlE = calcLlE(colR.grade, colR.diameter, p.concreteGrade, fSeismic);
    const fAnchorInFound = fAnchor.canStraight
      ? p.h - cover
      : fAnchor.straightPortion + fAnchor.bendLength;
    const insertLen = (fAnchorInFound + fLlE) / 1000;
    const colFormula: FormulaStep[] = [
      { label: '锚固判定', formula: fAnchor.canStraight ? '可用深度 ≥ laE → 直锚' : '可用深度 < laE → 弯锚',
        substitution: `可用=${p.h - cover}mm, laE=${fLaE}mm`, result: `→ ${fAnchor.anchorType === 'straight' ? '直锚' : '弯锚'} (场景${fAnchor.scenario})` },
      { label: '基础内锚固段', formula: fAnchor.canStraight ? 'L = h - c' : 'L = 直段 + 弯折',
        substitution: fAnchor.canStraight ? `= ${p.h} - ${cover}` : `= ${fAnchor.straightPortion} + ${fAnchor.bendLength}`,
        result: `= ${fAnchorInFound} mm` },
      { label: '搭接 llE', formula: 'llE = 1.4 × laE', substitution: `= 1.4 × ${fLaE}`, result: `= ${fLlE} mm` },
    ];
    if (colCount === 2) {
      colFormula.push({ label: '柱数', formula: 'n柱 = 2', substitution: '', result: `每柱${colR.count}根，共${colR.count * 2}根` });
    }
    push('柱插筋', p.colMain, `${insertLen.toFixed(2)}m × ${colR.count * colCount} (${fAnchor.anchorType === 'straight' ? '直锚' : '弯锚'})`,
      colR.grade, colR.diameter, colR.count * colCount, insertLen, '#8E44AD', colFormula);
  }

  // 双柱基础: 顶部柱间纵向受力钢筋 (22G101-3 p2-12)
  if ((p.columnCount || 1) === 2 && p.topBarX && p.colSpacing) {
    const topX = parseSlabRebar(p.topBarX);
    // 纵向受力钢筋: 沿 X 向铺设，长度 = 柱间距 + 2 * (柱外缘到基础边缘距离)
    const topXLen = (p.bx - 2 * cover) / 1000;
    const topXCount = Math.floor((p.by - 2 * cover) / topX.spacing) + 1;
    const topXFormula: FormulaStep[] = [
      { label: '单根长度', formula: 'L = bx - 2c', substitution: `= ${p.bx} - 2×${cover}`, result: `= ${p.bx - 2 * cover} mm` },
      { label: '根数', formula: 'n = (by - 2c) / s + 1', substitution: `= (${p.by} - 2×${cover}) / ${topX.spacing} + 1`, result: `= ${topXCount}` },
    ];
    push('顶部纵向筋', p.topBarX, `${topXLen.toFixed(2)}m × ${topXCount}`,
      topX.grade, topX.diameter, topXCount, topXLen, '#E67E22', topXFormula);
  }

  // 双柱基础: 顶部柱间分布钢筋
  if ((p.columnCount || 1) === 2 && p.topBarY && p.colSpacing) {
    const topY = parseSlabRebar(p.topBarY);
    // 分布钢筋: 沿 Y 向铺设，长度 = by - 2*cover, 范围 = 柱间区域
    const topYLen = (p.by - 2 * cover) / 1000;
    const topYCount = Math.floor((p.colSpacing - p.colBx) / topY.spacing) + 1;
    const topYFormula: FormulaStep[] = [
      { label: '单根长度', formula: 'L = by - 2c', substitution: `= ${p.by} - 2×${cover}`, result: `= ${p.by - 2 * cover} mm` },
      { label: '根数(柱间区域)', formula: 'n = (s - colBx) / s间距 + 1', substitution: `= (${p.colSpacing} - ${p.colBx}) / ${topY.spacing} + 1`, result: `= ${topYCount}` },
    ];
    push('顶部分布筋', p.topBarY, `${topYLen.toFixed(2)}m × ${topYCount}`,
      topY.grade, topY.diameter, topYCount, topYLen, '#27AE60', topYFormula);
  }

  return buildResult(items, total, 'foundation');
}

// ═══════════════════════════════════════════════════════════════════
// 承台 (CT) — 钢筋用量计算
// ═══════════════════════════════════════════════════════════════════

export function calcPileCap(p: PileCapParams): CalcResult {
  const items: CalcItem[] = [];
  let total = 0;
  const cover = p.cover || 50;

  function pushItem(name: string, spec: string, length: string, grade: string, diameter: number, count: number, lengthM: number, color: string, formulaSteps?: FormulaStep[]) {
    const weightKg = count * lengthM * w(diameter);
    const steps = formulaSteps ? [...formulaSteps, weightSteps(name, count, lengthM, diameter)] : [weightSteps(name, count, lengthM, diameter)];
    items.push({ name, spec, length, weight: `${weightKg.toFixed(2)} kg`, color, grade, diameter, count, lengthM, weightKg, formulaSteps: steps });
    total += weightKg;
  }

  // X 向底筋: 沿 Y 向铺设，长度 = by - 2*cover
  const barX = parseSlabRebar(p.bottomBarX);
  const barXLen = (p.by - 2 * cover) / 1000;
  const barXCount = Math.floor((p.bx - 2 * cover) / barX.spacing) + 1;
  const barXFormula: FormulaStep[] = [
    { label: '单根长度', formula: 'L = by - 2c', substitution: `= ${p.by} - 2×${cover}`, result: `= ${p.by - 2 * cover} mm` },
    { label: '根数', formula: 'n = (bx - 2c) / s + 1', substitution: `= (${p.bx} - 2×${cover}) / ${barX.spacing} + 1`, result: `= ${barXCount}` },
  ];
  pushItem('X向底筋', p.bottomBarX, `${barXLen.toFixed(2)}m × ${barXCount}`,
    barX.grade, barX.diameter, barXCount, barXLen, '#C0392B', barXFormula);

  // Y 向底筋: 沿 X 向铺设，长度 = bx - 2*cover
  const barY = parseSlabRebar(p.bottomBarY);
  const barYLen = (p.bx - 2 * cover) / 1000;
  const barYCount = Math.floor((p.by - 2 * cover) / barY.spacing) + 1;
  const barYFormula: FormulaStep[] = [
    { label: '单根长度', formula: 'L = bx - 2c', substitution: `= ${p.bx} - 2×${cover}`, result: `= ${p.bx - 2 * cover} mm` },
    { label: '根数', formula: 'n = (by - 2c) / s + 1', substitution: `= (${p.by} - 2×${cover}) / ${barY.spacing} + 1`, result: `= ${barYCount}` },
  ];
  pushItem('Y向底筋', p.bottomBarY, `${barYLen.toFixed(2)}m × ${barYCount}`,
    barY.grade, barY.diameter, barYCount, barYLen, '#2980B9', barYFormula);

  // 柱插筋: 按 22G101-3 判定直锚/弯锚 — determineColFoundAnchor
  if (p.colMain) {
    const colR = parseRebar(p.colMain);
    const seismic = p.seismicGrade || '非抗震';
    const laE = calcLaE(colR.grade, colR.diameter, p.concreteGrade, seismic);
    const anchorInfo = determineColFoundAnchor(p.h, cover, colR.diameter, laE);
    // 总长 = 承台内锚固段 + 承台上方柱身搭接(llE)
    const llE = calcLlE(colR.grade, colR.diameter, p.concreteGrade, seismic);
    const anchorInCap = anchorInfo.canStraight
      ? p.h - cover                      // 直锚: 从顶面到底保护层
      : anchorInfo.straightPortion + anchorInfo.bendLength; // 弯锚: 直段+弯折
    const insertLen = (anchorInCap + llE) / 1000;
    const colFormula: FormulaStep[] = [
      ...anchorSteps(colR.grade, colR.diameter, p.concreteGrade, seismic),
      { label: '锚固判定', formula: anchorInfo.canStraight ? '可用深度 ≥ laE → 直锚' : '可用深度 < laE → 弯锚',
        substitution: `可用=${p.h - cover}mm, laE=${laE}mm`, result: `→ ${anchorInfo.anchorType === 'straight' ? '直锚' : '弯锚'} (场景${anchorInfo.scenario})` },
      { label: '承台内锚固段', formula: anchorInfo.canStraight ? 'L_cap = h - c' : 'L_cap = 直段 + 弯折',
        substitution: anchorInfo.canStraight ? `= ${p.h} - ${cover}` : `= ${anchorInfo.straightPortion} + ${anchorInfo.bendLength}`,
        result: `= ${anchorInCap} mm` },
      { label: '搭接长度 llE', formula: 'llE = ζl × laE', substitution: `= 1.4 × ${laE}`, result: `= ${llE} mm` },
      { label: '插筋总长', formula: 'L = L_cap + llE', substitution: `= ${anchorInCap} + ${llE}`, result: `= ${anchorInCap + llE} mm = ${insertLen.toFixed(2)} m` },
    ];
    pushItem('柱插筋', p.colMain, `${insertLen.toFixed(2)}m × ${colR.count} (${anchorInfo.anchorType === 'straight' ? '直锚' : '弯锚'})`,
      colR.grade, colR.diameter, colR.count, insertLen, '#8E44AD', colFormula);
  }

  return buildResult(items, total, 'pilecap');
}

// ═══════════════════════════════════════════════════════════════════
// 筏板基础 (FB) — 钢筋用量计算
// ═══════════════════════════════════════════════════════════════════

export function calcRaft(p: RaftFoundationParams): CalcResult {
  const items: CalcItem[] = [];
  let total = 0;
  const cover = p.cover || 40;

  function push(name: string, spec: string, length: string, grade: string, diameter: number, count: number, lengthM: number, color: string, formulaSteps?: FormulaStep[]) {
    const weightKg = count * lengthM * w(diameter);
    const steps = formulaSteps ? [...formulaSteps, weightSteps(name, count, lengthM, diameter)] : [weightSteps(name, count, lengthM, diameter)];
    items.push({ name, spec, length, weight: `${weightKg.toFixed(2)} kg`, color, grade, diameter, count, lengthM, weightKg, formulaSteps: steps });
    total += weightKg;
  }

  // X 向底筋: 沿 Y 向铺设，长度 = ly - 2*cover
  const botX = parseSlabRebar(p.bottomBarX);
  const botXLen = (p.ly - 2 * cover) / 1000;
  const botXCount = Math.floor((p.lx - 2 * cover) / botX.spacing) + 1;
  const botXFormula: FormulaStep[] = [
    { label: '单根长度', formula: 'L = ly - 2c', substitution: `= ${p.ly} - 2×${cover}`, result: `= ${p.ly - 2 * cover} mm` },
    { label: '根数', formula: 'n = (lx - 2c) / s + 1', substitution: `= (${p.lx} - 2×${cover}) / ${botX.spacing} + 1`, result: `= ${botXCount}` },
  ];
  push('X向底筋', p.bottomBarX, `${botXLen.toFixed(2)}m × ${botXCount}`,
    botX.grade, botX.diameter, botXCount, botXLen, '#C0392B', botXFormula);

  // Y 向底筋: 沿 X 向铺设，长度 = lx - 2*cover
  const botY = parseSlabRebar(p.bottomBarY);
  const botYLen = (p.lx - 2 * cover) / 1000;
  const botYCount = Math.floor((p.ly - 2 * cover) / botY.spacing) + 1;
  const botYFormula: FormulaStep[] = [
    { label: '单根长度', formula: 'L = lx - 2c', substitution: `= ${p.lx} - 2×${cover}`, result: `= ${p.lx - 2 * cover} mm` },
    { label: '根数', formula: 'n = (ly - 2c) / s + 1', substitution: `= (${p.ly} - 2×${cover}) / ${botY.spacing} + 1`, result: `= ${botYCount}` },
  ];
  push('Y向底筋', p.bottomBarY, `${botYLen.toFixed(2)}m × ${botYCount}`,
    botY.grade, botY.diameter, botYCount, botYLen, '#2980B9', botYFormula);

  // X 向面筋
  if (p.topBarX) {
    const topX = parseSlabRebar(p.topBarX);
    const topXLen = (p.ly - 2 * cover) / 1000;
    const topXCount = Math.floor((p.lx - 2 * cover) / topX.spacing) + 1;
    push('X向面筋', p.topBarX, `${topXLen.toFixed(2)}m × ${topXCount}`,
      topX.grade, topX.diameter, topXCount, topXLen, '#E67E22');
  }

  // Y 向面筋
  if (p.topBarY) {
    const topY = parseSlabRebar(p.topBarY);
    const topYLen = (p.lx - 2 * cover) / 1000;
    const topYCount = Math.floor((p.ly - 2 * cover) / topY.spacing) + 1;
    push('Y向面筋', p.topBarY, `${topYLen.toFixed(2)}m × ${topYCount}`,
      topY.grade, topY.diameter, topYCount, topYLen, '#27AE60');
  }

  // 柱插筋: 按 22G101-3 判定直锚/弯锚 (beamSlab 用 max(h, beamH))
  if (p.colMain) {
    const colR = parseRebar(p.colMain);
    const colTotal = p.colCountX * p.colCountY;
    const foundH = p.raftType === 'beamSlab' ? Math.max(p.h, p.beamH ?? 900) : p.h;
    const seismic = p.seismicGrade || '非抗震';
    const raftLaE = calcLaE(colR.grade, colR.diameter, p.concreteGrade, seismic);
    const raftAnchor = determineColFoundAnchor(foundH, cover, colR.diameter, raftLaE);
    const raftLlE = calcLlE(colR.grade, colR.diameter, p.concreteGrade, seismic);
    const raftAnchorInFound = raftAnchor.canStraight
      ? foundH - cover
      : raftAnchor.straightPortion + raftAnchor.bendLength;
    const insertLen = (raftAnchorInFound + raftLlE) / 1000;
    const colFormula: FormulaStep[] = [
      { label: '锚固判定', formula: raftAnchor.canStraight ? '可用深度 ≥ laE → 直锚' : '可用深度 < laE → 弯锚',
        substitution: `可用=${foundH - cover}mm, laE=${raftLaE}mm`, result: `→ ${raftAnchor.anchorType === 'straight' ? '直锚' : '弯锚'} (场景${raftAnchor.scenario})` },
      { label: '基础内锚固段', formula: raftAnchor.canStraight ? 'L = h - c' : 'L = 直段 + 弯折',
        substitution: raftAnchor.canStraight ? `= ${foundH} - ${cover}` : `= ${raftAnchor.straightPortion} + ${raftAnchor.bendLength}`,
        result: `= ${raftAnchorInFound} mm` },
      { label: '搭接 llE', formula: 'llE = 1.4 × laE', substitution: `= 1.4 × ${raftLaE}`, result: `= ${raftLlE} mm` },
      { label: '柱数', formula: 'n柱 = colCountX × colCountY', substitution: `= ${p.colCountX} × ${p.colCountY}`, result: `= ${colTotal}` },
    ];
    push('柱插筋', p.colMain, `${insertLen.toFixed(2)}m × ${colR.count * colTotal} (${raftAnchor.anchorType === 'straight' ? '直锚' : '弯锚'})`,
      colR.grade, colR.diameter, colR.count * colTotal, insertLen, '#8E44AD', colFormula);
  }

  // ── 梁板式筏基 JL 基础梁钢筋 ──
  if (p.raftType === 'beamSlab') {
    const beamH = p.beamH ?? 900;
    const beamB = p.beamB ?? 600;
    // X方向基础梁 (沿lx, 共colCountY道) + Y方向基础梁 (沿ly, 共colCountX道)
    const xBeamLen = p.lx / 1000;
    const yBeamLen = p.ly / 1000;
    const totalXBeams = p.colCountY;
    const totalYBeams = p.colCountX;

    if (p.beamBottom) {
      const bb = parseRebar(p.beamBottom);
      const botLen = xBeamLen;
      const botCount = bb.count * totalXBeams + bb.count * totalYBeams;
      push('JL底部纵筋 (B)', p.beamBottom,
        `${botLen.toFixed(2)}m × ${bb.count * totalXBeams} (X向) + ${yBeamLen.toFixed(2)}m × ${bb.count * totalYBeams} (Y向)`,
        bb.grade, bb.diameter,
        bb.count * totalXBeams,
        botLen, '#C0392B');
      // Y-direction bars
      push('JL底部纵筋 B (Y向)', p.beamBottom, `${yBeamLen.toFixed(2)}m × ${bb.count * totalYBeams}`,
        bb.grade, bb.diameter, bb.count * totalYBeams, yBeamLen, '#C0392B');
    }

    if (p.beamTop) {
      const bt = parseRebar(p.beamTop);
      push('JL顶部纵筋 T (X向)', p.beamTop, `${xBeamLen.toFixed(2)}m × ${bt.count * totalXBeams}`,
        bt.grade, bt.diameter, bt.count * totalXBeams, xBeamLen, '#E67E22');
      push('JL顶部纵筋 T (Y向)', p.beamTop, `${yBeamLen.toFixed(2)}m × ${bt.count * totalYBeams}`,
        bt.grade, bt.diameter, bt.count * totalYBeams, yBeamLen, '#E67E22');
    }

    if (p.beamStirrup) {
      const stir = parseStirrup(p.beamStirrup);
      const innerBJL = beamB - 2 * cover;
      const innerHJL = beamH - 2 * cover;
      const stirCutMm = stirrupCutLength(innerBJL, innerHJL, stir.diameter, stir.legs);
      const stirLenM = stirCutMm / 1000;
      // 加密区: max(2h, 500mm) from each column face — 22G101
      const jlDenseZone = beamDenseZoneLength(beamH);
      // X 向基础梁: 柱间距 = lx / (colCountX-1)，每跨加密区+非加密区
      const xSpanLen = p.colCountX > 1 ? p.lx / (p.colCountX - 1) : p.lx;
      const xDenseCount = Math.ceil((2 * jlDenseZone) / stir.spacingDense);
      const xNormalCount = Math.ceil(Math.max(xSpanLen - 2 * jlDenseZone, 0) / stir.spacingNormal);
      const xSpans = Math.max(p.colCountX - 1, 1);
      const xStirCount = totalXBeams * (xDenseCount + xNormalCount) * xSpans;
      const ySpanLen = p.colCountY > 1 ? p.ly / (p.colCountY - 1) : p.ly;
      const yDenseCount = Math.ceil((2 * jlDenseZone) / stir.spacingDense);
      const yNormalCount = Math.ceil(Math.max(ySpanLen - 2 * jlDenseZone, 0) / stir.spacingNormal);
      const ySpans = Math.max(p.colCountY - 1, 1);
      const yStirCount = totalYBeams * (yDenseCount + yNormalCount) * ySpans;
      const jlStirFormula: FormulaStep[] = [
        { label: '箍筋内净尺寸', formula: '内宽 = b梁-2c, 内高 = h梁-2c', substitution: `= ${beamB}-2×${cover}, ${beamH}-2×${cover}`, result: `= ${innerBJL}×${innerHJL} mm` },
        { label: '单根下料长度', formula: 'L = 2(b₀+h₀) + 2×hook + 4×1.75d', substitution: `含弯钩${stirrupHookLen(stir.diameter)}mm`, result: `= ${Math.round(stirCutMm)} mm = ${stirLenM.toFixed(3)} m` },
        { label: '加密区长度', formula: 'l_d = max(2h, 500)', substitution: `= max(2×${beamH}, 500)`, result: `= ${jlDenseZone} mm` },
        { label: 'X向每跨', formula: `密${xDenseCount} + 疏${xNormalCount} × ${xSpans}跨 × ${totalXBeams}道`, substitution: '', result: `= ${xStirCount}` },
        { label: 'Y向每跨', formula: `密${yDenseCount} + 疏${yNormalCount} × ${ySpans}跨 × ${totalYBeams}道`, substitution: '', result: `= ${yStirCount}` },
      ];
      push('JL箍筋 (X向)', p.beamStirrup, `${stirLenM.toFixed(3)}m × ${xStirCount} (密${xDenseCount}+疏${xNormalCount}/跨)`,
        stir.grade, stir.diameter, xStirCount, stirLenM, '#27AE60', jlStirFormula);
      push('JL箍筋 (Y向)', p.beamStirrup, `${stirLenM.toFixed(3)}m × ${yStirCount} (密${yDenseCount}+疏${yNormalCount}/跨)`,
        stir.grade, stir.diameter, yStirCount, stirLenM, '#27AE60');
    }
  }

  // ── 平板式筏基 ZXB 柱下板带附加钢筋 ──
  if (p.raftType === 'flatPlate' && p.colStripWidth) {
    if (p.colStripBarX) {
      const csX = parseSlabRebar(p.colStripBarX);
      // ZXB X向附加筋: 分布在Y列线的±colStripWidth/2带内，沿X向通长
      const csXLen = (p.lx - 2 * cover) / 1000;
      const stripZoneCount = Math.floor(p.colStripWidth / csX.spacing) + 1;
      const csXCount = p.colCountY * stripZoneCount;
      push('ZXB X向附加底筋', p.colStripBarX, `${csXLen.toFixed(2)}m × ${csXCount}`,
        csX.grade, csX.diameter, csXCount, csXLen, '#D35400');
    }
    if (p.colStripBarY) {
      const csY = parseSlabRebar(p.colStripBarY);
      const csYLen = (p.ly - 2 * cover) / 1000;
      const stripZoneCount = Math.floor(p.colStripWidth / csY.spacing) + 1;
      const csYCount = p.colCountX * stripZoneCount;
      push('ZXB Y向附加底筋', p.colStripBarY, `${csYLen.toFixed(2)}m × ${csYCount}`,
        csY.grade, csY.diameter, csYCount, csYLen, '#D35400');
    }
  }

  return buildResult(items, total, 'raft');
}
