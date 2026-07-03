import type { RebarMeshInfo } from './types';

export interface RebarGroupData {
  groupLabel?: string;
  groupCount?: number;
  distributionRange?: string;
  instanceIndex?: number;
  relatedGroups?: string[];
}

export function isSameRebarSet(info: RebarMeshInfo, selected: RebarMeshInfo | null): boolean {
  if (info.setId && selected?.setId) return info.setId === selected.setId;
  return info.type === selected?.type;
}

export function isRelatedRebarSet(setId: string | undefined, selected: RebarMeshInfo | null): boolean {
  if (!setId || !selected?.relatedSetIds) return false;
  return selected.relatedSetIds.includes(setId);
}

export function formatDistributionRange(startMm: number, endMm: number, spacingMm?: number): string {
  const range = `${Math.round(startMm)}-${Math.round(endMm)}mm`;
  return spacingMm ? `${range} @${Math.round(spacingMm)}` : range;
}

export function rebarGroupDataFromInfo(info: RebarMeshInfo): RebarGroupData {
  return {
    groupLabel: info.groupLabel,
    groupCount: info.groupCount,
    distributionRange: info.distributionRange,
    instanceIndex: info.instanceIndex,
    relatedGroups: info.relatedSetIds,
  };
}
