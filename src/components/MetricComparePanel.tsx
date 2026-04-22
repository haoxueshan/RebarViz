'use client';

import { ArrowDownRight, ArrowRight, ArrowUpRight, Minus, Scale } from 'lucide-react';

export interface CompareMetric {
  label: string;
  valueA: string | number;
  valueB: string | number;
  change: 'increase' | 'decrease' | 'same' | 'changed';
  unit?: string;
  percentChange?: number;
}

export interface CompareSummary {
  title: string;
  valueA: number;
  valueB: number;
  unit: string;
  labelA?: string;
  labelB?: string;
}

export function MetricComparePanel({
  metrics,
  summary,
  labelA = '方案A',
  labelB = '方案B',
}: {
  metrics: CompareMetric[];
  summary: CompareSummary;
  labelA?: string;
  labelB?: string;
}) {
  const diff = summary.valueB - summary.valueA;
  const percent = summary.valueA !== 0 ? (diff / summary.valueA) * 100 : 0;

  if (metrics.length === 0) {
    return (
      <div className="py-8 text-center text-gray-400">
        <Scale className="mx-auto mb-3 h-10 w-10 opacity-50" />
        <p className="text-sm">两个方案完全相同</p>
        <p className="mt-1 text-xs">修改参数后会自动显示差异</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className={`rounded-xl border p-4 ${
        diff > 0 ? 'border-red-200 bg-red-50' :
        diff < 0 ? 'border-emerald-200 bg-emerald-50' :
        'border-gray-200 bg-gray-50'
      }`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${
              diff > 0 ? 'bg-red-100' :
              diff < 0 ? 'bg-emerald-100' :
              'bg-gray-100'
            }`}>
              {diff > 0 ? <ArrowUpRight className="h-5 w-5 text-red-600" /> :
               diff < 0 ? <ArrowDownRight className="h-5 w-5 text-emerald-600" /> :
               <Minus className="h-5 w-5 text-gray-500" />}
            </div>
            <div>
              <p className="text-sm font-medium text-gray-700">{summary.title}</p>
              <p className={`text-lg font-bold ${
                diff > 0 ? 'text-red-600' :
                diff < 0 ? 'text-emerald-600' :
                'text-gray-600'
              }`}>
                {diff > 0 ? '+' : ''}{diff.toFixed(1)} {summary.unit}
                <span className="ml-1 text-sm font-normal">
                  ({percent > 0 ? '+' : ''}{percent.toFixed(1)}%)
                </span>
              </p>
            </div>
          </div>
          <div className="text-right text-xs text-gray-500">
            <p>{summary.labelA || labelA}: {summary.valueA.toFixed(1)}{summary.unit}</p>
            <p>{summary.labelB || labelB}: {summary.valueB.toFixed(1)}{summary.unit}</p>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="text-xs font-medium uppercase tracking-wide text-gray-500">差异详情 ({metrics.length} 项)</h4>
        {metrics.map((metric, idx) => (
          <div key={idx} className="flex items-center gap-3 rounded-lg bg-gray-50 p-3 transition-colors hover:bg-gray-100">
            <div className="min-w-0 flex-1">
              <p className="mb-1 text-xs text-gray-500">{metric.label}</p>
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-gray-700">
                  {metric.valueA}{metric.unit && <span className="ml-0.5 text-gray-400">{metric.unit}</span>}
                </span>
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                <span className={`truncate text-sm font-medium ${
                  metric.change === 'increase' ? 'text-red-600' :
                  metric.change === 'decrease' ? 'text-emerald-600' :
                  'text-amber-600'
                }`}>
                  {metric.valueB}{metric.unit && <span className="ml-0.5 opacity-70">{metric.unit}</span>}
                </span>
              </div>
            </div>
            {metric.percentChange !== undefined && (
              <span className={`rounded-full px-2 py-1 text-xs font-medium ${
                metric.change === 'increase' ? 'bg-red-100 text-red-700' :
                metric.change === 'decrease' ? 'bg-emerald-100 text-emerald-700' :
                'bg-amber-100 text-amber-700'
              }`}>
                {metric.percentChange > 0 ? '+' : ''}{metric.percentChange.toFixed(1)}%
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
