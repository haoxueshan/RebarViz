'use client';

import { useState, useEffect, useRef } from 'react';
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
  const [unlocked, setUnlocked] = useState(true);
  const [code, setCode] = useState('');
  const [shake, setShake] = useState(false);
  const [wrong, setWrong] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem(TRIAL_STORAGE_KEY);
    if (saved && TRIAL_CODES.includes(saved)) {
      setUnlocked(true);
    } else {
      setUnlocked(false);
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, []);

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    setWrong(false);
    setCode(formatCode(e.target.value));
  };

  const handleSubmit = () => {
    if (TRIAL_CODES.includes(code)) {
      localStorage.setItem(TRIAL_STORAGE_KEY, code);
      setUnlocked(true);
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
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-md">
        <div className={`bg-white rounded-2xl shadow-2xl w-full max-w-[340px] mx-4 overflow-hidden transition-transform ${shake ? 'animate-shake' : ''}`}>

          {/* Header */}
          <div className="bg-gradient-to-br from-green-500 to-emerald-600 px-6 py-5 text-center">
            <div className="text-2xl mb-1">📐</div>
            <h1 className="text-base font-bold text-white">3D 平法可视化</h1>
            <p className="text-xs text-green-100 mt-0.5">试用版 · 扫码获取试用码</p>
          </div>

          {/* WeChat QR */}
          <div className="flex flex-col items-center gap-2 pt-5 px-6">
            <div className="w-44 h-44 rounded-xl overflow-hidden border border-gray-200 bg-gray-50 flex items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/wechat-qr.svg"
                alt="微信二维码"
                width={176}
                height={176}
                className="object-contain w-full h-full"
              />
            </div>
            <p className="text-sm text-gray-600 text-center leading-relaxed">
              扫码添加微信，备注&nbsp;
              <span className="font-semibold text-gray-900">3D 平法加我</span>
              <br />
              <span className="text-xs text-gray-400">获取试用码后在下方输入</span>
            </p>
          </div>

          {/* Input + Button */}
          <div className="px-6 pb-6 pt-3 space-y-2.5">
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
              className={`w-full border rounded-xl px-4 py-3 text-center text-[17px] font-mono tracking-[0.2em] focus:outline-none focus:ring-2 transition-all
                ${wrong
                  ? 'border-red-300 bg-red-50 ring-red-200 text-red-600'
                  : 'border-gray-200 focus:ring-green-300 focus:border-green-400 text-gray-800'
                }`}
            />
            {wrong && (
              <p className="text-xs text-red-500 text-center -mt-1">试用码无效，请检查后重试</p>
            )}
            <button
              onClick={handleSubmit}
              className="w-full bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 active:scale-[0.98] text-white font-semibold rounded-xl py-3 text-sm transition-all cursor-pointer shadow-md shadow-green-500/25"
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
