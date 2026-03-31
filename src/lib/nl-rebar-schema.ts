/**
 * RebarGenSchema — 统一的 AI 配筋生成中间数据结构
 * AI 按此 schema 输出语义化 JSON，系统通过 mapper 转换为内部参数
 */
import type { ConcreteGrade, SeismicGrade } from './anchor';

// ─── 钢筋子结构 ───

/** 集中配筋（纵筋等）: 4根HRB400直径25 */
export interface RebarSpec {
  count: number;
  grade: string;    // "HPB300" | "HRB335" | "HRB400" | "RRB400" | "HRBF400"
  diameter: number; // mm
  rows?: number;    // 排数，如 6C25(2) 表示2排
  perRow?: number[]; // 每排根数，如 [4,2] 表示第一排4根第二排2根
}

/** 分布筋（板筋/墙筋）: HRB400直径10间距200 */
export interface DistributedRebarSpec {
  grade: string;
  diameter: number;
  spacing: number; // mm
}

/** 箍筋: HPB300直径8加密100非加密200两肢箍 */
export interface StirrupSpec {
  grade: string;
  diameter: number;
  spacingDense: number;
  spacingNormal: number;
  legs: number;
  typeCode?: string;  // 22G101-1 箍筋类型编号 (A, B, C, D, E, F)
}

// ─── 钢筋等级映射 ───

/** AI 输出的全称 → 系统内部单字母 */
export const GRADE_TO_LETTER: Record<string, string> = {
  'HPB300': 'A', 'HRB335': 'B', 'HRB400': 'C', 'RRB400': 'D', 'HRBF400': 'E',
  'A': 'A', 'B': 'B', 'C': 'C', 'D': 'D', 'E': 'E',
};

/** 系统内部单字母 → AI 友好全称 */
export const LETTER_TO_GRADE: Record<string, string> = {
  'A': 'HPB300', 'B': 'HRB335', 'C': 'HRB400', 'D': 'RRB400', 'E': 'HRBF400',
};

/** 标准钢筋直径 (mm) */
export const STANDARD_DIAMETERS = [6, 8, 10, 12, 14, 16, 18, 20, 22, 25, 28, 32, 36, 40];

// ─── 各构件 Schema ───

export interface BeamSchema {
  componentType: 'beam';
  sectionWidth?: number;
  sectionHeight?: number;
  topRebar?: RebarSpec | string;   // RebarSpec 或混合直径字符串如 "2C25+2C22"
  bottomRebar?: RebarSpec | string; // RebarSpec 或混合直径字符串如 "4C25+2C22";
  stirrup?: StirrupSpec;
  leftSupportRebar?: RebarSpec;
  rightSupportRebar?: RebarSpec;
  concreteGrade?: ConcreteGrade;
  seismicGrade?: SeismicGrade;
  cover?: number;
  spanLength?: number;
  columnWidth?: number;
  sideBar?: RebarSpec & { prefix?: 'G' | 'N' };
  tieBar?: { grade: string; diameter: number };
  lapType?: string;
  anchorType?: string;
}

export interface ColumnSchema {
  componentType: 'column';
  sectionWidth?: number;
  sectionHeight?: number;
  mainRebar?: RebarSpec;
  cornerRebar?: RebarSpec;     // 22G101-1 角筋 (e.g. 4C25)
  bMiddleRebar?: RebarSpec;    // 22G101-1 b边中部筋 (每侧根数)
  hMiddleRebar?: RebarSpec;    // 22G101-1 h边中部筋 (每侧根数)
  stirrup?: StirrupSpec;
  concreteGrade?: ConcreteGrade;
  seismicGrade?: SeismicGrade;
  cover?: number;
  height?: number;
}

export interface ShearWallSchema {
  componentType: 'shearwall';
  wallThickness?: number;
  wallLength?: number;
  wallHeight?: number;
  verticalBar?: DistributedRebarSpec;
  horizontalBar?: DistributedRebarSpec;
  boundaryMainRebar?: RebarSpec;
  boundaryStirrup?: StirrupSpec;
  concreteGrade?: ConcreteGrade;
  seismicGrade?: SeismicGrade;
  cover?: number;
}

