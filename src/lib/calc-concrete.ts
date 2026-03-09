import type { FormulaStep } from './calc';
import type { BeamParams, ColumnParams, SlabParams, ShearWallParams, StairParams } from './types';

// ═══════════════════════════════════════════════════════════════════
// 混凝土工程量计算 — 按清单规范 GB50854 / GB50500
// 核心原则: 不扣除钢筋所占体积
// ═══════════════════════════════════════════════════════════════════

export interface ConcreteCalcItem {
  name: string;           // 如 "梁体"、"踏步"、"平台板"
  volume: number;         // m³
  description: string;    // 描述
  formulaSteps: FormulaStep[];
  color: string;
}

export interface ConcreteCalcResult {
  items: ConcreteCalcItem[];
  totalVolume: number;    // 总体积 m³
}

// ─── 梁混凝土 ───
// 清单规范: 梁体积 = 截面面积 × 净跨长度 (伸入柱支座部分按梁计)
// 含加腋增量; 不扣钢筋
export function calcBeamConcrete(p: BeamParams): ConcreteCalcResult {
  const items: ConcreteCalcItem[] = [];
  const b = p.b;              // mm
  const h = p.h;              // mm
  const spanLen = p.spanLength || 4000; // mm
  const spanCount = p.spanCount || 1;
  const hc = p.hc || 500;     // 柱宽 mm

  // 梁净跨总长 (多跨含中间柱)
  const totalNetLen = spanCount * spanLen + (spanCount - 1) * hc;

  // 梁体 = b × h × totalNetLen
  const beamBodyVol = (b / 1000) * (h / 1000) * (totalNetLen / 1000);
  const beamBodySteps: FormulaStep[] = [
    { label: '截面尺寸', formula: 'b × h', substitution: `= ${b} × ${h}`, result: `= ${b * h} mm²` },
    { label: '梁净跨总长', formula: 'L = 跨数×净跨 + (跨数-1)×柱宽', substitution: `= ${spanCount}×${spanLen} + ${Math.max(spanCount - 1, 0)}×${hc}`, result: `= ${totalNetLen} mm` },
    { label: '梁体体积', formula: 'V = b × h × L', substitution: `= ${b/1000} × ${h/1000} × ${totalNetLen/1000}`, result: `= ${beamBodyVol.toFixed(4)} m³` },
  ];
  items.push({ name: '梁体', volume: beamBodyVol, description: `${b}×${h}mm × ${totalNetLen}mm`, formulaSteps: beamBodySteps, color: '#3B82F6' });

  // 加腋增量
  const haunchType = p.haunchType || 'none';
  const haunchLen = p.haunchLength || 0;
  const haunchH = p.haunchHeight || 0;
  const haunchSide = p.haunchSide || 'both';
  if (haunchType !== 'none' && haunchLen > 0 && haunchH > 0) {
    // 加腋近似为三角形截面: 0.5 × haunchLen × haunchH × b (竖向加腋)
    // 或 0.5 × haunchLen × haunchH × h (水平加腋)
    const sideCount = haunchSide === 'both' ? 2 * spanCount : spanCount;
    let haunchVol: number;
    let haunchDesc: string;
    let haunchSteps: FormulaStep[];

    if (haunchType === 'vertical') {
      // 竖向加腋: 在梁底, 三角形截面 = 0.5 × c1 × Δh × b
      haunchVol = sideCount * 0.5 * (haunchLen / 1000) * (haunchH / 1000) * (b / 1000);
      haunchDesc = `竖向加腋 ${haunchLen}×${haunchH}mm × ${sideCount}处`;
      haunchSteps = [
        { label: '单处加腋体积', formula: 'V₁ = 0.5 × c₁ × Δh × b', substitution: `= 0.5 × ${haunchLen/1000} × ${haunchH/1000} × ${b/1000}`, result: `= ${(0.5 * haunchLen / 1000 * haunchH / 1000 * b / 1000).toFixed(4)} m³` },
        { label: '加腋总体积', formula: 'V = V₁ × 处数', substitution: `= ${(0.5 * haunchLen / 1000 * haunchH / 1000 * b / 1000).toFixed(4)} × ${sideCount}`, result: `= ${haunchVol.toFixed(4)} m³` },
      ];
    } else {
      // 水平加腋: 在梁侧, 三角形截面 = 0.5 × c1 × Δb × h
      haunchVol = sideCount * 0.5 * (haunchLen / 1000) * (haunchH / 1000) * (h / 1000);
      haunchDesc = `水平加腋 ${haunchLen}×${haunchH}mm × ${sideCount}处`;
      haunchSteps = [
        { label: '单处加腋体积', formula: 'V₁ = 0.5 × c₁ × Δb × h', substitution: `= 0.5 × ${haunchLen/1000} × ${haunchH/1000} × ${h/1000}`, result: `= ${(0.5 * haunchLen / 1000 * haunchH / 1000 * h / 1000).toFixed(4)} m³` },
        { label: '加腋总体积', formula: 'V = V₁ × 处数', substitution: `= ${(0.5 * haunchLen / 1000 * haunchH / 1000 * h / 1000).toFixed(4)} × ${sideCount}`, result: `= ${haunchVol.toFixed(4)} m³` },
      ];
    }
    items.push({ name: '加腋增量', volume: haunchVol, description: haunchDesc, formulaSteps: haunchSteps, color: '#6366F1' });
  }

  const totalVolume = items.reduce((s, it) => s + it.volume, 0);
  return { items, totalVolume };
}

