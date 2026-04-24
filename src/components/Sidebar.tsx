'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Columns3, Box, LayoutGrid, GitMerge, ChevronLeft, ChevronRight, PanelLeftOpen, Settings, Wallpaper, Footprints, Landmark, Layers } from 'lucide-react';
import { useState, useRef, useCallback, useEffect } from 'react';
import { ContactAuthorButton } from './ContactAuthor';

const NAV = [
  { href: '/beam', label: '梁 KL', desc: '框架梁', icon: Columns3 },
  { href: '/column', label: '柱 KZ', desc: '框架柱', icon: Box },
  { href: '/shearwall', label: '墙 Q', desc: '剪力墙', icon: Wallpaper },
  { href: '/slab', label: '板 LB', desc: '楼板', icon: LayoutGrid },
  { href: '/joint', label: '节点', desc: '梁柱节点', icon: GitMerge },
  { href: '/stair', label: '楼梯 LT', desc: 'AT型楼梯', icon: Footprints },
  { href: '/foundation', label: '基础 DJ', desc: '独立基础', icon: Landmark },
  { href: '/stripfoundation', label: '条基 TJ', desc: '条形基础', icon: Landmark },
  { href: '/pilecap', label: '承台 CT', desc: '桩基承台', icon: Layers },
  { href: '/raft', label: '筏板 FB', desc: '筏板基础', icon: Landmark },
];

const SIDEBAR_DEFAULT_WIDTH = 208;
const SIDEBAR_MIN_WIDTH = 160;
const SIDEBAR_MAX_WIDTH = 400;
const COLLAPSE_THRESHOLD = 80;

type SidebarMode = 'expanded' | 'collapsed' | 'hidden';

const LS_WIDTH_KEY = 'sidebar-width';
const LS_MODE_KEY = 'sidebar-mode';

export function Sidebar() {
  const pathname = usePathname();
  const [mode, setMode] = useState<SidebarMode>('expanded');
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  const [hydrated, setHydrated] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

  const hidden = mode === 'hidden';
  const collapsed = mode === 'collapsed';

  useEffect(() => {
    try {
      const savedMode = localStorage.getItem(LS_MODE_KEY) as SidebarMode | null;
      const savedWidth = parseInt(localStorage.getItem(LS_WIDTH_KEY) ?? '', 10);
      if (savedMode === 'expanded' || savedMode === 'collapsed' || savedMode === 'hidden') {
        setMode(savedMode);
      }
      if (!isNaN(savedWidth)) {
        setSidebarWidth(Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, savedWidth)));
      }
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(LS_MODE_KEY, mode);
  }, [hydrated, mode]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(LS_WIDTH_KEY, String(sidebarWidth));
  }, [hydrated, sidebarWidth]);

  /** Cycle: expanded → collapsed → hidden → expanded */
  const handleToggle = () => {
    setMode(prev => {
      if (prev === 'expanded') return 'collapsed';
      if (prev === 'collapsed') return 'hidden';
      return 'expanded';
    });
  };

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragStartX.current = e.clientX;
    dragStartWidth.current = sidebarWidth;
    setIsDragging(true);
  }, [sidebarWidth]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - dragStartX.current;
      const newWidth = dragStartWidth.current + delta;
      if (newWidth < COLLAPSE_THRESHOLD) {
        setMode('collapsed');
      } else {
        setMode('expanded');
        setSidebarWidth(Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, newWidth)));
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  const asideStyle = !hidden && !collapsed ? { width: sidebarWidth } : undefined;

  return (
    <>
      {/* Floating show button when sidebar is hidden */}
      {hidden && (
        <button
          onClick={() => setMode('expanded')}
          className="hidden md:flex fixed left-0 top-1/2 -translate-y-1/2 z-40 items-center justify-center w-6 h-12 bg-white border border-l-0 border-gray-200 rounded-r-lg shadow-sm text-gray-400 hover:text-accent hover:bg-gray-50 cursor-pointer transition-colors"
          aria-label="显示侧边栏"
        >
          <PanelLeftOpen className="w-3.5 h-3.5" />
        </button>
      )}

      <aside
        style={asideStyle}
        className={`hidden md:flex flex-col shrink-0 border-r border-gray-200 bg-gray-50 overflow-hidden relative ${
          isDragging ? '' : 'transition-all duration-200'
        } ${hidden ? 'w-0 border-r-0' : collapsed ? 'w-16' : ''}`}
      >
        <nav className="flex-1 py-3 px-2 space-y-1">
          {NAV.map(({ href, label, desc, icon: Icon }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                title={collapsed ? label : undefined}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  active
                    ? 'bg-accent/10 text-accent border border-accent/20'
                    : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'
                }`}
              >
                <Icon className="w-5 h-5 shrink-0" />
                {!collapsed && (
                  <div className="min-w-0">
                    <div className="truncate">{label}</div>
                    <div
                      className={`text-[11px] truncate ${
                        active ? 'text-accent/70' : 'text-gray-400'
                      }`}
                    >
                      {desc}
                    </div>
                  </div>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Settings link at bottom */}
        <div className="px-2 pb-1">
          <Link
            href="/settings"
            title={collapsed ? '设置' : undefined}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer whitespace-nowrap ${
              pathname === '/settings'
                ? 'bg-accent/10 text-accent border border-accent/20'
                : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'
            }`}
          >
            <Settings className="w-5 h-5 shrink-0" />
            {!collapsed && (
              <div className="min-w-0">
                <div className="truncate">设置</div>
                <div
                  className={`text-[11px] truncate ${
                    pathname === '/settings' ? 'text-accent/70' : 'text-gray-400'
                  }`}
                >
                  API 配置
                </div>
              </div>
            )}
          </Link>
        </div>

        {/* Contact Author */}
        <div className="px-2 pb-1">
          <ContactAuthorButton collapsed={collapsed} />
        </div>

        <button
          onClick={handleToggle}
          className="flex items-center justify-center py-3 border-t border-gray-200 text-gray-400 hover:text-gray-600 cursor-pointer transition-colors"
          aria-label={collapsed ? '隐藏侧边栏' : '收起侧边栏'}
        >
          {collapsed ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4 rotate-180" />}
        </button>

        {/* Drag handle */}
        {!collapsed && !hidden && (
          <div
            onMouseDown={handleDragStart}
            className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize group hover:bg-accent/30 transition-colors ${isDragging ? 'bg-accent/40' : ''}`}
          >
            <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-8 rounded-full bg-gray-300 group-hover:bg-accent/60 transition-colors opacity-0 group-hover:opacity-100" />
          </div>
        )}
      </aside>
    </>
  );
}

export function MobileBottomNav() {
  const pathname = usePathname();

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-md border-t border-gray-200 flex">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium transition-colors cursor-pointer ${
              active ? 'text-accent' : 'text-gray-400'
            }`}
          >
            <Icon className={`w-5 h-5 ${active ? 'text-accent' : ''}`} />
            {label}
          </Link>
        );
      })}
      <Link
        href="/settings"
        className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium transition-colors cursor-pointer ${
          pathname === '/settings' ? 'text-accent' : 'text-gray-400'
        }`}
      >
        <Settings className={`w-5 h-5 ${pathname === '/settings' ? 'text-accent' : ''}`} />
        设置
      </Link>
    </nav>
  );
}
