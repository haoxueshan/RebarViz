/**
 * 双向映射: RebarGenSchema ↔ Structured_Params
 */
import type { BeamParams, ColumnParams, SlabParams, JointParams, ShearWallParams, FoundationParams, StripFoundationParams, PileCapParams, RaftFoundationParams, ComponentType } from './types';
import type { RebarGenSchema, RebarSpec, DistributedRebarSpec, StirrupSpec, BeamSchema, ColumnSchema, ShearWallSchema, SlabSchema, JointSchema, FoundationSchema, StripFoundationSchema, PileCapSchema, RaftSchema } from './nl-rebar-schema';
import { GRADE_TO_LETTER, LETTER_TO_GRADE } from './nl-rebar-schema';
import { parseRebar, parseStirrup, parseSlabRebar } from './rebar';

// ─── 辅助: spec → notation string ───

function gradeLetter(grade: string): string {
  return GRADE_TO_LETTER[grade] || GRADE_TO_LETTER[grade.toUpperCase()] || 'C';
}

/** {count:4, grade:"HRB400", diameter:25} → "4C25", {count:6, ..., rows:2} → "6C25(2)", {count:5, ..., perRow:[3,2]} → "5C25(3/2)" */
export function rebarSpecToNotation(spec: RebarSpec): string {
  let base = `${spec.count}${gradeLetter(spec.grade)}${spec.diameter}`;
  if (spec.perRow && spec.perRow.length >= 2) {
    // perRow[0]=外排, perRow[1]=内排; 22G101标注为 (内排/外排)
    base += `(${[...spec.perRow].reverse().join('/')})`;
  } else if (spec.rows && spec.rows >= 2) {
    base += `(${spec.rows})`;
  }
  return base;
}

/** {grade:"HRB400", diameter:10, spacing:200} → "C10@200" */
export function distributedSpecToNotation(spec: DistributedRebarSpec): string {
  return `${gradeLetter(spec.grade)}${spec.diameter}@${spec.spacing}`;
}

/** StirrupSpec → "B-A8@100/200(4)" or "A8@100/200(2)" */
export function stirrupSpecToNotation(spec: StirrupSpec): string {
  const g = gradeLetter(spec.grade);
  const typePrefix = spec.typeCode ? `${spec.typeCode}-` : '';
  if (spec.spacingDense === spec.spacingNormal) {
    return `${typePrefix}${g}${spec.diameter}@${spec.spacingDense}/${spec.spacingDense}(${spec.legs})`;
  }
  return `${typePrefix}${g}${spec.diameter}@${spec.spacingDense}/${spec.spacingNormal}(${spec.legs})`;
}

// ─── 辅助: notation string → spec ───

function gradeFullName(letter: string): string {
  return LETTER_TO_GRADE[letter] || 'HRB400';
}

export function notationToRebarSpec(notation: string): RebarSpec {
  const info = parseRebar(notation);
  const spec: RebarSpec = { count: info.count, grade: gradeFullName(info.grade), diameter: info.diameter };
  if (info.rows && info.rows >= 2) spec.rows = info.rows;
  if (info.perRow && info.perRow.length >= 2) spec.perRow = info.perRow;
  return spec;
}

export function notationToDistributedSpec(notation: string): DistributedRebarSpec {
  const info = parseSlabRebar(notation);
  return { grade: gradeFullName(info.grade), diameter: info.diameter, spacing: info.spacing };
}

export function notationToStirrupSpec(notation: string): StirrupSpec {
  const info = parseStirrup(notation);
  const spec: StirrupSpec = { 
    grade: gradeFullName(info.grade), 
    diameter: info.diameter, 
    spacingDense: info.spacingDense, 
    spacingNormal: info.spacingNormal, 
    legs: info.legs 
  };
  if (info.typeCode) spec.typeCode = info.typeCode;
  return spec;
}

// ─── mapSchemaToParams ───

