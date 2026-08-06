export function numberValueToDraft(value: number): string {
  return Number.isFinite(value) ? String(value) : "";
}

export function parseNumberDraft(draft: string): number | null {
  if (draft.trim() === "") return null;
  const parsed = Number(draft);
  return Number.isFinite(parsed) ? parsed : null;
}

export function displayNumberDraft(
  draft: string | null,
  value: number,
): string {
  return draft === null ? numberValueToDraft(value) : draft;
}

export function hasInvalidNumberDrafts(drafts: readonly string[]): boolean {
  return drafts.some((draft) => parseNumberDraft(draft) === null);
}
