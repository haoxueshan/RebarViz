'use client';

import { useState, useMemo, useCallback } from 'react';
import { Box, ChevronDown, Copy, Check } from 'lucide-react';
import type { ConcreteCalcResult } from '@/lib/calc-concrete';
import type { FormulaStep } from '@/lib/calc';

function FormulaBlock({ steps }: { steps: FormulaStep[] }) {
  return (
    <div className="mt-2 mb-1 ml-4 pl-3 border-l-2 border-amber-200 space-y-1.5">
      {steps.map((s, i) => (
        <div key={i} className="text-[11px] leading-relaxed">
          <span className="text-amber-600 font-medium">{s.label}</span>
          <div className="text-gray-500 font-mono ml-2">
            <span className="text-gray-400">{s.formula}</span>
            <br />
            <span className="text-gray-600">{s.substitution}</span>
            <br />
            <span className="text-gray-800 font-semibold">{s.result}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export function ConcreteCalc({ result }: { result: ConcreteCalcResult }) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const maxVol = useMemo(() => Math.max(...result.items.map(it => it.volume), 0.0001), [result.items]);
  const toggleExpand = useCallback((i: number) => setExpandedIdx(prev => prev === i ? null : i), []);

  const handleCopy = useCallback(async () => {
    const lines = [
      '混凝土工程量计算',
      '─'.repeat(30),
      ...result.items.map(it => `${it.name}: ${it.volume.toFixed(4)} m³ (${it.description})`),
      '─'.repeat(30),
      `合计: ${result.totalVolume.toFixed(4)} m³`,
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  }, [result]);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center">
            <Box className="w-4 h-4 text-amber-600" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-gray-800">混凝土工程量</h2>
            <p className="text-[11px] text-gray-400">按清单规范，不扣除钢筋体积</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={handleCopy}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium cursor-pointer text-gray-600 bg-gray-50 hover:bg-gray-100 transition-colors">
            {copied ? <Check className="w-3 h-3 text-green-600" /> : <Copy className="w-3 h-3" />}
            {copied ? '已复制' : '复制'}
          </button>
        </div>
      </div>

      {/* Total hero card */}
      <div className="mb-4 p-4 rounded-xl bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-100/50">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs text-amber-600/70 font-medium mb-0.5">混凝土总量</p>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-bold text-amber-700">{result.totalVolume.toFixed(4)}</span>
              <span className="text-sm text-amber-500 font-medium">m³</span>
            </div>
          </div>
          <div className="text-right">
            <div className="flex items-center gap-3">
              <div>
                <p className="text-[10px] text-amber-500/70">分项数</p>
                <p className="text-sm font-semibold text-amber-700">{result.items.length}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Detail list */}
      <div className="space-y-1">
        {result.items.map((item, i) => {
          const pct = result.totalVolume > 0 ? (item.volume / result.totalVolume) * 100 : 0;
          const isExpanded = expandedIdx === i;
          const hasFormula = item.formulaSteps.length > 0;
          return (
            <div key={i}
              className={`group rounded-lg px-3 py-2.5 transition-colors ${
                isExpanded ? 'bg-amber-50/60' : 'hover:bg-gray-50/80'
              } ${hasFormula ? 'cursor-pointer' : ''}`}
              onClick={hasFormula ? () => toggleExpand(i) : undefined}
            >
              {/* Top: name + volume */}
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ background: item.color }} />
                  <span className="text-[13px] font-medium text-gray-800">{item.name}</span>
                  {hasFormula && (
                    <ChevronDown className={`w-3 h-3 text-gray-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                  )}
                </div>
                <div className="flex items-baseline gap-1 shrink-0">
                  <span className="text-[13px] font-semibold text-gray-800">{item.volume.toFixed(4)}</span>
                  <span className="text-[10px] text-gray-400">m³</span>
                  <span className="text-[10px] text-gray-300 ml-1">({pct.toFixed(1)}%)</span>
                </div>
              </div>
              {/* Bottom: description + bar */}
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{ width: `${(item.volume / maxVol) * 100}%`, background: item.color, opacity: 0.7 }}
                  />
                </div>
                <span className="text-[10px] text-gray-400 shrink-0 max-w-[200px] text-right truncate">{item.description}</span>
              </div>
              {/* Formula breakdown */}
              {isExpanded && hasFormula && (
                <FormulaBlock steps={item.formulaSteps} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
