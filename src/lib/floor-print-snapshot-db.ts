import type { FloorPrintSnapshot } from "./floor-print";
import {
  FLOOR_PRINT_LAST_ID_KEY,
  FLOOR_PRINT_SNAPSHOT_KEY_PREFIX,
  clearLegacyFloorPrintSnapshots,
  loadFloorPrintSnapshot,
  parseFloorPrintSnapshot,
  saveFloorPrintSnapshot,
} from "./floor-print-storage";

/**
 * Floor Print Snapshot 主存储：IndexedDB。
 * 打印快照是较大的结构化冻结结果，不再默认写入 sessionStorage（避免 quota exceeded）。
 * sessionStorage 仅保留旧版本兼容读取与 IndexedDB 不可用时的单快照 fallback。
 */
const FLOOR_PRINT_DB_NAME = "rebarviz-floor-print";
const FLOOR_PRINT_DB_VERSION = 1;
const FLOOR_PRINT_DB_STORE = "snapshots";

/** IndexedDB 最多保留的打印快照数（保留最近 N 个）。 */
export const FLOOR_PRINT_SNAPSHOT_RETENTION = 3;

/** QuotaExceeded 统一中文业务错误。 */
export const FLOOR_PRINT_QUOTA_ERROR_MESSAGE =
  "打印数据较大，浏览器临时存储空间不足。请关闭其他 RebarViz 标签页后重试，或在支持 IndexedDB 的浏览器中打开。";

export class FloorPrintStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FloorPrintStorageError";
  }
}

export function isStorageQuotaError(error: unknown): boolean {
  if (!(error instanceof DOMException)) return false;
  return error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED";
}

function isBrowserRuntime(): boolean {
  return typeof window !== "undefined" && typeof indexedDB !== "undefined";
}

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isSnapshotRecord(value: unknown): value is { id: string; createdAt: string } {
  return isObjectLike(value) && typeof value.id === "string" && typeof value.createdAt === "string";
}

function rejectOnRequestFailure<T>(request: IDBRequest<T>, reject: (reason: unknown) => void): void {
  request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
}

function requestAsPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    rejectOnRequestFailure(request, reject);
  });
}