// ─── 柱混凝土 ───
// 清单规范: 柱体积 = 截面面积 × 柱净高 (含柱头到板底)
// 梁柱节点体积归柱; 不扣钢筋
export function calcColumnConcrete(p: ColumnParams): ConcreteCalcResult {
  const b = p.b;
  const h = p.h;
  const height = p.height || 3000;

  const vol = (b / 1000) * (h / 1000) * (height / 1000);
  const steps: FormulaStep[] = [
    { label: '截面尺寸', formula: 'b × h', substitution: `= ${b} × ${h}`, result: `= ${b * h} mm²` },
    { label: '柱净高', formula: 'H', substitution: `= ${height}`, result: `= ${height} mm` },
    { label: '柱体积', formula: 'V = b × h × H', substitution: `= ${b/1000} × ${h/1000} × ${height/1000}`, result: `= ${vol.toFixed(4)} m³` },
  ];

  return {
    items: [{ name: '柱体', volume: vol, description: `${b}×${h}mm × H${height}mm`, formulaSteps: steps, color: '#3B82F6' }],
    totalVolume: vol,
  };
}

// ─── 板混凝土 ───
// 清单规范: 板体积 = 板面积 × 板厚 (扣柱/梁面积, 本项目暂不扣)
// 不扣钢筋
export function calcSlabConcrete(p: SlabParams, slabW = 3000, slabD = 3000): ConcreteCalcResult {
  const thickness = p.thickness;
  const area = slabW * slabD; // mm²

  const vol = (slabW / 1000) * (slabD / 1000) * (thickness / 1000);
  const steps: FormulaStep[] = [
    { label: '板面尺寸', formula: 'W × D', substitution: `= ${slabW} × ${slabD}`, result: `= ${(area / 1e6).toFixed(2)} m²` },
    { label: '板厚', formula: 't', substitution: `= ${thickness}`, result: `= ${thickness} mm` },
    { label: '板体积', formula: 'V = W × D × t', substitution: `= ${slabW/1000} × ${slabD/1000} × ${thickness/1000}`, result: `= ${vol.toFixed(4)} m³` },
  ];

  return {
    items: [{ name: '板体', volume: vol, description: `${slabW}×${slabD}mm × 厚${thickness}mm`, formulaSteps: steps, color: '#3B82F6' }],
    totalVolume: vol,
  };
}

