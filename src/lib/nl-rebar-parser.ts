/**
 * AI 响应解析与校验
 */
import type { ComponentType } from './types';
import type { RebarGenSchema, RebarSpec, DistributedRebarSpec, StirrupSpec } from './nl-rebar-schema';
import { STANDARD_DIAMETERS, GRADE_TO_LETTER } from './nl-rebar-schema';
import { CONCRETE_GRADES, SEISMIC_GRADES } from './anchor';

/** 从 AI 响应文本中提取 JSON 对象 */
export function extractJSON(text: string): object {
  // 尝试直接解析
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch { /* continue */ }

  // 尝试提取 ```json ... ``` 或 ``` ... ```
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch { /* continue */ }
  }

  // 尝试提取第一个 { ... } 块
  const braceMatch = trimmed.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try {
      return JSON.parse(braceMatch[0]);
    } catch { /* continue */ }
  }

  throw new Error('AI 返回格式异常，无法提取 JSON');
}

// ─── 校验辅助 ───

function isValidGrade(grade: string): boolean {
  return grade in GRADE_TO_LETTER;
}

function isValidDiameter(d: number): boolean {
  return STANDARD_DIAMETERS.includes(d);
}

function validateRebarSpec(spec: unknown, fieldName: string, errors: string[]): spec is RebarSpec {
  if (!spec || typeof spec !== 'object') return false;
  const s = spec as Record<string, unknown>;
  if (typeof s.count !== 'number' || s.count < 1 || s.count > 50) {
    errors.push(`${fieldName}.count 应为 1-50 的整数`);
  }
  if (typeof s.grade !== 'string' || !isValidGrade(s.grade)) {
    errors.push(`${fieldName}.grade 无效，应为 HPB300/HRB335/HRB400/RRB400/HRBF400`);
  }
  if (typeof s.diameter !== 'number' || !isValidDiameter(s.diameter)) {
    errors.push(`${fieldName}.diameter 无效，标准直径: ${STANDARD_DIAMETERS.join(',')}`);
  }
  return errors.length === 0;
}

function validateDistributedSpec(spec: unknown, fieldName: string, errors: string[]): spec is DistributedRebarSpec {
  if (!spec || typeof spec !== 'object') return false;
  const s = spec as Record<string, unknown>;
  if (typeof s.grade !== 'string' || !isValidGrade(s.grade)) {
    errors.push(`${fieldName}.grade 无效`);
  }
  if (typeof s.diameter !== 'number' || !isValidDiameter(s.diameter)) {
    errors.push(`${fieldName}.diameter 无效`);
  }
  if (typeof s.spacing !== 'number' || s.spacing < 50 || s.spacing > 500) {
    errors.push(`${fieldName}.spacing 应为 50-500mm`);
  }
  return errors.length === 0;
}

function validateStirrupSpec(spec: unknown, fieldName: string, errors: string[]): spec is StirrupSpec {
  if (!spec || typeof spec !== 'object') return false;
  const s = spec as Record<string, unknown>;
  if (typeof s.grade !== 'string' || !isValidGrade(s.grade)) {
    errors.push(`${fieldName}.grade 无效`);
  }
  if (typeof s.diameter !== 'number' || !isValidDiameter(s.diameter)) {
    errors.push(`${fieldName}.diameter 无效`);
  }
  if (typeof s.spacingDense !== 'number' || s.spacingDense < 50 || s.spacingDense > 300) {
    errors.push(`${fieldName}.spacingDense 应为 50-300mm`);
  }
  if (typeof s.spacingNormal !== 'number' || s.spacingNormal < 50 || s.spacingNormal > 500) {
    errors.push(`${fieldName}.spacingNormal 应为 50-500mm`);
  }
  if (typeof s.legs !== 'number' || s.legs < 2 || s.legs > 8) {
    errors.push(`${fieldName}.legs 应为 2-8`);
  }
  return errors.length === 0;
}

function numInRange(val: unknown, min: number, max: number): boolean {
  return typeof val === 'number' && val >= min && val <= max;
}

