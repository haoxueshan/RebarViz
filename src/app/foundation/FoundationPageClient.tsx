'use client';

import { useState, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import type { FoundationParams, FoundationStepDim, ComponentType } from '@/lib/types';
import { FOUNDATION_PRESETS } from '@/lib/rebar';
import { calcFoundation } from '@/lib/calc';
import { FoundationCrossSection } from '@/components/CrossSection';
import { FoundationExplain } from '@/components/NotationExplain';
import { WeightCalc } from '@/components/WeightCalc';
import { ConcreteCalc } from '@/components/ConcreteCalc';
import { calcFoundationConcrete } from '@/lib/calc-concrete';
import { ShareButton } from '@/components/ShareButton';
import { Field, NumField, Legend, ResetButton, SelectField, Section } from '@/components/FormControls';
import { ViewerSkeleton } from '@/components/ViewerSkeleton';
import { CONCRETE_GRADES } from '@/lib/anchor';
import type { ConcreteGrade } from '@/lib/anchor';
import { AISidebar } from '@/components/AISidebar';
import { buildFoundationContext } from '@/lib/ai-context';
import { decodeSharedParam } from '@/lib/share-params';
import { Sparkles } from 'lucide-react';

const DATA_TABS = [
  { key: 'section', label: '截面图' },
  { key: 'weight', label: '用量估算' },
  { key: 'concrete', label: '混凝土量' },
] as const;

const FoundationViewer = dynamic(() => import('@/components/FoundationViewer'), {
  ssr: false,
  loading: () => <ViewerSkeleton />,
});

const presetList = [
  { key: 'simple', label: '单阶基础', dot: 'bg-blue-400' },
  { key: 'standard', label: '双阶基础', dot: 'bg-green-400' },
  { key: 'tapered', label: '锥形基础', dot: 'bg-orange-400' },
  { key: 'dualColumn', label: '双柱基础', dot: 'bg-sky-400' },
] as const;

function toMutableStepDims(dims: readonly { readonly bx: number; readonly by: number; readonly h: number }[]): FoundationStepDim[] {
  return dims.map(d => ({ bx: d.bx, by: d.by, h: d.h }));
}

const DEFAULT: FoundationParams = {
  ...FOUNDATION_PRESETS.standard,
  stepDims: toMutableStepDims(FOUNDATION_PRESETS.standard.stepDims),
};

export function FoundationPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [params, setParams] = useState<FoundationParams>(() => {
    const p = searchParams.get('p');
    const shared = decodeSharedParam<Partial<FoundationParams>>(p ?? undefined);
    if (shared && shared.bx && shared.by) {
      return { ...DEFAULT, ...shared };
    }
    return DEFAULT;
  });
  const [dataTab, setDataTab] = useState<typeof DATA_TABS[number]['key']>('section');
  const aiMessage = searchParams.get('ai') || undefined;
  const [showAI, setShowAI] = useState(!!aiMessage);

  const update = (patch: Partial<FoundationParams>) => setParams(p => ({ ...p, ...patch }));
  const calcResult = useMemo(() => calcFoundation(params), [params]);
  const concreteResult = useMemo(() => calcFoundationConcrete(params), [params]);
  const aiContext = useMemo(() => buildFoundationContext(params), [params]);

  const applyPreset = (key: keyof typeof FOUNDATION_PRESETS) => {
    const preset = FOUNDATION_PRESETS[key];
    setParams({
      ...preset,
      stepDims: toMutableStepDims(preset.stepDims),
    });
  };

  const updateStepDim = (index: number, patch: Partial<FoundationStepDim>) => {
    const newDims = [...params.stepDims];
    newDims[index] = { ...newDims[index], ...patch };
    setParams(p => ({ ...p, stepDims: newDims }));
  };

  return (
    <main className="px-4 py-4">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* 左栏：参数输入 */}
        <div className="lg:col-span-3 space-y-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto lg:scrollbar-thin">
          <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-primary">参数输入</h2>
              <div className="flex items-center gap-2">
                <ResetButton onClick={() => setParams(DEFAULT)} />
                <ShareButton params={params} />
              </div>
            </div>

            <div className="mb-4">
              <label className="text-xs text-muted mb-2 block">快速示例</label>
              <div className="flex flex-wrap gap-1.5">
                {presetList.map(({ key, label, dot }) => (
                  <button key={key} onClick={() => applyPreset(key)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium cursor-pointer transition-all bg-gray-50 text-gray-600 border border-gray-200 hover:border-gray-300 hover:bg-white hover:shadow-sm active:scale-95">
                    <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <Field label="基础编号" value={params.id} onChange={v => update({ id: v })} />
              <SelectField label="基础形状" value={params.shape} onChange={v => update({ shape: v as 'stepped' | 'tapered' })}
                options={[{ value: 'stepped', label: '阶形' }, { value: 'tapered', label: '锥形' }]} />
              <SelectField label="柱数" value={String(params.columnCount || 1)} onChange={v => update({ columnCount: Number(v) as 1 | 2 })}
                options={[{ value: '1', label: '单柱' }, { value: '2', label: '双柱 (22G101-3 p2-12)' }]} />
              <NumField label="底面 X 向宽 bx (mm)" value={params.bx} onChange={v => update({ bx: v })} min={800} max={8000} />
              <NumField label="底面 Y 向宽 by (mm)" value={params.by} onChange={v => update({ by: v })} min={800} max={4000} />
              <NumField label="基础总高 h (mm)" value={params.h} onChange={v => update({ h: v })} min={300} max={2000} />
            </div>

            {params.shape === 'stepped' && (
              <Section title="各阶尺寸">
                {params.stepDims.map((s, i) => (
                  <div key={i} className="space-y-2 p-2 bg-gray-50 rounded-lg">
                    <p className="text-xs font-medium text-gray-500">第 {i + 1} 阶</p>
                    <NumField label={`bx (mm)`} value={s.bx} onChange={v => updateStepDim(i, { bx: v })} min={400} max={4000} />
                    <NumField label={`by (mm)`} value={s.by} onChange={v => updateStepDim(i, { by: v })} min={400} max={4000} />
                    <NumField label={`h (mm)`} value={s.h} onChange={v => updateStepDim(i, { h: v })} min={200} max={1000} />
                  </div>
                ))}
              </Section>
            )}

            <Section title="底部配筋">
              <Field label="X向底筋" value={params.bottomBarX} onChange={v => update({ bottomBarX: v })} placeholder="如: C12@150" />
              <Field label="Y向底筋" value={params.bottomBarY} onChange={v => update({ bottomBarY: v })} placeholder="如: C12@150" />
            </Section>

            <Section title="柱参数">
              <NumField label="柱截面 X (mm)" value={params.colBx} onChange={v => update({ colBx: v })} min={200} max={800} />
              <NumField label="柱截面 Y (mm)" value={params.colBy} onChange={v => update({ colBy: v })} min={200} max={800} />
              <Field label="柱插筋" value={params.colMain} onChange={v => update({ colMain: v })} placeholder="如: 8C20" />
              {(params.columnCount || 1) === 2 && (
                <NumField label="双柱中心距 (mm)" value={params.colSpacing || 2000} onChange={v => update({ colSpacing: v })} min={800} max={6000} />
              )}
            </Section>

            {(params.columnCount || 1) === 2 && (
              <Section title="顶部柱间配筋">
                <Field label="纵向受力筋" value={params.topBarX || 'C14@150'} onChange={v => update({ topBarX: v })} placeholder="如: C14@150" />
                <Field label="分布筋" value={params.topBarY || 'C10@200'} onChange={v => update({ topBarY: v })} placeholder="如: C10@200" />
              </Section>
            )}

            <Section title="材料">
              <SelectField label="混凝土等级" value={params.concreteGrade} onChange={v => update({ concreteGrade: v as ConcreteGrade })}
                options={CONCRETE_GRADES.map(g => ({ value: g, label: g }))} />
              <NumField label="保护层 (mm)" value={params.cover} onChange={v => update({ cover: v })} min={35} max={70} />
            </Section>
          </div>

          <Legend items={[
            { color: '#C0392B', label: 'X向底部钢筋' },
            { color: '#2980B9', label: 'Y向底部钢筋' },
            { color: '#8E44AD', label: '柱插筋' },
            ...((params.columnCount || 1) === 2 ? [
              { color: '#E67E22', label: '顶部纵向受力筋' },
              { color: '#27AE60', label: '顶部柱间分布筋' },
            ] : []),
            { color: '#BDC3C7', label: '混凝土（半透明）', opacity: 0.6 },
          ]} />
        </div>

        {/* 中栏：3D模型 + 数据 tab */}
        <div className={`${showAI ? 'lg:col-span-6' : 'lg:col-span-9'} space-y-4 min-w-0 transition-all`}>
          <FoundationViewer params={params} />
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="flex items-center gap-1 px-3 py-2 border-b border-gray-100">
              <div className="flex items-center gap-1 bg-gray-100/80 rounded-lg p-0.5">
                {DATA_TABS.map(t => (
                  <button key={t.key} onClick={() => setDataTab(t.key)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all cursor-pointer ${dataTab === t.key ? 'bg-white text-accent shadow-sm' : 'text-muted hover:text-primary'}`}>
                    {t.label}
                  </button>
                ))}
              </div>
              <button onClick={() => setShowAI(a => !a)}
                className={`ml-auto px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-all flex items-center gap-1.5 ${showAI ? 'bg-gradient-to-r from-blue-500 to-violet-500 text-white shadow-md shadow-blue-500/20' : 'bg-gradient-to-r from-blue-50 to-violet-50 text-violet-600 hover:from-blue-100 hover:to-violet-100'}`}>
                <Sparkles className="w-3.5 h-3.5" />
                AI 助手
              </button>
            </div>
            <div className="p-5">
              {dataTab === 'section' && (
                <>
                  <h2 className="text-sm font-semibold text-primary mb-3">底面配筋示意（俯视）</h2>
                  <div className="flex justify-center">
                    <FoundationCrossSection params={params} />
                  </div>
                </>
              )}
              {dataTab === 'weight' && <WeightCalc result={calcResult} />}
              {dataTab === 'concrete' && <ConcreteCalc result={concreteResult} />}
            </div>
          </div>
        </div>

        {/* 右栏：AI 侧边栏 */}
        {showAI && (
          <div className="lg:col-span-3">
            <AISidebar
              componentType="foundation"
              currentParams={params}
              onApplyParams={(p) => update(p as Partial<FoundationParams>)}
              context={aiContext}
              notationSlot={<FoundationExplain params={params} />}
              initialMessage={aiMessage}
              onSwitchTab={(tab) => setDataTab(tab as typeof dataTab)}
              onNavigateComponent={(type: ComponentType, message?: string) => {
                const encoded = message ? `?ai=${encodeURIComponent(message)}` : '';
                router.push(`/${type}${encoded}`);
              }}
              onApplyPreset={(preset) => {
                if (preset in FOUNDATION_PRESETS) applyPreset(preset as keyof typeof FOUNDATION_PRESETS);
              }}
              onGetCurrentState={() => aiContext}
              onResetParams={() => setParams({ ...FOUNDATION_PRESETS.standard, stepDims: toMutableStepDims(FOUNDATION_PRESETS.standard.stepDims) })}
            />
          </div>
        )}
      </div>
    </main>
  );
}
