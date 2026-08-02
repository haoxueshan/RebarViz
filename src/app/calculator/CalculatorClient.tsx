'use client';

import { useMemo, useState } from 'react';
import { AlertCircle, Calculator, RotateCcw, Ruler, Sigma } from 'lucide-react';
import {
  MAX_VISIBLE_SVG_BARS,
  calculateRebar,
  createDefaultCalculatorState,
  parseNumericInput,
  resolveTopInputs,
  setTopFollowMode,
  validateCalculatorState,
  type CalculatedBar,
  type CalculatorState,
  type CountMode,
  type RebarDirection,
  type RebarInputs,
  type RebarLayer,
} from './calculator';

const X_COLOR = '#2563eb';
const Y_COLOR = '#f97316';

interface NumberFieldProps {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  readOnly?: boolean;
  invalid?: boolean;
}

function NumberField({
  id,
  label,
  value,
  onChange,
  min,
  readOnly = false,
  invalid = false,
}: NumberFieldProps) {
  return (
    <label htmlFor={id} className="block min-w-0">
      <span className="mb-1.5 block text-xs font-medium text-slate-600">{label}</span>
      <div className="relative">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          step="any"
          min={min}
          value={Number.isFinite(value) ? value : 0}
          readOnly={readOnly}
          aria-invalid={invalid}
          onChange={(event) => onChange(parseNumericInput(event.target.value))}
          className={`h-10 w-full rounded-xl border px-3 pr-12 text-sm text-slate-900 outline-none transition ${
            invalid
              ? 'border-red-300 bg-red-50/60 focus:border-red-500 focus:ring-2 focus:ring-red-100'
              : readOnly
                ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-500'
                : 'border-slate-200 bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-100'
          }`}
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-slate-400">
          mm
        </span>
      </div>
    </label>
  );
}

function SectionTitle({ number, title, description }: { number: string; title: string; description: string }) {
  return (
    <div className="mb-5 flex items-start gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-xs font-bold text-blue-600">
        {number}
      </span>
      <div>
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>
      </div>
    </div>
  );
}

interface DirectionCardProps {
  idPrefix: string;
  direction: RebarDirection;
  bar: RebarInputs;
  anchorReadOnly?: boolean;
  onChange: (key: keyof RebarInputs, value: number) => void;
}

function DirectionCard({
  idPrefix,
  direction,
  bar,
  anchorReadOnly = false,
  onChange,
}: DirectionCardProps) {
  const isX = direction === 'x';
  const color = isX ? X_COLOR : Y_COLOR;
  const directionText = isX ? 'X向：西 → 东' : 'Y向：南 → 北';
  const firstAnchorLabel = isX ? '西端锚固' : '南端锚固';
  const secondAnchorLabel = isX ? '东端锚固' : '北端锚固';

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 sm:p-5">
      <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-800">
        <span className="h-1 w-6 rounded-full" style={{ backgroundColor: color }} />
        {directionText}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <NumberField
          id={`${idPrefix}-diameter`}
          label="钢筋直径"
          value={bar.diameter}
          min={1}
          invalid={bar.diameter <= 0}
          onChange={(value) => onChange('diameter', value)}
        />
        <NumberField
          id={`${idPrefix}-spacing`}
          label="钢筋间距"
          value={bar.spacing}
          min={1}
          invalid={bar.spacing <= 0}
          onChange={(value) => onChange('spacing', value)}
        />
        <NumberField
          id={`${idPrefix}-first-anchor`}
          label={firstAnchorLabel}
          value={bar.firstAnchor}
          min={0}
          readOnly={anchorReadOnly}
          invalid={bar.firstAnchor < 0}
          onChange={(value) => onChange('firstAnchor', value)}
        />
        <NumberField
          id={`${idPrefix}-second-anchor`}
          label={secondAnchorLabel}
          value={bar.secondAnchor}
          min={0}
          readOnly={anchorReadOnly}
          invalid={bar.secondAnchor < 0}
          onChange={(value) => onChange('secondAnchor', value)}
        />
      </div>
    </div>
  );
}

interface DiagramLineProps {
  direction: RebarDirection;
  count: number;
  layer: RebarLayer;
}