function beamSchemaToParams(s: BeamSchema): Partial<BeamParams> {
  const p: Partial<BeamParams> = {};
  if (s.id) p.id = s.id;
  if (s.sectionWidth !== undefined) p.b = s.sectionWidth;
  if (s.sectionHeight !== undefined) p.h = s.sectionHeight;
  if (s.topRebar) p.top = typeof s.topRebar === 'string' ? s.topRebar : rebarSpecToNotation(s.topRebar);
  if (s.bottomRebar) p.bottom = typeof s.bottomRebar === 'string' ? s.bottomRebar : rebarSpecToNotation(s.bottomRebar);
  if (s.stirrup) p.stirrup = stirrupSpecToNotation(s.stirrup);
  if (s.leftSupportRebar) p.leftSupport = rebarSpecToNotation(s.leftSupportRebar);
  if (s.rightSupportRebar) p.rightSupport = rebarSpecToNotation(s.rightSupportRebar);
  if (s.leftSupport2Rebar) p.leftSupport2 = rebarSpecToNotation(s.leftSupport2Rebar);
  if (s.rightSupport2Rebar) p.rightSupport2 = rebarSpecToNotation(s.rightSupport2Rebar);
  if (s.erectionBar) p.erectionBar = rebarSpecToNotation(s.erectionBar);
  if (s.sideBar) {
    const prefix = s.sideBar.prefix || 'G';
    p.sideBar = `${prefix}${s.sideBar.count}${gradeLetter(s.sideBar.grade)}${s.sideBar.diameter}`;
  }
  if (s.tieBar) {
    p.tieBar = `${gradeLetter(s.tieBar.grade)}${s.tieBar.diameter}`;
  }
  if (s.concreteGrade) p.concreteGrade = s.concreteGrade;
  if (s.seismicGrade) p.seismicGrade = s.seismicGrade;
  if (s.cover !== undefined) p.cover = s.cover;
  if (s.spanLength !== undefined) p.spanLength = s.spanLength;
  if (s.spanCount !== undefined) p.spanCount = s.spanCount;
  if (s.spanWidths) p.spanWidths = s.spanWidths;
  if (s.spanHeights) p.spanHeights = s.spanHeights;
  if (s.columnWidth !== undefined) p.hc = s.columnWidth;
  return p;
}

function columnSchemaToParams(s: ColumnSchema): Partial<ColumnParams> {
  const p: Partial<ColumnParams> = {};
  if (s.sectionWidth !== undefined) p.b = s.sectionWidth;
  if (s.sectionHeight !== undefined) p.h = s.sectionHeight;
  if (s.mainRebar) p.main = rebarSpecToNotation(s.mainRebar);
  if (s.cornerRebar) p.cornerMain = rebarSpecToNotation(s.cornerRebar);
  if (s.bMiddleRebar) p.bMiddleMain = rebarSpecToNotation(s.bMiddleRebar);
  if (s.hMiddleRebar) p.hMiddleMain = rebarSpecToNotation(s.hMiddleRebar);
  if (s.stirrup) p.stirrup = stirrupSpecToNotation(s.stirrup);
  if (s.concreteGrade) p.concreteGrade = s.concreteGrade;
  if (s.seismicGrade) p.seismicGrade = s.seismicGrade;
  if (s.cover !== undefined) p.cover = s.cover;
  if (s.height !== undefined) p.height = s.height;
  return p;
}

function shearWallSchemaToParams(s: ShearWallSchema): Partial<ShearWallParams> {
  const p: Partial<ShearWallParams> = {};
  if (s.wallThickness !== undefined) p.bw = s.wallThickness;
  if (s.wallLength !== undefined) p.lw = s.wallLength;
  if (s.wallHeight !== undefined) p.hw = s.wallHeight;
  if (s.verticalBar) p.vertBar = distributedSpecToNotation(s.verticalBar);
  if (s.horizontalBar) p.horizBar = distributedSpecToNotation(s.horizontalBar);
  if (s.boundaryMainRebar) p.boundaryMain = rebarSpecToNotation(s.boundaryMainRebar);
  if (s.boundaryStirrup) p.boundaryStirrup = stirrupSpecToNotation(s.boundaryStirrup);
  if (s.concreteGrade) p.concreteGrade = s.concreteGrade;
  if (s.seismicGrade) p.seismicGrade = s.seismicGrade;
  if (s.cover !== undefined) p.cover = s.cover;
  return p;
}

