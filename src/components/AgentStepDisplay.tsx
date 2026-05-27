'use client';

import { useState, memo } from 'react';
import {
  Wrench, Check, AlertCircle, ChevronDown, ChevronRight,
  Settings2, ShieldCheck, Calculator, LayoutGrid, Highlighter,
  Navigation, Layers, Eye, Star, RotateCcw, GitCompare, Loader2,
} from 'lucide-react';
import type { AgentStep } from '@/lib/ai-agent-engine';

// ─── Tool icon/label mapping ───

interface ToolMeta {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  color: string; // tailwind bg color class
}

const TOOL_META: Record<string, ToolMeta> = {
  modify_params:        { icon: Settings2,     label: '修改参数',   color: 'bg-blue-500' },
  run_compliance_check: { icon: ShieldCheck,   label: '规范校验',   color: 'bg-emerald-500' },
  run_calculation:      { icon: Calculator,    label: '触发计算',   color: 'bg-amber-500' },
  switch_view:          { icon: LayoutGrid,    label: '切换面板',   color: 'bg-indigo-500' },
  highlight_element:    { icon: Highlighter,   label: '高亮元素',   color: 'bg-pink-500' },
  navigate_component:   { icon: Navigation,    label: '跳转构件',   color: 'bg-cyan-500' },
  apply_preset:         { icon: Layers,        label: '应用预设',   color: 'bg-purple-500' },
  get_current_state:    { icon: Eye,           label: '获取状态',   color: 'bg-gray-500' },
  save_favorite:        { icon: Star,          label: '保存收藏',   color: 'bg-yellow-500' },
  reset_params:         { icon: RotateCcw,     label: '重置参数',   color: 'bg-orange-500' },
  compare_with_preset:  { icon: GitCompare,    label: '方案对比',   color: 'bg-teal-500' },
};

const DEFAULT_META: ToolMeta = { icon: Wrench, label: '工具调用', color: 'bg-violet-500' };

// ─── Pair tool_call + tool_result into groups ───

interface StepGroup {
  call: AgentStep;
  result?: AgentStep;
}

function groupSteps(steps: AgentStep[]): { groups: StepGroup[]; thinking: AgentStep | null } {
  const groups: StepGroup[] = [];
  let thinking: AgentStep | null = null;
  let pending: AgentStep | null = null;

  for (const step of steps) {
    if (step.type === 'thinking') {
      thinking = step;
    } else if (step.type === 'tool_call') {
      if (pending) groups.push({ call: pending });
      pending = step;
    } else if (step.type === 'tool_result') {
      if (pending) {
        groups.push({ call: pending, result: step });
        pending = null;
      }
    }
  }
  if (pending) groups.push({ call: pending });
  return { groups, thinking };
}

// ─── Format tool args for display ───

function formatArgs(args: Record<string, unknown>): string {
  return Object.entries(args)
    .map(([k, v]) => {
      const val = typeof v === 'object' ? JSON.stringify(v) : String(v);
      return `${k}: ${val.length > 50 ? val.slice(0, 47) + '...' : val}`;
    })
    .join(', ');
}

// ─── Single step group component ───