function DiagramLines({ direction, count, layer }: DiagramLineProps) {
  const visibleCount = Math.min(Math.max(Math.trunc(count), 0), MAX_VISIBLE_SVG_BARS);
  const inset = layer === 'top' ? 4 : 0;
  const color = direction === 'x' ? X_COLOR : Y_COLOR;

  return Array.from({ length: visibleCount }, (_, index) => {
    const ratio = visibleCount === 1 ? 0.5 : index / (visibleCount - 1);
    const commonProps = {
      stroke: color,
      strokeWidth: 2,
      strokeDasharray: layer === 'top' ? '7 4' : undefined,
      opacity: layer === 'top' ? 0.92 : 0.58,
    };

    if (direction === 'x') {
      const y = 53 + inset + ratio * (284 - 2 * inset);
      return <line key={`${layer}-${direction}-${index}`} {...commonProps} x1="73" x2="447" y1={y} y2={y} />;
    }

    const x = 73 + inset + ratio * (374 - 2 * inset);
    return <line key={`${layer}-${direction}-${index}`} {...commonProps} x1={x} x2={x} y1="53" y2="337" />;
  });
}

function SlabDiagram({ state, result }: { state: CalculatorState; result: ReturnType<typeof calculateRebar> }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-500" aria-label="图示线型">
        <span className="inline-flex items-center gap-2">
          <span className="w-6 border-t-2 border-slate-500" />地筋实线
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="w-6 border-t-2 border-dashed border-slate-500" />面筋虚线
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: X_COLOR }} />X向
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: Y_COLOR }} />Y向
        </span>
      </div>

      <svg
        className="block h-auto w-full"
        viewBox="0 0 520 390"
        role="img"
        aria-labelledby="calculator-svg-title calculator-svg-desc"
      >
        <title id="calculator-svg-title">楼板钢筋方向图</title>
        <desc id="calculator-svg-desc">
          X向钢筋沿西向东布置，Y向钢筋沿南向北布置；地筋为实线，面筋为虚线。
        </desc>
        <text x="260" y="23" textAnchor="middle" className="fill-slate-700 text-[13px] font-semibold">北（+Y）</text>
        <text x="260" y="382" textAnchor="middle" className="fill-slate-700 text-[13px] font-semibold">南（−Y）</text>
        <text x="25" y="199" textAnchor="middle" className="fill-slate-700 text-[13px] font-semibold">西</text>
        <text x="495" y="199" textAnchor="middle" className="fill-slate-700 text-[13px] font-semibold">东</text>
        <rect x="65" y="45" width="390" height="300" rx="6" className="fill-slate-100 stroke-slate-300" strokeWidth="2" />
        <DiagramLines direction="y" count={result.bottomY.count} layer="bottom" />
        <DiagramLines direction="x" count={result.bottomX.count} layer="bottom" />
        <DiagramLines direction="y" count={result.topY.count} layer="top" />
        <DiagramLines direction="x" count={result.topX.count} layer="top" />
        <text x="260" y="365" textAnchor="middle" className="fill-slate-500 text-[12px]">
          东西净尺寸 X = {state.slab.spanX} mm
        </text>
        <text
          x="474"
          y="199"
          textAnchor="middle"
          transform="rotate(90 474 199)"
          className="fill-slate-500 text-[12px]"
        >
          南北净尺寸 Y = {state.slab.spanY} mm
        </text>
      </svg>
      <p className="mt-2 text-xs leading-5 text-slate-400">
        图中每组最多显示 {MAX_VISIBLE_SVG_BARS} 条线；计算结果始终使用实际根数。
      </p>
    </div>
  );
}

function formatLength(value: number) {
  return `${value.toFixed(3)} m`;
}

function formatWeight(value: number) {
  return `${value.toFixed(2)} kg`;
}

