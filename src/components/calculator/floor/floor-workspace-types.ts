export type FloorWorkflowStage = "plan" | "bottom" | "top" | "bom";

export type FloorWorkflowStatus = "valid" | "warning" | "invalid" | "pending";

export type FloorInspectorTab =
  | "object"
  | "boundary"
  | "floor"
  | "role"
  | "defaults"
  | "slab"
  | "through";

export type FloorWorkspaceRoleItem = {
  id: string;
  slabIds: string[];
  label: string;
  detail: string;
  status: "valid" | "invalid";
};

export type FloorWorkspaceThroughItem = {
  id: string;
  name: string;
  detail: string;
  status: "valid" | "invalid" | "disabled";
};
