'use client';

import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
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
      {/* Full-screen dark backdrop — matches landing page bg */}
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#06060f] overflow-hidden">

        {/* Ambient glow blobs */}
        <div className="absolute top-1/4 left-1/3 w-[500px] h-[500px] bg-blue-600/10 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute bottom-1/4 right-1/3 w-[400px] h-[400px] bg-cyan-500/8 rounded-full blur-[100px] pointer-events-none" />

        {/* Card */}
        <div className={`relative w-full max-w-[360px] mx-4 rounded-2xl border border-white/[0.08] bg-white/[0.04] backdrop-blur-xl shadow-2xl overflow-hidden ${shake ? 'animate-shake' : ''}`}>

          {/* Top gradient bar */}
          <div className="h-[2px] w-full bg-gradient-to-r from-blue-500 via-cyan-400 to-blue-600" />

          {/* Header */}
          <div className="px-7 pt-7 pb-5 text-center border-b border-white/[0.06]">
            {/* Logo */}
            <div className="inline-flex items-center gap-2.5 mb-4">
              <div className="w-9 h-9 bg-gradient-to-br from-blue-500 to-cyan-400 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/30">
                <svg className="w-4.5 h-4.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
              </div>
              <span className="text-lg font-bold text-white tracking-tight">RebarViz</span>
            </div>
            <p className="text-xs text-white/40 tracking-widest uppercase">3D 平法可视化 · 试用版</p>
          </div>

          {/* QR + instructions */}
          <div className="flex flex-col items-center gap-3 px-7 pt-6 pb-4">
            <div className="rounded-xl overflow-hidden border border-white/10 shadow-lg">
              <Image
                src="/wechat-qr.jpg"
                alt="微信二维码"
                width={220}
                height={220}
                className="w-[220px] h-[220px] object-cover block"
              />
            </div>
            <div className="text-center space-y-0.5">
              <p className="text-sm text-white/70">
                扫码添加微信，备注&nbsp;
                <span className="font-semibold text-white">3D 平法加我</span>
              </p>
              <p className="text-xs text-white/35">获取试用码后在下方输入</p>
            </div>
          </div>

          {/* Input + button */}
          <div className="px-7 pb-7 space-y-3">
            <input
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
              className={`w-full rounded-xl px-4 py-3 text-center text-[16px] font-mono tracking-[0.22em] transition-all focus:outline-none
                ${wrong
                  ? 'bg-red-500/10 border border-red-500/50 text-red-400 focus:ring-1 focus:ring-red-500/40'
                  : 'bg-white/[0.06] border border-white/[0.12] text-white focus:ring-1 focus:ring-blue-500/60 focus:border-blue-500/50'
                }`}
            />
            {wrong && (
              <p className="text-[11px] text-red-400/80 text-center">试用码无效，请检查后重试</p>
            )}
            <button
              onClick={handleSubmit}
              className="w-full bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 active:scale-[0.98] text-white font-semibold rounded-xl py-3 text-sm transition-all cursor-pointer shadow-lg shadow-blue-500/20"
            >
              激活使用
            </button>
          </div>

        </div>
      </div>

      {/* Children rendered but invisible — keeps layout/SSR intact */}
      <div className="invisible pointer-events-none select-none" aria-hidden="true">
        {children}
      </div>
    </>
  );
}