function ResultTable({ bars }: { bars: CalculatedBar[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="overflow-x-auto">
        <table className="min-w-[760px] w-full border-collapse text-sm">
          <thead className="bg-slate-50 text-xs font-semibold text-slate-500">
            <tr>
              <th className="px-4 py-3 text-left">钢筋类型</th>
              <th className="px-4 py-3 text-left">方向</th>
              <th className="px-4 py-3 text-right">钢筋直径</th>
              <th className="px-4 py-3 text-right">根数</th>
              <th className="px-4 py-3 text-right">单根长度</th>
              <th className="px-4 py-3 text-right">总长度</th>
              <th className="px-4 py-3 text-right">重量</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 [font-variant-numeric:tabular-nums]">
            {bars.map((bar) => {
              const isX = bar.direction === 'x';
              return (
                <tr key={bar.key} className="text-slate-700">
                  <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-900">
                    {bar.layer === 'bottom' ? '地筋' : '面筋'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <span
                      className="inline-flex items-center gap-2 font-medium"
                      style={{ color: isX ? X_COLOR : Y_COLOR }}
                    >
                      <span className="h-1 w-5 rounded-full" style={{ backgroundColor: isX ? X_COLOR : Y_COLOR }} />
                      {isX ? 'X向' : 'Y向'}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">Φ{bar.diameter}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">{bar.count} 根</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">{formatLength(bar.singleLengthM)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">{formatLength(bar.totalLengthM)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-900">
                    {formatWeight(bar.weightKg)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function CalculatorClient() {
  const [state, setState] = useState<CalculatorState>(() => createDefaultCalculatorState());
  const topInputs = useMemo(() => resolveTopInputs(state), [state]);
  const result = useMemo(() => calculateRebar(state), [state]);
  const validationMessages = useMemo(() => validateCalculatorState(state), [state]);

  const updateSlabNumber = (key: 'spanX' | 'spanY' | 'cover', value: number) => {
    setState((current) => ({
      ...current,
      slab: { ...current.slab, [key]: value },
    }));
  };

  const updateCountMode = (countMode: CountMode) => {
    setState((current) => ({
      ...current,
      slab: { ...current.slab, countMode },
    }));
  };

  const updateBar = (
    layer: RebarLayer,
    direction: RebarDirection,
    key: keyof RebarInputs,
    value: number,
  ) => {
    setState((current) => ({
      ...current,
      [layer]: {
        ...current[layer],
        [direction]: {
          ...current[layer][direction],
          [key]: value,
        },
      },
    }));
  };

  const toggleTopFollow = () => {
    setState((current) => setTopFollowMode(current, !current.topFollowsBottom));
  };

  const reset = () => setState(createDefaultCalculatorState());

  return (
    <main className="min-h-[calc(100dvh-3.5rem)] bg-slate-100/80 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto w-full max-w-[1500px]">
        <header className="mb-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-600/20">
                <Calculator className="h-6 w-6" />
              </span>
              <div>
                <p className="text-xs font-semibold tracking-[0.18em] text-blue-600">REBARVIZ · 计算器</p>
                <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">楼板钢筋计算器</h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
                  按 X/Y 方向分别计算地筋与面筋的根数、长度和理论重量，结果随输入实时更新。
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={reset}
              className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
            >
              <RotateCcw className="h-4 w-4" />
              重置数据
            </button>
          </div>
        </header>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(560px,1.1fr)]">
          <div className="space-y-6">
            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              <SectionTitle number="1" title="楼板基础参数" description="输入楼板净尺寸、保护层并选择根数计算方式。" />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <NumberField
                  id="calculator-span-x"
                  label="东西净尺寸 X"
                  value={state.slab.spanX}
                  min={1}
                  invalid={state.slab.spanX <= 0}
                  onChange={(value) => updateSlabNumber('spanX', value)}
                />
                <NumberField
                  id="calculator-span-y"
                  label="南北净尺寸 Y"
                  value={state.slab.spanY}
                  min={1}
                  invalid={state.slab.spanY <= 0}
                  onChange={(value) => updateSlabNumber('spanY', value)}
                />
                <NumberField
                  id="calculator-cover"
                  label="保护层"
                  value={state.slab.cover}
                  min={0}
                  invalid={state.slab.cover < 0}
                  onChange={(value) => updateSlabNumber('cover', value)}
                />
                <label htmlFor="calculator-count-mode" className="block min-w-0">
                  <span className="mb-1.5 block text-xs font-medium text-slate-600">根数算法</span>
                  <select
                    id="calculator-count-mode"
                    value={state.slab.countMode}
                    onChange={(event) => updateCountMode(event.target.value as CountMode)}
                    className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  >
                    <option value="project">项目算法：ceil（净尺寸 ÷ 间距）</option>
                    <option value="cover">保护层算法：ceil（有效宽度 ÷ 间距）+ 1</option>
                  </select>
                </label>
              </div>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              <SectionTitle number="2" title="地筋参数" description="X向沿西至东运行，Y向沿南至北运行；两端锚固分别计入单根长度。" />
              <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                <DirectionCard
                  idPrefix="calculator-bottom-x"
                  direction="x"
                  bar={state.bottom.x}
                  onChange={(key, value) => updateBar('bottom', 'x', key, value)}
                />
                <DirectionCard
                  idPrefix="calculator-bottom-y"
                  direction="y"
                  bar={state.bottom.y}
                  onChange={(key, value) => updateBar('bottom', 'y', key, value)}
                />
              </div>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              <SectionTitle number="3" title="面筋参数" description="可跟随对应地筋端部锚固，也可关闭跟随后分别手动输入四端数值。" />
              <div className="mb-5 grid gap-4 rounded-2xl border border-blue-100 bg-blue-50/60 p-4 sm:grid-cols-[minmax(0,1fr)_180px] sm:items-end">
                <div>
                  <span className="mb-2 block text-xs font-medium text-slate-600">面筋锚固方式</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={state.topFollowsBottom}
                    onClick={toggleTopFollow}
                    className="inline-flex items-center gap-3 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
                  >
                    <span className={`relative h-6 w-11 rounded-full transition ${state.topFollowsBottom ? 'bg-blue-600' : 'bg-slate-300'}`}>
                      <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-all ${state.topFollowsBottom ? 'left-6' : 'left-1'}`} />
                    </span>
                    <span className="text-sm font-medium text-slate-800">锚固跟随对应地筋</span>
                  </button>
                </div>
                <NumberField
                  id="calculator-top-increment"
                  label="每端比地筋增加"
                  value={state.topAnchorIncrement}
                  min={0}
                  invalid={state.topAnchorIncrement < 0}
                  onChange={(value) => setState((current) => ({ ...current, topAnchorIncrement: value }))}
                />
              </div>
              <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                <DirectionCard
                  idPrefix="calculator-top-x"
                  direction="x"
                  bar={topInputs.x}
                  anchorReadOnly={state.topFollowsBottom}
                  onChange={(key, value) => updateBar('top', 'x', key, value)}
                />
                <DirectionCard
                  idPrefix="calculator-top-y"
                  direction="y"
                  bar={topInputs.y}
                  anchorReadOnly={state.topFollowsBottom}
                  onChange={(key, value) => updateBar('top', 'y', key, value)}
                />
              </div>
              <p className="mt-4 text-xs leading-5 text-slate-500">
                {state.topFollowsBottom
                  ? `当前面筋各端锚固 = 对应地筋端部 + ${Math.max(state.topAnchorIncrement, 0)} mm`
                  : '当前面筋西、东、南、北四端锚固均为手动输入。'}
              </p>
            </section>
          </div>

          <section className="self-start rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6 xl:sticky xl:top-20">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-xs font-bold text-blue-600">4</span>
                <div>
                  <h2 className="text-base font-semibold text-slate-900">计算结果</h2>
                  <p className="mt-1 text-sm leading-6 text-slate-500">四项钢筋独立计算，长度与重量按要求保留小数位。</p>
                </div>
              </div>
              <span className="hidden items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 sm:inline-flex">
                <Sigma className="h-3.5 w-3.5" />实时更新
              </span>
            </div>

            {validationMessages.length > 0 && (
              <div className="mb-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">
                <div className="flex items-start gap-2.5">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <p className="font-semibold">请检查输入数据</p>
                    <ul className="mt-1.5 list-disc space-y-1 pl-5">
                      {validationMessages.map((message) => <li key={message}>{message}</li>)}
                    </ul>
                  </div>
                </div>
              </div>
            )}

            <div className="grid gap-5">
              <SlabDiagram state={state} result={result} />
              <ResultTable bars={result.bars} />
            </div>

            <div className="mt-5 rounded-2xl bg-slate-950 p-5 text-white" aria-live="polite">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-sm text-slate-400">全部钢筋合计重量</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">理论重量按钢筋截面积 × 7850 kg/m³ 计算</p>
                </div>
                <div className="text-3xl font-bold tracking-tight text-cyan-300 [font-variant-numeric:tabular-nums]">
                  {formatWeight(result.totalWeightKg)}
                </div>
              </div>
            </div>

            <div className="mt-4 grid gap-3 text-xs leading-5 text-slate-500 sm:grid-cols-2">
              <div className="flex items-start gap-2 rounded-xl bg-slate-50 p-3">
                <Ruler className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
                <span>
                  {state.slab.countMode === 'cover'
                    ? '根数：ceil（（垂直方向净尺寸 − 2 × 保护层）÷ 间距）+ 1'
                    : '根数：ceil（垂直方向净尺寸 ÷ 间距）'}
                </span>
              </div>
              <div className="flex items-start gap-2 rounded-xl bg-slate-50 p-3">
                <Calculator className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
                <span>单根长度 = 运行方向净尺寸 + 第一端锚固 + 第二端锚固</span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