export interface SlabSchema {
  componentType: 'slab';
  thickness?: number;
  spanX?: number;
  spanY?: number;
  supportType?: 'simple' | 'continuous' | 'cantilever';
  supportBeamWidth?: number;
  bottomXBar?: DistributedRebarSpec;
  bottomYBar?: DistributedRebarSpec;
  topXBar?: DistributedRebarSpec;
  topYBar?: DistributedRebarSpec;
  supportNegXBar?: DistributedRebarSpec;
  supportNegYBar?: DistributedRebarSpec;
  distributionBar?: DistributedRebarSpec;
  concreteGrade?: ConcreteGrade;
  cover?: number;
}

export interface JointSchema {
  componentType: 'joint';
  columnWidth?: number;
  columnHeight?: number;
  columnMainRebar?: RebarSpec;
  columnStirrup?: StirrupSpec;
  beamWidth?: number;
  beamHeight?: number;
  beamTopRebar?: RebarSpec;
  beamBottomRebar?: RebarSpec;
  beamStirrup?: StirrupSpec;
  jointType?: 'middle' | 'side' | 'corner';
  anchorType?: 'straight' | 'bent';
  concreteGrade?: ConcreteGrade;
  seismicGrade?: SeismicGrade;
  cover?: number;
}

export interface PileCapSchema {
  componentType: 'pilecap';
  bx?: number;
  by?: number;
  h?: number;
  bottomBarX?: string;
  bottomBarY?: string;
  colBx?: number;
  colBy?: number;
  colMain?: string;
  pileDiameter?: number;
  pileCount?: number;
  pileSpacingX?: number;
  pileSpacingY?: number;
  pileLength?: number;
  pileLayout?: 'grid' | 'circular';
  concreteGrade?: ConcreteGrade;
  seismicGrade?: SeismicGrade;
  cover?: number;
}

export interface RaftSchema {
  componentType: 'raft';
  lx?: number;
  ly?: number;
  h?: number;
  bottomBarX?: string;
  bottomBarY?: string;
  topBarX?: string;
  topBarY?: string;
  colBx?: number;
  colBy?: number;
  colMain?: string;
  colCountX?: number;
  colCountY?: number;
  colSpacingX?: number;
  colSpacingY?: number;
  raftType?: 'flat' | 'beamSlab' | 'flatPlate';
  beamB?: number;
  beamH?: number;
  beamBottom?: string;
  beamTop?: string;
  colStripWidth?: number;
  concreteGrade?: ConcreteGrade;
  seismicGrade?: SeismicGrade;
  cover?: number;
}

export type RebarGenSchema = BeamSchema | ColumnSchema | ShearWallSchema | SlabSchema | JointSchema | PileCapSchema | RaftSchema;

// ─── JSON Schema 字符串（嵌入 prompt） ───

const REBAR_SPEC_SCHEMA = `{ "count": number, "grade": "HPB300|HRB335|HRB400|RRB400|HRBF400", "diameter": number }`;
const DISTRIBUTED_SPEC_SCHEMA = `{ "grade": "HPB300|HRB335|HRB400|RRB400|HRBF400", "diameter": number, "spacing": number }`;
const STIRRUP_SPEC_SCHEMA = `{ "grade": "HPB300|HRB335|HRB400|RRB400|HRBF400", "diameter": number, "spacingDense": number, "spacingNormal": number, "legs": number, "typeCode": "A|B|C|D|E|F" (可选) }`;

export const BEAM_JSON_SCHEMA = `{
  "componentType": "beam",
  "sectionWidth": number (mm, 150-1200),
  "sectionHeight": number (mm, 200-2000),
  "topRebar": ${REBAR_SPEC_SCHEMA} 或 "2C25+2C22" (混合直径字符串),
  "bottomRebar": ${REBAR_SPEC_SCHEMA} 或 "4C25+2C22" (混合直径字符串),
  "stirrup": ${STIRRUP_SPEC_SCHEMA},
  "leftSupportRebar": ${REBAR_SPEC_SCHEMA} (可选),
  "rightSupportRebar": ${REBAR_SPEC_SCHEMA} (可选),
  "sideBar": { "prefix": "G|N", "count": number, "grade": "...", "diameter": number } (可选, G=构造腰筋, N=抗扭筋),
  "tieBar": { "grade": "HPB300|HRB400|...", "diameter": number } (可选, 拉筋，留空自动确定: b≤350→A6),
  "concreteGrade": "C20-C60" (可选),
  "seismicGrade": "一级|二级|三级|四级|非抗震" (可选),
  "cover": number (mm, 可选),
  "spanLength": number (mm, 可选),
  "columnWidth": number (mm, 可选)
}`;

