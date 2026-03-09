/**
 * 双向映射: RebarGenSchema ↔ Structured_Params
 */
import type { BeamParams, ColumnParams, SlabParams, JointParams, ShearWallParams, ComponentType } from './types';
import type { RebarGenSchema, RebarSpec, DistributedRebarSpec, StirrupSpec, BeamSchema, ColumnSchema, ShearWallSchema, SlabSchema, JointSchema } from './nl-rebar-schema';
import { GRADE_TO_LETTER, LETTER_TO_GRADE } from './nl-rebar-schema';
import { parseRebar, parseStirrup, parseSlabRebar } from './rebar';

// ─── 辅助: spec → notation string ───

function gradeLetter(grade: string): string {
  return GRADE_TO_LETTER[grade] || GRADE_TO_LETTER[grade.toUpperCase()] || 'C';
}

/** {count:4, grade:"HRB400", diameter:25} → "4C25" */
export function rebarSpecToNotation(spec: RebarSpec): string {
  return `${spec.count}${gradeLetter(spec.grade)}${spec.diameter}`;
}

/** {grade:"HRB400", diameter:10, spacing:200} → "C10@200" */
export function distributedSpecToNotation(spec: DistributedRebarSpec): string {
  return `${gradeLetter(spec.grade)}${spec.diameter}@${spec.spacing}`;
}

/** StirrupSpec → "A8@100/200(2)" */
export function stirrupSpecToNotation(spec: StirrupSpec): string {
  const g = gradeLetter(spec.grade);
  if (spec.spacingDense === spec.spacingNormal) {
    return `${g}${spec.diameter}@${spec.spacingDense}/${spec.spacingDense}(${spec.legs})`;
  }
  return `${g}${spec.diameter}@${spec.spacingDense}/${spec.spacingNormal}(${spec.legs})`;
}

// ─── 辅助: notation string → spec ───

function gradeFullName(letter: string): string {
  return LETTER_TO_GRADE[letter] || 'HRB400';
}

export function notationToRebarSpec(notation: string): RebarSpec {
  const info = parseRebar(notation);
  return { count: info.count, grade: gradeFullName(info.grade), diameter: info.diameter };
}

export function notationToDistributedSpec(notation: string): DistributedRebarSpec {
  const info = parseSlabRebar(notation);
  return { grade: gradeFullName(info.grade), diameter: info.diameter, spacing: info.spacing };
}

export function notationToStirrupSpec(notation: string): StirrupSpec {
  const info = parseStirrup(notation);
  return { grade: gradeFullName(info.grade), diameter: info.diameter, spacingDense: info.spacingDense, spacingNormal: info.spacingNormal, legs: info.legs };
}

// ─── mapSchemaToParams ───

function beamSchemaToParams(s: BeamSchema): Partial<BeamParams> {
  const p: Partial<BeamParams> = {};
  if (s.sectionWidth !== undefined) p.b = s.sectionWidth;
  if (s.sectionHeight !== undefined) p.h = s.sectionHeight;
  if (s.topRebar) p.top = rebarSpecToNotation(s.topRebar);
  if (s.bottomRebar) p.bottom = rebarSpecToNotation(s.bottomRebar);
  if (s.stirrup) p.stirrup = stirrupSpecToNotation(s.stirrup);
  if (s.leftSupportRebar) p.leftSupport = rebarSpecToNotation(s.leftSupportRebar);
  if (s.rightSupportRebar) p.rightSupport = rebarSpecToNotation(s.rightSupportRebar);
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
  if (s.columnWidth !== undefined) p.hc = s.columnWidth;
  return p;
}

function columnSchemaToParams(s: ColumnSchema): Partial<ColumnParams> {
  const p: Partial<ColumnParams> = {};
  if (s.sectionWidth !== undefined) p.b = s.sectionWidth;
  if (s.sectionHeight !== undefined) p.h = s.sectionHeight;
  if (s.mainRebar) p.main = rebarSpecToNotation(s.mainRebar);
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
  if (s.bottomXBar) p.bottomX = distributedSpecToNotation(s.bottomXBar);
  if (s.bottomYBar) p.bottomY = distributedSpecToNotation(s.bottomYBar);
  if (s.topXBar) p.topX = distributedSpecToNotation(s.topXBar);
  if (s.topYBar) p.topY = distributedSpecToNotation(s.topYBar);
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

export function mapSchemaToParams(
  schema: RebarGenSchema,
  componentType: ComponentType
): Partial<BeamParams | ColumnParams | SlabParams | JointParams | ShearWallParams> {
  switch (componentType) {
    case 'beam': return beamSchemaToParams(schema as BeamSchema);
    case 'column': return columnSchemaToParams(schema as ColumnSchema);
    case 'shearwall': return shearWallSchemaToParams(schema as ShearWallSchema);
    case 'slab': return slabSchemaToParams(schema as SlabSchema);
    case 'joint': return jointSchemaToParams(schema as JointSchema);
  }
}

// ─── mapParamsToSchema ───

function beamParamsToSchema(p: BeamParams): BeamSchema {
  const s: BeamSchema = { componentType: 'beam' };
  s.sectionWidth = p.b;
  s.sectionHeight = p.h;
  s.topRebar = notationToRebarSpec(p.top);
  s.bottomRebar = notationToRebarSpec(p.bottom);
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
  return {
    componentType: 'column',
    sectionWidth: p.b, sectionHeight: p.h,
    mainRebar: notationToRebarSpec(p.main),
    stirrup: notationToStirrupSpec(p.stirrup),
    concreteGrade: p.concreteGrade, seismicGrade: p.seismicGrade,
    cover: p.cover, height: p.height,
  };
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
    bottomXBar: notationToDistributedSpec(p.bottomX),
    bottomYBar: notationToDistributedSpec(p.bottomY),
    concreteGrade: p.concreteGrade, cover: p.cover,
  };
  if (p.topX) s.topXBar = notationToDistributedSpec(p.topX);
  if (p.topY) s.topYBar = notationToDistributedSpec(p.topY);
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
  }
}