function transactionAsPromise(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

/** 打开打印快照数据库（仅 Browser Runtime 调用，SSR 安全）。 */
export function openFloorPrintDatabase(): Promise<IDBDatabase> {
  if (!isBrowserRuntime()) return Promise.reject(new Error("IndexedDB unavailable"));
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(FLOOR_PRINT_DB_NAME, FLOOR_PRINT_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(FLOOR_PRINT_DB_STORE)) {
        db.createObjectStore(FLOOR_PRINT_DB_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
    request.onblocked = () => reject(new Error("IndexedDB open blocked"));
  });
}

/** IndexedDB 保存快照（结构化克隆直接存对象，成功后按 createdAt 保留最近 N 个）。 */
export async function saveFloorPrintSnapshotAsync(snapshot: FloorPrintSnapshot): Promise<void> {
  const db = await openFloorPrintDatabase();
  try {
    const transaction = db.transaction(FLOOR_PRINT_DB_STORE, "readwrite");
    transaction.objectStore(FLOOR_PRINT_DB_STORE).put(snapshot);
    await transactionAsPromise(transaction);
  } finally {
    db.close();
  }
  // 清理不影响本次保存结果；失败仅意味着保留数量可能超过上限。
  try {
    await pruneFloorPrintSnapshotsAsync([snapshot.id]);
  } catch {
    // 忽略清理失败。
  }
}

/** IndexedDB 读取快照；读出后仍经过 parseFloorPrintSnapshot 严格校验。 */
export async function loadFloorPrintSnapshotAsync(id: string): Promise<FloorPrintSnapshot | null> {
  if (!id) return null;
  const db = await openFloorPrintDatabase();
  try {
    const request = db.transaction(FLOOR_PRINT_DB_STORE, "readonly").objectStore(FLOOR_PRINT_DB_STORE).get(id);
    const value = await requestAsPromise(request);
    return parseFloorPrintSnapshot(value);
  } finally {
    db.close();
  }
}

/** IndexedDB 删除快照。 */
export async function removeFloorPrintSnapshotAsync(id: string): Promise<void> {
  if (!id) return;
  const db = await openFloorPrintDatabase();
  try {
    const transaction = db.transaction(FLOOR_PRINT_DB_STORE, "readwrite");
    transaction.objectStore(FLOOR_PRINT_DB_STORE).delete(id);
    await transactionAsPromise(transaction);
  } finally {
    db.close();
  }
}

/** 列出 IndexedDB 中所有快照记录（测试/诊断用）。 */
export async function listFloorPrintSnapshotsAsync(): Promise<Array<{ id: string; createdAt: string }>> {
  const db = await openFloorPrintDatabase();
  try {
    const request = db.transaction(FLOOR_PRINT_DB_STORE, "readonly").objectStore(FLOOR_PRINT_DB_STORE).getAll();
    const values = await requestAsPromise(request);
    return values.filter(isSnapshotRecord).map((record) => ({ id: record.id, createdAt: record.createdAt }));
  } finally {
    db.close();
  }
}

/**
 * 按 createdAt 保留最近 FLOOR_PRINT_SNAPSHOT_RETENTION 个快照。
 * keepIds 中的快照（如刚生成的当前快照）绝不删除。
 */
export async function pruneFloorPrintSnapshotsAsync(keepIds: readonly string[] = []): Promise<void> {
  const db = await openFloorPrintDatabase();
  try {
    const store = db.transaction(FLOOR_PRINT_DB_STORE, "readwrite").objectStore(FLOOR_PRINT_DB_STORE);
    const request = store.getAll();
    const values = await requestAsPromise(request);
    const keep = new Set(keepIds);
    const deletable = values
      .filter(isSnapshotRecord)
      .filter((record) => !keep.has(record.id))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const extraCount = Math.max(0, FLOOR_PRINT_SNAPSHOT_RETENTION - keep.size);
    for (const record of deletable.slice(extraCount)) {
      store.delete(record.id);
    }
    await transactionAsPromise(store.transaction);
  } finally {
    db.close();
  }
}

/**
 * 打印快照持久化统一入口：
 * 1. IndexedDB 保存成功 → 结束（不再写 sessionStorage）。
 * 2. IndexedDB 不可用/失败 → sessionStorage fallback：先清旧打印快照，只保留当前一个。
 * 3. fallback 仍失败且为 QuotaExceeded → 抛中文业务错误；其他错误原样抛出。
 */
export async function persistFloorPrintSnapshot(snapshot: FloorPrintSnapshot): Promise<void> {
  try {
    await saveFloorPrintSnapshotAsync(snapshot);
    return;
  } catch {
    // IndexedDB 不可用（隐私模式/存储失败）→ sessionStorage fallback。
  }
  try {
    clearLegacyFloorPrintSnapshots(window.sessionStorage);
    saveFloorPrintSnapshot(window.sessionStorage, snapshot);
  } catch (error) {
    if (isStorageQuotaError(error)) {
      throw new FloorPrintStorageError(FLOOR_PRINT_QUOTA_ERROR_MESSAGE);
    }
    throw error;
  }
}

/**
 * 打印快照统一读取：优先 IndexedDB；不存在时尝试旧 sessionStorage（Legacy 兼容）。
 */
export async function loadFloorPrintSnapshotAnywhere(id: string): Promise<FloorPrintSnapshot | null> {
  if (!id) return null;
  try {
    const fromIndexedDb = await loadFloorPrintSnapshotAsync(id);
    if (fromIndexedDb) return fromIndexedDb;
  } catch {
    // IndexedDB 不可用 → 尝试 Legacy sessionStorage。
  }
  return loadFloorPrintSnapshot(window.sessionStorage, id);
}

/** 保留旧常量引用：Legacy 打印快照 Key 前缀与 last-id 由 floor-print-storage 管理。 */
export { FLOOR_PRINT_LAST_ID_KEY, FLOOR_PRINT_SNAPSHOT_KEY_PREFIX };
