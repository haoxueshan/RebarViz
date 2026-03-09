import type { RebarInfo, StirrupInfo } from './types';

export const GRADE_MAP: Record<string, string> = {
  A: 'HPB300 (一级)',
  B: 'HRB335 (二级)',
  C: 'HRB400 (三级)',
  D: 'RRB400 (四级)',
  E: 'HRBF400',
};

export function parseRebar(str: string): RebarInfo {
  // 支持 22G101 平法格式:
  // 基本: "2C25" → 2根C25
  // 带排数: "6C25(2)" → 6根C25分2排
  // 每排分配: "5C25(3/2)" → 5根C25第一排3根第二排2根
  const m = str.match(/(\d+)([A-Za-z])(\d+)/);
  if (!m) return { count: 2, grade: 'C', diameter: 20 };
  const count = parseInt(m[1]);
  const grade = m[2].toUpperCase();
  const diameter = parseInt(m[3]);

  // 解析括号: (排数) 或 (第一排/第二排)
  const afterBase = str.slice(str.indexOf(m[3]) + m[3].length);
  const rowMatch = afterBase.match(/\((\d+)(?:\/(\d+))?\)/);
  if (rowMatch) {
    if (rowMatch[2]) {
      // 格式: (3/2) — 显式每排根数
      const r1 = parseInt(rowMatch[1]);
      const r2 = parseInt(rowMatch[2]);
      return { count: r1 + r2, grade, diameter, rows: 2, perRow: [r1, r2] };
    } else {
      // 格式: (2) — 排数，自动分配
      const rows = parseInt(rowMatch[1]);
      if (rows >= 2) {
        const perRow: number[] = [];
        let remaining = count;
        for (let r = 0; r < rows; r++) {
          const n = Math.ceil(remaining / (rows - r));
          perRow.push(n);
          remaining -= n;
        }
        return { count, grade, diameter, rows, perRow };
      }
    }
  }
  return { count, grade, diameter };
}

// 板筋格式: "C10@150" => { grade:'C', diameter:10, spacing:150 }
export function parseSlabRebar(str: string): { grade: string; diameter: number; spacing: number } {
  const m = str.match(/([A-Za-z])(\d+)@(\d+)/);
  if (!m) return { grade: 'C', diameter: 10, spacing: 150 };
  return { grade: m[1].toUpperCase(), diameter: parseInt(m[2]), spacing: parseInt(m[3]) };
}

export function parseStirrup(str: string): StirrupInfo {
  const m = str.match(/([A-Za-z])(\d+)@(\d+)(?:\/(\d+))?\((\d+)\)/);
  if (!m) return { grade: 'A', diameter: 8, spacingDense: 100, spacingNormal: 200, legs: 2 };
  return {
    grade: m[1].toUpperCase(),
    diameter: parseInt(m[2]),
    spacingDense: parseInt(m[3]),
    spacingNormal: m[4] ? parseInt(m[4]) : parseInt(m[3]),
    legs: parseInt(m[5]),
  };
}

export function gradeLabel(grade: string): string {
  return GRADE_MAP[grade] || grade;
}

/**
 * 解析腰筋/抗扭筋标注
 * G4C12 → { prefix:'G', count:4, grade:'C', diameter:12 } (构造腰筋)
 * N2C16 → { prefix:'N', count:2, grade:'C', diameter:16 } (抗扭筋)
 */
export interface SideBarInfo {
  prefix: 'G' | 'N';
  count: number;
  grade: string;
  diameter: number;
}

export function parseSideBar(str: string): SideBarInfo | null {
  const m = str.match(/^([GN])(\d+)([A-Za-z])(\d+)$/);
  if (!m) return null;
  return {
    prefix: m[1] as 'G' | 'N',
    count: parseInt(m[2]),
    grade: m[3].toUpperCase(),
    diameter: parseInt(m[4]),
  };
}

/**
 * 解析拉筋标注
 * A6 → { grade:'A', diameter:6 }
 * C8 → { grade:'C', diameter:8 }
 */
export interface TieBarInfo {
  grade: string;
  diameter: number;
}

export function parseTieBar(str: string): TieBarInfo | null {
  const m = str.match(/^([A-Za-z])(\d+)$/);
  if (!m) return null;
  return { grade: m[1].toUpperCase(), diameter: parseInt(m[2]) };
}

