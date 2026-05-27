/**
 * NL Rebar Prompt 构造 — 为 AI 生成配筋解析请求
 */
import type { ComponentType, BeamParams, ColumnParams, SlabParams, JointParams, ShearWallParams, StripFoundationParams } from './types';
import type { RebarGenSchema, RebarSpec, DistributedRebarSpec, StirrupSpec } from './nl-rebar-schema';
import { JSON_SCHEMAS, LETTER_TO_GRADE } from './nl-rebar-schema';
import { parseRebar, parseStirrup, parseSlabRebar } from './rebar';

const COMPONENT_NAMES: Record<ComponentType, string> = {
  beam: '框架梁', column: '框架柱', shearwall: '剪力墙', slab: '楼板', joint: '梁柱节点', stair: '楼梯', foundation: '独立基础', stripfoundation: '条形基础', pilecap: '承台', raft: '筏板基础',
};

const NL_SYSTEM_BASE = `你是一位资深结构工程师，精通22G101图集和GB50010规范。
你的任务是将用户的中文配筋描述解析为严格的JSON对象。

钢筋等级对照：
- HPB300 (一级钢，光圆) — 常用于箍筋
- HRB335 (二级钢)
- HRB400 (三级钢) — 最常用
- RRB400 (四级钢)
- HRBF400 (细晶粒钢)

标准钢筋直径(mm): 6, 8, 10, 12, 14, 16, 18, 20, 22, 25, 28, 32, 36, 40

输出规则：
1. 只输出纯JSON，不要包含任何解释文字或markdown标记
2. 只填写用户明确提到的字段，未提及的字段不要输出
3. 钢筋等级使用全称如 "HRB400"，不要用缩写字母
4. 数值使用整数，单位为mm
5. componentType 必须填写`;

/** 构造 AI 解析请求 */
export function buildNLPrompt(
  componentType: ComponentType,
  currentParams: BeamParams | ColumnParams | SlabParams | JointParams | ShearWallParams | StripFoundationParams,
  userText: string
): { system: string; user: string } {
  const schema = JSON_SCHEMAS[componentType];
  const name = COMPONENT_NAMES[componentType];
  const currentDesc = formatParams(componentType, currentParams);

  const system = `${NL_SYSTEM_BASE}

当前构件类型: ${name}
输出JSON格式:
${schema}`;

  const user = `当前参数:
${currentDesc}

用户描述: ${userText}

请将上述描述解析为JSON。只输出JSON，不要其他内容。`;

  return { system, user };
}

// ─── formatParams: 结构化参数 → 中文可读描述 ───

function fmtRebar(notation: string): string {
  const r = parseRebar(notation);
  return `${r.count}根${LETTER_TO_GRADE[r.grade] || r.grade} Φ${r.diameter}`;
}

function fmtDistributed(notation: string): string {
  const r = parseSlabRebar(notation);
  return `${LETTER_TO_GRADE[r.grade] || r.grade} Φ${r.diameter}@${r.spacing}`;
}

function fmtStirrup(notation: string): string {
  const s = parseStirrup(notation);
  return `${LETTER_TO_GRADE[s.grade] || s.grade} Φ${s.diameter} 加密${s.spacingDense}/非加密${s.spacingNormal} ${s.legs}肢箍`;
}

