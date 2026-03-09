/**
 * Build context strings from component params for AI assistant
 */
import type { BeamParams, ColumnParams, SlabParams, JointParams, ShearWallParams, StairParams } from './types';
import { parseRebar, parseStirrup, parseSlabRebar, gradeLabel } from './rebar';
import { calcLaE, FT, FY } from './anchor';
import type { ConcreteGrade, SeismicGrade } from './anchor';

/** 单根钢筋截面面积 mm² */
function As(d: number): number { return Math.PI * d * d / 4; }

export function buildBeamContext(p: BeamParams): string {
  const topR = parseRebar(p.top);
  const botR = parseRebar(p.bottom);
  const stir = parseStirrup(p.stirrup);
  const cover = p.cover || 25;
  const h0 = p.h - cover - botR.diameter / 2;
  const AsTop = topR.count * As(topR.diameter);
  const AsBot = botR.count * As(botR.diameter);
  const bh0 = p.b * h0;
  const rhoTop = (AsTop / bh0 * 100).toFixed(3);
  const rhoBot = (AsBot / bh0 * 100).toFixed(3);
  const ft = FT[p.concreteGrade] || 1.43;
  const fyBot = FY[botR.grade] || 360;
  const rhoMin = Math.max(0.2, 0.45 * ft / fyBot * 100).toFixed(3);
  const laETop = calcLaE(topR.grade, topR.diameter, p.concreteGrade as ConcreteGrade, (p.seismicGrade || '三级') as SeismicGrade);
  const laEBot = calcLaE(botR.grade, botR.diameter, p.concreteGrade as ConcreteGrade, (p.seismicGrade || '三级') as SeismicGrade);
  const canStraightAnchor = laETop <= (p.hc || 500) - cover;
  return `构件类型: 框架梁 ${p.id}
截面: ${p.b}×${p.h}mm，有效高度 h₀=${h0.toFixed(0)}mm
上部通长筋: ${p.top} (${topR.count}根 ${gradeLabel(topR.grade)} Φ${topR.diameter}，As=${AsTop.toFixed(0)}mm²)
下部通长筋: ${p.bottom} (${botR.count}根 ${gradeLabel(botR.grade)} Φ${botR.diameter}，As=${AsBot.toFixed(0)}mm²)
配筋率: 上部ρ=${rhoTop}%，下部ρ=${rhoBot}%，最小配筋率ρmin=${rhoMin}%
箍筋: ${p.stirrup} (${gradeLabel(stir.grade)} Φ${stir.diameter} 加密${stir.spacingDense}/非加密${stir.spacingNormal} ${stir.legs}肢箍)
锚固长度: 上部laE=${laETop}mm，下部laE=${laEBot}mm，${canStraightAnchor ? '可直锚(laE≤hc-c)' : '需弯锚(laE>hc-c)'}
左支座负筋: ${p.leftSupport || '无'}
右支座负筋: ${p.rightSupport || '无'}
腰筋/抗扭筋: ${p.sideBar || '无'}${p.sideBar ? `，拉筋: ${p.tieBar || '自动(b≤350→A6)'}` : ''}
混凝土等级: ${p.concreteGrade}(ft=${ft}MPa)，抗震等级: ${p.seismicGrade}
保护层: ${cover}mm，梁净跨: ${p.spanLength}mm，柱宽 hc: ${p.hc}mm${p.haunchType && p.haunchType !== 'none' ? `\n加腋: ${p.haunchType === 'horizontal' ? '水平' : '竖向'}加腋，c₁=${p.haunchLength}mm，${p.haunchType === 'horizontal' ? '高度' : '宽度'}=${p.haunchHeight}mm，${p.haunchSide === 'both' ? '两端' : p.haunchSide === 'left' ? '左端' : '右端'}` : ''}`;
}

