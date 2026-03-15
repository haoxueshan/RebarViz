'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Send, Sparkles, Loader2, ArrowRight } from 'lucide-react';
import { detectComponentType } from '@/lib/component-detector';
import type { ComponentType } from '@/lib/types';

const EXAMPLE_PROMPTS = [
  { text: '300×600梁，4根25下部筋，2根20上部筋', type: 'beam' as ComponentType },
  { text: '500×500柱，角筋4根25，b边中部每侧2根22', type: 'column' as ComponentType },
  { text: '120厚板，底筋C10@150', type: 'slab' as ComponentType },
  { text: '200厚剪力墙，竖向C10@200', type: 'shearwall' as ComponentType },
  { text: '11步楼梯，踏步高150宽280', type: 'stair' as ComponentType },
];

const TYPE_COLORS: Record<ComponentType, string> = {
  beam: 'text-blue-400',
  column: 'text-violet-400',
  slab: 'text-emerald-400',
  shearwall: 'text-rose-400',
  joint: 'text-orange-400',
  stair: 'text-cyan-400',
  foundation: 'text-teal-400',
  pilecap: 'text-sky-400',
  raft: 'text-indigo-400',
};

export function GlobalAIInput() {
  const [input, setInput] = useState('');
  const [detecting, setDetecting] = useState(false);
  const [detectedLabel, setDetectedLabel] = useState<string | null>(null);
  const [detectedType, setDetectedType] = useState<ComponentType | null>(null);
  const [noMatch, setNoMatch] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const router = useRouter();

  // Real-time detection as user types
  useEffect(() => {
    const trimmed = input.trim();
    if (!trimmed) {
      setDetectedLabel(null);
      setDetectedType(null);
      setNoMatch(false);
      return;
    }

    const result = detectComponentType(trimmed);
    if (result.detected) {
      setDetectedLabel(result.label);
      setDetectedType(result.componentType);
      setNoMatch(false);
    } else {
      setDetectedLabel(null);
      setDetectedType(null);
      setNoMatch(trimmed.length > 3);
    }
  }, [input]);

  const handleSubmit = () => {
    const trimmed = input.trim();
    if (!trimmed) return;

    const result = detectComponentType(trimmed);
    if (result.detected) {
      setDetecting(true);
      // Navigate to target page with AI message as query param
      const encoded = encodeURIComponent(trimmed);
      router.push(`${result.route}?ai=${encoded}`);
    } else {
      setNoMatch(true);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleExample = (text: string) => {
    setInput(text);
    // Auto-detect and navigate
    const result = detectComponentType(text);
    if (result.detected) {
      setDetecting(true);
      const encoded = encodeURIComponent(text);
      router.push(`${result.route}?ai=${encoded}`);
    }
  };

  return (
    <div className="w-full max-w-3xl mx-auto">
      {/* Input area */}
      <div className="relative">
        <div className="relative bg-white/[0.06] border border-white/[0.12] rounded-2xl backdrop-blur-sm overflow-hidden transition-all focus-within:border-blue-400/40 focus-within:bg-white/[0.08] focus-within:shadow-[0_0_40px_rgba(59,130,246,0.1)]">
          <div className="flex items-center gap-2 px-5 pt-4 pb-1">
            <Sparkles className="w-5 h-5 text-blue-400 shrink-0" />
            <span className="text-sm text-gray-400 font-medium">AI 智能生成</span>
            {detectedLabel && detectedType && (
              <span className={`ml-auto text-xs font-medium px-2.5 py-0.5 rounded-full bg-white/5 border border-white/10 ${TYPE_COLORS[detectedType]}`}>
                识别为：{detectedLabel}
              </span>
            )}
          </div>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="描述你想要的构件配筋，如：300×600梁，4根25下部筋..."
            rows={2}
            className="w-full px-5 py-3 bg-transparent text-white text-base outline-none resize-none placeholder:text-gray-500 leading-relaxed"
          />
          <div className="flex items-center justify-between px-5 pb-4">
            <div className="flex items-center gap-2 text-xs text-gray-500">
              {noMatch && (
                <span className="text-amber-400">
                  未能识别构件类型，请尝试包含「梁」「柱」「板」「墙」「节点」「楼梯」等关键词
                </span>
              )}
              {!noMatch && !detectedLabel && input.trim().length === 0 && (
                <span>输入后按 Enter 发送，AI 自动识别构件类型并生成模型</span>
              )}
            </div>
            <button
              onClick={handleSubmit}
              disabled={!input.trim() || detecting || (!detectedLabel && noMatch)}
              className="flex items-center gap-2 px-5 py-2 bg-gradient-to-r from-blue-500 to-cyan-400 text-white text-sm font-semibold rounded-xl hover:shadow-lg hover:shadow-blue-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
            >
              {detecting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  跳转中
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  生成模型
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Example chips */}
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <span className="text-xs text-gray-500 mr-1 py-1.5">试试：</span>
        {EXAMPLE_PROMPTS.map((ex, i) => (
          <button
            key={i}
            onClick={() => handleExample(ex.text)}
            className="group flex items-center gap-1.5 px-3.5 py-1.5 bg-white/[0.04] border border-white/[0.08] rounded-xl text-xs text-gray-400 hover:text-white hover:bg-white/[0.08] hover:border-white/[0.15] transition-all cursor-pointer"
          >
            {ex.text}
            <ArrowRight className="w-3 h-3 opacity-0 -ml-1 group-hover:opacity-100 group-hover:ml-0 transition-all" />
          </button>
        ))}
      </div>
    </div>
  );
}
