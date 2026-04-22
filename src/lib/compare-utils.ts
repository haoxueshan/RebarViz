import type { CompareMetric } from '@/components/MetricComparePanel';

export function compareValues(a: number, b: number): 'increase' | 'decrease' | 'same' {
  if (Math.abs(a - b) < 0.001) return 'same';
  return b > a ? 'increase' : 'decrease';
}

export function calcPercentChange(a: number, b: number): number | undefined {
  if (a === 0) return undefined;
  return ((b - a) / a) * 100;
}

export function metricFromNumber(label: string, a: number, b: number, unit?: string): CompareMetric | null {
  if (Math.abs(a - b) < 0.001) return null;
  return {
    label,
    valueA: a,
    valueB: b,
    change: compareValues(a, b),
    unit,
    percentChange: calcPercentChange(a, b),
  };
}

export function metricFromText(label: string, a: string, b: string): CompareMetric | null {
  if (a === b) return null;
  return {
    label,
    valueA: a,
    valueB: b,
    change: 'changed',
  };
}
