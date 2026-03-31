/**
 * 全局常量定义
 * 统一管理颜色、单位换算、施工步骤等
 */

// ═══════════════════════════════════════════════════════════════════
// 单位换算
// ═══════════════════════════════════════════════════════════════════

/** mm → m 单位换算 */
export const S = 0.001;

// ═══════════════════════════════════════════════════════════════════
// 钢筋颜色
// ═══════════════════════════════════════════════════════════════════

/** 普通钢筋 (纵筋) */
export const COLOR_REBAR = '#C0392B';
export const COLOR_REBAR_HI = '#E74C3C';

/** 箍筋 - 通用 */
export const COLOR_STIRRUP = '#27AE60';
export const COLOR_STIRRUP_HI = '#2ECC71';

/** 箍筋 - 加密区 */
export const COLOR_STIRRUP_DENSE = '#1E8449';
export const COLOR_STIRRUP_DENSE_HI = '#27AE60';

/** 箍筋 - 非加密区 */
export const COLOR_STIRRUP_NORMAL = '#7DCEA0';
export const COLOR_STIRRUP_NORMAL_HI = '#A9DFBF';

/** 支座负筋 */
export const COLOR_SUPPORT = '#8E44AD';
export const COLOR_SUPPORT_HI = '#9B59B6';

/** 架立筋 */
export const COLOR_ERECTION = '#F39C12';
export const COLOR_ERECTION_HI = '#F1C40F';

/** 加腋附加筋 */
export const COLOR_HAUNCH = '#E67E22';
export const COLOR_HAUNCH_HI = '#F39C12';

/** 腰筋/抗扭筋 */
export const COLOR_SIDEBAR = '#2980B9';
export const COLOR_SIDEBAR_HI = '#3498DB';

/** 拉筋 */
export const COLOR_TIEBAR = '#1ABC9C';
export const COLOR_TIEBAR_HI = '#16A085';

/** 混凝土 (柱) */
export const COLOR_COLUMN = '#7F8C8D';

/** 剪力墙分布筋 */
export const COLOR_VERT_BAR = '#3498DB';
export const COLOR_VERT_BAR_HI = '#5DADE2';
export const COLOR_HORIZ_BAR = '#9B59B6';
export const COLOR_HORIZ_BAR_HI = '#AF7AC5';

/** 约束边缘构件 */
export const COLOR_BOUNDARY = '#E74C3C';
export const COLOR_BOUNDARY_HI = '#F1948A';

// ═══════════════════════════════════════════════════════════════════
// 施工步骤定义
// ═══════════════════════════════════════════════════════════════════

export interface ConstructionStep {
  groups: Set<string>;
  label: string;
}

/** 梁施工步骤 */
export const BEAM_CONSTRUCTION_STEPS: ConstructionStep[] = [
  { groups: new Set(['concrete']), label: '模板+混凝土' },
  { groups: new Set(['concrete', 'stirrup']), label: '+箍筋' },
  { groups: new Set(['concrete', 'stirrup', 'bottom']), label: '+下部纵筋' },
  { groups: new Set(['concrete', 'stirrup', 'bottom', 'top']), label: '+上部纵筋' },
  { groups: new Set(['concrete', 'stirrup', 'bottom', 'top', 'support']), label: '+支座负筋/架立筋' },
  { groups: new Set(['concrete', 'stirrup', 'bottom', 'top', 'support', 'sideBar']), label: '+腰筋/拉筋' },
  { groups: new Set(['concrete', 'stirrup', 'bottom', 'top', 'support', 'sideBar', 'haunch']), label: '+加腋附加筋' },
];

/** 柱施工步骤 */
export const COLUMN_CONSTRUCTION_STEPS: ConstructionStep[] = [
  { groups: new Set(['concrete']), label: '模板+混凝土' },
  { groups: new Set(['concrete', 'main']), label: '+纵筋' },
  { groups: new Set(['concrete', 'main', 'stirrup']), label: '+箍筋' },
];

/** 剪力墙施工步骤 */
export const SHEARWALL_CONSTRUCTION_STEPS: ConstructionStep[] = [
  { groups: new Set(['concrete']), label: '模板+混凝土' },
  { groups: new Set(['concrete', 'vertBar']), label: '+竖向分布筋' },
  { groups: new Set(['concrete', 'vertBar', 'horizBar']), label: '+水平分布筋' },
  { groups: new Set(['concrete', 'vertBar', 'horizBar', 'boundary']), label: '+约束边缘构件' },
];

// ═══════════════════════════════════════════════════════════════════
// 渲染参数
// ═══════════════════════════════════════════════════════════════════

/** 楼梯上部筋 */
export const COLOR_STAIR_TOP = '#8E44AD';
export const COLOR_STAIR_TOP_HI = '#9B59B6';

/** 楼梯下部筋 */
export const COLOR_STAIR_BOTTOM = '#C0392B';
export const COLOR_STAIR_BOTTOM_HI = '#E74C3C';

