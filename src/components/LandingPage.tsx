'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowRight, Columns3, Box, LayoutGrid, GitMerge, Wallpaper, Landmark,
  RotateCcw, MousePointerClick, Scissors, BookOpen, Sparkles, Layers,
  ChevronDown, Zap, Eye, Brain, Camera, Footprints, ShieldCheck,
} from 'lucide-react';
import { GlobalAIInput } from '@/components/GlobalAIInput';

/* ─── Full-screen animated mesh background ─── */
function MeshBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    const dpr = window.devicePixelRatio || 1;
    let mouseX = 0.5, mouseY = 0.5;

    const handleMouse = (e: MouseEvent) => {
      mouseX = e.clientX / window.innerWidth;
      mouseY = e.clientY / window.innerHeight;
    };
    window.addEventListener('mousemove', handleMouse);

    const resize = () => {
      canvas.width = canvas.offsetWidth * dpr;
      canvas.height = canvas.offsetHeight * dpr;
      ctx.scale(dpr, dpr);
    };
    resize();
    window.addEventListener('resize', resize);

    interface Node { x: number; y: number; baseX: number; baseY: number; vx: number; vy: number; }
    const cols = 18, rows = 10;
    const nodes: Node[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = (c / (cols - 1)) * canvas.offsetWidth;
        const y = (r / (rows - 1)) * canvas.offsetHeight;
        nodes.push({ x, y, baseX: x, baseY: y, vx: (Math.random() - 0.5) * 0.15, vy: (Math.random() - 0.5) * 0.15 });
      }
    }

    let time = 0;
    const draw = () => {
      const w = canvas.offsetWidth, h = canvas.offsetHeight;
      ctx.clearRect(0, 0, w, h);
      time += 0.003;

      // Update nodes with gentle wave + mouse repulsion
      for (const n of nodes) {
        const wave = Math.sin(time + n.baseX * 0.003) * 8 + Math.cos(time * 0.7 + n.baseY * 0.004) * 6;
        n.x = n.baseX + wave + n.vx * Math.sin(time * 2);
        n.y = n.baseY + Math.cos(time + n.baseX * 0.002) * 6 + n.vy * Math.cos(time * 2);

        // Mouse influence
        const dx = n.x / w - mouseX;
        const dy = n.y / h - mouseY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 0.15) {
          const force = (0.15 - dist) * 60;
          n.x += (dx / dist) * force;
          n.y += (dy / dist) * force;
        }
      }

      // Draw connections
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c;
          const n = nodes[i];
          // Right neighbor
          if (c < cols - 1) {
            const right = nodes[i + 1];
            ctx.beginPath();
            ctx.moveTo(n.x, n.y);
            ctx.lineTo(right.x, right.y);
            ctx.strokeStyle = 'rgba(59,130,246,0.06)';
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
          // Bottom neighbor
          if (r < rows - 1) {
            const bottom = nodes[i + cols];
            ctx.beginPath();
            ctx.moveTo(n.x, n.y);
            ctx.lineTo(bottom.x, bottom.y);
            ctx.strokeStyle = 'rgba(59,130,246,0.06)';
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }

      // Draw nodes
      for (const n of nodes) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, 1.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(59,130,246,0.12)';
        ctx.fill();
      }

      animId = requestAnimationFrame(draw);
    };
    draw();

    return () => { cancelAnimationFrame(animId); window.removeEventListener('resize', resize); window.removeEventListener('mousemove', handleMouse); };
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />;
}

/* ─── Animated counter ─── */
function AnimatedNumber({ target, suffix = '' }: { target: number; suffix?: string }) {
  const [value, setValue] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          const duration = 1500;
          const startTime = performance.now();
          const animate = (now: number) => {
            const elapsed = now - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            setValue(Math.floor(eased * target));
            if (progress < 1) requestAnimationFrame(animate);
          };
          requestAnimationFrame(animate);
          observer.disconnect();
        }
      },
      { threshold: 0.5 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [target]);

  return <span ref={ref}>{value}{suffix}</span>;
}