// ─── 剪力墙混凝土 ───
// 清单规范: 墙体积 = 墙长 × 墙高 × 墙厚 (扣门窗洞口, 本项目暂无洞口)
// 不扣钢筋
export function calcShearWallConcrete(p: ShearWallParams): ConcreteCalcResult {
  const items: ConcreteCalcItem[] = [];
  const lw = p.lw;
  const hw = p.hw;
  const bw = p.bw;

  // 墙身体积
  const wallVol = (lw / 1000) * (hw / 1000) * (bw / 1000);
  const wallSteps: FormulaStep[] = [
    { label: '墙长', formula: 'lw', substitution: `= ${lw}`, result: `= ${lw} mm` },
    { label: '墙高', formula: 'hw', substitution: `= ${hw}`, result: `= ${hw} mm` },
    { label: '墙厚', formula: 'bw', substitution: `= ${bw}`, result: `= ${bw} mm` },
    { label: '墙身体积', formula: 'V = lw × hw × bw', substitution: `= ${lw/1000} × ${hw/1000} × ${bw/1000}`, result: `= ${wallVol.toFixed(4)} m³` },
  ];
  items.push({ name: '墙身', volume: wallVol, description: `${lw}×${hw}×${bw}mm`, formulaSteps: wallSteps, color: '#3B82F6' });

  // 约束边缘构件增量 (如果 boundary 长度 > bw，则超出墙厚部分需计入)
  // 清单规范: 暗柱并入墙体积，端柱另列。这里 boundaryLen = max(bw, 400)
  // 当 boundaryLen > bw 时，超出部分 = (boundaryLen - bw) × bw × hw × 2端
  const boundaryLen = Math.max(p.bw, 400);
  if (boundaryLen > bw) {
    const extraLen = boundaryLen - bw;
    const extraVol = 2 * (extraLen / 1000) * (bw / 1000) * (hw / 1000);
    const extraSteps: FormulaStep[] = [
      { label: '边缘构件长度', formula: 'l_b = max(bw, 400)', substitution: `= max(${bw}, 400)`, result: `= ${boundaryLen} mm` },
      { label: '超出墙厚部分', formula: 'Δl = l_b - bw', substitution: `= ${boundaryLen} - ${bw}`, result: `= ${extraLen} mm` },
      { label: '增量体积', formula: 'V = 2 × Δl × bw × hw', substitution: `= 2 × ${extraLen/1000} × ${bw/1000} × ${hw/1000}`, result: `= ${extraVol.toFixed(4)} m³` },
    ];
    items.push({ name: '边缘构件增量', volume: extraVol, description: `超出墙厚 ${extraLen}mm × 2端`, formulaSteps: extraSteps, color: '#8B5CF6' });
  }

  const totalVolume = items.reduce((s, it) => s + it.volume, 0);
  return { items, totalVolume };
}

