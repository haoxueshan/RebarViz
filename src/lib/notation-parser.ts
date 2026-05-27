/**
 * 平法标注本地快速解析
 * 在发送 AI 前先尝试本地正则解析，识别成功则直接映射为 params，跳过 AI 调用
 *
 * 支持格式:
 * 梁: KL1(3) 300×600 2C25 4C25 A8@100/200(2) [左支座] [右支座]
 * 柱: KZ1 500×500 12C25 A10@100/200(4)
 * 板: LB1 h=120 C10@150 C10@200
 * 剪力墙: Q1 bw=200 lw=3000 C10@200 C10@200 8C16
 */
import type { ComponentType, BeamParams, ColumnParams, SlabParams, JointParams, ShearWallParams, StairParams, FoundationParams } from './types';

type AnyParams = BeamParams | ColumnParams | SlabParams | JointParams | ShearWallParams | StairParams | FoundationParams;

export interface NotationParseResult {
  success: true;
  params: Partial<AnyParams>;
  description: string; // 中文描述识别结果
}

export interface NotationParseFail {
  success: false;
}

export type NotationResult = NotationParseResult | NotationParseFail;

// ─── 通用正则 ───

/** 截面尺寸: 300×600, 300x600, 300*600, 300乘600 */
const RE_SECTION = /(\d{2,4})\s*[×xX*×乘]\s*(\d{2,4})/;

/** 箍筋标注: A8@100/200(2), C10@100/200(4) */
const RE_STIRRUP = /([A-Ea-e])(\d{1,2})@(\d{2,3})(?:\/(\d{2,3}))?\((\d)\)/;

/** 梁编号: KL1, KL1(3), WKL2(5), 允许OCR产生的空格/连字符、中文括号 */
const RE_BEAM_ID = /[A-Z]*KL[\s\-]*\d+(?:\s*[\(\uff08]\s*\d+\s*[\)\uff09])?/i;

/** 柱编号: KZ1, KZ2 */
const RE_COLUMN_ID = /KZ\d+/i;

/** 板编号: LB1, LB2 */
const RE_SLAB_ID = /LB\d+/i;

/** 剪力墙编号: Q1, Q2 */
const RE_WALL_ID = /Q\d+/i;

/** 楼梯标识: AT, BT, CT, DT, ET, 楼梯, 梯段 */
const RE_STAIR_ID = /(?:AT|BT|CT|DT|ET)(?:\d*|型)|楼梯|梯段/i;

/** 独立基础编号: DJ1, 独立基础, 独基 */
const RE_FOUNDATION_ID = /DJ\d*|独立基础|独基/i;

// ─── 辅助 ───

function extractAllRebars(text: string): Array<{ count: number; grade: string; diameter: number; raw: string }> {
  const results: Array<{ count: number; grade: string; diameter: number; raw: string }> = [];
  const re = /(\d{1,2})([A-Ea-e])(\d{1,2})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    // 排除箍筋中的匹配（如 A8@... 中的 A8 不是纵筋）
    const after = text.slice(m.index + m[0].length);
    if (after.startsWith('@')) continue; // 这是分布筋/箍筋，不是纵筋
    // 排除腰筋/抗扭筋（前缀 G 或 N，如 G4C12、N2C16）
    if (m.index > 0) {
      const before = text[m.index - 1];
      if (before === 'G' || before === 'N' || before === 'g' || before === 'n') continue;
    }
    results.push({
      count: parseInt(m[1]),
      grade: m[2].toUpperCase(),
      diameter: parseInt(m[3]),
      raw: m[0],
    });
  }
  return results;
}

function extractStirrup(text: string): { grade: string; diameter: number; spacingDense: number; spacingNormal: number; legs: number; raw: string } | null {
  const m = text.match(RE_STIRRUP);
  if (!m) return null;
  return {
    grade: m[1].toUpperCase(),
    diameter: parseInt(m[2]),
    spacingDense: parseInt(m[3]),
    spacingNormal: m[4] ? parseInt(m[4]) : parseInt(m[3]),
    legs: parseInt(m[5]),
    raw: m[0],
  };
}