export function formatParams(
  componentType: ComponentType,
  params: BeamParams | ColumnParams | SlabParams | JointParams | ShearWallParams | StripFoundationParams
): string {
  switch (componentType) {
    case 'beam': {
      const p = params as BeamParams;
      let s = `截面: ${p.b}×${p.h}mm, 上部筋: ${p.top}(${fmtRebar(p.top)}), 下部筋: ${p.bottom}(${fmtRebar(p.bottom)}), 箍筋: ${p.stirrup}(${fmtStirrup(p.stirrup)})`;
      if (p.leftSupport) s += `, 左支座负筋: ${p.leftSupport}`;
      if (p.rightSupport) s += `, 右支座负筋: ${p.rightSupport}`;
      s += `, 混凝土: ${p.concreteGrade}, 抗震: ${p.seismicGrade}, 保护层: ${p.cover}mm, 净跨: ${p.spanLength}mm, 支座柱宽hc: ${p.hc}mm, 支座柱截面深度: ${p.supportDepth || 600}mm`;
      return s;
    }
    case 'column': {
      const p = params as ColumnParams;
      let s = `截面: ${p.b}×${p.h}mm, 全部纵筋: ${p.main}(${fmtRebar(p.main)})`;
      if (p.cornerMain) s += `, 角筋: ${p.cornerMain}(${fmtRebar(p.cornerMain)})`;
      if (p.bMiddleMain) s += `, b边中部筋: ${p.bMiddleMain}(${fmtRebar(p.bMiddleMain)}每侧)`;
      if (p.hMiddleMain) s += `, h边中部筋: ${p.hMiddleMain}(${fmtRebar(p.hMiddleMain)}每侧)`;
      s += `, 箍筋: ${p.stirrup}(${fmtStirrup(p.stirrup)}), 混凝土: ${p.concreteGrade}, 抗震: ${p.seismicGrade}, 保护层: ${p.cover}mm, 柱净高: ${p.height}mm`;
      return s;
    }
    case 'shearwall': {
      const p = params as ShearWallParams;
      return `墙厚: ${p.bw}mm, 墙长: ${p.lw}mm, 墙高: ${p.hw}mm, 竖向分布筋: ${p.vertBar}(${fmtDistributed(p.vertBar)}), 水平分布筋: ${p.horizBar}(${fmtDistributed(p.horizBar)}), 边缘构件纵筋: ${p.boundaryMain}(${fmtRebar(p.boundaryMain)}), 边缘构件箍筋: ${p.boundaryStirrup}, 混凝土: ${p.concreteGrade}, 抗震: ${p.seismicGrade}, 保护层: ${p.cover}mm`;
    }
    case 'slab': {
      const p = params as SlabParams;
      const stLabel = p.supportType === 'simple' ? '简支' : p.supportType === 'continuous' ? '连续' : '悬挑';
      let s = `板厚: ${p.thickness}mm, 板跨: ${p.spanX}×${p.spanY}mm, 支座: ${stLabel}, 梁宽: ${p.supportBeamWidth}mm`;
      s += `, X向底筋: ${p.bottomX}(${fmtDistributed(p.bottomX)}), Y向底筋: ${p.bottomY}(${fmtDistributed(p.bottomY)})`;
      if (p.topX) s += `, X向面筋: ${p.topX}`;
      if (p.topY) s += `, Y向面筋: ${p.topY}`;
      if (p.supportNegX) s += `, X向支座负筋: ${p.supportNegX}`;
      if (p.supportNegY) s += `, Y向支座负筋: ${p.supportNegY}`;
      if (p.distribution) s += `, 分布筋: ${p.distribution}`;
      s += `, 混凝土: ${p.concreteGrade}, 保护层: ${p.cover}mm`;
      return s;
    }
    case 'joint': {
      const p = params as JointParams;
      const jt = { middle: '中间节点', side: '边节点', corner: '角节点' };
      return `柱截面: ${p.colB}×${p.colH}mm, 柱纵筋: ${p.colMain}, 梁截面: ${p.beamB}×${p.beamH}mm, 梁上部筋: ${p.beamTop}, 梁下部筋: ${p.beamBottom}, 节点类型: ${jt[p.jointType]}, 锚固: ${p.anchorType === 'bent' ? '弯锚' : '直锚'}, 混凝土: ${p.concreteGrade}, 抗震: ${p.seismicGrade}, 保护层: ${p.cover}mm`;
    }
    case 'stripfoundation': {
      const p = params as StripFoundationParams;
      return `条基底板: ${p.length}×${p.width}×${p.h}mm, 底部横向筋: ${p.bottomBar}(${fmtDistributed(p.bottomBar)}), 底部分布筋: ${p.distBar}(${fmtDistributed(p.distBar)}), 顶部横向筋: ${p.topBar || '无'}, 顶部分布筋: ${p.topDistBar || '无'}, 支承: ${p.supportCount}${p.supportType === 'beam' ? '梁' : '墙'}, 支承宽度: ${p.supportWidth}mm${p.supportSpacing ? `, 中心距: ${p.supportSpacing}mm` : ''}, 混凝土: ${p.concreteGrade}, 保护层: ${p.cover}mm`;
    }
    default: return '';
  }
}