/**
 * 22G101: 自动确定拉筋规格
 * b ≤ 350mm → A6 (HPB300 Φ6)
 * b > 350mm → 同箍筋规格
 */
export function autoTieBar(beamWidth: number, stirrupGrade: string, stirrupDia: number): TieBarInfo {
  if (beamWidth <= 350) return { grade: 'A', diameter: 6 };
  return { grade: stirrupGrade, diameter: stirrupDia };
}

export function tieBarToString(info: TieBarInfo): string {
  return `${info.grade}${info.diameter}`;
}

export const BEAM_PRESETS = {
  simple: {
    id: 'KL1(2)', b: 250, h: 500, top: '2C20', bottom: '3C22',
    stirrup: 'A8@150/150(2)', leftSupport: '', rightSupport: '',
    concreteGrade: 'C30' as const, seismicGrade: '三级' as const, cover: 25, spanLength: 4000, hc: 500,
    haunchType: 'none' as const, haunchLength: 0, haunchHeight: 0, haunchSide: 'both' as const,
  },
  standard: {
    id: 'KL1(3)', b: 300, h: 600, top: '2C25', bottom: '4C25',
    stirrup: 'A8@100/200(2)', leftSupport: '2C25', rightSupport: '4C25',
    concreteGrade: 'C30' as const, seismicGrade: '三级' as const, cover: 25, spanLength: 4000, hc: 500,
    haunchType: 'none' as const, haunchLength: 0, haunchHeight: 0, haunchSide: 'both' as const,
    sideBar: 'G4C12',
  },
  complex: {
    id: 'KL2(4)', b: 350, h: 700, top: '4C25', bottom: '6C28',
    stirrup: 'A10@100/200(4)', leftSupport: '4C25', rightSupport: '6C25',
    leftSupport2: '2C25', rightSupport2: '2C25',
    concreteGrade: 'C35' as const, seismicGrade: '二级' as const, cover: 25, spanLength: 6000, hc: 600,
    haunchType: 'none' as const, haunchLength: 0, haunchHeight: 0, haunchSide: 'both' as const,
    sideBar: 'N4C16',
  },
  haunchH: {
    id: 'KL3(2)', b: 300, h: 600, top: '2C25', bottom: '4C25',
    stirrup: 'A8@100/200(2)', leftSupport: '2C25', rightSupport: '4C25',
    concreteGrade: 'C30' as const, seismicGrade: '三级' as const, cover: 25, spanLength: 6000, hc: 500,
    haunchType: 'horizontal' as const, haunchLength: 800, haunchHeight: 300, haunchSide: 'both' as const,
  },
  haunchV: {
    id: 'KL4(2)', b: 300, h: 600, top: '2C25', bottom: '4C25',
    stirrup: 'A8@100/200(2)', leftSupport: '2C25', rightSupport: '4C25',
    concreteGrade: 'C30' as const, seismicGrade: '三级' as const, cover: 25, spanLength: 4000, hc: 500,
    haunchType: 'vertical' as const, haunchLength: 600, haunchHeight: 150, haunchSide: 'both' as const,
  },
  multiSpan: {
    id: 'KL5(3)', b: 300, h: 600, top: '2C25', bottom: '4C25',
    stirrup: 'A8@100/200(2)', leftSupport: '2C25', rightSupport: '4C25',
    concreteGrade: 'C30' as const, seismicGrade: '三级' as const, cover: 25, spanLength: 4000, hc: 500,
    haunchType: 'none' as const, haunchLength: 0, haunchHeight: 0, haunchSide: 'both' as const,
    sideBar: 'G4C12', spanCount: 3,
  },
} as const;

export const COLUMN_PRESETS = {
  simple:   {
    id: 'KZ1', b: 400, h: 400, main: '8C20', stirrup: 'A8@100/200(2)',
    concreteGrade: 'C30' as const, seismicGrade: '三级' as const, cover: 25, height: 3000,
  },
  standard: {
    id: 'KZ2', b: 500, h: 500, main: '12C25', stirrup: 'A10@100/200(4)',
    concreteGrade: 'C30' as const, seismicGrade: '三级' as const, cover: 25, height: 3000,
  },
} as const;

