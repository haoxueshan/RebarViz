'use client';

import { useState, useCallback } from 'react';
import type {
  BeamParams,
  ColumnParams,
  SlabParams,
  JointParams,
  ShearWallParams,
  StairParams,
  FoundationParams,
  StripFoundationParams,
  PileCapParams,
  RaftFoundationParams,
  ComponentType,
} from './types';

type AnyParams =
  | BeamParams
  | ColumnParams
  | SlabParams
  | JointParams
  | ShearWallParams
  | StairParams
  | FoundationParams
  | StripFoundationParams
  | PileCapParams
  | RaftFoundationParams;

interface HistoryItem<T = AnyParams> {
  id: string;
  type: ComponentType;
  params: T;
  name: string;        // 显示名称（编号或自动生成）
  timestamp: number;
}

interface FavoriteItem<T = AnyParams> extends HistoryItem<T> {
  note?: string;       // 用户备注
}

const MAX_HISTORY = 10;
const STORAGE_KEYS = {
  history: 'rebarviz_history',
  favorites: 'rebarviz_favorites',
};

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function getStorageKey(type: ComponentType, key: 'history' | 'favorites'): string {
  return `${STORAGE_KEYS[key]}_${type}`;
}

function parseStoredItems<T>(raw: string | null): T[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function getParamsName(type: ComponentType, params: AnyParams, fallbackName?: string): string {
  if (fallbackName) return fallbackName;
  if ('id' in params && typeof params.id === 'string' && params.id.trim()) {
    return params.id;
  }
  return `${type}-${Date.now()}`;
}

/**
 * 历史记录和收藏 Hook
 */
export function useHistory<T extends AnyParams>(type: ComponentType) {
  const [history, setHistory] = useState<HistoryItem<T>[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const historyKey = getStorageKey(type, 'history');
      const savedHistory = localStorage.getItem(historyKey);
      return parseStoredItems<HistoryItem<T>>(savedHistory);
    } catch (e) {
      console.warn('Failed to load history from localStorage:', e);
      return [];
    }
  });
  const [favorites, setFavorites] = useState<FavoriteItem<T>[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const favKey = getStorageKey(type, 'favorites');
      const savedFavorites = localStorage.getItem(favKey);
      return parseStoredItems<FavoriteItem<T>>(savedFavorites);
    } catch (e) {
      console.warn('Failed to load favorites from localStorage:', e);
      return [];
    }
  });
  const isLoaded = true;

  // 保存到 localStorage
  const saveToStorage = useCallback((items: HistoryItem<T>[], key: 'history' | 'favorites') => {
    try {
      const storageKey = getStorageKey(type, key);
      localStorage.setItem(storageKey, JSON.stringify(items));
    } catch (e) {
      console.warn('Failed to save to localStorage:', e);
    }
  }, [type]);

  // 添加历史记录
  const addToHistory = useCallback((params: T, name?: string) => {
    setHistory(prev => {
      // 检查是否已存在相同参数
      const exists = prev.find(item => 
        JSON.stringify(item.params) === JSON.stringify(params)
      );
      if (exists) {
        // 移到最前面
        const updated = [exists, ...prev.filter(i => i.id !== exists.id)];
        saveToStorage(updated, 'history');
        return updated;
      }
      
      const item: HistoryItem<T> = {
        id: generateId(),
        type,
        params,
        name: getParamsName(type, params, name),
        timestamp: Date.now(),
      };
      
      const updated = [item, ...prev].slice(0, MAX_HISTORY);
      saveToStorage(updated, 'history');
      return updated;
    });
  }, [type, saveToStorage]);

  // 添加收藏
  const addToFavorites = useCallback((params: T, name?: string, note?: string) => {
    setFavorites(prev => {
      // 检查是否已收藏
      const exists = prev.find(item => 
        JSON.stringify(item.params) === JSON.stringify(params)
      );
      if (exists) return prev;
      
      const item: FavoriteItem<T> = {
        id: generateId(),
        type,
        params,
        name: getParamsName(type, params, name),
        timestamp: Date.now(),
        note,
      };
      
      const updated = [item, ...prev];
      saveToStorage(updated, 'favorites');
      return updated;
    });
  }, [type, saveToStorage]);

  // 从收藏移除
  const removeFromFavorites = useCallback((id: string) => {
    setFavorites(prev => {
      const updated = prev.filter(item => item.id !== id);
      saveToStorage(updated, 'favorites');
      return updated;
    });
  }, [saveToStorage]);

  // 从历史移除
  const removeFromHistory = useCallback((id: string) => {
    setHistory(prev => {
      const updated = prev.filter(item => item.id !== id);
      saveToStorage(updated, 'history');
      return updated;
    });
  }, [saveToStorage]);

  // 清空历史
  const clearHistory = useCallback(() => {
    setHistory([]);
    saveToStorage([], 'history');
  }, [saveToStorage]);

  // 检查是否已收藏
  const isFavorite = useCallback((params: T) => {
    return favorites.some(item => 
      JSON.stringify(item.params) === JSON.stringify(params)
    );
  }, [favorites]);

  // 更新收藏备注
  const updateFavoriteNote = useCallback((id: string, note: string) => {
    setFavorites(prev => {
      const updated = prev.map(item => 
        item.id === id ? { ...item, note } : item
      );
      saveToStorage(updated, 'favorites');
      return updated;
    });
  }, [saveToStorage]);

  return {
    history,
    favorites,
    isLoaded,
    addToHistory,
    addToFavorites,
    removeFromFavorites,
    removeFromHistory,
    clearHistory,
    isFavorite,
    updateFavoriteNote,
  };
}