/** 楼梯分布筋 */
export const COLOR_STAIR_DIST = '#27AE60';
export const COLOR_STAIR_DIST_HI = '#2ECC71';

/** 楼梯施工步骤 */
export const STAIR_CONSTRUCTION_STEPS: ConstructionStep[] = [
  { groups: new Set(['concrete']), label: '模板+混凝土' },
  { groups: new Set(['concrete', 'bottom']), label: '+下部纵筋' },
  { groups: new Set(['concrete', 'bottom', 'top']), label: '+上部纵筋' },
  { groups: new Set(['concrete', 'bottom', 'top', 'dist']), label: '+分布筋' },
];

/** 基础底筋 X 向 */
export const COLOR_FOUND_BOTTOM_X = '#C0392B';
export const COLOR_FOUND_BOTTOM_X_HI = '#E74C3C';

/** 基础底筋 Y 向 */
export const COLOR_FOUND_BOTTOM_Y = '#2980B9';
export const COLOR_FOUND_BOTTOM_Y_HI = '#3498DB';

/** 基础柱插筋 */
export const COLOR_FOUND_COL = '#8E44AD';
export const COLOR_FOUND_COL_HI = '#9B59B6';

/** 基础顶筋 X 向 */
export const COLOR_FOUND_TOP_X = '#E67E22';
export const COLOR_FOUND_TOP_X_HI = '#F39C12';

/** 基础顶筋 Y 向 */
export const COLOR_FOUND_TOP_Y = '#27AE60';
export const COLOR_FOUND_TOP_Y_HI = '#2ECC71';

/** 独立基础施工步骤 */
export const FOUNDATION_CONSTRUCTION_STEPS: ConstructionStep[] = [
  { groups: new Set(['concrete']), label: '模板+混凝土' },
  { groups: new Set(['concrete', 'bottomX']), label: '+X向底筋' },
  { groups: new Set(['concrete', 'bottomX', 'bottomY']), label: '+Y向底筋' },
  { groups: new Set(['concrete', 'bottomX', 'bottomY', 'colMain']), label: '+柱插筋' },
];

/** 双列基础施工步骤 */
export const FOUNDATION_DUAL_COL_STEPS: ConstructionStep[] = [
  { groups: new Set(['concrete']), label: '模板+混凝土' },
  { groups: new Set(['concrete', 'bottomX']), label: '+X向底筋' },
  { groups: new Set(['concrete', 'bottomX', 'bottomY']), label: '+Y向底筋' },
  { groups: new Set(['concrete', 'bottomX', 'bottomY', 'topX']), label: '+X向顶筋' },
  { groups: new Set(['concrete', 'bottomX', 'bottomY', 'topX', 'topY']), label: '+Y向顶筋' },
  { groups: new Set(['concrete', 'bottomX', 'bottomY', 'topX', 'topY', 'colMain']), label: '+柱插筋' },
];

// ─── 承台 (Pile Cap) ─────────────────────────────────

/** 承台底筋 X 向 */
export const COLOR_PC_BOTTOM_X = '#C0392B';
export const COLOR_PC_BOTTOM_X_HI = '#E74C3C';

/** 承台底筋 Y 向 */
export const COLOR_PC_BOTTOM_Y = '#2980B9';
export const COLOR_PC_BOTTOM_Y_HI = '#3498DB';

/** 承台柱插筋 */
export const COLOR_PC_COL = '#8E44AD';
export const COLOR_PC_COL_HI = '#9B59B6';

/** 桩体 */
export const COLOR_PC_PILE = '#7F8C8D';
export const COLOR_PC_PILE_HI = '#95A5A6';

/** 承台施工步骤 */
export const PILECAP_CONSTRUCTION_STEPS: ConstructionStep[] = [
  { groups: new Set(['pile']), label: '桩基施工' },
  { groups: new Set(['pile', 'concrete']), label: '+承台混凝土' },
  { groups: new Set(['pile', 'concrete', 'bottomX']), label: '+X向底筋' },
  { groups: new Set(['pile', 'concrete', 'bottomX', 'bottomY']), label: '+Y向底筋' },
  { groups: new Set(['pile', 'concrete', 'bottomX', 'bottomY', 'colMain']), label: '+柱插筋' },
];

// ─── 筏板基础 (Raft) ─────────────────────────────────

/** 筏板底筋 X 向 */
export const COLOR_RAFT_BOTTOM_X = '#C0392B';
export const COLOR_RAFT_BOTTOM_X_HI = '#E74C3C';

/** 筏板底筋 Y 向 */
export const COLOR_RAFT_BOTTOM_Y = '#2980B9';
export const COLOR_RAFT_BOTTOM_Y_HI = '#3498DB';

/** 筏板面筋 X 向 */
export const COLOR_RAFT_TOP_X = '#E67E22';
export const COLOR_RAFT_TOP_X_HI = '#F39C12';

/** 筏板面筋 Y 向 */
export const COLOR_RAFT_TOP_Y = '#27AE60';
export const COLOR_RAFT_TOP_Y_HI = '#2ECC71';