function slabSchemaToParams(s: SlabSchema): Partial<SlabParams> {
  const p: Partial<SlabParams> = {};
  if (s.thickness !== undefined) p.thickness = s.thickness;
  if (s.spanX !== undefined) p.spanX = s.spanX;
  if (s.spanY !== undefined) p.spanY = s.spanY;
  if (s.supportType) p.supportType = s.supportType;
  if (s.supportBeamWidth !== undefined) p.supportBeamWidth = s.supportBeamWidth;
  if (s.bottomXBar) p.bottomX = distributedSpecToNotation(s.bottomXBar);
  if (s.bottomYBar) p.bottomY = distributedSpecToNotation(s.bottomYBar);
  if (s.topXBar) p.topX = distributedSpecToNotation(s.topXBar);
  if (s.topYBar) p.topY = distributedSpecToNotation(s.topYBar);
  if (s.supportNegXBar) p.supportNegX = distributedSpecToNotation(s.supportNegXBar);
  if (s.supportNegYBar) p.supportNegY = distributedSpecToNotation(s.supportNegYBar);
  if (s.distributionBar) p.distribution = distributedSpecToNotation(s.distributionBar);
  if (s.concreteGrade) p.concreteGrade = s.concreteGrade;
  if (s.cover !== undefined) p.cover = s.cover;
  return p;
}

function jointSchemaToParams(s: JointSchema): Partial<JointParams> {
  const p: Partial<JointParams> = {};
  if (s.columnWidth !== undefined) p.colB = s.columnWidth;
  if (s.columnHeight !== undefined) p.colH = s.columnHeight;
  if (s.columnMainRebar) p.colMain = rebarSpecToNotation(s.columnMainRebar);
  if (s.columnStirrup) p.colStirrup = stirrupSpecToNotation(s.columnStirrup);
  if (s.beamWidth !== undefined) p.beamB = s.beamWidth;
  if (s.beamHeight !== undefined) p.beamH = s.beamHeight;
  if (s.beamTopRebar) p.beamTop = rebarSpecToNotation(s.beamTopRebar);
  if (s.beamBottomRebar) p.beamBottom = rebarSpecToNotation(s.beamBottomRebar);
  if (s.beamStirrup) p.beamStirrup = stirrupSpecToNotation(s.beamStirrup);
  if (s.jointType) p.jointType = s.jointType;
  if (s.anchorType) p.anchorType = s.anchorType;
  if (s.concreteGrade) p.concreteGrade = s.concreteGrade;
  if (s.seismicGrade) p.seismicGrade = s.seismicGrade;
  if (s.cover !== undefined) p.cover = s.cover;
  return p;
}

function foundationSchemaToParams(s: FoundationSchema): Partial<FoundationParams> {
  const p: Partial<FoundationParams> = {};
  if (s.shape !== undefined) p.shape = s.shape;
  if (s.bx !== undefined) p.bx = s.bx;
  if (s.by !== undefined) p.by = s.by;
  if (s.h !== undefined) p.h = s.h;
  if (s.bottomBarX !== undefined) p.bottomBarX = s.bottomBarX;
  if (s.bottomBarY !== undefined) p.bottomBarY = s.bottomBarY;
  if (s.colBx !== undefined) p.colBx = s.colBx;
  if (s.colBy !== undefined) p.colBy = s.colBy;
  if (s.colMain !== undefined) p.colMain = s.colMain;
  if (s.columnCount !== undefined) p.columnCount = s.columnCount;
  if (s.colSpacing !== undefined) p.colSpacing = s.colSpacing;
  if (s.topBarX !== undefined) p.topBarX = s.topBarX;
  if (s.topBarY !== undefined) p.topBarY = s.topBarY;
  if (s.concreteGrade !== undefined) p.concreteGrade = s.concreteGrade;
  if (s.seismicGrade !== undefined) p.seismicGrade = s.seismicGrade;
  if (s.cover !== undefined) p.cover = s.cover;
  return p;
}

