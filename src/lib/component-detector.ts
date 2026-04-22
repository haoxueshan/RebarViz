/**
 * 从自然语言文本中检测构件类型
 * 用于首页全局 AI 输入和跨构件类型识别
 */
import type { ComponentType } from './types';

interface DetectionResult {
  detected: true;
  componentType: ComponentType;
  label: string;        // 中文名，如 "框架梁"
  route: string;        // 路由路径，如 "/beam"
  confidence: 'high' | 'medium';
}

interface DetectionFail {
  detected: false;
}

export type ComponentDetection = DetectionResult | DetectionFail;

const COMPONENT_META: Record<ComponentType, { label: string; route: string }> = {
  beam:      { label: '框架梁', route: '/beam' },
  column:    { label: '框架柱', route: '/column' },
  slab:      { label: '楼板',   route: '/slab' },
  joint:     { label: '梁柱节点', route: '/joint' },
  shearwall: { label: '剪力墙', route: '/shearwall' },
  stair:     { label: '楼梯',   route: '/stair' },
  foundation: { label: '独立基础', route: '/foundation' },
  stripfoundation: { label: '条形基础', route: '/stripfoundation' },
  pilecap:    { label: '承台',   route: '/pilecap' },
  raft:       { label: '筏板基础', route: '/raft' },
};

/**
 * 关键词规则 — 按优先级排列
 * high: 明确的构件编号或专有术语
 * medium: 通用描述词
 */
const RULES: Array<{ type: ComponentType; patterns: RegExp[]; confidence: 'high' | 'medium' }> = [
  // ─── 高置信度：编号/专有术语 ───
  { type: 'beam',      patterns: [/\bKL\d/i, /\bWKL\d/i, /\bKKL\d/i, /框架梁/, /连续梁/], confidence: 'high' },
  { type: 'column',    patterns: [/\bKZ\d/i, /\bKZZ\d/i, /框架柱/, /角筋/, /中部筋/], confidence: 'high' },
  { type: 'slab',      patterns: [/\bLB\d/i, /楼板配筋/, /板配筋/], confidence: 'high' },
  { type: 'shearwall', patterns: [/\bQ\d+\b/, /剪力墙/, /约束边缘构件/, /\bYBZ\b/i, /\bGBZ\b/i], confidence: 'high' },
  { type: 'joint',     patterns: [/梁柱节点/, /节点核心区/, /节点区/, /弯锚.*节点|节点.*弯锚/, /直锚.*节点|节点.*直锚/], confidence: 'high' },
  { type: 'stair',     patterns: [/\bAT\d/i, /\bBT\d/i, /板式楼梯/, /梯板/, /踏步/, /梯段/], confidence: 'high' },
  { type: 'stripfoundation', patterns: [/\bTJ[BJP]?\d/i, /条形基础/, /条基/, /双梁条形基础/, /基础梁.*条形基础|条形基础.*基础梁/], confidence: 'high' },
  { type: 'foundation', patterns: [/\bDJ\d/i, /独立基础/, /柱下基础/, /阶形基础/, /锥形基础/], confidence: 'high' },
  { type: 'pilecap',    patterns: [/\bCT\d/i, /承台/, /桩基承台/, /桩帽/], confidence: 'high' },
  { type: 'raft',       patterns: [/\bFB\d/i, /筏板基础/, /筏板/, /筏形基础/], confidence: 'high' },

  // ─── 中置信度：通用描述 ───
  { type: 'beam',      patterns: [/梁/, /上部筋.*下部筋|下部筋.*上部筋/, /支座负筋/, /箍筋加密/], confidence: 'medium' },
  { type: 'column',    patterns: [/柱[子截]/, /柱.*纵筋|纵筋.*柱/], confidence: 'medium' },
  { type: 'slab',      patterns: [/板[厚底面]/, /底筋.*面筋|面筋.*底筋/, /分布筋/], confidence: 'medium' },
  { type: 'shearwall', patterns: [/墙[厚长]/, /竖向.*水平|水平.*竖向/], confidence: 'medium' },
  { type: 'joint',     patterns: [/节点/, /锚固.*方式|弯锚|直锚/], confidence: 'medium' },
  { type: 'stair',     patterns: [/楼梯/, /梯[板梁]/, /踏步/], confidence: 'medium' },
  { type: 'stripfoundation', patterns: [/基础梁/, /双墙/, /双梁/, /底板配筋.*分布筋|分布筋.*底板配筋/], confidence: 'medium' },
  { type: 'foundation', patterns: [/基础/, /基底/, /柱插筋/], confidence: 'medium' },
  { type: 'pilecap',    patterns: [/桩基/, /桩径/, /桩距/, /桩数/], confidence: 'medium' },
  { type: 'raft',       patterns: [/柱网/, /筏[板形]/, /板厚.*柱距|柱距.*板厚/], confidence: 'medium' },
];

/**
 * 检测文本中的构件类型
 */
export function detectComponentType(text: string): ComponentDetection {
  const trimmed = text.trim();
  if (!trimmed) return { detected: false };

  // 先扫高置信度规则
  for (const rule of RULES) {
    if (rule.confidence !== 'high') continue;
    for (const pattern of rule.patterns) {
      if (pattern.test(trimmed)) {
        const meta = COMPONENT_META[rule.type];
        return { detected: true, componentType: rule.type, ...meta, confidence: 'high' };
      }
    }
  }

  // 再扫中置信度规则
  for (const rule of RULES) {
    if (rule.confidence !== 'medium') continue;
    for (const pattern of rule.patterns) {
      if (pattern.test(trimmed)) {
        const meta = COMPONENT_META[rule.type];
        return { detected: true, componentType: rule.type, ...meta, confidence: 'medium' };
      }
    }
  }

  return { detected: false };
}

/**
 * 获取构件类型的中文名称
 */
export function getComponentLabel(type: ComponentType): string {
  return COMPONENT_META[type].label;
}

/**
 * 获取构件类型对应的路由
 */
export function getComponentRoute(type: ComponentType): string {
  return COMPONENT_META[type].route;
}