/** 筏板柱插筋 */
export const COLOR_RAFT_COL = '#8E44AD';
export const COLOR_RAFT_COL_HI = '#9B59B6';

/** 基础主梁 JL 底部纵筋 */
export const COLOR_RAFT_BEAM_BOTTOM = '#C0392B';
export const COLOR_RAFT_BEAM_BOTTOM_HI = '#E74C3C';

/** 基础主梁 JL 顶部纵筋 */
export const COLOR_RAFT_BEAM_TOP = '#E67E22';
export const COLOR_RAFT_BEAM_TOP_HI = '#F39C12';

/** 基础主梁 JL 箍筋 */
export const COLOR_RAFT_BEAM_STIRRUP = '#27AE60';
export const COLOR_RAFT_BEAM_STIRRUP_HI = '#2ECC71';

/** 平板式筏基 — 柱下板带 ZXB 附加底筋 */
export const COLOR_RAFT_COL_STRIP = '#D35400';
export const COLOR_RAFT_COL_STRIP_HI = '#E67E22';

/** 筏板基础施工步骤 (平板式) */
export const RAFT_CONSTRUCTION_STEPS: ConstructionStep[] = [
  { groups: new Set(['concrete']), label: '模板+混凝土' },
  { groups: new Set(['concrete', 'bottomX']), label: '+X向底筋' },
  { groups: new Set(['concrete', 'bottomX', 'bottomY']), label: '+Y向底筋' },
  { groups: new Set(['concrete', 'bottomX', 'bottomY', 'topX']), label: '+X向面筋' },
  { groups: new Set(['concrete', 'bottomX', 'bottomY', 'topX', 'topY']), label: '+Y向面筋' },
  { groups: new Set(['concrete', 'bottomX', 'bottomY', 'topX', 'topY', 'colMain']), label: '+柱插筋' },
];

/** 梁板式筏基施工步骤 (beamSlab) */
export const RAFT_BEAM_SLAB_STEPS: ConstructionStep[] = [
  { groups: new Set(['concrete']), label: '模板+混凝土' },
  { groups: new Set(['concrete', 'bottomX']), label: '+LPB X向底筋' },
  { groups: new Set(['concrete', 'bottomX', 'bottomY']), label: '+LPB Y向底筋' },
  { groups: new Set(['concrete', 'bottomX', 'bottomY', 'topX']), label: '+LPB X向面筋' },
  { groups: new Set(['concrete', 'bottomX', 'bottomY', 'topX', 'topY']), label: '+LPB Y向面筋' },
  { groups: new Set(['concrete', 'bottomX', 'bottomY', 'topX', 'topY', 'beamStirrup']), label: '+JL箍筋' },
  { groups: new Set(['concrete', 'bottomX', 'bottomY', 'topX', 'topY', 'beamStirrup', 'beamBottom']), label: '+JL底部纵筋' },
  { groups: new Set(['concrete', 'bottomX', 'bottomY', 'topX', 'topY', 'beamStirrup', 'beamBottom', 'beamTop']), label: '+JL顶部纵筋' },
  { groups: new Set(['concrete', 'bottomX', 'bottomY', 'topX', 'topY', 'beamStirrup', 'beamBottom', 'beamTop', 'colMain']), label: '+柱插筋' },
];

/** 平板式筏基板带施工步骤 (flatPlate / ZXB+KZB) */
export const RAFT_FLAT_PLATE_STEPS: ConstructionStep[] = [
  { groups: new Set(['concrete']), label: '模板+混凝土' },
  { groups: new Set(['concrete', 'bottomX']), label: '+跨中底筋X (KZB)' },
  { groups: new Set(['concrete', 'bottomX', 'bottomY']), label: '+跨中底筋Y (KZB)' },
  { groups: new Set(['concrete', 'bottomX', 'bottomY', 'colStrip']), label: '+柱下板带附加筋 (ZXB)' },
  { groups: new Set(['concrete', 'bottomX', 'bottomY', 'colStrip', 'topX']), label: '+X向面筋' },
  { groups: new Set(['concrete', 'bottomX', 'bottomY', 'colStrip', 'topX', 'topY']), label: '+Y向面筋' },
  { groups: new Set(['concrete', 'bottomX', 'bottomY', 'colStrip', 'topX', 'topY', 'colMain']), label: '+柱插筋' },
];

/** 钢筋材质默认参数 */
export const REBAR_MATERIAL = {
  roughness: 0.4,
  metalness: 0.6,
};

/** 混凝土材质默认参数 */
export const CONCRETE_MATERIAL = {
  color: '#BDC3C7',
  roughness: 0.8,
};

/** 箍筋圆弧采样点数 */
export const STIRRUP_CURVE_SAMPLES = 160;

/** 箍筋弯钩采样点数 */
export const HOOK_CURVE_SAMPLES = 40;

/** 钢筋圆柱体段数 */
export const REBAR_SEGMENTS = 12;
