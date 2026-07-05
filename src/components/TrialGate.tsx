'use client';

import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import { ArrowRight, Box, CheckCircle2, KeyRound, MessageCircle, ScanLine, ShieldCheck } from 'lucide-react';
import { TRIAL_CODES, TRIAL_STORAGE_KEY } from '@/config/trial';

function formatCode(raw: string): string {
  const clean = raw.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 16);
  const parts: string[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    parts.push(clean.slice(i, i + 4));
  }
  return parts.join('-');
}

export function TrialGate({ children }: { children: React.ReactNode }) {
  const [storedCode, setStoredCode] = useState('');
  const [ready, setReady] = useState(false);
  const [code, setCode] = useState('');
  const [shake, setShake] = useState(false);
  const [wrong, setWrong] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const unlocked = ready && TRIAL_CODES.includes(storedCode);

  useEffect(() => {
    try {
      setStoredCode(window.localStorage.getItem(TRIAL_STORAGE_KEY) ?? '');
    } catch {
      setStoredCode('');
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    if (!ready || unlocked) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 150);
    return () => window.clearTimeout(timer);
  }, [ready, unlocked]);

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    setWrong(false);
    setCode(formatCode(e.target.value));
  };

  const handleSubmit = () => {
    if (TRIAL_CODES.includes(code)) {
      try {
        localStorage.setItem(TRIAL_STORAGE_KEY, code);
      } catch {
        // Ignore storage failures and still unlock for current session.
      }
      setStoredCode(code);
    } else {
      setWrong(true);
      setShake(true);
      setTimeout(() => setShake(false), 500);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSubmit();
  };

  if (unlocked) return <>{children}</>;

  return (
    <>
      <div className="fixed inset-0 z-[9999] min-h-[100dvh] overflow-y-auto bg-[#080b12] text-white">
        <div className="pointer-events-none fixed inset-0 bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:56px_56px]" />
        <div className="pointer-events-none fixed inset-0 bg-[linear-gradient(115deg,rgba(37,99,235,0.18),rgba(15,23,42,0.36)_38%,rgba(8,11,18,0.96)_72%)]" />

        <main className="relative mx-auto grid min-h-[100dvh] w-full max-w-6xl grid-cols-1 items-center gap-8 px-5 py-8 md:grid-cols-[minmax(0,1fr)_390px] md:px-8 lg:gap-14">
          <section className="max-w-2xl">
            <div className="mb-8 inline-flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-blue-300/20 bg-blue-500 text-white shadow-[0_16px_36px_rgba(37,99,235,0.28)]">
                <Box className="h-5 w-5" strokeWidth={2} />
              </div>
              <div>
                <p className="text-xl font-semibold tracking-tight">RebarViz</p>
                <p className="text-sm text-slate-400">钢筋平法识图 3D 可视化</p>
              </div>
            </div>

            <h1 className="max-w-xl text-4xl font-semibold leading-tight tracking-tight text-white md:text-5xl">
              输入试用码，进入配筋模型工作台
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-slate-300">
              用三维方式查看梁、柱、板和基础配筋，适合平法识图学习、构造复盘和方案演示。
            </p>

            <div className="mt-9 grid gap-4 sm:grid-cols-3">
              {[
                { icon: ScanLine, title: '扫码添加', body: '备注 3D 平法加我' },
                { icon: MessageCircle, title: '获取试用码', body: '人工确认后发送' },
                { icon: ShieldCheck, title: '本机保存', body: '试用码仅存浏览器' },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.title} className="rounded-xl border border-white/10 bg-white/[0.035] p-4">
                    <Icon className="mb-3 h-5 w-5 text-blue-300" strokeWidth={2} />
                    <p className="text-sm font-medium text-white">{item.title}</p>
                    <p className="mt-1 text-xs leading-5 text-slate-400">{item.body}</p>
                  </div>
                );
              })}
            </div>

            <div className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-400">
              <span className="inline-flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-blue-300" strokeWidth={2} />
                22G101 标注解析
              </span>
              <span className="inline-flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-blue-300" strokeWidth={2} />
                3D 交互查看
              </span>
              <span className="inline-flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-blue-300" strokeWidth={2} />
                截面配筋示意
              </span>
            </div>
          </section>

          <div className={`relative w-full rounded-2xl border border-white/12 bg-slate-950/70 p-5 shadow-[0_24px_80px_rgba(2,6,23,0.45)] backdrop-blur-xl ${shake ? 'animate-shake' : ''}`}>
            <div className="absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-blue-300/70 to-transparent" />

            <div className="flex items-center gap-3 border-b border-white/10 pb-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/15 text-blue-200">
                <KeyRound className="h-5 w-5" strokeWidth={2} />
              </div>
              <div>
                <h2 className="text-base font-semibold text-white">试用激活</h2>
                <p className="text-xs text-slate-400">扫码获取试用码后输入</p>
              </div>
            </div>

            <div className="mt-5 flex flex-col items-center">
              <div className="w-full max-w-[264px] overflow-hidden rounded-xl border border-slate-200 bg-white p-2 shadow-[0_18px_44px_rgba(15,23,42,0.28)]">
                <Image
                  src="/wechat-qr-clean.jpg"
                  alt="微信二维码"
                  width={861}
                  height={861}
                  priority
                  className="aspect-square h-auto w-full rounded-lg bg-white object-contain"
                />
              </div>
              <p className="mt-4 text-center text-sm leading-6 text-slate-300">
                扫码添加微信，备注 <span className="font-semibold text-white">3D 平法加我</span>
              </p>
            </div>

            <div className="mt-5 space-y-3">
              <label htmlFor="trial-code" className="block text-sm font-medium text-slate-200">
                试用码
              </label>
              <input
                id="trial-code"
                ref={inputRef}
                type="text"
                value={code}
                onChange={handleInput}
                onKeyDown={handleKeyDown}
                maxLength={19}
                spellCheck={false}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="characters"
                aria-invalid={wrong}
                aria-describedby={wrong ? 'trial-code-error' : 'trial-code-help'}
                placeholder="XXXX-XXXX-XXXX-XXXX"
                className={`w-full rounded-xl px-4 py-3 text-center font-mono text-[16px] tracking-[0.18em] transition focus:outline-none
                  ${wrong
                    ? 'border border-red-400 bg-red-950/35 text-red-100 placeholder:text-red-200/45 focus:ring-2 focus:ring-red-300/40'
                    : 'border border-white/12 bg-white/[0.055] text-white placeholder:text-slate-500 focus:border-blue-300/70 focus:ring-2 focus:ring-blue-300/30'
                  }`}
              />
              {wrong ? (
                <p id="trial-code-error" className="text-sm text-red-200">
                  试用码无效，请检查后重试。
                </p>
              ) : (
                <p id="trial-code-help" className="text-xs leading-5 text-slate-500">
                  输入后会自动格式化为 4 位一组。
                </p>
              )}
              <button
                onClick={handleSubmit}
                className="group inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-500 px-4 py-3 text-sm font-semibold text-white shadow-[0_16px_36px_rgba(37,99,235,0.28)] transition hover:bg-blue-400 active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-blue-200/70"
              >
                激活使用
                <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" strokeWidth={2} />
              </button>
            </div>
          </div>
        </main>
      </div>

      {/* Children rendered but invisible to keep layout and SSR intact. */}
      <div className="invisible pointer-events-none select-none" aria-hidden="true">
        {children}
      </div>
    </>
  );
}