export const COLUMN_JSON_SCHEMA = `{
  "componentType": "column",
  "sectionWidth": number (mm, 200-1200),
  "sectionHeight": number (mm, 200-1200),
  "mainRebar": ${REBAR_SPEC_SCHEMA} (全部纵筋, legacy写法),
  "cornerRebar": ${REBAR_SPEC_SCHEMA} (可选, 22G101-1角筋, 固定4根),
  "bMiddleRebar": ${REBAR_SPEC_SCHEMA} (可选, b边中部筋, count=每侧根数),
  "hMiddleRebar": ${REBAR_SPEC_SCHEMA} (可选, h边中部筋, count=每侧根数),
  "stirrup": ${STIRRUP_SPEC_SCHEMA},
  "concreteGrade": "C20-C60" (可选),
  "seismicGrade": "一级|二级|三级|四级|非抗震" (可选),
  "cover": number (mm, 可选),
  "height": number (mm, 可选)
}`;

export const SHEAR_WALL_JSON_SCHEMA = `{
  "componentType": "shearwall",
  "wallThickness": number (mm, 200-400),
  "wallLength": number (mm, 1000-6000),
  "wallHeight": number (mm, 可选),
  "verticalBar": ${DISTRIBUTED_SPEC_SCHEMA},
  "horizontalBar": ${DISTRIBUTED_SPEC_SCHEMA},
  "boundaryMainRebar": ${REBAR_SPEC_SCHEMA},
  "boundaryStirrup": ${STIRRUP_SPEC_SCHEMA},
  "concreteGrade": "C20-C60" (可选),
  "seismicGrade": "一级|二级|三级|四级|非抗震" (可选),
  "cover": number (mm, 可选)
}`;

export const SLAB_JSON_SCHEMA = `{
  "componentType": "slab",
  "thickness": number (mm, 60-300),
  "spanX": number (mm, X向板跨, 1000-12000, 可选),
  "spanY": number (mm, Y向板跨, 1000-12000, 可选),
  "supportType": "simple|continuous|cantilever" (可选, 默认continuous),
  "supportBeamWidth": number (mm, 支座梁宽, 150-600, 可选),
  "bottomXBar": ${DISTRIBUTED_SPEC_SCHEMA},
  "bottomYBar": ${DISTRIBUTED_SPEC_SCHEMA},
  "topXBar": ${DISTRIBUTED_SPEC_SCHEMA} (可选),
  "topYBar": ${DISTRIBUTED_SPEC_SCHEMA} (可选),
  "supportNegXBar": ${DISTRIBUTED_SPEC_SCHEMA} (可选, X向支座负筋, 22G101),
  "supportNegYBar": ${DISTRIBUTED_SPEC_SCHEMA} (可选, Y向支座负筋, 22G101),
  "distributionBar": ${DISTRIBUTED_SPEC_SCHEMA} (可选),
  "concreteGrade": "C20-C60" (可选),
  "cover": number (mm, 可选)
}`;

export const JOINT_JSON_SCHEMA = `{
  "componentType": "joint",
  "columnWidth": number (mm, 200-1200),
  "columnHeight": number (mm, 200-1200),
  "columnMainRebar": ${REBAR_SPEC_SCHEMA},
  "columnStirrup": ${STIRRUP_SPEC_SCHEMA},
  "beamWidth": number (mm, 150-1200),
  "beamHeight": number (mm, 200-2000),
  "beamTopRebar": ${REBAR_SPEC_SCHEMA},
  "beamBottomRebar": ${REBAR_SPEC_SCHEMA},
  "beamStirrup": ${STIRRUP_SPEC_SCHEMA},
  "jointType": "middle|side|corner" (可选),
  "anchorType": "straight|bent" (可选),
  "concreteGrade": "C20-C60" (可选),
  "seismicGrade": "一级|二级|三级|四级|非抗震" (可选),
  "cover": number (mm, 可选)
}`;

const STAIR_JSON_SCHEMA = `{
  "componentType": "stair",
  "stairType": "AT" | "BT" | "CT" | "DT" | "ET" (可选，默认AT),
  "stepCount": number (踏步数，3-24),
  "stepHeight": number (踏步高mm，100-200),
  "stepWidth": number (踏步宽mm，220-350),
  "slabThickness": number (梯板厚mm，80-200),
  "flightWidth": number (梯段宽mm，800-2000),
  "topPlatformLen": number (上平台板长mm，可选),
  "botPlatformLen": number (下平台板长mm，可选),
  "platformThickness": number (平台板厚mm，可选),
  "beamB": number (梯梁宽mm，可选),
  "beamH": number (梯梁高mm，可选),
  "topBar": "等级+直径@间距" (上部纵筋，如C8@200),
  "bottomBar": "等级+直径@间距" (下部纵筋，如C10@150),
  "distBar": "等级+直径@间距" (分布筋，如A6@250),
  "concreteGrade": "C20"-"C80" (可选),
  "cover": number (mm, 可选)
}`;

