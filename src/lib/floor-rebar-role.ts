export type FloorBarRole = "main" | "secondary";

export type FloorRebarDomainBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export const FLOOR_REBAR_GEOMETRY_EPSILON_MM = 1e-7;

export function isSquareFloorRebarDomain(
  domain: FloorRebarDomainBounds,
): boolean {
  const spanX = domain.maxX - domain.minX;
  const spanY = domain.maxY - domain.minY;
  return Math.abs(spanX - spanY) <= FLOOR_REBAR_GEOMETRY_EPSILON_MM;
}

/**
 * 主副筋只由Opening裁断前的连续楼板Domain净跨决定：短跨方向为主筋，
 * 长跨方向为副筋。正方形Domain确定性地使用X主、Y副。
 */
export function resolveFloorBarRole(
  domain: FloorRebarDomainBounds,
  direction: "x" | "y",
): FloorBarRole {
  const spanX = domain.maxX - domain.minX;
  const spanY = domain.maxY - domain.minY;
  if (Math.abs(spanX - spanY) <= FLOOR_REBAR_GEOMETRY_EPSILON_MM) {
    return direction === "x" ? "main" : "secondary";
  }
  if (spanX < spanY) {
    return direction === "x" ? "main" : "secondary";
  }
  return direction === "y" ? "main" : "secondary";
}

export function floorBarRoleLabel(role: FloorBarRole): string {
  return role === "main" ? "主筋" : "副筋";
}