export function buildColumnContext(p: ColumnParams): string {
  const mainR = parseRebar(p.main);
  const stir = parseStirrup(p.stirrup);
  const cover = p.cover || 25;
  const AsMain = mainR.count * As(mainR.diameter);
  const Ag = p.b * p.h;
  const rho = (AsMain / Ag * 100).toFixed(3);
  const ft = FT[p.concreteGrade] || 1.43;
  return `构件类型: 框架柱 ${p.id}
截面: ${p.b}×${p.h}mm，截面面积Ag=${Ag}mm²
纵筋: ${p.main} (${mainR.count}根 ${gradeLabel(mainR.grade)} Φ${mainR.diameter}，总As=${AsMain.toFixed(0)}mm²)
全截面配筋率: ρ=${rho}%
箍筋: ${p.stirrup} (${gradeLabel(stir.grade)} Φ${stir.diameter} 加密${stir.spacingDense}/非加密${stir.spacingNormal} ${stir.legs}肢箍)
混凝土等级: ${p.concreteGrade}(ft=${ft}MPa)，抗震等级: ${p.seismicGrade}
保护层: ${cover}mm，柱净高: ${p.height}mm`;
}

export function buildSlabContext(p: SlabParams): string {
  const cover = p.cover || 15;
  const h0 = p.thickness - cover - 5; // 估算有效高度
  const botX = parseSlabRebar(p.bottomX);
  const botY = parseSlabRebar(p.bottomY);
  const AsPerMBotX = (As(botX.diameter) * 1000 / botX.spacing).toFixed(0);
  const AsPerMBotY = (As(botY.diameter) * 1000 / botY.spacing).toFixed(0);
  const rhoBotX = (As(botX.diameter) * 1000 / botX.spacing / (1000 * h0) * 100).toFixed(3);
  const rhoBotY = (As(botY.diameter) * 1000 / botY.spacing / (1000 * h0) * 100).toFixed(3);
  const ft = FT[p.concreteGrade] || 1.43;
  const fy = FY[botX.grade] || 360;
  const rhoMin = Math.max(0.2, 0.45 * ft / fy * 100).toFixed(3);
  return `构件类型: 楼板 ${p.id}
板厚: ${p.thickness}mm，有效高度 h₀≈${h0}mm
X向底筋: ${p.bottomX} (As=${AsPerMBotX}mm²/m，ρ=${rhoBotX}%)
Y向底筋: ${p.bottomY} (As=${AsPerMBotY}mm²/m，ρ=${rhoBotY}%)
最小配筋率: ρmin=${rhoMin}%
X向面筋: ${p.topX || '无'}，Y向面筋: ${p.topY || '无'}
分布筋: ${p.distribution}
混凝土等级: ${p.concreteGrade}(ft=${ft}MPa)，保护层: ${cover}mm`;
}

export function buildJointContext(p: JointParams): string {
  const jointTypeLabel = { middle: '中间节点', side: '边节点', corner: '角节点' };
  const beamTopR = parseRebar(p.beamTop);
  const beamBotR = parseRebar(p.beamBottom);
  const cover = p.cover || 25;
  const laETop = calcLaE(beamTopR.grade, beamTopR.diameter, p.concreteGrade as ConcreteGrade, (p.seismicGrade || '三级') as SeismicGrade);
  const laEBot = calcLaE(beamBotR.grade, beamBotR.diameter, p.concreteGrade as ConcreteGrade, (p.seismicGrade || '三级') as SeismicGrade);
  const hc = p.colH || 500;
  const canStraight = laETop <= hc - cover;
  return `构件类型: 梁柱节点 (${jointTypeLabel[p.jointType]})
柱截面: ${p.colB}×${p.colH}mm，柱纵筋: ${p.colMain}
梁截面: ${p.beamB}×${p.beamH}mm
梁上部筋: ${p.beamTop} (${beamTopR.count}根Φ${beamTopR.diameter}，laE=${laETop}mm)
梁下部筋: ${p.beamBottom} (${beamBotR.count}根Φ${beamBotR.diameter}，laE=${laEBot}mm)
锚固方式: ${p.anchorType === 'bent' ? '弯锚' : '直锚'}，${canStraight ? '柱截面满足直锚条件(laE≤hc-c)' : '柱截面不满足直锚条件(laE>hc-c)'}
混凝土等级: ${p.concreteGrade}，抗震等级: ${p.seismicGrade}
保护层: ${cover}mm`;
}

