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
  topRebar?: RebarSpec;
  bottomRebar?: RebarSpec;
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
  bottomXBar?: DistributedRebarSpec;
  bottomYBar?: DistributedRebarSpec;
  topXBar?: DistributedRebarSpec;
  topYBar?: DistributedRebarSpec;
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

export type RebarGenSchema = BeamSchema | ColumnSchema | ShearWallSchema | SlabSchema | JointSchema;

// ─── JSON Schema 字符串（嵌入 prompt） ───

const REBAR_SPEC_SCHEMA = `{ "count": number, "grade": "HPB300|HRB335|HRB400|RRB400|HRBF400", "diameter": number }`;
const DISTRIBUTED_SPEC_SCHEMA = `{ "grade": "HPB300|HRB335|HRB400|RRB400|HRBF400", "diameter": number, "spacing": number }`;
const STIRRUP_SPEC_SCHEMA = `{ "grade": "HPB300|HRB335|HRB400|RRB400|HRBF400", "diameter": number, "spacingDense": number, "spacingNormal": number, "legs": number }`;

export const BEAM_JSON_SCHEMA = `{
  "componentType": "beam",
  "sectionWidth": number (mm, 150-1200),
  "sectionHeight": number (mm, 200-2000),
  "topRebar": ${REBAR_SPEC_SCHEMA},
  "bottomRebar": ${REBAR_SPEC_SCHEMA},
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
  "mainRebar": ${REBAR_SPEC_SCHEMA},
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
  "bottomXBar": ${DISTRIBUTED_SPEC_SCHEMA},
  "bottomYBar": ${DISTRIBUTED_SPEC_SCHEMA},
  "topXBar": ${DISTRIBUTED_SPEC_SCHEMA} (可选),
  "topYBar": ${DISTRIBUTED_SPEC_SCHEMA} (可选),
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

export const JSON_SCHEMAS: Record<string, string> = {
  beam: BEAM_JSON_SCHEMA,
  column: COLUMN_JSON_SCHEMA,
  shearwall: SHEAR_WALL_JSON_SCHEMA,
  slab: SLAB_JSON_SCHEMA,
  joint: JOINT_JSON_SCHEMA,
  stair: STAIR_JSON_SCHEMA,
};
