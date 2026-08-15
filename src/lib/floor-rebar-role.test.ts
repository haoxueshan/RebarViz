import { describe, expect, it } from "vitest";
import { buildFloorBottomRebarDomains } from "./floor-bottom-calculator";
import type { FloorOpening, FloorPlanState, FloorSlab, FloorSupportRule } from "./floor-plan";
import {
  buildFloorRebarRoleDomains,
  floorRoleDomainKey,
  resolveFloorBarRole,
  resolveFloorRebarRoleContext,
  resolveFloorRoleDomainMainDirection,
  resolveRoleDomainForPhysicalDomain,
  type FloorRebarRoleState,
} from "./floor-rebar-role";

function slab(id: string, x: number, y: number, width: number, height: number): FloorSlab {
  return { id, name: id, type: "room", x, y, width, height };
}

function opening(id: string, x: number, y: number, width: number, height: number): FloorOpening {
  return { id, name: id, type: "stair", x, y, width, height };
}

function plan(slabs: FloorSlab[], openings: FloorOpening[] = [], supportRules: FloorSupportRule[] = []): FloorPlanState {
  return { coordinateModel: "net-layout-v1", slabs, openings, supportRules, innerWallThickness: 240, outerWallThickness: 370, snapDistanceMm: 150, overlapToleranceMm: 10 };
}

const emptyRoleState: FloorRebarRoleState = { mainDirectionOverrides: {} };

describe("Floor Rebar Role Domain", () => {
  it("贯穿Opening只拆Physical Domain，不拆Role Domain", () => {
    const state = plan(
      [slab("a", 0, 0, 6000, 4000)],
      [opening("o", 2500, 0, 1000, 4000)],
    );
    const physical = buildFloorBottomRebarDomains(state);
    const role = buildFloorRebarRoleDomains(state);
    expect(physical).toHaveLength(2);
    expect(role).toHaveLength(1);
    expect(role[0]).toMatchObject({ id: "role:a", minX: 0, maxX: 6000, minY: 0, maxY: 4000, areaMm2: 24_000_000, shape: "rectangle" });
    const context = resolveFloorRebarRoleContext(state, physical, emptyRoleState);
    expect(context.errors).toEqual([]);
    expect([...context.mainDirectionByPhysicalDomain.values()]).toEqual(["y", "y"]);
  });

  it.each([
    [4000, 4000, "square", null, "required"],
    [4000, 4000.5, "square", null, "required"],
    [4000, 4002, "rectangle", "x", "auto"],
  ] as const)("%s×%s的业务容差解析为%s", (width, height, shape, mainDirection, source) => {
    const domain = buildFloorRebarRoleDomains(plan([slab("a", 0, 0, width, height)]))[0];
    expect(domain.shape).toBe(shape);
    expect(resolveFloorRoleDomainMainDirection(domain, emptyRoleState)).toMatchObject({ mainDirection, source });
  });

  it("非正方形矩形始终自动判断，不接受遗留人工覆盖改变方向", () => {
    const domain = buildFloorRebarRoleDomains(plan([slab("a", 0, 0, 4000, 6000)]))[0];
    expect(resolveFloorRoleDomainMainDirection(domain, {
      mainDirectionOverrides: { [domain.id]: "y" },
    })).toMatchObject({ mainDirection: "x", source: "auto" });
  });

  it("L/T型continuous Role Domain不按外包框猜测，人工方向作用于整个参考域", () => {
    const rules: FloorSupportRule[] = [{
      id: "continuous",
      target: { kind: "slab-edge", slabId: "a", side: "north", range: { mode: "whole" } },
      support: "continuous",
    }];
    const lPlan = plan([slab("a", 0, 0, 6000, 3000), slab("b", 0, 3000, 3000, 3000)], [], rules);
    const lDomain = buildFloorRebarRoleDomains(lPlan)[0];
    expect(lDomain.shape).toBe("irregular");
    expect(resolveFloorRoleDomainMainDirection(lDomain, emptyRoleState).mainDirection).toBeNull();
    const manual = { mainDirectionOverrides: { [floorRoleDomainKey(["a", "b"])]: "y" as const } };
    expect(resolveFloorRoleDomainMainDirection(lDomain, manual)).toMatchObject({ mainDirection: "y", source: "manual" });
    expect(resolveFloorBarRole("y", "x")).toBe("secondary");
    expect(resolveFloorBarRole("y", "y")).toBe("main");

    const tPlan = plan([slab("a", 0, 0, 6000, 3000), slab("b", 2000, 3000, 2000, 3000)], [], rules);
    expect(buildFloorRebarRoleDomains(tPlan)[0].shape).toBe("irregular");
  });

  it("Physical Domain无法唯一映射时返回显式错误而不是选择第一个", () => {
    const roleDomains = buildFloorRebarRoleDomains(plan([slab("a", 0, 0, 4000, 6000)]));
    expect(resolveRoleDomainForPhysicalDomain({
      id: "physical:missing",
      slabIds: ["missing"],
      cellIds: [],
      minX: 0,
      minY: 0,
      maxX: 1,
      maxY: 1,
    }, roleDomains)).toEqual({ errorCode: "role-domain-mapping-invalid" });
  });
});
