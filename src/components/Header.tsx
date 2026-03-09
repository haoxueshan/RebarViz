'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Box, Columns3, LayoutGrid, GitMerge, Menu, X, Wallpaper, Footprints } from 'lucide-react';

const NAV = [
  { href: '/beam', label: '梁 KL', icon: Columns3 },
  { href: '/column', label: '柱 KZ', icon: Box },
  { href: '/shearwall', label: '墙 Q', icon: Wallpaper },
  { href: '/slab', label: '板 LB', icon: LayoutGrid },
  { href: '/joint', label: '节点', icon: GitMerge },
  { href: '/stair', label: '楼梯 LT', icon: Footprints },
];

export function Header() {
  const pathname = usePathname();
  const isLanding = pathname === '/';
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className={`sticky top-0 z-50 backdrop-blur-md border-b transition-colors ${
      isLanding
        ? 'bg-[#0a0f1a]/80 border-white/5'
        : 'bg-white/80 border-gray-200'
    }`}>
      <div className="max-w-[1600px] mx-auto px-4 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5 group" onClick={() => setMobileOpen(false)}>
          <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-gradient-to-br from-blue-500 to-cyan-400">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          </div>
          <div className="leading-tight">
            <span className={`text-base font-bold ${isLanding ? 'text-white' : 'text-gray-800'}`}>RebarViz</span>
            <span className={`hidden sm:block text-[11px] ${isLanding ? 'text-gray-400' : 'text-muted'}`}>钢筋平法识图 · 22G101</span>
          </div>
        </Link>

        <nav className="hidden sm:flex items-center gap-1">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                  isLanding
                    ? active ? 'text-white bg-white/10' : 'text-gray-400 hover:bg-white/5 hover:text-white'
                    : active ? 'text-accent bg-accent/10' : 'text-muted hover:bg-gray-100 hover:text-primary'
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </Link>
            );
          })}
        </nav>

        {isLanding && (
          <button
            className="sm:hidden p-2 rounded-lg cursor-pointer transition-colors text-gray-400 hover:bg-white/10"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label={mobileOpen ? '关闭菜单' : '打开菜单'}
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        )}
      </div>

      {/* Mobile dropdown (landing only) */}
      {mobileOpen && isLanding && (
        <nav className="sm:hidden border-t px-4 py-2 space-y-1 border-white/5 bg-[#0a0f1a]/95 backdrop-blur-md">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setMobileOpen(false)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                  active ? 'text-white bg-white/10' : 'text-gray-400 hover:bg-white/5 hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </Link>
            );
          })}
        </nav>
      )}
    </header>
  );
}

/** Fixed bottom tab bar visible on mobile app pages */
export function MobileBottomNav() {
  const pathname = usePathname();
  const isLanding = pathname === '/';
  if (isLanding) return null;

  return (
    <nav className="sm:hidden fixed bottom-0 inset-x-0 z-50 bg-white/95 backdrop-blur-md border-t border-gray-200 flex items-stretch safe-bottom">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors ${
              active ? 'text-accent' : 'text-gray-400'
            }`}
          >
            <Icon className="w-5 h-5" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