export function buildShearWallContext(p: ShearWallParams): string {
  const vert = parseSlabRebar(p.vertBar);
  const horiz = parseSlabRebar(p.horizBar);
  const boundaryR = parseRebar(p.boundaryMain);
  // 竖向配筋率 (双排)
  const AsVert = 2 * As(vert.diameter) * 1000 / vert.spacing;
  const rhoVert = (AsVert / (p.bw * 1000) * 100).toFixed(3);
  const AsHoriz = 2 * As(horiz.diameter) * 1000 / horiz.spacing;
  const rhoHoriz = (AsHoriz / (p.bw * 1000) * 100).toFixed(3);
  const AsBoundary = boundaryR.count * As(boundaryR.diameter);
  return `构件类型: 剪力墙 ${p.id}
墙厚 bw: ${p.bw}mm，墙长 lw: ${p.lw}mm，墙净高 hw: ${p.hw}mm
竖向分布筋: ${p.vertBar} (${gradeLabel(vert.grade)} Φ${vert.diameter}@${vert.spacing}，双排，ρv=${rhoVert}%)
水平分布筋: ${p.horizBar} (${gradeLabel(horiz.grade)} Φ${horiz.diameter}@${horiz.spacing}，双排，ρh=${rhoHoriz}%)
约束边缘构件纵筋: ${p.boundaryMain} (${boundaryR.count}根 ${gradeLabel(boundaryR.grade)} Φ${boundaryR.diameter}，总As=${AsBoundary.toFixed(0)}mm²，两端各一组)
约束边缘构件箍筋: ${p.boundaryStirrup}
混凝土等级: ${p.concreteGrade}，抗震等级: ${p.seismicGrade}
保护层: ${p.cover}mm`;
}

export function buildStairContext(p: StairParams): string {
  const botR = parseSlabRebar(p.bottomBar);
  const topR = parseSlabRebar(p.topBar);
  const distR = parseSlabRebar(p.distBar);
  const totalRise = p.stepCount * p.stepHeight;
  const totalRun = p.stepCount * p.stepWidth;
  const angle = (Math.atan2(totalRise, totalRun) * 180 / Math.PI).toFixed(1);
  const slabLen = Math.round(Math.sqrt(totalRise * totalRise + totalRun * totalRun));
  const cover = p.cover || 15;
  const h0 = p.slabThickness - cover - botR.diameter / 2;
  const AsPerM = As(botR.diameter) * 1000 / botR.spacing;
  const rhoBot = (AsPerM / (1000 * h0) * 100).toFixed(3);
  const ft = FT[p.concreteGrade] || 1.43;
  const fy = FY[botR.grade] || 360;
  const rhoMin = Math.max(0.2, 0.45 * ft / fy * 100).toFixed(3);
  return `构件类型: AT型板式楼梯 ${p.id}
踏步: ${p.stepCount}步，踏步高 ${p.stepHeight}mm，踏步宽 ${p.stepWidth}mm
梯板厚: ${p.slabThickness}mm，有效高度 h₀≈${h0.toFixed(0)}mm，梯段宽: ${p.flightWidth}mm
总升高: ${totalRise}mm，总水平长: ${totalRun}mm，倾角: ${angle}°，斜长: ${slabLen}mm
上平台板长: ${p.topPlatformLen}mm，下平台板长: ${p.botPlatformLen}mm，平台板厚: ${p.platformThickness}mm
梯梁（梯板端支座梁）: ${p.beamB}×${p.beamH}mm（低端/高端）
下部纵筋: ${p.bottomBar} (${gradeLabel(botR.grade)} Φ${botR.diameter}@${botR.spacing}，As=${AsPerM.toFixed(0)}mm²/m，ρ=${rhoBot}%)
上部纵筋: ${p.topBar} (${gradeLabel(topR.grade)} Φ${topR.diameter}@${topR.spacing})
分布筋: ${p.distBar} (${gradeLabel(distR.grade)} Φ${distR.diameter}@${distR.spacing})
最小配筋率: ρmin=${rhoMin}%
混凝土等级: ${p.concreteGrade}(ft=${ft}MPa)，保护层: ${cover}mm`;
}
