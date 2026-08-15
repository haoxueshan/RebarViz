export type FloorHistoryState<T> = {
  past: T[];
  present: T;
  future: T[];
};

export const FLOOR_HISTORY_LIMIT = 100;

export function createFloorHistory<T>(present: T): FloorHistoryState<T> {
  return { past: [], present, future: [] };
}

/** 提交一次新状态：present 入 past，清空 future，超过上限丢弃最旧。 */
export function pushFloorHistory<T>(
  history: FloorHistoryState<T>,
  next: T,
): FloorHistoryState<T> {
  if (next === history.present) return history;
  const past = [...history.past, history.present];
  if (past.length > FLOOR_HISTORY_LIMIT) past.splice(0, past.length - FLOOR_HISTORY_LIMIT);
  return { past, present: next, future: [] };
}

export function undoFloorHistory<T>(
  history: FloorHistoryState<T>,
): { history: FloorHistoryState<T>; value: T } {
  if (history.past.length === 0) return { history, value: history.present };
  const previous = history.past.at(-1)!;
  return {
    history: {
      past: history.past.slice(0, -1),
      present: previous,
      future: [history.present, ...history.future],
    },
    value: previous,
  };
}

export function redoFloorHistory<T>(
  history: FloorHistoryState<T>,
): { history: FloorHistoryState<T>; value: T } {
  if (history.future.length === 0) return { history, value: history.present };
  const next = history.future[0];
  return {
    history: {
      past: [...history.past, history.present],
      present: next,
      future: history.future.slice(1),
    },
    value: next,
  };
}