function stripFoundationSchemaToParams(s: StripFoundationSchema): Partial<StripFoundationParams> {
  const p: Partial<StripFoundationParams> = {};
  if (s.stripKind !== undefined) p.stripKind = s.stripKind;
  if (s.length !== undefined) p.length = s.length;
  if (s.width !== undefined) p.width = s.width;
  if (s.h !== undefined) p.h = s.h;
  if (s.bottomBar !== undefined) p.bottomBar = s.bottomBar;
  if (s.distBar !== undefined) p.distBar = s.distBar;
  if (s.topBar !== undefined) p.topBar = s.topBar;
  if (s.topDistBar !== undefined) p.topDistBar = s.topDistBar;
  if (s.supportType !== undefined) p.supportType = s.supportType;
  if (s.supportCount !== undefined) p.supportCount = s.supportCount;
  if (s.supportWidth !== undefined) p.supportWidth = s.supportWidth;
  if (s.supportHeight !== undefined) p.supportHeight = s.supportHeight;
  if (s.supportSpacing !== undefined) p.supportSpacing = s.supportSpacing;
  if (s.jlBottom !== undefined) p.jlBottom = s.jlBottom;
  if (s.jlTop !== undefined) p.jlTop = s.jlTop;
  if (s.jlStirrup !== undefined) p.jlStirrup = s.jlStirrup;
  if (s.jlStirrupAlt !== undefined) p.jlStirrupAlt = s.jlStirrupAlt;
  if (s.jlEndType !== undefined) p.jlEndType = s.jlEndType;
  if (s.jlOverhangSide !== undefined) p.jlOverhangSide = s.jlOverhangSide;
  if (s.jlOverhang !== undefined) p.jlOverhang = s.jlOverhang;
  if (s.hasJcl !== undefined) p.hasJcl = s.hasJcl;
  if (s.jclCount !== undefined) p.jclCount = s.jclCount;
  if (s.jclSpacing !== undefined) p.jclSpacing = s.jclSpacing;
  if (s.jclB !== undefined) p.jclB = s.jclB;
  if (s.jclH !== undefined) p.jclH = s.jclH;
  if (s.jclBottom !== undefined) p.jclBottom = s.jclBottom;
  if (s.jclTop !== undefined) p.jclTop = s.jclTop;
  if (s.jclStirrup !== undefined) p.jclStirrup = s.jclStirrup;
  if (s.jclStirrupAlt !== undefined) p.jclStirrupAlt = s.jclStirrupAlt;
  if (s.jclEndType !== undefined) p.jclEndType = s.jclEndType;
  if (s.jclOverhangSide !== undefined) p.jclOverhangSide = s.jclOverhangSide;
  if (s.jclOverhang !== undefined) p.jclOverhang = s.jclOverhang;
  if (s.hasLocalOverride !== undefined) p.hasLocalOverride = s.hasLocalOverride;
  if (s.localOverrideStart !== undefined) p.localOverrideStart = s.localOverrideStart;
  if (s.localOverrideLength !== undefined) p.localOverrideLength = s.localOverrideLength;
  if (s.localBottomBar !== undefined) p.localBottomBar = s.localBottomBar;
  if (s.localTopBar !== undefined) p.localTopBar = s.localTopBar;
  if (s.localOverrideNote !== undefined) p.localOverrideNote = s.localOverrideNote;
  if (s.concreteGrade !== undefined) p.concreteGrade = s.concreteGrade;
  if (s.cover !== undefined) p.cover = s.cover;
  return p;
}

function pileCapSchemaToParams(s: PileCapSchema): Partial<PileCapParams> {
  const p: Partial<PileCapParams> = {};
  if (s.bx !== undefined) p.bx = s.bx;
  if (s.by !== undefined) p.by = s.by;
  if (s.h !== undefined) p.h = s.h;
  if (s.bottomBarX !== undefined) p.bottomBarX = s.bottomBarX;
  if (s.bottomBarY !== undefined) p.bottomBarY = s.bottomBarY;
  if (s.colBx !== undefined) p.colBx = s.colBx;
  if (s.colBy !== undefined) p.colBy = s.colBy;
  if (s.colMain !== undefined) p.colMain = s.colMain;
  if (s.pileDiameter !== undefined) p.pileDiameter = s.pileDiameter;
  if (s.pileCount !== undefined) p.pileCount = s.pileCount;
  if (s.pileSpacingX !== undefined) p.pileSpacingX = s.pileSpacingX;
  if (s.pileSpacingY !== undefined) p.pileSpacingY = s.pileSpacingY;
  if (s.pileLength !== undefined) p.pileLength = s.pileLength;
  if (s.pileLayout !== undefined) p.pileLayout = s.pileLayout;
  if (s.concreteGrade !== undefined) p.concreteGrade = s.concreteGrade;
  if (s.seismicGrade !== undefined) p.seismicGrade = s.seismicGrade;
  if (s.cover !== undefined) p.cover = s.cover;
  return p;
}