// ─── 楼梯混凝土 ───
// 清单规范: 按设计图示尺寸以体积计算, 含梯段板+踏步+平台板+梯梁
// 梯段板: 斜面板体积 = 斜板长 × 梯段宽 × 板厚
// 踏步: 三角形截面 = 0.5 × 踏步宽 × 踏步高 × 梯段宽 × (n-2) 个 (首末踏步含在梯梁中)
// 平台板: 长 × 宽 × 厚
// 梯梁: b × h × 梯段宽
export function calcStairConcrete(p: StairParams): ConcreteCalcResult {
  const items: ConcreteCalcItem[] = [];
  const n = p.stepCount;
  const hMM = p.stepHeight;
  const bMM = p.stepWidth;
  const tMM = p.slabThickness;
  const wMM = p.flightWidth;
  const topPlatMM = p.topPlatformLen;
  const botPlatMM = p.botPlatformLen;
  const platTMM = p.platformThickness;
  const beamBMM = p.beamB;
  const beamHMM = p.beamH;

  const totalRise = n * hMM;
  const totalRun = n * bMM;
  const slabLen = Math.sqrt(totalRise * totalRise + totalRun * totalRun);

  // 1. 梯段斜板: slabLen × flightWidth × slabThickness
  const slabVol = (slabLen / 1000) * (wMM / 1000) * (tMM / 1000);
  const slabSteps: FormulaStep[] = [
    { label: '梯段斜长', formula: 'L = √(H² + B²)', substitution: `= √(${totalRise}² + ${totalRun}²)`, result: `= ${Math.round(slabLen)} mm` },
    { label: '梯段板体积', formula: 'V = L × w × t', substitution: `= ${(slabLen/1000).toFixed(3)} × ${wMM/1000} × ${tMM/1000}`, result: `= ${slabVol.toFixed(4)} m³` },
  ];
  items.push({ name: '梯段斜板', volume: slabVol, description: `斜长${Math.round(slabLen)}mm × 宽${wMM}mm × 厚${tMM}mm`, formulaSteps: slabSteps, color: '#3B82F6' });

  // 2. 踏步三角体积: 0.5 × b × h × w × (n-2)
  // 首末踏步被梯梁覆盖, 中间 n-2 个踏步
  const stepCount = Math.max(n - 2, 0);
  const stepVol = stepCount * 0.5 * (bMM / 1000) * (hMM / 1000) * (wMM / 1000);
  const stepSteps: FormulaStep[] = [
    { label: '踏步数 (扣首末)', formula: 'n_step = n - 2', substitution: `= ${n} - 2`, result: `= ${stepCount}` },
    { label: '单个踏步体积', formula: 'V₁ = 0.5 × b × h × w', substitution: `= 0.5 × ${bMM/1000} × ${hMM/1000} × ${wMM/1000}`, result: `= ${(0.5 * bMM / 1000 * hMM / 1000 * wMM / 1000).toFixed(4)} m³` },
    { label: '踏步总体积', formula: 'V = V₁ × n_step', substitution: `= ${(0.5 * bMM / 1000 * hMM / 1000 * wMM / 1000).toFixed(4)} × ${stepCount}`, result: `= ${stepVol.toFixed(4)} m³` },
  ];
  items.push({ name: '踏步', volume: stepVol, description: `${stepCount}个 × ${bMM}×${hMM}mm三角形`, formulaSteps: stepSteps, color: '#60A5FA' });

  // 3. 下平台板: botPlatLen × flightWidth × platformThickness
  const botPlatVol = (botPlatMM / 1000) * (wMM / 1000) * (platTMM / 1000);
  const botPlatSteps: FormulaStep[] = [
    { label: '下平台板体积', formula: 'V = L × w × t', substitution: `= ${botPlatMM/1000} × ${wMM/1000} × ${platTMM/1000}`, result: `= ${botPlatVol.toFixed(4)} m³` },
  ];
  items.push({ name: '下平台板', volume: botPlatVol, description: `${botPlatMM}×${wMM}×${platTMM}mm`, formulaSteps: botPlatSteps, color: '#93C5FD' });

  // 4. 上平台板: topPlatLen × flightWidth × platformThickness
  const topPlatVol = (topPlatMM / 1000) * (wMM / 1000) * (platTMM / 1000);
  const topPlatSteps: FormulaStep[] = [
    { label: '上平台板体积', formula: 'V = L × w × t', substitution: `= ${topPlatMM/1000} × ${wMM/1000} × ${platTMM/1000}`, result: `= ${topPlatVol.toFixed(4)} m³` },
  ];
  items.push({ name: '上平台板', volume: topPlatVol, description: `${topPlatMM}×${wMM}×${platTMM}mm`, formulaSteps: topPlatSteps, color: '#93C5FD' });

  // 5. 低端梯梁: beamB × beamH × (flightWidth + 墙体出挑)
  // 梯梁宽度 ≈ 梯段宽 (简化, 梯梁两端嵌入墙内不单独计)
  const botBeamVol = (beamBMM / 1000) * (beamHMM / 1000) * (wMM / 1000);
  const botBeamSteps: FormulaStep[] = [
    { label: '低端梯梁体积', formula: 'V = b × h × w', substitution: `= ${beamBMM/1000} × ${beamHMM/1000} × ${wMM/1000}`, result: `= ${botBeamVol.toFixed(4)} m³` },
  ];
  items.push({ name: '低端梯梁', volume: botBeamVol, description: `${beamBMM}×${beamHMM}mm × 长${wMM}mm`, formulaSteps: botBeamSteps, color: '#A78BFA' });

  // 6. 高端梯梁
  const topBeamVol = (beamBMM / 1000) * (beamHMM / 1000) * (wMM / 1000);
  const topBeamSteps: FormulaStep[] = [
    { label: '高端梯梁体积', formula: 'V = b × h × w', substitution: `= ${beamBMM/1000} × ${beamHMM/1000} × ${wMM/1000}`, result: `= ${topBeamVol.toFixed(4)} m³` },
  ];
  items.push({ name: '高端梯梁', volume: topBeamVol, description: `${beamBMM}×${beamHMM}mm × 长${wMM}mm`, formulaSteps: topBeamSteps, color: '#A78BFA' });

  const totalVolume = items.reduce((s, it) => s + it.volume, 0);
  return { items, totalVolume };
}
