import { parseRebar, parseRebarBottom, parseStirrup, parseSlabRebar, parseSideBar, parseTieBar, autoTieBar } from './rebar';
import { calcSupportRebarLength, calcLlE, calcSlabBottomAnchor, calcBeamEndAnchor, calcLa, FT, FY } from './anchor';
import { calcEffectiveDepth } from './layout';
import type { BeamParams, ColumnParams, SlabParams, ShearWallParams, StairParams, FoundationParams, PileCapParams, RaftFoundationParams } from './types';
import { rebarWeightPerM, beamDenseZoneLength, rebarArea, slabBottomAnchorDetail, slabNegBarExtend, slabNegBarBend } from './construction-rules';

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
  const la = Math.max(lab, 200, 10 * dia);
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
      formula: 'la = ζa × lab ≥ max(200, 10d)',
      substitution: `= 1.0 × ${lab}，≥ max(200, ${10 * dia})`,
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
  const la = Math.max(lab, 200, 10 * dia);
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
    substitution: `= ${count} × ${lengthM.toFixed(2)}m × ${unitW.toFixed(3)}kg/m`,
    result: `= ${total.toFixed(2)} kg`,
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
}

export function calcBeam(p: BeamParams): CalcResult {
  const top = parseRebar(p.top);
  const bot = parseRebarBottom(p.bottom);
  const stir = parseStirrup(p.stirrup);
  const leftR = p.leftSupport ? parseRebar(p.leftSupport) : null;
  const rightR = p.rightSupport ? parseRebar(p.rightSupport) : null;
  const beamLen = p.spanLength || 4000;
  const cover = p.cover || 25;
  const spanCount = p.spanCount || 1;
  const hc = p.hc || 500;
  const totalNet = spanCount * beamLen + (spanCount - 1) * hc; // 多跨总净长

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
      const segAnchorLen = segAnchor.canStraight ? segAnchor.straightLen : (segAnchor.bentStraightPart + segAnchor.bentBendPart);
      const segL = (totalNet + 2 * segAnchorLen) / 1000;
      const anchorDesc = segAnchor.canStraight
        ? `直锚${segAnchor.straightLen}mm` : `弯锚(直段${segAnchor.bentStraightPart}+弯折${segAnchor.bentBendPart}mm)`;
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
    const topAnchorLen = topAnchor.canStraight ? topAnchor.straightLen : (topAnchor.bentStraightPart + topAnchor.bentBendPart);
    const topL = (totalNet + 2 * topAnchorLen) / 1000;
    const topAnchorDesc = topAnchor.canStraight
      ? `直锚${topAnchor.straightLen}mm` : `弯锚(直段${topAnchor.bentStraightPart}+弯折${topAnchor.bentBendPart}mm)`;
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
      const segAnchorLen = segAnchor.canStraight ? segAnchor.straightLen : (segAnchor.bentStraightPart + segAnchor.bentBendPart);
      const segL = (totalNet + 2 * segAnchorLen) / 1000;
      const anchorDesc = segAnchor.canStraight
        ? `直锚${segAnchor.straightLen}mm` : `弯锚(直段${segAnchor.bentStraightPart}+弯折${segAnchor.bentBendPart}mm)`;
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
    const botAnchorLen = botAnchor.canStraight ? botAnchor.straightLen : (botAnchor.bentStraightPart + botAnchor.bentBendPart);
    const botL = (totalNet + 2 * botAnchorLen) / 1000;
    const botAnchorDesc = botAnchor.canStraight
      ? `直锚${botAnchor.straightLen}mm` : `弯锚(直段${botAnchor.bentStraightPart}+弯折${botAnchor.bentBendPart}mm)`;
    const botFormula: FormulaStep[] = [
      ...beamEndAnchorSteps(bot.grade, bot.diameter, p.concreteGrade, p.seismicGrade, hc, cover),
      { label: '单根长度', formula: 'L = 净跨总长 + 2×锚固', substitution: `= ${totalNet} + 2×${botAnchorLen}`, result: `= ${(totalNet + 2 * botAnchorLen)} mm = ${botL.toFixed(2)} m` },
    ];
    const botRowDesc = bot.perRow && bot.perRow.length >= 2 ? `，${bot.perRow.length}排(${[...bot.perRow].reverse().join('/')})` : (bot.rows && bot.rows >= 2 ? `，${bot.rows}排` : '');
    push('下部通长筋', p.bottom, `${botL.toFixed(2)}m × ${bot.count}${botRowDesc} (${botAnchorDesc}×2)`,
      bot.grade, bot.diameter, bot.count, botL, '#C0392B', botFormula);
  }

  // 支座负筋 (伸入跨内 ln/3 + 锚固)
  if (leftR) {
    const supportLen = calcSupportRebarLength(beamLen);
    const leftAnchor = calcBeamEndAnchor(leftR.grade, leftR.diameter, p.concreteGrade, p.seismicGrade, hc, cover);
    const anchorLen = leftAnchor.canStraight ? leftAnchor.straightLen : (leftAnchor.bentStraightPart + leftAnchor.bentBendPart);
    const lLen = (supportLen + anchorLen) / 1000;
    const leftCount = leftR.count * spanCount;
    const leftSupportFormula: FormulaStep[] = [
      ...beamEndAnchorSteps(leftR.grade, leftR.diameter, p.concreteGrade, p.seismicGrade, hc, cover),
      { label: '跨内伸入长度', formula: '第一排: ln/3', substitution: `= ${beamLen}/3`, result: `= ${supportLen} mm` },
      { label: '单根长度', formula: 'L = ln/3 + 锚固', substitution: `= ${supportLen} + ${anchorLen}`, result: `= ${supportLen + anchorLen} mm = ${lLen.toFixed(2)} m` },
    ];
    push('左支座负筋', p.leftSupport!, `${lLen.toFixed(2)}m × ${leftCount}${spanCount > 1 ? ` (${leftR.count}根×${spanCount}跨)` : ''} (ln/3=${supportLen}mm+锚固)`,
      leftR.grade, leftR.diameter, leftCount, lLen, '#8E44AD', leftSupportFormula);
  }
  if (rightR) {
    const supportLen = calcSupportRebarLength(beamLen);
    const rightAnchor = calcBeamEndAnchor(rightR.grade, rightR.diameter, p.concreteGrade, p.seismicGrade, hc, cover);
    const anchorLen = rightAnchor.canStraight ? rightAnchor.straightLen : (rightAnchor.bentStraightPart + rightAnchor.bentBendPart);
    const rLen = (supportLen + anchorLen) / 1000;
    const rightCount = rightR.count * spanCount;
    const rightSupportFormula: FormulaStep[] = [
      ...beamEndAnchorSteps(rightR.grade, rightR.diameter, p.concreteGrade, p.seismicGrade, hc, cover),
      { label: '跨内伸入长度', formula: '第一排: ln/3', substitution: `= ${beamLen}/3`, result: `= ${supportLen} mm` },
      { label: '单根长度', formula: 'L = ln/3 + 锚固', substitution: `= ${supportLen} + ${anchorLen}`, result: `= ${supportLen + anchorLen} mm = ${rLen.toFixed(2)} m` },
    ];
    push('右支座负筋', p.rightSupport!, `${rLen.toFixed(2)}m × ${rightCount}${spanCount > 1 ? ` (${rightR.count}根×${spanCount}跨)` : ''} (ln/3=${supportLen}mm+锚固)`,
      rightR.grade, rightR.diameter, rightCount, rLen, '#8E44AD', rightSupportFormula);
  }

  // 第二排支座负筋 (ln/4)
  const leftR2 = p.leftSupport2 ? parseRebar(p.leftSupport2) : null;
  const rightR2 = p.rightSupport2 ? parseRebar(p.rightSupport2) : null;
  if (leftR2) {
    const supportLen2 = calcSupportRebarLength(beamLen, 2);
    const leftAnchor2 = calcBeamEndAnchor(leftR2.grade, leftR2.diameter, p.concreteGrade, p.seismicGrade, hc, cover);
    const anchorLen2 = leftAnchor2.canStraight ? leftAnchor2.straightLen : (leftAnchor2.bentStraightPart + leftAnchor2.bentBendPart);
    const lLen2 = (supportLen2 + anchorLen2) / 1000;
    const leftCount2 = leftR2.count * spanCount;
    const leftFormula2: FormulaStep[] = [
      ...beamEndAnchorSteps(leftR2.grade, leftR2.diameter, p.concreteGrade, p.seismicGrade, hc, cover),
      { label: '跨内伸入长度', formula: '第二排: ln/4', substitution: `= ${beamLen}/4`, result: `= ${supportLen2} mm` },
      { label: '单根长度', formula: 'L = ln/4 + 锚固', substitution: `= ${supportLen2} + ${anchorLen2}`, result: `= ${supportLen2 + anchorLen2} mm = ${lLen2.toFixed(2)} m` },
    ];
    push('左支座负筋(二排)', p.leftSupport2!, `${lLen2.toFixed(2)}m × ${leftCount2}${spanCount > 1 ? ` (${leftR2.count}根×${spanCount}跨)` : ''} (ln/4=${supportLen2}mm+锚固)`,
      leftR2.grade, leftR2.diameter, leftCount2, lLen2, '#8E44AD', leftFormula2);
  }
  if (rightR2) {
    const supportLen2 = calcSupportRebarLength(beamLen, 2);
    const rightAnchor2 = calcBeamEndAnchor(rightR2.grade, rightR2.diameter, p.concreteGrade, p.seismicGrade, hc, cover);
    const anchorLen2 = rightAnchor2.canStraight ? rightAnchor2.straightLen : (rightAnchor2.bentStraightPart + rightAnchor2.bentBendPart);
    const rLen2 = (supportLen2 + anchorLen2) / 1000;
    const rightCount2 = rightR2.count * spanCount;
    const rightFormula2: FormulaStep[] = [
      ...beamEndAnchorSteps(rightR2.grade, rightR2.diameter, p.concreteGrade, p.seismicGrade, hc, cover),
      { label: '跨内伸入长度', formula: '第二排: ln/4', substitution: `= ${beamLen}/4`, result: `= ${supportLen2} mm` },
      { label: '单根长度', formula: 'L = ln/4 + 锚固', substitution: `= ${supportLen2} + ${anchorLen2}`, result: `= ${supportLen2 + anchorLen2} mm = ${rLen2.toFixed(2)} m` },
    ];
    push('右支座负筋(二排)', p.rightSupport2!, `${rLen2.toFixed(2)}m × ${rightCount2}${spanCount > 1 ? ` (${rightR2.count}根×${spanCount}跨)` : ''} (ln/4=${supportLen2}mm+锚固)`,
      rightR2.grade, rightR2.diameter, rightCount2, rLen2, '#8E44AD', rightFormula2);
  }

  // 架立筋 (有支座负筋时, 或用户手动指定)
  const hasErectionBar = p.erectionBar ? true : (leftR || rightR);
  if (hasErectionBar) {
    const erUser = p.erectionBar ? parseRebar(p.erectionBar) : null;
    const erDia = erUser ? erUser.diameter : ((beamLen <= 4000) ? 10 : 12);
    const erGrade = erUser ? erUser.grade : 'C'; // HRB400
    const erCount = erUser ? erUser.count : 2;
    const leftSupportLen = leftR ? calcSupportRebarLength(beamLen) : 0;
    const rightSupportLen = rightR ? calcSupportRebarLength(beamLen) : 0;
    const lap = 150;
    let erLen: number;
    let erFormulaSub: string;
    if (leftR && rightR) {
      erLen = beamLen - leftSupportLen - rightSupportLen + 2 * lap;
      erFormulaSub = `= ${beamLen} - ${leftSupportLen} - ${rightSupportLen} + 2×${lap}`;
    } else if (leftR) {
      erLen = beamLen - leftSupportLen + lap;
      erFormulaSub = `= ${beamLen} - ${leftSupportLen} + ${lap}`;
    } else if (rightR) {
      erLen = beamLen - rightSupportLen + lap;
      erFormulaSub = `= ${beamLen} - ${rightSupportLen} + ${lap}`;
    } else {
      // 用户指定架立筋但无支座负筋: 取全跨长
      erLen = beamLen;
      erFormulaSub = `= ${beamLen} (全跨)`;
    }
    if (erLen > 50) {
      const erLM = erLen / 1000;
      const erTotal = erCount * spanCount;
      const erSpec = p.erectionBar || `${erCount}Φ${erDia}`;
      const erFormula: FormulaStep[] = [
        { label: '架立筋长度', formula: 'L = ln - 左支座伸入 - 右支座伸入 + 搭接', substitution: erFormulaSub, result: `= ${erLen} mm = ${erLM.toFixed(2)} m` },
      ];
      push('架立筋', erSpec, `${erLM.toFixed(2)}m × ${erTotal}${spanCount > 1 ? ` (${erCount}根×${spanCount}跨)` : ''} (搭接${lap}mm)`,
        erGrade, erDia, erTotal, erLM, '#F39C12', erFormula);
    }
  }

  // 箍筋 (加密区按22G101: max(2h, 500mm) from column face)
  const innerB = p.b - 2 * cover;
  const innerH = p.h - 2 * cover;
  const perimeter = 2 * (innerB + innerH) / 1000;
  const denseZoneLen = beamDenseZoneLength(p.h);
  const denseCountPerSpan = Math.ceil((2 * denseZoneLen) / stir.spacingDense); // 每跨两端加密区
  const normalCountPerSpan = Math.ceil(Math.max(beamLen - 2 * denseZoneLen, 0) / stir.spacingNormal);
  const stirCount = (denseCountPerSpan + normalCountPerSpan) * spanCount;
  const stirSingleL = perimeter * stir.legs / 2;
  const stirWt = stirCount * stirSingleL * w(stir.diameter);
  const stirFormula: FormulaStep[] = [
    { label: '箍筋内净尺寸', formula: '内宽 = b - 2c, 内高 = h - 2c', substitution: `= ${p.b} - 2×${cover}, ${p.h} - 2×${cover}`, result: `= ${innerB}×${innerH} mm` },
    { label: '加密区长度', formula: 'l_dense = max(2h, 500)', substitution: `= max(2×${p.h}, 500)`, result: `= ${denseZoneLen} mm` },
    { label: '加密区根数/跨', formula: 'n_dense = ⌈2×l_dense / s_dense⌉', substitution: `= ⌈2×${denseZoneLen} / ${stir.spacingDense}⌉`, result: `= ${denseCountPerSpan}` },
    { label: '非加密区根数/跨', formula: 'n_normal = ⌈(ln - 2×l_dense) / s_normal⌉', substitution: `= ⌈(${beamLen} - 2×${denseZoneLen}) / ${stir.spacingNormal}⌉`, result: `= ${normalCountPerSpan}` },
    { label: '箍筋总数', formula: `n = (n_dense + n_normal) × 跨数`, substitution: `= (${denseCountPerSpan} + ${normalCountPerSpan}) × ${spanCount}`, result: `= ${stirCount} 根` },
    weightSteps('箍筋', stirCount, stirSingleL, stir.diameter),
  ];
  items.push({
    name: '箍筋', spec: p.stirrup,
    length: `${stirCount}根 × ${perimeter.toFixed(2)}m`,
    weight: `${stirWt.toFixed(2)} kg`, color: '#27AE60',
    grade: stir.grade, diameter: stir.diameter, count: stirCount, lengthM: stirSingleL, weightKg: stirWt,
    formulaSteps: stirFormula,
  });
  total += stirWt;

  // 腰筋/抗扭筋
  const sideInfo = p.sideBar ? parseSideBar(p.sideBar) : null;
  if (sideInfo) {
    const sideAnchor = calcBeamEndAnchor(sideInfo.grade, sideInfo.diameter, p.concreteGrade, p.seismicGrade, hc, cover);
    const sideAnchorLen = sideAnchor.canStraight ? sideAnchor.straightLen : (sideAnchor.bentStraightPart + sideAnchor.bentBendPart);
    const sideLM = (totalNet + 2 * sideAnchorLen) / 1000;
    const sideFormula: FormulaStep[] = [
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
      const tieBody = (p.b - 2 * cover - 2 * stir.diameter) / 1000;
      const tieHook = Math.max(10 * tieInfo.diameter, 75) / 1000;
      const tieSingleL = tieBody + 2 * tieHook;
      const tieXCountPerSpan = Math.ceil(Math.max(beamLen - 2 * denseZoneLen, 0) / stir.spacingNormal);
      const tieTotal = tieXCountPerSpan * perSide * spanCount;
      if (tieTotal > 0) {
        const tieFormula: FormulaStep[] = [
          { label: '拉筋主体', formula: 'body = b - 2c - 2d_stir', substitution: `= ${p.b} - 2×${cover} - 2×${stir.diameter}`, result: `= ${(tieBody * 1000).toFixed(0)} mm` },
          { label: '弯钩长度', formula: 'hook = max(10d, 75)', substitution: `= max(10×${tieInfo.diameter}, 75)`, result: `= ${(tieHook * 1000).toFixed(0)} mm` },
          { label: '单根长度', formula: 'L = body + 2×hook', substitution: `= ${(tieBody * 1000).toFixed(0)} + 2×${(tieHook * 1000).toFixed(0)}`, result: `= ${(tieSingleL * 1000).toFixed(0)} mm = ${tieSingleL.toFixed(2)} m` },
          { label: '拉筋总数', formula: 'n = 道数 × 层数 × 跨数', substitution: `= ${tieXCountPerSpan} × ${perSide} × ${spanCount}`, result: `= ${tieTotal} 根` },
        ];
        push('拉筋', p.tieBar || `${tieInfo.grade}${tieInfo.diameter}`,
          `${tieSingleL.toFixed(2)}m × ${tieTotal} (${tieXCountPerSpan}道×${perSide}层${spanCount > 1 ? `×${spanCount}跨` : ''})`,
          tieInfo.grade, tieInfo.diameter, tieTotal, tieSingleL, '#1ABC9C', tieFormula);
      }
    }
  }

  return { items, total: `${total.toFixed(2)} kg` };
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
  bodyLen?: number;  // 主体水平段 mm
  anchorLen?: number; // 锚固长度 mm (每端)
  bendLen?: number;  // 弯折段长度 mm
  bendDir?: 'down' | 'up'; // 弯折方向: 上部筋向下, 下部筋向上
  width?: number;    // 箍筋宽 mm
  height?: number;   // 箍筋高 mm
  hookLen?: number;  // 弯钩长 mm
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
  const beamLen = p.spanLength || 4000;
  const spanCount = p.spanCount || 1;
  const totalNet = spanCount * beamLen + (spanCount - 1) * hc;

  // 上部通长筋
  const topA = calcBeamEndAnchor(top.grade, top.diameter, p.concreteGrade, p.seismicGrade, hc, cover);
  if (topA.canStraight) {
    shapes.push({ name: '上部通长筋', spec: p.top, shapeType: 'straight', count: top.count,
      color: '#C0392B', totalLen: totalNet + 2 * topA.straightLen,
      bodyLen: totalNet, anchorLen: topA.straightLen });
  } else {
    shapes.push({ name: '上部通长筋', spec: p.top, shapeType: 'bentAnchor', count: top.count,
      color: '#C0392B', totalLen: totalNet + 2 * (topA.bentStraightPart + topA.bentBendPart),
      bodyLen: totalNet, anchorLen: topA.bentStraightPart, bendLen: topA.bentBendPart, bendDir: 'down' });
  }

  // 下部通长筋
  const botA = calcBeamEndAnchor(bot.grade, bot.diameter, p.concreteGrade, p.seismicGrade, hc, cover);
  if (botA.canStraight) {
    shapes.push({ name: '下部通长筋', spec: p.bottom, shapeType: 'straight', count: bot.count,
      color: '#C0392B', totalLen: totalNet + 2 * botA.straightLen,
      bodyLen: totalNet, anchorLen: botA.straightLen });
  } else {
    shapes.push({ name: '下部通长筋', spec: p.bottom, shapeType: 'bentAnchor', count: bot.count,
      color: '#C0392B', totalLen: totalNet + 2 * (botA.bentStraightPart + botA.bentBendPart),
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
    const sLen = calcSupportRebarLength(beamLen, row);
    const a = calcBeamEndAnchor(r.grade, r.diameter, p.concreteGrade, p.seismicGrade, hc, cover);
    const ancLen = a.canStraight ? a.straightLen : a.bentStraightPart;
    const bLen = a.canStraight ? 0 : a.bentBendPart;
    const side = key.startsWith('left') ? '左' : '右';
    const rowLabel = row === 2 ? '(二排)' : '';
    shapes.push({ name: `${side}支座负筋${rowLabel}`, spec: field,
      shapeType: 'support', count: r.count * spanCount,
      color: '#8E44AD', totalLen: sLen + ancLen + bLen,
      bodyLen: sLen, anchorLen: ancLen, bendLen: bLen || undefined, spanLen: sLen, supportRow: row,
      bendDir: 'down' });
  }

  // 箍筋
  const stirW = p.b - 2 * cover;
  const stirH = p.h - 2 * cover;
  const hookLen = Math.max(10 * stir.diameter, 75);
  const stirPerimeter = 2 * (stirW + stirH);
  shapes.push({ name: '箍筋', spec: p.stirrup, shapeType: 'stirrup',
    count: 0, color: '#27AE60', totalLen: stirPerimeter + 2 * hookLen,
    width: stirW, height: stirH, hookLen });

  // 拉筋
  const sideInfo = p.sideBar ? parseSideBar(p.sideBar) : null;
  if (sideInfo) {
    const tieInfo = p.tieBar ? parseTieBar(p.tieBar) : autoTieBar(p.b, stir.grade, stir.diameter);
    if (tieInfo) {
      const tieBody = p.b - 2 * cover - 2 * stir.diameter;
      const tieHook = Math.max(10 * tieInfo.diameter, 75);
      shapes.push({ name: '拉筋', spec: p.tieBar || `A${tieInfo.diameter}`,
        shapeType: 'tie', count: 0, color: '#1ABC9C',
        totalLen: tieBody + 2 * tieHook, bodyLen: tieBody, hookLen: tieHook });
    }
  }

  return shapes;
}

export function calcColumn(p: ColumnParams): CalcResult {
  const main = parseRebar(p.main);
  const stir = parseStirrup(p.stirrup);
  const colHeight = p.height || 3000;
  const cover = p.cover || 25;
  const items: CalcItem[] = [];
  let total = 0;

  const llE = calcLlE(main.grade, main.diameter, p.concreteGrade, p.seismicGrade);
  const mainL = (colHeight + llE) / 1000;
  const mainW = main.count * mainL * w(main.diameter);
  const mainFormula: FormulaStep[] = [
    ...anchorSteps(main.grade, main.diameter, p.concreteGrade, p.seismicGrade),
    { label: '抗震搭接长度 llE', formula: 'llE = ζl × laE', substitution: `= 1.4 × laE`, result: `= ${llE} mm` },
    { label: '单根长度', formula: 'L = H + llE', substitution: `= ${colHeight} + ${llE}`, result: `= ${colHeight + llE} mm = ${mainL.toFixed(2)} m` },
    weightSteps('纵筋', main.count, mainL, main.diameter),
  ];
  items.push({
    name: '纵向钢筋', spec: p.main,
    length: `${mainL.toFixed(2)}m × ${main.count} (含搭接${llE}mm)`,
    weight: `${mainW.toFixed(2)} kg`, color: '#C0392B',
    grade: main.grade, diameter: main.diameter, count: main.count, lengthM: mainL, weightKg: mainW,
    formulaSteps: mainFormula,
  });
  total += mainW;

  const innerB = p.b - 2 * cover;
  const innerH = p.h - 2 * cover;
  const perimeter = 2 * (innerB + innerH) / 1000;
  const denseCount = Math.ceil(1000 / stir.spacingDense);
  const normalCount = Math.ceil((colHeight - 1000) / stir.spacingNormal);
  const stirCount = denseCount + normalCount;
  const stirSingleL = perimeter * stir.legs / 2;
  const stirW = stirCount * stirSingleL * w(stir.diameter);
  const colStirFormula: FormulaStep[] = [
    { label: '箍筋内净尺寸', formula: '内宽 = b - 2c, 内高 = h - 2c', substitution: `= ${p.b} - 2×${cover}, ${p.h} - 2×${cover}`, result: `= ${innerB}×${innerH} mm` },
    { label: '加密区根数', formula: 'n_dense = ⌈1000 / s_dense⌉', substitution: `= ⌈1000 / ${stir.spacingDense}⌉`, result: `= ${denseCount}` },
    { label: '非加密区根数', formula: 'n_normal = ⌈(H - 1000) / s_normal⌉', substitution: `= ⌈(${colHeight} - 1000) / ${stir.spacingNormal}⌉`, result: `= ${normalCount}` },
    { label: '箍筋总数', formula: 'n = n_dense + n_normal', substitution: `= ${denseCount} + ${normalCount}`, result: `= ${stirCount} 根` },
    weightSteps('箍筋', stirCount, stirSingleL, stir.diameter),
  ];
  items.push({
    name: '箍筋', spec: p.stirrup,
    length: `${stirCount}根 × ${perimeter.toFixed(2)}m`,
    weight: `${stirW.toFixed(2)} kg`, color: '#27AE60',
    grade: stir.grade, diameter: stir.diameter, count: stirCount, lengthM: stirSingleL, weightKg: stirW,
    formulaSteps: colStirFormula,
  });
  total += stirW;

  return { items, total: `${total.toFixed(2)} kg` };
}

export function calcSlab(p: SlabParams): CalcResult {
  const slabW = p.spanX;
  const slabD = p.spanY;
  const bx = parseSlabRebar(p.bottomX);
  const by = parseSlabRebar(p.bottomY);
  const tx = p.topX ? parseSlabRebar(p.topX) : null;
  const ty = p.topY ? parseSlabRebar(p.topY) : null;
  const items: CalcItem[] = [];
  let total = 0;

  // ── 底筋 (按支座类型区分锚固) ──
  const bxLa = calcLa(bx.grade, bx.diameter, p.concreteGrade);
  const bxDetail = slabBottomAnchorDetail(p.supportType, bx.diameter, bxLa);
  const bxAnchorTotal = bxDetail.straight + bxDetail.bend; // 直段+弯折
  const bxCount = Math.ceil(slabD / bx.spacing);
  const bxLen = (slabW + 2 * bxAnchorTotal) / 1000;
  const bxW = bxCount * bxLen * w(bx.diameter);
  const supportLabel = p.supportType === 'simple' ? '简支' : p.supportType === 'continuous' ? '连续' : '悬挑';
  const bxFormula: FormulaStep[] = [
    { label: `锚固 (${supportLabel})`, formula: bxDetail.bend > 0 ? '直段+弯折' : '直段伸入', substitution: bxDetail.bend > 0 ? `= ${bxDetail.straight} + ${bxDetail.bend}` : `= ${bxDetail.straight}`, result: `= ${bxAnchorTotal} mm` },
    { label: '锚固说明', formula: '22G101', substitution: '', result: bxDetail.description },
    { label: '根数', formula: 'n = ⌈D / s⌉', substitution: `= ⌈${slabD} / ${bx.spacing}⌉`, result: `= ${bxCount}` },
    { label: '单根长度', formula: 'L = W + 2×anc', substitution: `= ${slabW} + 2×${bxAnchorTotal}`, result: `= ${slabW + 2 * bxAnchorTotal} mm = ${bxLen.toFixed(2)} m` },
    weightSteps('X向底筋', bxCount, bxLen, bx.diameter),
  ];
  items.push({
    name: 'X向底筋', spec: p.bottomX,
    length: `${bxLen.toFixed(2)}m × ${bxCount} (${supportLabel}锚${bxAnchorTotal}mm×2)`,
    weight: `${bxW.toFixed(2)} kg`, color: '#C0392B',
    grade: bx.grade, diameter: bx.diameter, count: bxCount, lengthM: bxLen, weightKg: bxW,
    formulaSteps: bxFormula,
  });
  total += bxW;

  const byLa = calcLa(by.grade, by.diameter, p.concreteGrade);
  const byDetail = slabBottomAnchorDetail(p.supportType, by.diameter, byLa);
  const byAnchorTotal = byDetail.straight + byDetail.bend;
  const byCount = Math.ceil(slabW / by.spacing);
  const byLen = (slabD + 2 * byAnchorTotal) / 1000;
  const byW = byCount * byLen * w(by.diameter);
  const byFormula: FormulaStep[] = [
    { label: `锚固 (${supportLabel})`, formula: byDetail.bend > 0 ? '直段+弯折' : '直段伸入', substitution: byDetail.bend > 0 ? `= ${byDetail.straight} + ${byDetail.bend}` : `= ${byDetail.straight}`, result: `= ${byAnchorTotal} mm` },
    { label: '锚固说明', formula: '22G101', substitution: '', result: byDetail.description },
    { label: '根数', formula: 'n = ⌈W / s⌉', substitution: `= ⌈${slabW} / ${by.spacing}⌉`, result: `= ${byCount}` },
    { label: '单根长度', formula: 'L = D + 2×anc', substitution: `= ${slabD} + 2×${byAnchorTotal}`, result: `= ${slabD + 2 * byAnchorTotal} mm = ${byLen.toFixed(2)} m` },
    weightSteps('Y向底筋', byCount, byLen, by.diameter),
  ];
  items.push({
    name: 'Y向底筋', spec: p.bottomY,
    length: `${byLen.toFixed(2)}m × ${byCount} (${supportLabel}锚${byAnchorTotal}mm×2)`,
    weight: `${byW.toFixed(2)} kg`, color: '#E67E22',
    grade: by.grade, diameter: by.diameter, count: byCount, lengthM: byLen, weightKg: byW,
    formulaSteps: byFormula,
  });
  total += byW;

  // ── 面筋 (含锚入支座) ──
  // 面筋伸入支座: 连续板 ≥ la, 简支板 ≥ la/2, 悬挑板全长
  if (tx) {
    const txLa = calcLa(tx.grade, tx.diameter, p.concreteGrade);
    const txAnchor = p.supportType === 'cantilever' ? 0 : p.supportType === 'continuous' ? txLa : Math.ceil(txLa / 2);
    const txCount = Math.ceil(slabD / tx.spacing);
    const txLen = (slabW + 2 * txAnchor) / 1000;
    const txW = txCount * txLen * w(tx.diameter);
    const txFormula: FormulaStep[] = [
      { label: `面筋锚固 (${supportLabel})`, formula: p.supportType === 'continuous' ? 'anc = la' : 'anc = la/2', substitution: p.supportType === 'cantilever' ? '悬挑端无锚固' : `= ${txAnchor}`, result: `= ${txAnchor} mm` },
      { label: '根数', formula: 'n = ⌈D / s⌉', substitution: `= ⌈${slabD} / ${tx.spacing}⌉`, result: `= ${txCount}` },
      { label: '单根长度', formula: 'L = W + 2×anc', substitution: `= ${slabW} + 2×${txAnchor}`, result: `= ${slabW + 2 * txAnchor} mm = ${txLen.toFixed(2)} m` },
      weightSteps('X向面筋', txCount, txLen, tx.diameter),
    ];
    items.push({ name: 'X向面筋', spec: p.topX, length: `${txLen.toFixed(2)}m × ${txCount}${txAnchor > 0 ? ` (含锚${txAnchor}mm×2)` : ''}`, weight: `${txW.toFixed(2)} kg`, color: '#8E44AD',
      grade: tx.grade, diameter: tx.diameter, count: txCount, lengthM: txLen, weightKg: txW, formulaSteps: txFormula });
    total += txW;
  }
  if (ty) {
    const tyLa = calcLa(ty.grade, ty.diameter, p.concreteGrade);
    const tyAnchor = p.supportType === 'cantilever' ? 0 : p.supportType === 'continuous' ? tyLa : Math.ceil(tyLa / 2);
    const tyCount = Math.ceil(slabW / ty.spacing);
    const tyLen = (slabD + 2 * tyAnchor) / 1000;
    const tyW = tyCount * tyLen * w(ty.diameter);
    const tyFormula: FormulaStep[] = [
      { label: `面筋锚固 (${supportLabel})`, formula: p.supportType === 'continuous' ? 'anc = la' : 'anc = la/2', substitution: p.supportType === 'cantilever' ? '悬挑端无锚固' : `= ${tyAnchor}`, result: `= ${tyAnchor} mm` },
      { label: '根数', formula: 'n = ⌈W / s⌉', substitution: `= ⌈${slabW} / ${ty.spacing}⌉`, result: `= ${tyCount}` },
      { label: '单根长度', formula: 'L = D + 2×anc', substitution: `= ${slabD} + 2×${tyAnchor}`, result: `= ${slabD + 2 * tyAnchor} mm = ${tyLen.toFixed(2)} m` },
      weightSteps('Y向面筋', tyCount, tyLen, ty.diameter),
    ];
    items.push({ name: 'Y向面筋', spec: p.topY, length: `${tyLen.toFixed(2)}m × ${tyCount}${tyAnchor > 0 ? ` (含锚${tyAnchor}mm×2)` : ''}`, weight: `${tyW.toFixed(2)} kg`, color: '#7D3C98',
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

  return { items, total: `${total.toFixed(2)} kg` };
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

  return { items, total: `${total.toFixed(2)} kg` };
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
  const slabLen = Math.sqrt(totalRise * totalRise + totalRun * totalRun);
  const flightW = p.flightWidth;

  const items: CalcItem[] = [];
  let stairTotal = 0;

  function pushStair(name: string, spec: string, length: string, grade: string, diameter: number, count: number, lengthM: number, color: string, formulaSteps?: FormulaStep[]) {
    const weightKg = count * lengthM * w(diameter);
    const steps = formulaSteps ? [...formulaSteps, weightSteps(name, count, lengthM, diameter)] : [weightSteps(name, count, lengthM, diameter)];
    items.push({ name, spec, length, weight: `${weightKg.toFixed(2)} kg`, color, grade, diameter, count, lengthM, weightKg, formulaSteps: steps });
    stairTotal += weightKg;
  }

  // 下部纵筋: 沿梯板斜面 + 两端锚入平台
  const botAnc = Math.min(Math.round(p.botPlatformLen * 0.8), 300);
  const topAnc = Math.min(Math.round(p.topPlatformLen * 0.8), 300);
  const botBarLen = slabLen + botAnc + topAnc;
  const botBarLenM = botBarLen / 1000;
  const botBarCount = Math.floor((flightW - 2 * cover) / botR.spacing) + 1;
  const botFormula: FormulaStep[] = [
    { label: '梯板斜长', formula: 'L_slab = √(H² + B²)', substitution: `= √(${totalRise}² + ${totalRun}²)`, result: `= ${Math.round(slabLen)} mm` },
    { label: '两端锚入', formula: 'L_anc = min(0.8×下平台, 300) + min(0.8×上平台, 300)', substitution: `= ${botAnc} + ${topAnc}`, result: `= ${botAnc + topAnc} mm` },
    { label: '单根长度', formula: 'L = L_slab + L_anc', substitution: `= ${Math.round(slabLen)} + ${botAnc + topAnc}`, result: `= ${Math.round(botBarLen)} mm = ${botBarLenM.toFixed(2)} m` },
    { label: '根数', formula: 'n = ⌊(w - 2c) / s⌋ + 1', substitution: `= ⌊(${flightW} - 2×${cover}) / ${botR.spacing}⌋ + 1`, result: `= ${botBarCount}` },
  ];
  pushStair('下部纵筋', p.bottomBar, `${botBarLenM.toFixed(2)}m × ${botBarCount}根`,
    botR.grade, botR.diameter, botBarCount, botBarLenM, '#C0392B', botFormula);

  // 上部纵筋
  const topBarLen = slabLen + botAnc + topAnc;
  const topBarLenM = topBarLen / 1000;
  const topBarCount = Math.floor((flightW - 2 * cover) / topR.spacing) + 1;
  const topFormula: FormulaStep[] = [
    { label: '单根长度', formula: '同下部纵筋路径', substitution: `= ${Math.round(slabLen)} + ${botAnc + topAnc}`, result: `= ${Math.round(topBarLen)} mm = ${topBarLenM.toFixed(2)} m` },
    { label: '根数', formula: 'n = ⌊(w - 2c) / s⌋ + 1', substitution: `= ⌊(${flightW} - 2×${cover}) / ${topR.spacing}⌋ + 1`, result: `= ${topBarCount}` },
  ];
  pushStair('上部纵筋', p.topBar, `${topBarLenM.toFixed(2)}m × ${topBarCount}根`,
    topR.grade, topR.diameter, topBarCount, topBarLenM, '#8E44AD', topFormula);

  // 分布筋 (沿斜面等间距，上下各一层)
  const distBarLen = flightW - 2 * cover;
  const distBarLenM = distBarLen / 1000;
  const distCountPerLayer = Math.floor(slabLen / distR.spacing);
  const distTotalCount = distCountPerLayer * 2;
  const distFormula: FormulaStep[] = [
    { label: '单根长度', formula: 'L = 梯段宽 - 2c', substitution: `= ${flightW} - 2×${cover}`, result: `= ${distBarLen} mm = ${distBarLenM.toFixed(2)} m` },
    { label: '每层根数', formula: 'n = ⌊L_slab / s⌋', substitution: `= ⌊${Math.round(slabLen)} / ${distR.spacing}⌋`, result: `= ${distCountPerLayer}` },
    { label: '总根数', formula: 'N = n × 2(上下两层)', substitution: `= ${distCountPerLayer} × 2`, result: `= ${distTotalCount}` },
  ];
  pushStair('分布筋', p.distBar, `${distBarLenM.toFixed(2)}m × ${distTotalCount}根 (上下各${distCountPerLayer})`,
    distR.grade, distR.diameter, distTotalCount, distBarLenM, '#27AE60', distFormula);

  return { items, total: `${stairTotal.toFixed(2)} kg` };
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
  const slabLen = Math.sqrt(totalRise * totalRise + totalRun * totalRun);
  const beamB = p.beamB; // 梯梁宽(=踏步宽)

  // 下部纵筋锚固: 沿延长线伸入梁, 满足 ①过支座中线 ②≥5d, 取大值
  // 沿斜面的锚固长度 = 水平投影 / cosA
  const cosA = totalRun / slabLen;
  const bot5d = 5 * botR.diameter;
  const botAncHoriz = Math.max(beamB / 2, bot5d); // 水平投影
  const botAncSlope = Math.round(botAncHoriz / cosA); // 沿斜面长度

  // 上部纵筋: 沿延长线伸入梁至外侧边, 末端15d向下弯钩
  // 伸入梁的斜面长度 ≈ beamB / cosA (cover可忽略)
  const topAncSlope = Math.round((beamB - cover) / cosA);
  const topHook = 15 * topR.diameter;
  // 伸入梯板 ln/4 (斜面长度)
  const topLn4 = Math.round(slabLen / 4);

  const botBarCount = Math.floor((p.flightWidth - 2 * cover) / botR.spacing) + 1;
  const topBarCount = Math.floor((p.flightWidth - 2 * cover) / topR.spacing) + 1;
  const distCountPerLayer = Math.floor(slabLen / distR.spacing);

  // 下部纵筋: 直线型，沿板底延长线伸入两端梯梁，无弯钩
  const botBodyLen = Math.round(slabLen);
  const botTotalLen = botBodyLen + botAncSlope * 2;
  shapes.push({
    name: '下部纵筋', spec: p.bottomBar, shapeType: 'straight',
    count: botBarCount, color: '#C0392B',
    totalLen: botTotalLen, bodyLen: botBodyLen,
    anchorLen: botAncSlope,
  });

  // 上部纵筋: 弯折型 (两端各一段独立负筋)
  // 路径: 15d弯钩↓ → 沿延长线穿过梁 → 沿板顶伸入梯板 ln/4
  const topPieceLen = topAncSlope + topLn4 + topHook;
  shapes.push({
    name: '上部纵筋', spec: p.topBar, shapeType: 'bentAnchor',
    count: topBarCount * 2, color: '#8E44AD',
    totalLen: topPieceLen,
    anchorLen: topAncSlope,
    bodyLen: topLn4,
    hookLen: topHook,
    bendDir: 'down',
  });

  // 分布筋: 直线型，垂直纵筋
  const distLen = p.flightWidth - 2 * cover;
  shapes.push({
    name: '分布筋', spec: p.distBar, shapeType: 'straight',
    count: distCountPerLayer * 2, color: '#27AE60',
    totalLen: distLen, bodyLen: distLen,
  });

  return shapes;
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

  // 柱插筋: 从基础底伸入基础顶 + 伸出基础顶以上一定高度 (简化: h + 500mm 预留)
  if (p.colMain) {
    const colR = parseRebar(p.colMain);
    const colCount = (p.columnCount || 1);
    const insertLen = (p.h + 500) / 1000;
    const colFormula: FormulaStep[] = [
      { label: '插筋长度', formula: 'L = h基 + 预留', substitution: `= ${p.h} + 500`, result: `= ${p.h + 500} mm` },
    ];
    if (colCount === 2) {
      colFormula.push({ label: '柱数', formula: 'n柱 = 2', substitution: '', result: `每柱${colR.count}根，共${colR.count * 2}根` });
    }
    push('柱插筋', p.colMain, `${insertLen.toFixed(2)}m × ${colR.count * colCount}`,
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

  return { items, total: `${total.toFixed(2)} kg` };
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

  // 柱插筋: h承台 + 500mm 预留
  if (p.colMain) {
    const colR = parseRebar(p.colMain);
    const insertLen = (p.h + 500) / 1000;
    const colFormula: FormulaStep[] = [
      { label: '插筋长度', formula: 'L = h承台 + 预留', substitution: `= ${p.h} + 500`, result: `= ${p.h + 500} mm` },
    ];
    pushItem('柱插筋', p.colMain, `${insertLen.toFixed(2)}m × ${colR.count}`,
      colR.grade, colR.diameter, colR.count, insertLen, '#8E44AD', colFormula);
  }

  return { items, total: `${total.toFixed(2)} kg` };
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

  // 柱插筋: 每根柱 h + 500mm 预留
  if (p.colMain) {
    const colR = parseRebar(p.colMain);
    const colTotal = p.colCountX * p.colCountY;
    const insertLen = (p.h + 500) / 1000;
    const colFormula: FormulaStep[] = [
      { label: '插筋长度', formula: 'L = h筏板 + 预留', substitution: `= ${p.h} + 500`, result: `= ${p.h + 500} mm` },
      { label: '柱数', formula: 'n柱 = colCountX × colCountY', substitution: `= ${p.colCountX} × ${p.colCountY}`, result: `= ${colTotal}` },
    ];
    push('柱插筋', p.colMain, `${insertLen.toFixed(2)}m × ${colR.count * colTotal}`,
      colR.grade, colR.diameter, colR.count * colTotal, insertLen, '#8E44AD', colFormula);
  }

  return { items, total: `${total.toFixed(2)} kg` };
}
