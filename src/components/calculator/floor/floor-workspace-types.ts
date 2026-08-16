export type FloorWorkflowStage = "plan" | "bottom" | "top" | "bom";

export type FloorWorkflowStatus = "valid" | "warning" | "invalid" | "pending";

export type FloorInspectorTab =
  | "object"
  | "boundary"
  | "floor"
  | "role"
  | "defaults"
  | "slab"
  | "through"
  | "diagnostics";

export type FloorWorkspaceIssue = {
  id: string;
  code: string;
  severity: "error" | "warning";
  stage: "plan" | "bottom" | "top";
  title: string;
  detail?: string;
  objectId?: string;
  boundaryId?: string;
  domainId?: string;
  throughPathId?: string;
};

export type FloorWorkspaceRoleItem = {
  id: string;
  slabIds: string[];
  label: string;
  detail: string;
  status: "valid" | "warning" | "invalid";
};

export type FloorWorkspaceThroughItem = {
  id: string;
  name: string;
  detail: string;
  status: "valid" | "warning" | "invalid" | "disabled";
};