// ─── formatSchemaPreview: RebarGenSchema → 中文预览 ───

function fmtRebarSpec(r: RebarSpec): string {
  return `${r.count}根${r.grade} Φ${r.diameter}`;
}
function fmtDistSpec(d: DistributedRebarSpec): string {
  return `${d.grade} Φ${d.diameter}@${d.spacing}`;
}
function fmtStirrupSpec(s: StirrupSpec): string {
  return `${s.grade} Φ${s.diameter} ${s.spacingDense}/${s.spacingNormal} ${s.legs}肢`;
}

export function formatSchemaPreview(schema: RebarGenSchema, componentType: ComponentType): string {
  const lines: string[] = [];
  switch (componentType) {
    case 'beam': {
      const s = schema as import('./nl-rebar-schema').BeamSchema;
      if (s.sectionWidth !== undefined || s.sectionHeight !== undefined) lines.push(`截面: ${s.sectionWidth ?? '—'}×${s.sectionHeight ?? '—'}mm`);
      if (s.topRebar) lines.push(`上部筋: ${typeof s.topRebar === 'string' ? s.topRebar : fmtRebarSpec(s.topRebar)}`);
      if (s.bottomRebar) lines.push(`下部筋: ${typeof s.bottomRebar === 'string' ? s.bottomRebar : fmtRebarSpec(s.bottomRebar)}`);
      if (s.stirrup) lines.push(`箍筋: ${fmtStirrupSpec(s.stirrup)}`);
      if (s.leftSupportRebar) lines.push(`左支座负筋: ${fmtRebarSpec(s.leftSupportRebar)}`);
      if (s.rightSupportRebar) lines.push(`右支座负筋: ${fmtRebarSpec(s.rightSupportRebar)}`);
      if (s.concreteGrade) lines.push(`混凝土: ${s.concreteGrade}`);
      if (s.seismicGrade) lines.push(`抗震: ${s.seismicGrade}`);
      if (s.cover !== undefined) lines.push(`保护层: ${s.cover}mm`);
      if (s.spanLength !== undefined) lines.push(`净跨: ${s.spanLength}mm`);
      if (s.columnWidth !== undefined) lines.push(`柱宽hc: ${s.columnWidth}mm`);
      break;
    }
    case 'column': {
      const s = schema as import('./nl-rebar-schema').ColumnSchema;
      if (s.sectionWidth !== undefined || s.sectionHeight !== undefined) lines.push(`截面: ${s.sectionWidth ?? '—'}×${s.sectionHeight ?? '—'}mm`);
      if (s.mainRebar) lines.push(`全部纵筋: ${fmtRebarSpec(s.mainRebar)}`);
      if (s.cornerRebar) lines.push(`角筋: ${fmtRebarSpec(s.cornerRebar)}`);
      if (s.bMiddleRebar) lines.push(`b边中部筋: ${fmtRebarSpec(s.bMiddleRebar)}(每侧)`);
      if (s.hMiddleRebar) lines.push(`h边中部筋: ${fmtRebarSpec(s.hMiddleRebar)}(每侧)`);
      if (s.stirrup) lines.push(`箍筋: ${fmtStirrupSpec(s.stirrup)}`);
      if (s.concreteGrade) lines.push(`混凝土: ${s.concreteGrade}`);
      if (s.seismicGrade) lines.push(`抗震: ${s.seismicGrade}`);
      if (s.cover !== undefined) lines.push(`保护层: ${s.cover}mm`);
      if (s.height !== undefined) lines.push(`柱净高: ${s.height}mm`);
      break;
    }
    case 'shearwall': {
      const s = schema as import('./nl-rebar-schema').ShearWallSchema;
      if (s.wallThickness !== undefined) lines.push(`墙厚: ${s.wallThickness}mm`);
      if (s.wallLength !== undefined) lines.push(`墙长: ${s.wallLength}mm`);
      if (s.wallHeight !== undefined) lines.push(`墙高: ${s.wallHeight}mm`);
      if (s.verticalBar) lines.push(`竖向分布筋: ${fmtDistSpec(s.verticalBar)}`);
      if (s.horizontalBar) lines.push(`水平分布筋: ${fmtDistSpec(s.horizontalBar)}`);
      if (s.boundaryMainRebar) lines.push(`边缘构件纵筋: ${fmtRebarSpec(s.boundaryMainRebar)}`);
      if (s.boundaryStirrup) lines.push(`边缘构件箍筋: ${fmtStirrupSpec(s.boundaryStirrup)}`);
      if (s.concreteGrade) lines.push(`混凝土: ${s.concreteGrade}`);
      if (s.seismicGrade) lines.push(`抗震: ${s.seismicGrade}`);
      break;
    }
    case 'slab': {
      const s = schema as import('./nl-rebar-schema').SlabSchema;
      if (s.thickness !== undefined) lines.push(`板厚: ${s.thickness}mm`);
      if (s.spanX !== undefined || s.spanY !== undefined) lines.push(`板跨: ${s.spanX ?? '—'}×${s.spanY ?? '—'}mm`);
      if (s.supportType) lines.push(`支座: ${{ simple: '简支', continuous: '连续', cantilever: '悬挑' }[s.supportType]}`);
      if (s.supportBeamWidth !== undefined) lines.push(`梁宽: ${s.supportBeamWidth}mm`);
      if (s.bottomXBar) lines.push(`X向底筋: ${fmtDistSpec(s.bottomXBar)}`);
      if (s.bottomYBar) lines.push(`Y向底筋: ${fmtDistSpec(s.bottomYBar)}`);
      if (s.topXBar) lines.push(`X向面筋: ${fmtDistSpec(s.topXBar)}`);
      if (s.topYBar) lines.push(`Y向面筋: ${fmtDistSpec(s.topYBar)}`);
      if (s.supportNegXBar) lines.push(`X向支座负筋: ${fmtDistSpec(s.supportNegXBar)}`);
      if (s.supportNegYBar) lines.push(`Y向支座负筋: ${fmtDistSpec(s.supportNegYBar)}`);
      if (s.distributionBar) lines.push(`分布筋: ${fmtDistSpec(s.distributionBar)}`);
      if (s.concreteGrade) lines.push(`混凝土: ${s.concreteGrade}`);
      if (s.cover !== undefined) lines.push(`保护层: ${s.cover}mm`);
      break;
    }
    case 'joint': {
      const s = schema as import('./nl-rebar-schema').JointSchema;
      if (s.columnWidth !== undefined || s.columnHeight !== undefined) lines.push(`柱截面: ${s.columnWidth ?? '—'}×${s.columnHeight ?? '—'}mm`);
      if (s.columnMainRebar) lines.push(`柱纵筋: ${fmtRebarSpec(s.columnMainRebar)}`);
      if (s.columnStirrup) lines.push(`柱箍筋: ${fmtStirrupSpec(s.columnStirrup)}`);
      if (s.beamWidth !== undefined || s.beamHeight !== undefined) lines.push(`梁截面: ${s.beamWidth ?? '—'}×${s.beamHeight ?? '—'}mm`);
      if (s.beamTopRebar) lines.push(`梁上部筋: ${fmtRebarSpec(s.beamTopRebar)}`);
      if (s.beamBottomRebar) lines.push(`梁下部筋: ${fmtRebarSpec(s.beamBottomRebar)}`);
      if (s.beamStirrup) lines.push(`梁箍筋: ${fmtStirrupSpec(s.beamStirrup)}`);
      if (s.jointType) lines.push(`节点类型: ${{ middle: '中间', side: '边', corner: '角' }[s.jointType]}节点`);
      if (s.anchorType) lines.push(`锚固: ${s.anchorType === 'bent' ? '弯锚' : '直锚'}`);
      if (s.concreteGrade) lines.push(`混凝土: ${s.concreteGrade}`);
      if (s.seismicGrade) lines.push(`抗震: ${s.seismicGrade}`);
      break;
    }
    case 'stripfoundation': {
      const s = schema as import('./nl-rebar-schema').StripFoundationSchema;
      if (s.length !== undefined || s.width !== undefined || s.h !== undefined) lines.push(`底板: ${s.length ?? '—'}×${s.width ?? '—'}×${s.h ?? '—'}mm`);
      if (s.bottomBar) lines.push(`底部横向筋: ${s.bottomBar}`);
      if (s.distBar) lines.push(`底部分布筋: ${s.distBar}`);
      if (s.topBar) lines.push(`顶部横向筋: ${s.topBar}`);
      if (s.topDistBar) lines.push(`顶部分布筋: ${s.topDistBar}`);
      if (s.supportType) lines.push(`支承类型: ${s.supportType === 'beam' ? '梁' : '墙'}`);
      if (s.supportCount !== undefined) lines.push(`支承道数: ${s.supportCount}`);
      if (s.supportWidth !== undefined) lines.push(`支承宽度: ${s.supportWidth}mm`);
      if (s.supportSpacing !== undefined) lines.push(`支承中心距: ${s.supportSpacing}mm`);
      if (s.jlBottom) lines.push(`JL底筋: ${s.jlBottom}`);
      if (s.jlTop) lines.push(`JL顶筋: ${s.jlTop}`);
      if (s.jlStirrup) lines.push(`JL箍筋: ${s.jlStirrup}`);
      if (s.hasJcl !== undefined) lines.push(`JCL: ${s.hasJcl ? '是' : '否'}`);
      if (s.jclCount !== undefined) lines.push(`JCL道数: ${s.jclCount}`);
      if (s.jclSpacing !== undefined) lines.push(`JCL中心距: ${s.jclSpacing}mm`);
      if (s.jclB !== undefined || s.jclH !== undefined) lines.push(`JCL截面: ${s.jclB ?? '—'}×${s.jclH ?? '—'}mm`);
      if (s.jclBottom) lines.push(`JCL底筋: ${s.jclBottom}`);
      if (s.jclTop) lines.push(`JCL顶筋: ${s.jclTop}`);
      if (s.jclStirrup) lines.push(`JCL箍筋: ${s.jclStirrup}`);
      if (s.hasLocalOverride !== undefined) lines.push(`原位修正: ${s.hasLocalOverride ? '是' : '否'}`);
      if (s.localOverrideStart !== undefined || s.localOverrideLength !== undefined) lines.push(`修正段: 起点${s.localOverrideStart ?? '—'}mm, 长度${s.localOverrideLength ?? '—'}mm`);
      if (s.localBottomBar) lines.push(`修正底筋: ${s.localBottomBar}`);
      if (s.localTopBar) lines.push(`修正顶筋: ${s.localTopBar}`);
      if (s.concreteGrade) lines.push(`混凝土: ${s.concreteGrade}`);
      if (s.cover !== undefined) lines.push(`保护层: ${s.cover}mm`);
      break;
    }
  }
  return lines.join('\n');
}