const FOUNDATION_JSON_SCHEMA = `{
  "componentType": "foundation",
  "shape": "stepped" | "tapered" (可选，默认stepped),
  "bx": number (底面X向宽mm, 800-8000),
  "by": number (底面Y向宽mm, 800-4000),
  "h": number (基础总高mm, 300-2000),
  "bottomBarX": "等级+直径@间距" (X向底筋，如C12@150),
  "bottomBarY": "等级+直径@间距" (Y向底筋，如C12@150),
  "colBx": number (柱截面X向mm, 可选),
  "colBy": number (柱截面Y向mm, 可选),
  "colMain": "数量+等级+直径" (柱插筋，如8C20, 可选),
  "columnCount": 1 | 2 (柱数，可选，默认1),
  "colSpacing": number (双柱中心距mm, 仅columnCount=2时, 可选),
  "topBarX": "等级+直径@间距" (顶部柱间纵向筋, 仅双柱, 可选),
  "topBarY": "等级+直径@间距" (顶部柱间分布筋, 仅双柱, 可选),
  "concreteGrade": "C20"-"C80" (可选),
  "cover": number (mm, 可选)
}`;

const PILECAP_JSON_SCHEMA = `{
  "componentType": "pilecap",
  "bx": number (承台X向宽mm, 600-6000),
  "by": number (承台Y向宽mm, 600-6000),
  "h": number (承台高度mm, 500-3000),
  "bottomBarX": "等级+直径@间距" (X向底筋，如C14@150),
  "bottomBarY": "等级+直径@间距" (Y向底筋，如C14@150),
  "colBx": number (柱截面X向mm, 可选),
  "colBy": number (柱截面Y向mm, 可选),
  "colMain": "数量+等级+直径" (柱插筋，如8C20, 可选),
  "pileDiameter": number (桩径mm, 300-2000),
  "pileCount": number (桩数, 1-16),
  "pileSpacingX": number (X向桩距mm, 可选),
  "pileSpacingY": number (Y向桩距mm, 可选),
  "pileLength": number (桩长mm, 可选),
  "concreteGrade": "C20"-"C80" (可选),
  "cover": number (mm, 可选)
}`;

const RAFT_JSON_SCHEMA = `{
  "componentType": "raft",
  "lx": number (X向长度mm, 6000-60000),
  "ly": number (Y向宽度mm, 6000-40000),
  "h": number (板厚mm, 300-2000),
  "bottomBarX": "等级+直径@间距" (X向底筋，如C16@150),
  "bottomBarY": "等级+直径@间距" (Y向底筋，如C16@150),
  "topBarX": "等级+直径@间距" (X向面筋，如C12@200),
  "topBarY": "等级+直径@间距" (Y向面筋，如C12@200),
  "colBx": number (柱截面X向mm, 可选),
  "colBy": number (柱截面Y向mm, 可选),
  "colMain": "数量+等级+直径" (柱插筋，如8C20, 可选),
  "colCountX": number (X向柱数, 1-10),
  "colCountY": number (Y向柱数, 1-10),
  "colSpacingX": number (X向柱距mm, 可选),
  "colSpacingY": number (Y向柱距mm, 可选),
  "concreteGrade": "C20"-"C60" (可选),
  "seismicGrade": "一级"|"二级"|"三级"|"四级"|"非抗震" (可选),
  "cover": number (mm, 可选)
}`;

export const JSON_SCHEMAS: Record<string, string> = {
  beam: BEAM_JSON_SCHEMA,
  column: COLUMN_JSON_SCHEMA,
  shearwall: SHEAR_WALL_JSON_SCHEMA,
  slab: SLAB_JSON_SCHEMA,
  joint: JOINT_JSON_SCHEMA,
  stair: STAIR_JSON_SCHEMA,
  foundation: FOUNDATION_JSON_SCHEMA,
  pilecap: PILECAP_JSON_SCHEMA,
  raft: RAFT_JSON_SCHEMA,
};