/* ─── Scroll-reveal wrapper ─── */
function Reveal({ children, className = '', delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); observer.disconnect(); } },
      { threshold: 0.15 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'} ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

/* ─── Data ─── */
const FEATURES = [
  { icon: RotateCcw, title: '3D 交互查看', desc: '旋转、缩放、平移，从任意角度观察配筋构造', color: 'from-blue-500 to-cyan-400', bg: 'bg-blue-50' },
  { icon: MousePointerClick, title: '点击识别', desc: '点击任意钢筋，即时显示该钢筋的详细信息', color: 'from-sky-500 to-blue-400', bg: 'bg-sky-50' },
  { icon: Scissors, title: '剖切视图', desc: '沿构件任意位置剖切，查看截面配筋详情', color: 'from-orange-500 to-amber-400', bg: 'bg-orange-50' },
  { icon: BookOpen, title: '标注自动解读', desc: '输入平法标注，自动解析钢筋等级、直径、间距', color: 'from-emerald-500 to-green-400', bg: 'bg-emerald-50' },
  { icon: Sparkles, title: 'AI 平法助手', desc: '接入 DeepSeek / Qwen / Kimi，随时提问构造问题', color: 'from-cyan-500 to-blue-400', bg: 'bg-cyan-50' },
  { icon: Layers, title: '截面配筋图', desc: '同步生成 2D 截面示意，对照理解更直观', color: 'from-slate-500 to-blue-400', bg: 'bg-slate-50' },
  { icon: Camera, title: '图纸扫描建模', desc: '上传施工图，AI 自动识别平法标注并生成 3D 配筋模型', color: 'from-blue-500 to-orange-400', bg: 'bg-blue-50' },
];

const COMPONENTS = [
  {
    href: '/beam', icon: Columns3, title: '梁', code: 'KL',
    desc: '集中标注与原位标注，支座负筋、箍筋加密区、22G101端锚构造',
    tags: ['集中标注', '原位标注', '支座负筋', '箍筋加密区', '直锚/弯锚'],
    gradient: 'from-blue-600 to-cyan-500', light: 'bg-blue-50 border-blue-100',
  },
  {
    href: '/column', icon: Box, title: '柱', code: 'KZ',
    desc: '纵筋分布、箍筋加密区、搭接区域可视化',
    tags: ['纵向钢筋', '箍筋加密区', '角筋', '搭接区域'],
    gradient: 'from-violet-600 to-purple-500', light: 'bg-violet-50 border-violet-100',
  },
  {
    href: '/shearwall', icon: Wallpaper, title: '剪力墙', code: 'Q',
    desc: '竖向/水平分布筋、约束边缘构件、YBZ/GBZ构造',
    tags: ['竖向分布筋', '水平分布筋', '约束边缘构件', 'YBZ'],
    gradient: 'from-rose-600 to-pink-500', light: 'bg-rose-50 border-rose-100',
  },
  {
    href: '/slab', icon: LayoutGrid, title: '板', code: 'LB',
    desc: '底筋、面筋、分布筋双向配筋可视化',
    tags: ['X/Y向底筋', '面筋', '分布筋', '板厚'],
    gradient: 'from-emerald-600 to-green-500', light: 'bg-emerald-50 border-emerald-100',
  },
  {
    href: '/joint', icon: GitMerge, title: '节点', code: 'Joint',
    desc: '节点核心区构造详图，梁筋锚固、节点区箍筋加密',
    tags: ['弯锚', '直锚', '节点区箍筋', '中间/边节点'],
    gradient: 'from-orange-600 to-amber-500', light: 'bg-orange-50 border-orange-100',
  },
  {
    href: '/foundation', icon: Landmark, title: '基础', code: 'DJ',
    desc: '独立基础底部双向配筋、柱插筋、阶形/锥形构造',
    tags: ['X/Y向底筋', '柱插筋', '阶形基础', '锥形基础'],
    gradient: 'from-teal-600 to-cyan-500', light: 'bg-teal-50 border-teal-100',
  },
  {
    href: '/stripfoundation', icon: Landmark, title: '条基', code: 'TJ',
    desc: '条形基础底板 B/T 配筋、分布筋、单梁/双梁或单墙/双墙条基构造',
    tags: ['B/T配筋', '分布筋', '双梁条基', '双墙条基'],
    gradient: 'from-cyan-700 to-sky-500', light: 'bg-cyan-50 border-cyan-100',
  },
  {
    href: '/pilecap', icon: Layers, title: '承台', code: 'CT',
    desc: '桩基承台双向配筋、柱插筋、3D桩位排布可视化',
    tags: ['桩基排布', 'X/Y向底筋', '柱插筋', '桩径/桩距'],
    gradient: 'from-sky-600 to-blue-500', light: 'bg-sky-50 border-sky-100',
  },
  {
    href: '/raft', icon: Landmark, title: '筏板', code: 'FB',
    desc: '筏板基础双向配筋、柱网插筋、面筋/底筋 3D 可视化',
    tags: ['X/Y向底筋', 'X/Y向面筋', '柱网插筋', '板厚'],
    gradient: 'from-indigo-600 to-violet-500', light: 'bg-indigo-50 border-indigo-100',
  },
];

const STATS = [
  { value: 10, suffix: '种', label: '构件类型' },
  { value: 22, suffix: 'G101', label: '图集标准' },
  { value: 3, suffix: '个', label: 'AI 模型接入' },
  { value: 100, suffix: '%', label: '免费开源' },
];

const HERO_CAPABILITIES = [
  { icon: BookOpen, title: '基于图集', desc: '22G101-1 / 2 / 3' },
  { icon: ShieldCheck, title: '构造详录', desc: '锚固、加密区、搭接等' },
  { icon: RotateCcw, title: '3D 交互', desc: '旋转、缩放、剖切查看' },
  { icon: MousePointerClick, title: '点击识别', desc: '钢筋信息一目了然' },
  { icon: Brain, title: 'AI 助手', desc: '三大模型随时答疑' },
];

const HERO_COMPONENTS = [
  { href: '/beam', icon: Columns3, title: '梁 KL', desc: '框架梁、连梁等', image: '/landing-beam.webp' },
  { href: '/column', icon: Box, title: '柱 KZ', desc: '框架柱、构造柱等', image: '/landing-column.webp' },
  { href: '/shearwall', icon: Wallpaper, title: '墙 Q', desc: '剪力墙、挡土墙等', image: '/landing-wall.webp' },
  { href: '/slab', icon: LayoutGrid, title: '板 LB', desc: '楼板、基础底板等', image: '/landing-slab.webp' },
  { href: '/joint', icon: GitMerge, title: '节点', desc: '梁柱节点、节点区', image: '/landing-joint.webp' },
  { href: '/stair', icon: Footprints, title: '楼梯 LT', desc: '板式楼梯、梯梁等', image: '/landing-stair.webp' },
];

/* ─── Main Landing Page ─── */
export function LandingPage() {
  return (
    <main className="w-full bg-[#0a0f1a] text-white overflow-hidden">

      {/* ═══════ HERO — immersive model first ═══════ */}
      <section className="relative overflow-hidden lg:min-h-[720px] xl:min-h-[760px]">
        <MeshBackground />

        <Image
          src="/landing-rebar-hero.webp"
          alt="梁柱节点钢筋 3D 可视化模型"
          fill
          priority
          sizes="100vw"
          className="object-cover object-[64%_50%] opacity-80"
        />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,#08111f_0%,rgba(8,17,31,0.92)_30%,rgba(8,17,31,0.38)_62%,rgba(8,17,31,0.76)_100%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(10,15,26,0.08)_0%,rgba(10,15,26,0.05)_58%,#0a0f1a_100%)]" />

        <div className="pointer-events-none absolute right-[8%] top-[15%] hidden text-sm text-slate-200/85 lg:block">
          <div className="border-l border-t border-white/30 pl-4 pt-2">上部通长筋<br /><span className="font-mono text-cyan-200">4Φ25</span></div>
        </div>
        <div className="pointer-events-none absolute right-[16%] top-[45%] hidden text-sm text-slate-200/85 lg:block">
          <div className="border-l border-t border-white/25 pl-4 pt-2">箍筋加密区<br /><span className="font-mono text-cyan-200">@100/200</span></div>
        </div>

        <div className="pointer-events-none absolute right-8 top-[48%] z-20 hidden -translate-y-1/2 overflow-hidden rounded-2xl border border-white/15 bg-slate-950/45 backdrop-blur-xl xl:block">
          {[
            { icon: Box, label: '默认视角' },
            { icon: Scissors, label: '剖切' },
            { icon: MousePointerClick, label: '选中钢筋' },
            { icon: Eye, label: '测量标注' },
          ].map(({ icon: Icon, label }) => (
            <div key={label} className="flex w-[72px] flex-col items-center gap-1 border-b border-white/10 px-3 py-3 text-center text-[11px] text-slate-300 last:border-b-0">
              <Icon className="h-5 w-5 text-slate-100" strokeWidth={1.8} />
              {label}
            </div>
          ))}
        </div>

        <div className="relative z-10 flex min-h-[720px] w-full flex-col justify-end px-5 pb-0 pt-12 sm:px-8 lg:px-12 lg:pt-16 xl:min-h-[760px]">
          <div className="grid flex-1 items-center gap-10 lg:grid-cols-[minmax(0,680px)_1fr]">
            <div className="max-w-3xl">
              <Reveal>
                <div className="mb-6 inline-flex items-center gap-2.5 rounded-full border border-white/12 bg-slate-950/45 px-4 py-2 text-sm text-slate-200 backdrop-blur-md">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_18px_rgba(52,211,153,0.7)]" />
                  基于 22G101 图集
                </div>
              </Reveal>

              <Reveal delay={100}>
                <h1 className="max-w-3xl text-5xl font-black leading-[0.98] tracking-tight sm:text-6xl lg:text-7xl xl:text-[86px]">
                  <span className="block text-white drop-shadow-[0_10px_30px_rgba(0,0,0,0.45)]">钢筋平法识图</span>
                  <span className="mt-2 block bg-gradient-to-r from-blue-400 via-cyan-300 to-sky-500 bg-clip-text text-transparent">3D 可视化学习</span>
                </h1>
              </Reveal>

              <Reveal delay={200}>
                <p className="mt-6 max-w-xl text-base leading-8 text-slate-300 sm:text-lg">
                  输入平法标注，即时生成三维配筋模型。旋转查看构造细节，AI 助手随时答疑。
                </p>
              </Reveal>

              <Reveal delay={280}>
                <div className="mt-7 max-w-[820px] [&>div]:mx-0">
                  <GlobalAIInput />
                </div>
              </Reveal>

              <Reveal delay={360}>
                <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                  <Link
                    href="/beam"
                    className="group inline-flex items-center justify-center gap-2 rounded-xl bg-blue-500 px-8 py-4 text-base font-bold text-white shadow-[0_20px_55px_rgba(37,99,235,0.28)] transition-all hover:bg-cyan-400 active:scale-[0.98]"
                  >
                    开始学习
                    <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
                  </Link>
                  <a
                    href="#features"
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-slate-950/30 px-8 py-4 text-base font-semibold text-slate-200 backdrop-blur-md transition-all hover:border-white/25 hover:bg-white/[0.08]"
                  >
                    了解更多
                    <ChevronDown className="h-5 w-5" />
                  </a>
                </div>
              </Reveal>
            </div>

            <div className="hidden min-h-[460px] lg:block" />
          </div>

          <Reveal delay={420}>
            <div className="mt-7 grid border-y border-white/10 bg-slate-950/60 backdrop-blur-md md:grid-cols-5">
              {HERO_CAPABILITIES.map(({ icon: Icon, title, desc }) => (
                <div key={title} className="flex items-center gap-4 border-white/10 px-5 py-5 md:border-r last:md:border-r-0">
                  <Icon className="h-7 w-7 shrink-0 text-cyan-300" strokeWidth={1.8} />
                  <div>
                    <p className="text-sm font-semibold text-white">{title}</p>
                    <p className="mt-0.5 text-xs leading-5 text-slate-400">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      <section className="relative border-b border-white/[0.06] bg-[#07111d] py-8">
        <div className="w-full px-5 sm:px-8 lg:px-12">
          <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-2xl font-bold text-white sm:text-3xl">选择构件，开始学习</h2>
              <p className="mt-2 text-sm text-slate-400">覆盖常见结构构件，配筋要点一目了然</p>
            </div>
            <Link href="#features" className="inline-flex items-center gap-2 text-sm font-semibold text-slate-300 transition-colors hover:text-white">
              查看全部构件
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
            {HERO_COMPONENTS.map(({ href, icon: Icon, title, desc, image }) => (
              <Link
                key={href}
                href={href}
                className="group overflow-hidden rounded-xl border border-white/10 bg-white/[0.035] transition-all hover:-translate-y-0.5 hover:border-blue-300/45 hover:bg-white/[0.06]"
              >
                <div className="relative h-24 border-b border-white/10 bg-slate-950/60">
                  <Image
                    src={image}
                    alt={`${title}配筋模型`}
                    fill
                    sizes="(min-width: 1024px) 16vw, 50vw"
                    className="object-cover opacity-80 transition-transform duration-500 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 to-transparent" />
                </div>
                <div className="p-4">
                  <Icon className="mb-3 h-5 w-5 text-blue-300" strokeWidth={1.8} />
                  <h3 className="text-base font-semibold text-white">{title}</h3>
                  <p className="mt-1 text-xs leading-5 text-slate-400">{desc}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════ STATS BAR ═══════ */}
      <section className="relative border-y border-white/[0.06] bg-[#07111d]">
        <div className="relative grid w-full grid-cols-2 gap-px px-5 py-8 sm:px-8 md:grid-cols-4 lg:px-12">
          {STATS.map(({ value, suffix, label }, i) => (
            <Reveal key={label} delay={i * 100}>
              <div className="border border-white/10 bg-white/[0.025] px-5 py-6 text-center">
                <div className="text-3xl font-black text-cyan-200 sm:text-4xl">
                  <AnimatedNumber target={value} suffix={suffix} />
                </div>
                <div className="mt-2 text-sm text-slate-400">{label}</div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ═══════ FEATURES — large cards ═══════ */}
      <section id="features" className="relative bg-[#0a0f1a] py-24 sm:py-28">
        <div className="w-full px-5 sm:px-8 lg:px-12">
          <Reveal>
            <div className="mb-14 max-w-2xl">
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-blue-500/20 bg-blue-500/10 px-4 py-1.5 text-xs font-medium text-blue-300">
                <Zap className="w-3.5 h-3.5" /> 核心功能
              </div>
              <h2 className="text-4xl font-black tracking-tight sm:text-5xl">
                为什么用 <span className="bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-cyan-300">RebarViz</span>
              </h2>
              <p className="mt-4 text-lg leading-8 text-slate-400">围绕平法标注、三维模型和构造理解，把识图过程变成可操作的工程视图。</p>
            </div>
          </Reveal>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, desc, color }, i) => (
              <Reveal key={title} delay={i * 80}>
                <div className="group relative h-full overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.035] p-6 transition-all duration-300 hover:border-blue-300/35 hover:bg-white/[0.055]">
                  <div className={`mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br ${color}`}>
                    <Icon className="h-6 w-6 text-white" />
                  </div>
                  <h3 className="mb-2 text-lg font-bold text-white">{title}</h3>
                  <p className="leading-relaxed text-slate-400">{desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════ COMPONENTS — showcase cards ═══════ */}
      <section className="relative border-t border-white/[0.06] bg-[#07111d] py-24 sm:py-28">
        <div className="w-full px-5 sm:px-8 lg:px-12">
          <Reveal>
            <div className="mb-12 max-w-2xl">
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-4 py-1.5 text-xs font-medium text-cyan-300">
                <Eye className="w-3.5 h-3.5" /> 完整构件库
              </div>
              <h2 className="text-4xl font-black tracking-tight sm:text-5xl">从常见构件进入模型</h2>
              <p className="mt-4 text-lg leading-8 text-slate-400">梁、柱、墙、板、节点和基础体系都保留原有入口，只把视觉统一到新的模型首屏语言。</p>
            </div>
          </Reveal>

          {/* Scan CTA — full-width highlight card */}
          <Reveal delay={0}>
            <Link
              href="/scan"
              className="group relative flex items-center gap-6 bg-gradient-to-r from-blue-600/[0.12] to-cyan-500/[0.08] border border-blue-500/25 rounded-3xl p-8 hover:border-blue-400/50 hover:from-blue-600/[0.18] transition-all duration-300 overflow-hidden cursor-pointer mb-6"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-blue-600 to-cyan-500 opacity-0 group-hover:opacity-[0.05] transition-opacity duration-500 pointer-events-none" />
              <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform duration-300 shrink-0">
                <Camera className="w-8 h-8 text-white" />
              </div>
              <div className="relative flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-1.5">
                  <h3 className="text-2xl font-bold text-white">图纸扫描建模</h3>
                  <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-blue-500/20 border border-blue-400/30 text-blue-300 tracking-wide">NEW</span>
                </div>
                <p className="text-gray-400 leading-relaxed">上传结构施工图或手绘草图，AI 自动识别平法标注，一键生成对应构件的 3D 配筋模型</p>
              </div>
              <div className="relative flex items-center gap-2 text-sm font-semibold text-blue-400 group-hover:text-cyan-300 transition-colors shrink-0">
                立即体验
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </div>
            </Link>
          </Reveal>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {COMPONENTS.map(({ href, icon: Icon, title, code, desc, tags, gradient }, i) => (
              <Reveal key={href} delay={i * 100}>
                <Link
                  href={href}
                  className="group relative block bg-white/[0.03] border border-white/[0.06] rounded-3xl p-8 hover:bg-white/[0.06] hover:border-white/[0.15] transition-all duration-300 overflow-hidden cursor-pointer"
                >
                  <div className={`absolute inset-0 bg-gradient-to-br ${gradient} opacity-0 group-hover:opacity-[0.06] transition-opacity duration-500`} />
                  <div className="relative flex items-center gap-5 mb-5">
                    <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${gradient} flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform duration-300`}>
                      <Icon className="w-8 h-8 text-white" />
                    </div>
                    <div>
                      <div className="flex items-baseline gap-2">
                        <h3 className="text-2xl font-bold text-white">{title}</h3>
                        <span className="text-xs font-mono text-gray-500 bg-white/5 px-2 py-0.5 rounded">{code}</span>
                      </div>
                      <p className="text-sm text-gray-400 mt-1">{desc}</p>
                    </div>
                  </div>
                  <div className="relative flex flex-wrap gap-2 mb-5">
                    {tags.map(tag => (
                      <span key={tag} className="px-3 py-1 bg-white/5 border border-white/5 text-xs text-gray-400 rounded-lg">
                        {tag}
                      </span>
                    ))}
                  </div>
                  <div className="relative flex items-center gap-1.5 text-sm font-medium text-gray-500 group-hover:text-white transition-colors">
                    进入学习
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </div>
                </Link>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════ AI SECTION — cinematic card ═══════ */}
      <section className="relative border-t border-white/[0.06] bg-[#0a0f1a] py-24 sm:py-28">
        <div className="w-full px-5 sm:px-8 lg:px-12">
          <Reveal>
            <div className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.035] p-6 sm:p-10 lg:p-12">
              <Image
                src="/landing-rebar-hero.webp"
                alt="AI 平法助手背景模型"
                fill
                sizes="100vw"
                className="object-cover object-right opacity-20"
              />
              <div className="absolute inset-0 bg-[linear-gradient(90deg,#0a0f1a_0%,rgba(10,15,26,0.92)_42%,rgba(10,15,26,0.58)_100%)]" />

              <div className="relative grid gap-10 md:grid-cols-2 md:items-center">
                <div>
                  <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-blue-500/20 bg-blue-500/10 px-4 py-1.5 text-xs font-medium text-blue-300">
                    <Brain className="w-3.5 h-3.5" /> AI 驱动
                  </div>
                  <h2 className="mb-5 text-4xl font-black sm:text-5xl">
                    AI <span className="bg-clip-text text-transparent bg-gradient-to-r from-blue-300 to-cyan-300">平法助手</span>
                  </h2>
                  <p className="mb-8 max-w-xl text-lg leading-8 text-slate-400">
                    接入 DeepSeek、通义千问、Kimi 三大模型，随时提问 22G101 图集和钢筋构造问题。
                    AI 会结合你当前查看的构件参数，给出针对性的专业解答。
                  </p>
                  <div className="flex flex-wrap gap-3">
                    {['DeepSeek', '通义千问', 'Kimi'].map(name => (
                      <span key={name} className="rounded-xl border border-white/10 bg-white/[0.055] px-4 py-2 text-sm font-medium text-slate-300">
                        {name}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Mock chat UI */}
                <div className="rounded-2xl border border-white/10 bg-slate-950/65 p-5 shadow-2xl backdrop-blur-md">
                  <div className="mb-4 flex items-center gap-2 border-b border-white/5 pb-4">
                    <Sparkles className="h-5 w-5 text-blue-300" />
                    <span className="font-medium text-slate-300">AI 平法助手</span>
                    <span className="ml-auto rounded bg-white/5 px-2 py-0.5 text-[10px] text-slate-500">DeepSeek</span>
                  </div>
                  <div className="space-y-4">
                    <div className="flex justify-end">
                      <div className="max-w-[80%] rounded-2xl rounded-br-md bg-blue-500 px-4 py-2.5 text-sm text-white">
                        梁端弯锚的弯折段长度怎么算？
                      </div>
                    </div>
                    <div className="flex justify-start">
                      <div className="max-w-[85%] rounded-2xl rounded-bl-md border border-white/10 bg-white/5 px-4 py-3 text-sm leading-relaxed text-slate-300">
                        根据 22G101-1，梁端弯锚的弯折段长度为 <span className="text-cyan-400 font-mono font-medium">15d</span>（d 为钢筋直径）。
                        例如 Φ25 钢筋，弯折段 = 15 × 25 = <span className="text-cyan-400 font-mono font-medium">375mm</span>。
                        直段部分需 ≥ <span className="text-cyan-400 font-mono font-medium">0.4laE</span>。
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ═══════ FINAL CTA ═══════ */}
      <section className="relative py-32 sm:py-40">
        <div className="absolute inset-0 bg-gradient-to-t from-blue-500/[0.06] to-transparent pointer-events-none" />
        <div className="w-full px-5 text-center sm:px-8 lg:px-12">
          <Reveal>
            <h2 className="text-5xl sm:text-7xl font-black tracking-tight mb-8">
              准备好了吗？
            </h2>
            <p className="text-xl text-gray-400 mb-14 max-w-2xl mx-auto">
              选择一个构件类型，开始你的 3D 平法识图之旅
            </p>
            <div className="flex flex-wrap justify-center gap-5">
              {COMPONENTS.map(({ href, icon: Icon, title, code, gradient }) => (
                <Link
                  key={href}
                  href={href}
                  className={`group flex items-center gap-3 px-8 py-4 bg-gradient-to-r ${gradient} rounded-2xl font-bold text-white text-lg hover:shadow-[0_0_40px_rgba(59,130,246,0.2)] transition-all cursor-pointer`}
                >
                  <Icon className="w-6 h-6" />
                  {title} {code}
                  <ArrowRight className="w-5 h-5 opacity-0 -ml-2 group-hover:opacity-100 group-hover:ml-0 transition-all" />
                </Link>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ═══════ FOOTER ═══════ */}
      <footer className="border-t border-white/[0.06]">
        <div className="w-full px-5 py-12 sm:px-8 lg:px-12">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-gradient-to-br from-blue-500 to-cyan-400 rounded-xl flex items-center justify-center">
                <svg className="w-4.5 h-4.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
              </div>
              <span className="font-bold text-lg text-gray-300">RebarViz</span>
            </div>
            <p className="text-sm text-gray-600">
              基于 22G101-1/2/3 系列图集 · 仅供学习参考
            </p>
          </div>
        </div>
      </footer>
    </main>
  );
}