function extractDistributed(text: string): Array<{ grade: string; diameter: number; spacing: number; raw: string }> {
  const results: Array<{ grade: string; diameter: number; spacing: number; raw: string }> = [];
  const re = /([A-Ea-e])(\d{1,2})@(\d{2,3})(?!\s*[/(])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    // 排除箍筋（后面跟 / 和 (）
    const after = text.slice(m.index + m[0].length);
    if (after.match(/^\s*\/\s*\d+\s*\(/)) continue;
    results.push({
      grade: m[1].toUpperCase(),
      diameter: parseInt(m[2]),
      spacing: parseInt(m[3]),
      raw: m[0],
    });
  }
  return results;
}

function rebarNotation(count: number, grade: string, diameter: number): string {
  return `${count}${grade}${diameter}`;
}

/** 提取混合直径标注: 2C25+2C22, 2C25+3C20 等 → 完整字符串 */
function extractMixedDiameter(text: string): string | null {
  const m = text.match(/(\d{1,2}[A-Ea-e]\d{1,2})\s*\+\s*(\d{1,2}[A-Ea-e]\d{1,2})/);
  if (!m) return null;
  return `${m[1].toUpperCase()}+${m[2].toUpperCase()}`;
}

/** 提取多排标注: 6C25 4/2 或 6C25(2) → { notation, rows?, perRow? } */
function extractRowInfo(text: string): { notation: string; rows?: number; perRow?: string } | null {
  // 匹配 6C25 4/2 格式
  const m1 = text.match(/(\d{1,2})([A-Ea-e])(\d{1,2})\s+(\d)\/(\d)/);
  if (m1) {
    const count = parseInt(m1[1]);
    const grade = m1[2].toUpperCase();
    const diameter = parseInt(m1[3]);
    return { notation: `${count}${grade}${diameter}(${m1[4]}/${m1[5]})`, perRow: `${m1[4]}/${m1[5]}` };
  }
  // 匹配 6C25(2) 格式（排数）
  const m2 = text.match(/(\d{1,2})([A-Ea-e])(\d{1,2})\s*\((\d)\)(?!\s*@)/);
  if (m2) {
    // 排除箍筋格式 A8@100/200(2) — 前面没有 @ 时才是排数标注
    const before = text.slice(0, m2.index);
    if (before.match(/@\d+\/\d+\s*$/)) return null; // 这是箍筋
    const count = parseInt(m2[1]);
    const grade = m2[2].toUpperCase();
    const diameter = parseInt(m2[3]);
    const rows = parseInt(m2[4]);
    return { notation: `${count}${grade}${diameter}(${rows})`, rows };
  }
  return null;
}

/** 提取多跨截面: "第一跨250x400 第二跨250x500" 或 "250x400,250x500" */
function extractMultiSpanSections(text: string): Array<{ b: number; h: number }> | null {
  const results: Array<{ b: number; h: number }> = [];
  // 模式1: 第N跨250x400
  const re1 = /第[一二三四五六七八九十\d]+跨\s*(\d{2,4})\s*[×xX*×乘]\s*(\d{2,4})/g;
  let m: RegExpExecArray | null;
  while ((m = re1.exec(text)) !== null) {
    results.push({ b: parseInt(m[1]), h: parseInt(m[2]) });
  }
  if (results.length >= 2) return results;
  // 模式2: 逗号/顿号分隔的多个截面 250x400,250x500
  const secs = text.match(/(\d{2,4})\s*[×xX*×乘]\s*(\d{2,4})/g);
  if (secs && secs.length >= 2) {
    // 只有在确认是多跨上下文时才当多截面（检测有梁编号+括号跨数）
    const hasMultiSpanId = /KL[\s\-]*\d+[\s]*[\(\uff08]\s*(\d+)\s*[\)\uff09]/i.test(text);
    if (hasMultiSpanId) {
      const re2 = /(\d{2,4})\s*[×xX*×乘]\s*(\d{2,4})/g;
      let m2: RegExpExecArray | null;
      while ((m2 = re2.exec(text)) !== null) {
        results.push({ b: parseInt(m2[1]), h: parseInt(m2[2]) });
      }
      if (results.length >= 2) return results;
    }
  }
  return null;
}

function stirrupNotation(s: { grade: string; diameter: number; spacingDense: number; spacingNormal: number; legs: number }): string {
  return `${s.grade}${s.diameter}@${s.spacingDense}/${s.spacingNormal}(${s.legs})`;
}

function distributedNotation(d: { grade: string; diameter: number; spacing: number }): string {
  return `${d.grade}${d.diameter}@${d.spacing}`;
}

// ─── 梁标注解析 ───

function parseBeamNotation(text: string): NotationResult {
  // 检测是否含有梁标注特征
  const hasBeamId = RE_BEAM_ID.test(text);
  const hasSection = RE_SECTION.test(text);
  const hasStirrup = RE_STIRRUP.test(text);
  const rebars = extractAllRebars(text);

  // 至少要有截面尺寸 + 纵筋 或 梁编号
  if (!hasSection && rebars.length < 2 && !hasBeamId) return { success: false };
  if (!hasBeamId && !hasStirrup && rebars.length < 2) return { success: false };

  const params: Partial<BeamParams> = {};
  const desc: string[] = [];

  // 编号（规范化：去除空格/连字符、统一括号）
  const idMatch = text.match(RE_BEAM_ID);
  if (idMatch) {
    params.id = idMatch[0].toUpperCase().replace(/[\s\-]/g, '').replace(/\uff08/g, '(').replace(/\uff09/g, ')');
    desc.push(params.id);
    // 从编号中提取跨数: KL1(3) → spanCount=3
    const spanCountMatch = params.id.match(/\((\d+)\)/);
    if (spanCountMatch) {
      const sc = parseInt(spanCountMatch[1]);
      if (sc >= 1 && sc <= 20) {
        params.spanCount = sc;
      }
    }
  }

  // 截面
  const secMatch = text.match(RE_SECTION);
  if (secMatch) {
    params.b = parseInt(secMatch[1]);
    params.h = parseInt(secMatch[2]);
    desc.push(`截面${params.b}×${params.h}`);
  }

  // 多跨截面：检测是否有多个不同截面
  const multiSections = extractMultiSpanSections(text);
  if (multiSections && multiSections.length >= 2) {
    params.spanWidths = multiSections.map(s => s.b);
    params.spanHeights = multiSections.map(s => s.h);
    if (!params.spanCount || params.spanCount < multiSections.length) {
      params.spanCount = multiSections.length;
    }
    if (!params.b) params.b = multiSections[0].b;
    if (!params.h) params.h = multiSections[0].h;
    desc.push(`多跨截面${multiSections.map(s => `${s.b}×${s.h}`).join('/')}`);
  }

  // 箍筋（先提取，避免和纵筋混淆）
  const stirrup = extractStirrup(text);
  if (stirrup) {
    params.stirrup = stirrupNotation(stirrup);
    desc.push(`箍筋${params.stirrup}`);
  }

  // 腰筋/抗扭筋：检测 G或N 前缀的钢筋标注（如 G4C12、N2C16）
  const sideBarMatch = text.match(/([GNgn])(\d{1,2})([A-Ea-e])(\d{1,2})/);
  if (sideBarMatch) {
    const prefix = sideBarMatch[1].toUpperCase();
    const count = parseInt(sideBarMatch[2]);
    const grade = sideBarMatch[3].toUpperCase();
    const diameter = parseInt(sideBarMatch[4]);
    params.sideBar = `${prefix}${count}${grade}${diameter}`;
    desc.push(`腰筋${params.sideBar}`);
  }

  // 纵筋解析：平法集中标注中 “;” 或 “；” 分隔上部筋和下部筋
  const semiParts = text.split(/[;；]/);
  const topMixed = extractMixedDiameter(semiParts[0]);
  const bottomMixed = semiParts.length >= 2 ? extractMixedDiameter(semiParts[1]) : null;
  const topRowInfo = extractRowInfo(semiParts[0]);
  const bottomRowInfo = semiParts.length >= 2 ? extractRowInfo(semiParts[1]) : null;

  if (semiParts.length >= 2) {
    const topRebars = extractAllRebars(semiParts[0]);
    const bottomRebars = extractAllRebars(semiParts[1]);

    // 上部筋：优先混合直径 > 多排标注 > 普通标注
    if (topMixed) {
      params.top = topMixed;
      desc.push(`上部筋${params.top}`);
    } else if (topRowInfo) {
      params.top = topRowInfo.notation;
      desc.push(`上部筋${params.top}`);
    } else if (topRebars.length >= 1) {
      params.top = rebarNotation(topRebars[topRebars.length - 1].count, topRebars[topRebars.length - 1].grade, topRebars[topRebars.length - 1].diameter);
      desc.push(`上部筋${params.top}`);
    }

    // 下部筋：优先混合直径 > 多排标注 > 普通标注
    if (bottomMixed) {
      params.bottom = bottomMixed;
      desc.push(`下部筋${params.bottom}`);
    } else if (bottomRowInfo) {
      params.bottom = bottomRowInfo.notation;
      desc.push(`下部筋${params.bottom}`);
    } else if (bottomRebars.length >= 1) {
      params.bottom = rebarNotation(bottomRebars[0].count, bottomRebars[0].grade, bottomRebars[0].diameter);
      desc.push(`下部筋${params.bottom}`);
    }

    // 如果分号后有多个纵筋，第二个可能是支座筋（排除腰筋后）
    if (bottomRebars.length >= 2) {
      params.leftSupport = rebarNotation(bottomRebars[1].count, bottomRebars[1].grade, bottomRebars[1].diameter);
      desc.push(`左支座${params.leftSupport}`);
    }
    if (bottomRebars.length >= 3) {
      params.rightSupport = rebarNotation(bottomRebars[2].count, bottomRebars[2].grade, bottomRebars[2].diameter);
      desc.push(`右支座${params.rightSupport}`);
    }
  } else {
    // 无分号分隔：检测混合直径和多排标注
    if (topMixed) {
      params.top = topMixed;
      desc.push(`上部筋${params.top}`);
      const remaining = rebars.filter(r => !topMixed.includes(r.raw));
      if (remaining.length >= 1) {
        params.bottom = rebarNotation(remaining[0].count, remaining[0].grade, remaining[0].diameter);
        desc.push(`下部筋${params.bottom}`);
      }
    } else if (topRowInfo) {
      params.top = topRowInfo.notation;
      desc.push(`上部筋${params.top}`);
      if (rebars.length >= 2) {
        params.bottom = rebarNotation(rebars[1].count, rebars[1].grade, rebars[1].diameter);
        desc.push(`下部筋${params.bottom}`);
      }
    } else {
      // 按顺序分配为 上部筋、下部筋、左支座、右支座
      if (rebars.length >= 1) {
        params.top = rebarNotation(rebars[0].count, rebars[0].grade, rebars[0].diameter);
        desc.push(`上部筋${params.top}`);
      }
      if (rebars.length >= 2) {
        params.bottom = rebarNotation(rebars[1].count, rebars[1].grade, rebars[1].diameter);
        desc.push(`下部筋${params.bottom}`);
      }
      if (rebars.length >= 3) {
        params.leftSupport = rebarNotation(rebars[2].count, rebars[2].grade, rebars[2].diameter);
        desc.push(`左支座${params.leftSupport}`);
      }
      if (rebars.length >= 4) {
        params.rightSupport = rebarNotation(rebars[3].count, rebars[3].grade, rebars[3].diameter);
        desc.push(`右支座${params.rightSupport}`);
      }
    }
  }

  if (Object.keys(params).length < 2) return { success: false };

  return {
    success: true,
    params,
    description: `已识别梁标注：${desc.join('，')}`,
  };
}

// ─── 柱标注解析 ───

function parseColumnNotation(text: string): NotationResult {
  const hasColumnId = RE_COLUMN_ID.test(text);
  const hasSection = RE_SECTION.test(text);
  const rebars = extractAllRebars(text);
  const stirrup = extractStirrup(text);

  if (!hasColumnId && !hasSection) return { success: false };
  if (rebars.length < 1 && !stirrup) return { success: false };

  const params: Partial<ColumnParams> = {};
  const desc: string[] = [];

  const idMatch = text.match(RE_COLUMN_ID);
  if (idMatch) {
    params.id = idMatch[0].toUpperCase();
    desc.push(params.id);
  }

  const secMatch = text.match(RE_SECTION);
  if (secMatch) {
    params.b = parseInt(secMatch[1]);
    params.h = parseInt(secMatch[2]);
    desc.push(`截面${params.b}×${params.h}`);
  }

  if (rebars.length >= 1) {
    params.main = rebarNotation(rebars[0].count, rebars[0].grade, rebars[0].diameter);
    desc.push(`纵筋${params.main}`);
  }

  if (stirrup) {
    params.stirrup = stirrupNotation(stirrup);
    desc.push(`箍筋${params.stirrup}`);
  }

  if (Object.keys(params).length < 2) return { success: false };

  return {
    success: true,
    params,
    description: `已识别柱标注：${desc.join('，')}`,
  };
}

// ─── 板标注解析 ───

function parseSlabNotation(text: string): NotationResult {
  const hasSlabId = RE_SLAB_ID.test(text);
  const distributed = extractDistributed(text);

  // 提取板厚: h=120, 厚120, 120厚
  const thicknessMatch = text.match(/(?:h\s*=\s*|厚度?\s*=?\s*)(\d{2,3})|(\d{2,3})\s*厚/i);

  if (!hasSlabId && !thicknessMatch && distributed.length < 1) return { success: false };

  const params: Partial<SlabParams> = {};
  const desc: string[] = [];

  const idMatch = text.match(RE_SLAB_ID);
  if (idMatch) {
    params.id = idMatch[0].toUpperCase();
    desc.push(params.id);
  }

  if (thicknessMatch) {
    params.thickness = parseInt(thicknessMatch[1] || thicknessMatch[2]);
    desc.push(`板厚${params.thickness}mm`);
  }

  // 分布筋按顺序: X底、Y底、X面、Y面
  if (distributed.length >= 1) {
    params.bottomX = distributedNotation(distributed[0]);
    desc.push(`X底筋${params.bottomX}`);
  }
  if (distributed.length >= 2) {
    params.bottomY = distributedNotation(distributed[1]);
    desc.push(`Y底筋${params.bottomY}`);
  }
  if (distributed.length >= 3) {
    params.topX = distributedNotation(distributed[2]);
    desc.push(`X面筋${params.topX}`);
  }
  if (distributed.length >= 4) {
    params.topY = distributedNotation(distributed[3]);
    desc.push(`Y面筋${params.topY}`);
  }

  if (Object.keys(params).length < 2) return { success: false };

  return {
    success: true,
    params,
    description: `已识别板标注：${desc.join('，')}`,
  };
}

// ─── 剪力墙标注解析 ───

function parseShearWallNotation(text: string): NotationResult {
  const hasWallId = RE_WALL_ID.test(text);
  const distributed = extractDistributed(text);
  const rebars = extractAllRebars(text);

  // 提取墙厚: bw=200
  const bwMatch = text.match(/bw\s*=\s*(\d{3})/i);
  // 提取墙长: lw=3000
  const lwMatch = text.match(/lw\s*=\s*(\d{3,5})/i);

  if (!hasWallId && !bwMatch && distributed.length < 1) return { success: false };

  const params: Partial<ShearWallParams> = {};
  const desc: string[] = [];

  const idMatch = text.match(RE_WALL_ID);
  if (idMatch) {
    params.id = idMatch[0].toUpperCase();
    desc.push(params.id);
  }

  if (bwMatch) {
    params.bw = parseInt(bwMatch[1]);
    desc.push(`墙厚${params.bw}mm`);
  }
  if (lwMatch) {
    params.lw = parseInt(lwMatch[1]);
    desc.push(`墙长${params.lw}mm`);
  }

  // 分布筋: 竖向、水平
  if (distributed.length >= 1) {
    params.vertBar = distributedNotation(distributed[0]);
    desc.push(`竖向${params.vertBar}`);
  }
  if (distributed.length >= 2) {
    params.horizBar = distributedNotation(distributed[1]);
    desc.push(`水平${params.horizBar}`);
  }

  // 边缘构件纵筋
  if (rebars.length >= 1) {
    params.boundaryMain = rebarNotation(rebars[0].count, rebars[0].grade, rebars[0].diameter);
    desc.push(`边缘纵筋${params.boundaryMain}`);
  }

  if (Object.keys(params).length < 2) return { success: false };

  return {
    success: true,
    params,
    description: `已识别剪力墙标注：${desc.join('，')}`,
  };
}

// ─── 楼梯标注解析 (22G101-2) ───

function parseStairNotation(text: string): NotationResult {
  const hasStairId = RE_STAIR_ID.test(text);
  const distributed = extractDistributed(text);

  // 提取楼梯类型: AT, BT, CT 等
  const typeMatch = text.match(/\b(AT|BT|CT|DT|ET)/i);
  // 提取踏步数: 10步, 12级, n=10
  const stepCountMatch = text.match(/(\d{1,2})\s*[步级踏]/) || text.match(/n\s*=\s*(\d{1,2})/i);
  // 提取踏步尺寸: 高150宽280, 步高150 步宽280, h=150 b=280
  const stepSizeMatch = text.match(/(?:踏步|步)?[^\d]*高\s*(\d{2,3})\s*(?:宽|×|x)\s*(\d{2,3})/i)
    || text.match(/步高\s*(\d{2,3})\s*步宽\s*(\d{2,3})/)
    || text.match(/h\s*=\s*(\d{2,3})\s*b\s*=\s*(\d{2,3})/i);
  // 提取板厚
  const thicknessMatch = text.match(/板厚\s*(\d{2,3})/) || text.match(/t\s*=\s*(\d{2,3})/i);
  // 提取梯段宽度
  const flightWidthMatch = text.match(/(?:梯段宽|宽度)\s*(\d{3,4})/) || text.match(/W\s*=\s*(\d{3,4})/i);

  if (!hasStairId && !stepCountMatch && distributed.length < 1) return { success: false };

  const params: Partial<StairParams> = {};
  const desc: string[] = [];

  // 楼梯类型
  if (typeMatch) {
    params.stairType = typeMatch[1].toUpperCase() as StairParams['stairType'];
    desc.push(`${params.stairType}型楼梯`);
  }

  // 踏步数
  if (stepCountMatch) {
    params.stepCount = parseInt(stepCountMatch[1]);
    desc.push(`${params.stepCount}步`);
  }

  // 踏步尺寸
  if (stepSizeMatch) {
    params.stepHeight = parseInt(stepSizeMatch[1]);
    params.stepWidth = parseInt(stepSizeMatch[2]);
    desc.push(`步高${params.stepHeight}×步宽${params.stepWidth}`);
  }

  // 板厚
  if (thicknessMatch) {
    params.slabThickness = parseInt(thicknessMatch[1]);
    desc.push(`板厚${params.slabThickness}mm`);
  }

  // 梯段宽度
  if (flightWidthMatch) {
    params.flightWidth = parseInt(flightWidthMatch[1]);
    desc.push(`梯段宽${params.flightWidth}mm`);
  }

  // 配筋: 分布筋按顺序 → bottomBar, topBar, distBar
  if (distributed.length >= 1) {
    params.bottomBar = distributedNotation(distributed[0]);
    desc.push(`底筋${params.bottomBar}`);
  }
  if (distributed.length >= 2) {
    params.topBar = distributedNotation(distributed[1]);
    desc.push(`面筋${params.topBar}`);
  }
  if (distributed.length >= 3) {
    params.distBar = distributedNotation(distributed[2]);
    desc.push(`分布筋${params.distBar}`);
  }

  if (Object.keys(params).length < 2) return { success: false };

  return {
    success: true,
    params,
    description: `已识别楼梯标注：${desc.join('，')}`,
  };
}

// ─── 独立基础标注解析 (22G101-3) ───

function parseFoundationNotation(text: string): NotationResult {
  const hasFoundId = RE_FOUNDATION_ID.test(text);
  const distributed = extractDistributed(text);
  const rebars = extractAllRebars(text);

  // 提取基础底面尺寸: 2000×2000 or bx=2000 by=2000
  const sizeMatch = text.match(/(\d{3,5})\s*[×xX*×乘]\s*(\d{3,5})/);
  const bxMatch = text.match(/bx\s*=\s*(\d{3,5})/i);
  const byMatch = text.match(/by\s*=\s*(\d{3,5})/i);
  // 提取总高: h=800, 高800
  const hMatch = text.match(/(?:基础)?[总]?高\s*(\d{3,4})/) || text.match(/h\s*=\s*(\d{3,4})/i);
  // 提取柱截面: 柱400×400, 柱截面400×400
  const colMatch = text.match(/柱(?:截面)?\s*(\d{2,4})\s*[×xX*×乘]\s*(\d{2,4})/);

  if (!hasFoundId && !sizeMatch && !bxMatch && distributed.length < 1) return { success: false };

  const params: Partial<FoundationParams> = {};
  const desc: string[] = [];

  // 编号
  const idMatch = text.match(/DJ\d+/i);
  if (idMatch) {
    params.id = idMatch[0].toUpperCase();
    desc.push(params.id);
  }

  // 底面尺寸
  if (sizeMatch) {
    params.bx = parseInt(sizeMatch[1]);
    params.by = parseInt(sizeMatch[2]);
    desc.push(`底面${params.bx}×${params.by}`);
  } else {
    if (bxMatch) { params.bx = parseInt(bxMatch[1]); desc.push(`bx=${params.bx}`); }
    if (byMatch) { params.by = parseInt(byMatch[1]); desc.push(`by=${params.by}`); }
  }

  // 总高
  if (hMatch) {
    params.h = parseInt(hMatch[1]);
    desc.push(`高${params.h}mm`);
  }

  // 柱截面
  if (colMatch) {
    params.colBx = parseInt(colMatch[1]);
    params.colBy = parseInt(colMatch[2]);
    desc.push(`柱${params.colBx}×${params.colBy}`);
  }

  // 底筋: 分布筋 → bottomBarX, bottomBarY
  if (distributed.length >= 1) {
    params.bottomBarX = distributedNotation(distributed[0]);
    desc.push(`X底筋${params.bottomBarX}`);
  }
  if (distributed.length >= 2) {
    params.bottomBarY = distributedNotation(distributed[1]);
    desc.push(`Y底筋${params.bottomBarY}`);
  }

  // 柱插筋 (纵筋格式)
  if (rebars.length >= 1) {
    params.colMain = rebarNotation(rebars[0].count, rebars[0].grade, rebars[0].diameter);
    desc.push(`柱插筋${params.colMain}`);
  }

  if (Object.keys(params).length < 2) return { success: false };

  return {
    success: true,
    params,
    description: `已识别独立基础标注：${desc.join('，')}`,
  };
}

// ─── 主入口 ───

/**
 * 尝试本地解析平法标注
 * @returns 解析结果，success=false 时应 fallback 到 AI
 */
export function tryParseNotation(text: string, componentType: ComponentType): NotationResult {
  const trimmed = text.trim();

  // 如果包含明显的自然语言问句词，不尝试本地解析
  if (/[?？]|怎么|为什么|什么是|如何|能不能|帮我|请问|计算/.test(trimmed)) {
    return { success: false };
  }

  // 按当前构件类型优先匹配，如果失败再尝试其他类型
  switch (componentType) {
    case 'beam': {
      const result = parseBeamNotation(trimmed);
      if (result.success) return result;
      break;
    }
    case 'column': {
      const result = parseColumnNotation(trimmed);
      if (result.success) return result;
      break;
    }
    case 'slab': {
      const result = parseSlabNotation(trimmed);
      if (result.success) return result;
      break;
    }
    case 'shearwall': {
      const result = parseShearWallNotation(trimmed);
      if (result.success) return result;
      break;
    }
    case 'joint':
      // 节点标注较复杂，暂不做本地解析，交给 AI
      break;
    case 'stair': {
      const result = parseStairNotation(trimmed);
      if (result.success) return result;
      break;
    }
    case 'foundation': {
      const result = parseFoundationNotation(trimmed);
      if (result.success) return result;
      break;
    }
  }

  // 如果当前类型匹配失败，尝试检测文本中是否有明确的构件类型标识
  if (componentType !== 'beam' && RE_BEAM_ID.test(trimmed)) {
    const result = parseBeamNotation(trimmed);
    if (result.success) return result;
  }
  if (componentType !== 'column' && RE_COLUMN_ID.test(trimmed)) {
    const result = parseColumnNotation(trimmed);
    if (result.success) return result;
  }
  if (componentType !== 'slab' && RE_SLAB_ID.test(trimmed)) {
    const result = parseSlabNotation(trimmed);
    if (result.success) return result;
  }
  if (componentType !== 'shearwall' && RE_WALL_ID.test(trimmed)) {
    const result = parseShearWallNotation(trimmed);
    if (result.success) return result;
  }
  if (componentType !== 'stair' && RE_STAIR_ID.test(trimmed)) {
    const result = parseStairNotation(trimmed);
    if (result.success) return result;
  }
  if (componentType !== 'foundation' && RE_FOUNDATION_ID.test(trimmed)) {
    const result = parseFoundationNotation(trimmed);
    if (result.success) return result;
  }

  return { success: false };
}