export const SLAB_PRESETS = {
  simple: {
    id: 'LB1', thickness: 120,
    bottomX: 'C10@150', bottomY: 'C10@200',
    topX: '', topY: '',
    distribution: 'A6@250',
    concreteGrade: 'C30' as const, cover: 15,
  },
  standard: {
    id: 'LB2', thickness: 150,
    bottomX: 'C12@150', bottomY: 'C10@200',
    topX: 'C10@200', topY: 'C10@200',
    distribution: 'A6@250',
    concreteGrade: 'C30' as const, cover: 15,
  },
  thick: {
    id: 'LB3', thickness: 200,
    bottomX: 'C14@150', bottomY: 'C12@150',
    topX: 'C12@200', topY: 'C10@200',
    distribution: 'A8@200',
    concreteGrade: 'C35' as const, cover: 20,
  },
} as const;

// 剪力墙分布筋格式: "C10@200" => { grade:'C', diameter:10, spacing:200 }
export function parseWallRebar(str: string): { grade: string; diameter: number; spacing: number } {
  return parseSlabRebar(str); // same format
}

export const SHEAR_WALL_PRESETS = {
  simple: {
    id: 'Q1', bw: 200, lw: 3000, hw: 3000,
    vertBar: 'C10@200', horizBar: 'C10@200',
    boundaryMain: '8C16', boundaryStirrup: 'A8@100',
    concreteGrade: 'C30' as const, seismicGrade: '三级' as const, cover: 20,
  },
  standard: {
    id: 'Q2', bw: 250, lw: 4500, hw: 3000,
    vertBar: 'C12@200', horizBar: 'C10@200',
    boundaryMain: '12C18', boundaryStirrup: 'A8@100',
    concreteGrade: 'C35' as const, seismicGrade: '二级' as const, cover: 20,
  },
} as const;

export const JOINT_PRESETS = {
  middleBent: {
    colB: 500, colH: 500, colMain: '12C25', colStirrup: 'A10@100/200(4)',
    beamB: 300, beamH: 600, beamTop: '4C25', beamBottom: '4C25', beamStirrup: 'A8@100/200(2)',
    jointType: 'middle' as const, anchorType: 'bent' as const,
    concreteGrade: 'C30' as const, seismicGrade: '三级' as const, cover: 25,
  },
  middleStraight: {
    colB: 600, colH: 600, colMain: '16C25', colStirrup: 'A10@100/200(4)',
    beamB: 300, beamH: 600, beamTop: '4C22', beamBottom: '4C22', beamStirrup: 'A8@100/200(2)',
    jointType: 'middle' as const, anchorType: 'straight' as const,
    concreteGrade: 'C30' as const, seismicGrade: '三级' as const, cover: 25,
  },
  side: {
    colB: 500, colH: 500, colMain: '12C25', colStirrup: 'A10@100/200(4)',
    beamB: 250, beamH: 500, beamTop: '3C25', beamBottom: '3C22', beamStirrup: 'A8@100/200(2)',
    jointType: 'side' as const, anchorType: 'bent' as const,
    concreteGrade: 'C30' as const, seismicGrade: '三级' as const, cover: 25,
  },
} as const;

export const STAIR_PRESETS = {
  standard: {
    id: 'AT-1', stairType: 'AT' as const,
    stepCount: 11, stepHeight: 150, stepWidth: 280,
    slabThickness: 120, flightWidth: 1200,
    topPlatformLen: 1500, botPlatformLen: 1500, platformThickness: 120,
    beamB: 250, beamH: 350,
    topBar: 'C8@200', bottomBar: 'C10@150', distBar: 'A6@250',
    concreteGrade: 'C30' as const, cover: 15,
  },
  wide: {
    id: 'AT-2', stairType: 'AT' as const,
    stepCount: 13, stepHeight: 160, stepWidth: 260,
    slabThickness: 140, flightWidth: 1500,
    topPlatformLen: 1800, botPlatformLen: 1800, platformThickness: 140,
    beamB: 250, beamH: 400,
    topBar: 'C10@200', bottomBar: 'C12@150', distBar: 'A8@250',
    concreteGrade: 'C30' as const, cover: 20,
  },
  compact: {
    id: 'AT-3', stairType: 'AT' as const,
    stepCount: 9, stepHeight: 167, stepWidth: 260,
    slabThickness: 100, flightWidth: 1100,
    topPlatformLen: 1200, botPlatformLen: 1200, platformThickness: 100,
    beamB: 200, beamH: 300,
    topBar: 'C8@250', bottomBar: 'C10@200', distBar: 'A6@300',
    concreteGrade: 'C25' as const, cover: 15,
  },
} as const;