const StepGroupCard = memo(function StepGroupCard({ group, index }: { group: StepGroup; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const meta = TOOL_META[group.call.toolName || ''] || DEFAULT_META;
  const Icon = meta.icon;
  const hasArgs = group.call.toolArgs && Object.keys(group.call.toolArgs).length > 0;
  const succeeded = group.result?.result?.success;
  const resultMsg = group.result?.result?.message;

  return (
    <div
      className="group rounded-xl border border-gray-100/80 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.03)] overflow-hidden animate-[fadeSlideIn_0.25s_ease-out]"
      style={{ animationDelay: `${index * 60}ms`, animationFillMode: 'backwards' }}
    >
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-2 px-2.5 py-2 text-left hover:bg-gray-50/50 transition-colors cursor-pointer"
      >
        {/* Tool icon badge */}
        <span className={`flex items-center justify-center w-5.5 h-5.5 rounded-lg ${meta.color} text-white shrink-0 shadow-sm`}>
          <Icon className="w-3 h-3" />
        </span>

        {/* Tool label */}
        <span className="text-[11px] font-semibold text-gray-700 truncate">
          {meta.label}
        </span>

        {/* Result indicator */}
        {group.result && (
          <span className="ml-auto flex items-center gap-1 shrink-0">
            {succeeded ? (
              <span className="flex items-center gap-0.5 text-[10px] text-emerald-600 font-medium bg-emerald-50 px-1.5 py-0.5 rounded-full">
                <Check className="w-2.5 h-2.5" />
                成功
              </span>
            ) : (
              <span className="flex items-center gap-0.5 text-[10px] text-red-500 font-medium bg-red-50 px-1.5 py-0.5 rounded-full">
                <AlertCircle className="w-2.5 h-2.5" />
                失败
              </span>
            )}
          </span>
        )}

        {/* Spinner if no result yet */}
        {!group.result && (
          <span className="ml-auto animate-pulse-glow rounded-full">
            <Loader2 className="w-3.5 h-3.5 text-violet-400 animate-spin" />
          </span>
        )}

        {/* Expand chevron */}
        {(hasArgs || resultMsg) && (
          <span className={`transition-transform shrink-0 text-gray-300 ${expanded ? 'rotate-90' : ''}`}>
            <ChevronRight className="w-3 h-3" />
          </span>
        )}
      </button>

      {/* Expanded detail */}
      {expanded && (hasArgs || resultMsg) && (
        <div className="px-2.5 pb-2.5 pt-0 space-y-2 border-t border-gray-50">
          {/* Args */}
          {hasArgs && (
            <div className="mt-2">
              <div className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider mb-1">参数</div>
              <pre className="text-[10px] text-gray-600 bg-gray-50/80 rounded-lg px-2.5 py-1.5 overflow-x-auto whitespace-pre-wrap break-all font-mono leading-relaxed border border-gray-100/50">
                {formatArgs(group.call.toolArgs!)}
              </pre>
            </div>
          )}

          {/* Result message */}
          {resultMsg && (
            <div>
              <div className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider mb-1">结果</div>
              <p className={`text-[11px] leading-relaxed whitespace-pre-wrap ${succeeded ? 'text-emerald-700' : 'text-red-600'}`}>
                {resultMsg}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

// ─── Thinking indicator ───

function ThinkingIndicator({ message }: { message?: string }) {
  return (
    <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-violet-50/60 border border-violet-100/60">
      <div className="flex gap-1">
        <span className="typing-dot w-1.5 h-1.5 rounded-full bg-violet-400" />
        <span className="typing-dot w-1.5 h-1.5 rounded-full bg-violet-400" />
        <span className="typing-dot w-1.5 h-1.5 rounded-full bg-violet-400" />
      </div>
      <span className="text-[11px] text-violet-500 font-medium">
        {message || '正在思考...'}
      </span>
    </div>
  );
}

// ─── Main export ───

interface AgentStepDisplayProps {
  steps: AgentStep[];
  isStreaming?: boolean;
}

export const AgentStepDisplay = memo(function AgentStepDisplay({ steps, isStreaming }: AgentStepDisplayProps) {
  const { groups, thinking } = groupSteps(steps);

  // Show initial spinner immediately when streaming starts (before any steps arrive)
  const showInitialSpinner = isStreaming && steps.length === 0;

  if (groups.length === 0 && !thinking && !isStreaming) return null;

  return (
    <div className="mt-1.5 space-y-1.5">
      {/* Initial spinner — appears instantly before any step is emitted */}
      {showInitialSpinner && <ThinkingIndicator message="AI 正在启动..." />}

      {/* Step count header */}
      {groups.length > 0 && (
        <div className="flex items-center gap-2 px-1">
          <div className="flex items-center gap-1.5">
            <span className="w-4 h-4 rounded-md bg-violet-100 flex items-center justify-center">
              <Wrench className="w-2.5 h-2.5 text-violet-500" />
            </span>
            <span className="text-[10px] font-semibold text-violet-500 tracking-wide">
              Agent · {groups.length} 步
            </span>
          </div>
          <span className="flex-1 h-px bg-gradient-to-r from-violet-100 to-transparent" />
        </div>
      )}

      {/* Step groups */}
      {groups.map((group, i) => (
        <StepGroupCard key={i} group={group} index={i} />
      ))}

      {/* Thinking indicator — only while actively streaming */}
      {thinking && isStreaming && <ThinkingIndicator message={thinking.message} />}

      {/* Fallback spinner when last tool call has no result yet */}
      {isStreaming && !thinking && groups.length > 0 && !groups[groups.length - 1].result && (
        <ThinkingIndicator message="正在执行工具..." />
      )}
    </div>
  );
});