function raftSchemaToParams(s: RaftSchema): Partial<RaftFoundationParams> {
  const p: Partial<RaftFoundationParams> = {};
  if (s.lx !== undefined) p.lx = s.lx;
  if (s.ly !== undefined) p.ly = s.ly;
  if (s.h !== undefined) p.h = s.h;
  if (s.bottomBarX !== undefined) p.bottomBarX = s.bottomBarX;
  if (s.bottomBarY !== undefined) p.bottomBarY = s.bottomBarY;
  if (s.topBarX !== undefined) p.topBarX = s.topBarX;
  if (s.topBarY !== undefined) p.topBarY = s.topBarY;
  if (s.colBx !== undefined) p.colBx = s.colBx;
  if (s.colBy !== undefined) p.colBy = s.colBy;
  if (s.colMain !== undefined) p.colMain = s.colMain;
  if (s.colCountX !== undefined) p.colCountX = s.colCountX;
  if (s.colCountY !== undefined) p.colCountY = s.colCountY;
  if (s.colSpacingX !== undefined) p.colSpacingX = s.colSpacingX;
  if (s.colSpacingY !== undefined) p.colSpacingY = s.colSpacingY;
  if (s.raftType !== undefined) p.raftType = s.raftType;
  if (s.beamB !== undefined) p.beamB = s.beamB;
  if (s.beamH !== undefined) p.beamH = s.beamH;
  if (s.beamBottom !== undefined) p.beamBottom = s.beamBottom;
  if (s.beamTop !== undefined) p.beamTop = s.beamTop;
  if (s.colStripWidth !== undefined) p.colStripWidth = s.colStripWidth;
  if (s.concreteGrade !== undefined) p.concreteGrade = s.concreteGrade;
  if (s.seismicGrade !== undefined) p.seismicGrade = s.seismicGrade;
  if (s.cover !== undefined) p.cover = s.cover;
  return p;
}

export function mapSchemaToParams(
  schema: RebarGenSchema,
  componentType: ComponentType
): Partial<BeamParams | ColumnParams | SlabParams | JointParams | ShearWallParams | FoundationParams | StripFoundationParams | PileCapParams | RaftFoundationParams> {
  switch (componentType) {
    case 'beam': return beamSchemaToParams(schema as BeamSchema);
    case 'column': return columnSchemaToParams(schema as ColumnSchema);
    case 'shearwall': return shearWallSchemaToParams(schema as ShearWallSchema);
    case 'slab': return slabSchemaToParams(schema as SlabSchema);
    case 'joint': return jointSchemaToParams(schema as JointSchema);
    case 'foundation': return foundationSchemaToParams(schema as FoundationSchema);
    case 'stripfoundation': return stripFoundationSchemaToParams(schema as StripFoundationSchema);
    case 'pilecap': return pileCapSchemaToParams(schema as PileCapSchema);
    case 'raft': return raftSchemaToParams(schema as RaftSchema);
    default: return {};
  }
}

// ─── mapParamsToSchema ───

function beamParamsToSchema(p: BeamParams): BeamSchema {
  const s: BeamSchema = { componentType: 'beam' };
  s.sectionWidth = p.b;
  s.sectionHeight = p.h;
  s.topRebar = p.top.includes('+') ? p.top : notationToRebarSpec(p.top);
  s.bottomRebar = p.bottom.includes('+') ? p.bottom : notationToRebarSpec(p.bottom);
  s.stirrup = notationToStirrupSpec(p.stirrup);
  if (p.leftSupport) s.leftSupportRebar = notationToRebarSpec(p.leftSupport);
  if (p.rightSupport) s.rightSupportRebar = notationToRebarSpec(p.rightSupport);
  if (p.sideBar) {
    const m = p.sideBar.match(/^([GN])(\d+)([A-Za-z])(\d+)$/);
    if (m) {
      s.sideBar = { prefix: m[1] as 'G' | 'N', count: parseInt(m[2]), grade: LETTER_TO_GRADE[m[3].toUpperCase()] || 'HRB400', diameter: parseInt(m[4]) };
    }
  }
  if (p.tieBar) {
    const tm = p.tieBar.match(/^([A-Za-z])(\d+)$/);
    if (tm) {
      s.tieBar = { grade: LETTER_TO_GRADE[tm[1].toUpperCase()] || 'HPB300', diameter: parseInt(tm[2]) };
    }
  }
  s.concreteGrade = p.concreteGrade;
  s.seismicGrade = p.seismicGrade;
  s.cover = p.cover;
  s.spanLength = p.spanLength;
  s.columnWidth = p.hc;
  return s;
}