/** 校验 RebarGenSchema */
export function validateRebarGenSchema(
  data: object,
  componentType: ComponentType
): { valid: true; schema: RebarGenSchema } | { valid: false; errors: string[] } {
  const d = data as Record<string, unknown>;
  const errors: string[] = [];

  // componentType 校验
  if (d.componentType && d.componentType !== componentType) {
    errors.push(`componentType 应为 "${componentType}"，实际为 "${d.componentType}"`);
  }
  // 强制设置正确的 componentType
  d.componentType = componentType;

  // 通用字段校验
  if (d.concreteGrade !== undefined && !(CONCRETE_GRADES as readonly string[]).includes(d.concreteGrade as string)) {
    errors.push(`concreteGrade 无效，应为 ${CONCRETE_GRADES.join('/')}`);
  }
  if (d.seismicGrade !== undefined && !(SEISMIC_GRADES as readonly string[]).includes(d.seismicGrade as string)) {
    errors.push(`seismicGrade 无效，应为 ${SEISMIC_GRADES.join('/')}`);
  }
  if (d.cover !== undefined && !numInRange(d.cover, 10, 60)) {
    errors.push('cover 应为 10-60mm');
  }

  // 按构件类型校验特有字段
  switch (componentType) {
    case 'beam':
      if (d.sectionWidth !== undefined && !numInRange(d.sectionWidth, 150, 1200)) errors.push('sectionWidth 应为 150-1200mm');
      if (d.sectionHeight !== undefined && !numInRange(d.sectionHeight, 200, 2000)) errors.push('sectionHeight 应为 200-2000mm');
      if (d.topRebar) validateRebarSpec(d.topRebar, 'topRebar', errors);
      if (d.bottomRebar) validateRebarSpec(d.bottomRebar, 'bottomRebar', errors);
      if (d.stirrup) validateStirrupSpec(d.stirrup, 'stirrup', errors);
      if (d.leftSupportRebar) validateRebarSpec(d.leftSupportRebar, 'leftSupportRebar', errors);
      if (d.rightSupportRebar) validateRebarSpec(d.rightSupportRebar, 'rightSupportRebar', errors);
      if (d.spanLength !== undefined && !numInRange(d.spanLength, 1000, 20000)) errors.push('spanLength 应为 1000-20000mm');
      if (d.columnWidth !== undefined && !numInRange(d.columnWidth, 200, 1200)) errors.push('columnWidth 应为 200-1200mm');
      break;

    case 'column':
      if (d.sectionWidth !== undefined && !numInRange(d.sectionWidth, 200, 1200)) errors.push('sectionWidth 应为 200-1200mm');
      if (d.sectionHeight !== undefined && !numInRange(d.sectionHeight, 200, 1200)) errors.push('sectionHeight 应为 200-1200mm');
      if (d.mainRebar) validateRebarSpec(d.mainRebar, 'mainRebar', errors);
      if (d.stirrup) validateStirrupSpec(d.stirrup, 'stirrup', errors);
      if (d.height !== undefined && !numInRange(d.height, 1000, 10000)) errors.push('height 应为 1000-10000mm');
      break;

    case 'shearwall':
      if (d.wallThickness !== undefined && !numInRange(d.wallThickness, 150, 500)) errors.push('wallThickness 应为 150-500mm');
      if (d.wallLength !== undefined && !numInRange(d.wallLength, 500, 10000)) errors.push('wallLength 应为 500-10000mm');
      if (d.wallHeight !== undefined && !numInRange(d.wallHeight, 1000, 10000)) errors.push('wallHeight 应为 1000-10000mm');
      if (d.verticalBar) validateDistributedSpec(d.verticalBar, 'verticalBar', errors);
      if (d.horizontalBar) validateDistributedSpec(d.horizontalBar, 'horizontalBar', errors);
      if (d.boundaryMainRebar) validateRebarSpec(d.boundaryMainRebar, 'boundaryMainRebar', errors);
      if (d.boundaryStirrup) validateStirrupSpec(d.boundaryStirrup, 'boundaryStirrup', errors);
      break;

    case 'slab':
      if (d.thickness !== undefined && !numInRange(d.thickness, 60, 300)) errors.push('thickness 应为 60-300mm');
      if (d.bottomXBar) validateDistributedSpec(d.bottomXBar, 'bottomXBar', errors);
      if (d.bottomYBar) validateDistributedSpec(d.bottomYBar, 'bottomYBar', errors);
      if (d.topXBar) validateDistributedSpec(d.topXBar, 'topXBar', errors);
      if (d.topYBar) validateDistributedSpec(d.topYBar, 'topYBar', errors);
      if (d.distributionBar) validateDistributedSpec(d.distributionBar, 'distributionBar', errors);
      break;

    case 'joint':
      if (d.columnWidth !== undefined && !numInRange(d.columnWidth, 200, 1200)) errors.push('columnWidth 应为 200-1200mm');
      if (d.columnHeight !== undefined && !numInRange(d.columnHeight, 200, 1200)) errors.push('columnHeight 应为 200-1200mm');
      if (d.columnMainRebar) validateRebarSpec(d.columnMainRebar, 'columnMainRebar', errors);
      if (d.columnStirrup) validateStirrupSpec(d.columnStirrup, 'columnStirrup', errors);
      if (d.beamWidth !== undefined && !numInRange(d.beamWidth, 150, 1200)) errors.push('beamWidth 应为 150-1200mm');
      if (d.beamHeight !== undefined && !numInRange(d.beamHeight, 200, 2000)) errors.push('beamHeight 应为 200-2000mm');
      if (d.beamTopRebar) validateRebarSpec(d.beamTopRebar, 'beamTopRebar', errors);
      if (d.beamBottomRebar) validateRebarSpec(d.beamBottomRebar, 'beamBottomRebar', errors);
      if (d.beamStirrup) validateStirrupSpec(d.beamStirrup, 'beamStirrup', errors);
      if (d.jointType !== undefined && !['middle', 'side', 'corner'].includes(d.jointType as string)) {
        errors.push('jointType 应为 middle/side/corner');
      }
      if (d.anchorType !== undefined && !['straight', 'bent'].includes(d.anchorType as string)) {
        errors.push('anchorType 应为 straight/bent');
      }
      break;

    case 'pilecap':
      if (d.bx !== undefined && !numInRange(d.bx, 600, 6000)) errors.push('bx 应为 600-6000mm');
      if (d.by !== undefined && !numInRange(d.by, 600, 6000)) errors.push('by 应为 600-6000mm');
      if (d.h !== undefined && !numInRange(d.h, 500, 3000)) errors.push('h 应为 500-3000mm');
      if (d.pileDiameter !== undefined && !numInRange(d.pileDiameter, 200, 2000)) errors.push('pileDiameter 应为 200-2000mm');
      if (d.pileCount !== undefined && !numInRange(d.pileCount, 1, 16)) errors.push('pileCount 应为 1-16');
      if (d.colBx !== undefined && !numInRange(d.colBx, 200, 1200)) errors.push('colBx 应为 200-1200mm');
      if (d.colBy !== undefined && !numInRange(d.colBy, 200, 1200)) errors.push('colBy 应为 200-1200mm');
      if (d.pileLayout !== undefined && !['grid', 'circular'].includes(d.pileLayout as string)) {
        errors.push('pileLayout 应为 grid/circular');
      }
      break;

    case 'raft':
      if (d.lx !== undefined && !numInRange(d.lx, 3000, 60000)) errors.push('lx 应为 3000-60000mm');
      if (d.ly !== undefined && !numInRange(d.ly, 3000, 40000)) errors.push('ly 应为 3000-40000mm');
      if (d.h !== undefined && !numInRange(d.h, 300, 2000)) errors.push('h 应为 300-2000mm');
      if (d.colCountX !== undefined && !numInRange(d.colCountX, 1, 10)) errors.push('colCountX 应为 1-10');
      if (d.colCountY !== undefined && !numInRange(d.colCountY, 1, 10)) errors.push('colCountY 应为 1-10');
      if (d.colBx !== undefined && !numInRange(d.colBx, 200, 1000)) errors.push('colBx 应为 200-1000mm');
      if (d.colBy !== undefined && !numInRange(d.colBy, 200, 1000)) errors.push('colBy 应为 200-1000mm');
      if (d.raftType !== undefined && !['flat', 'beamSlab', 'flatPlate'].includes(d.raftType as string)) {
        errors.push('raftType 应为 flat/beamSlab/flatPlate');
      }
      break;
  }

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, schema: data as RebarGenSchema };
}

/** 完整解析流程 */
export function parseAIResponse(
  responseText: string,
  componentType: ComponentType
): { success: true; schema: RebarGenSchema } | { success: false; error: string } {
  try {
    const json = extractJSON(responseText);
    const result = validateRebarGenSchema(json, componentType);
    if (!result.valid) {
      return { success: false, error: `参数校验失败:\n${result.errors.join('\n')}` };
    }
    return { success: true, schema: result.schema };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'AI 返回格式异常，请重试或调整描述' };
  }
}