function columnParamsToSchema(p: ColumnParams): ColumnSchema {
  const s: ColumnSchema = {
    componentType: 'column',
    sectionWidth: p.b, sectionHeight: p.h,
    mainRebar: notationToRebarSpec(p.main),
    stirrup: notationToStirrupSpec(p.stirrup),
    concreteGrade: p.concreteGrade, seismicGrade: p.seismicGrade,
    cover: p.cover, height: p.height,
  };
  if (p.cornerMain) s.cornerRebar = notationToRebarSpec(p.cornerMain);
  if (p.bMiddleMain) s.bMiddleRebar = notationToRebarSpec(p.bMiddleMain);
  if (p.hMiddleMain) s.hMiddleRebar = notationToRebarSpec(p.hMiddleMain);
  return s;
}

function shearWallParamsToSchema(p: ShearWallParams): ShearWallSchema {
  return {
    componentType: 'shearwall',
    wallThickness: p.bw, wallLength: p.lw, wallHeight: p.hw,
    verticalBar: notationToDistributedSpec(p.vertBar),
    horizontalBar: notationToDistributedSpec(p.horizBar),
    boundaryMainRebar: notationToRebarSpec(p.boundaryMain),
    boundaryStirrup: notationToStirrupSpec(p.boundaryStirrup),
    concreteGrade: p.concreteGrade, seismicGrade: p.seismicGrade, cover: p.cover,
  };
}

function slabParamsToSchema(p: SlabParams): SlabSchema {
  const s: SlabSchema = {
    componentType: 'slab',
    thickness: p.thickness,
    spanX: p.spanX, spanY: p.spanY,
    supportType: p.supportType,
    supportBeamWidth: p.supportBeamWidth,
    bottomXBar: notationToDistributedSpec(p.bottomX),
    bottomYBar: notationToDistributedSpec(p.bottomY),
    concreteGrade: p.concreteGrade, cover: p.cover,
  };
  if (p.topX) s.topXBar = notationToDistributedSpec(p.topX);
  if (p.topY) s.topYBar = notationToDistributedSpec(p.topY);
  if (p.supportNegX) s.supportNegXBar = notationToDistributedSpec(p.supportNegX);
  if (p.supportNegY) s.supportNegYBar = notationToDistributedSpec(p.supportNegY);
  if (p.distribution) s.distributionBar = notationToDistributedSpec(p.distribution);
  return s;
}

function jointParamsToSchema(p: JointParams): JointSchema {
  return {
    componentType: 'joint',
    columnWidth: p.colB, columnHeight: p.colH,
    columnMainRebar: notationToRebarSpec(p.colMain),
    columnStirrup: notationToStirrupSpec(p.colStirrup),
    beamWidth: p.beamB, beamHeight: p.beamH,
    beamTopRebar: notationToRebarSpec(p.beamTop),
    beamBottomRebar: notationToRebarSpec(p.beamBottom),
    beamStirrup: notationToStirrupSpec(p.beamStirrup),
    jointType: p.jointType, anchorType: p.anchorType,
    concreteGrade: p.concreteGrade, seismicGrade: p.seismicGrade, cover: p.cover,
  };
}

export function mapParamsToSchema(
  params: BeamParams | ColumnParams | SlabParams | JointParams | ShearWallParams,
  componentType: ComponentType
): RebarGenSchema {
  switch (componentType) {
    case 'beam': return beamParamsToSchema(params as BeamParams);
    case 'column': return columnParamsToSchema(params as ColumnParams);
    case 'shearwall': return shearWallParamsToSchema(params as ShearWallParams);
    case 'slab': return slabParamsToSchema(params as SlabParams);
    case 'joint': return jointParamsToSchema(params as JointParams);
    default: return { componentType } as unknown as RebarGenSchema;
  }
}
