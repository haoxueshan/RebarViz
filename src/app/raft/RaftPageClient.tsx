'use client';

import { useState, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import type { RaftFoundationParams, ComponentType } from '@/lib/types';
import { RAFT_PRESETS } from '@/lib/rebar';
import { calcRaft } from '@/lib/calc';
import { RaftCrossSection } from '@/components/CrossSection';
import { RaftExplain } from '@/components/NotationExplain';
import { WeightCalc } from '@/components/WeightCalc';
import { ConcreteCalc } from '@/components/ConcreteCalc';
import { calcRaftConcrete } from '@/lib/calc-concrete';
import { ShareButton } from '@/components/ShareButton';
import { Field, NumField, Legend, ResetButton, SelectField, Section } from '@/components/FormControls';
import { ViewerSkeleton } from '@/components/ViewerSkeleton';
import { CONCRETE_GRADES, SEISMIC_GRADES } from '@/lib/anchor';
import type { ConcreteGrade, SeismicGrade } from '@/lib/anchor';
import { AISidebar } from '@/components/AISidebar';
import { buildRaftContext } from '@/lib/ai-context';
import { decodeSharedParam } from '@/lib/share-params';
import { Sparkles } from 'lucide-react';

const DATA_TABS = [
  { key: 'section', label: '截面图' },
  { key: 'weight', label: '用量估算' },
  { key: 'concrete', label: '混凝土量' },
] as const;

const RaftViewer = dynamic(() => import('@/components/RaftViewer'), {
  ssr: false,
  loading: () => <ViewerSkeleton />,
});

const presetList = [
  { key: 'small', label: '小型筏板', dot: 'bg-blue-400' },
  { key: 'standard', label: '标准筏板', dot: 'bg-green-400' },
  { key: 'large', label: '大型筏板', dot: 'bg-orange-400' },
] as const;

const DEFAULT: RaftFoundationParams = {
  ...RAFT_PRESETS.standard,
};

export function RaftPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [params, setParams] = useState<RaftFoundationParams>(() => {
    const p = searchParams.get('p');
    const shared = decodeSharedParam<Partial<RaftFoundationParams>>(p ?? undefined);
    if (shared && shared.lx && shared.ly) {
      return { ...DEFAULT, ...shared };
    }
    return DEFAULT;
  });
  const [dataTab, setDataTab] = useState<typeof DATA_TABS[number]['key']>('section');
  const aiMessage = searchParams.get('ai') || undefined;
  const [showAI, setShowAI] = useState(!!aiMessage);

  const update = (patch: Partial<RaftFoundationParams>) => setParams(p => ({ ...p, ...patch }));
  const calcResult = useMemo(() => calcRaft(params), [params]);
  const concreteResult = useMemo(() => calcRaftConcrete(params), [params]);
  const aiContext = useMemo(() => buildRaftContext(params), [params]);

  const applyPreset = (key: keyof typeof RAFT_PRESETS) => {
    const preset = RAFT_PRESETS[key];
    setParams({ ...preset });
  };

  return (
    <main className="px-4 py-4">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* 左栏：参数输入 */}
        <div className="lg:col-span-3 space-y-4 lg:sticky lg:top-[60px] lg:max-h-[calc(100vh-76px)] lg:overflow-y-auto lg:scrollbar-thin">
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
              <Field label="筏板编号" value={params.id} onChange={v => update({ id: v })} />
              <NumField label="X 向长度 lx (mm)" value={params.lx} onChange={v => update({ lx: v })} min={3000} max={60000} />
              <NumField label="Y 向宽度 ly (mm)" value={params.ly} onChange={v => update({ ly: v })} min={3000} max={40000} />
              <NumField label="板厚 h (mm)" value={params.h} onChange={v => update({ h: v })} min={300} max={2000} />
            </div>

            <Section title="底部配筋">
              <Field label="X向底筋" value={params.bottomBarX} onChange={v => update({ bottomBarX: v })} placeholder="如: C16@150" />
              <Field label="Y向底筋" value={params.bottomBarY} onChange={v => update({ bottomBarY: v })} placeholder="如: C16@150" />
            </Section>

            <Section title="顶部配筋">
              <Field label="X向面筋" value={params.topBarX} onChange={v => update({ topBarX: v })} placeholder="如: C12@200" />
              <Field label="Y向面筋" value={params.topBarY} onChange={v => update({ topBarY: v })} placeholder="如: C12@200" />
            </Section>

            <Section title="柱网参数">
              <NumField label="柱截面 X (mm)" value={params.colBx} onChange={v => update({ colBx: v })} min={200} max={1000} />
              <NumField label="柱截面 Y (mm)" value={params.colBy} onChange={v => update({ colBy: v })} min={200} max={1000} />
              <Field label="柱插筋" value={params.colMain} onChange={v => update({ colMain: v })} placeholder="如: 8C20" />
              <NumField label="X 向柱数" value={params.colCountX} onChange={v => update({ colCountX: v })} min={1} max={10} />
              <NumField label="Y 向柱数" value={params.colCountY} onChange={v => update({ colCountY: v })} min={1} max={10} />
              <NumField label="X 向柱距 (mm)" value={params.colSpacingX} onChange={v => update({ colSpacingX: v })} min={3000} max={12000} />
              <NumField label="Y 向柱距 (mm)" value={params.colSpacingY} onChange={v => update({ colSpacingY: v })} min={3000} max={12000} />
            </Section>

            <Section title="材料">
              <SelectField label="混凝土等级" value={params.concreteGrade} onChange={v => update({ concreteGrade: v as ConcreteGrade })}
                options={CONCRETE_GRADES.map(g => ({ value: g, label: g }))} />
              <SelectField label="抗震等级" value={params.seismicGrade} onChange={v => update({ seismicGrade: v as SeismicGrade })}
                options={SEISMIC_GRADES.map(g => ({ value: g, label: g }))} />
              <NumField label="保护层 (mm)" value={params.cover} onChange={v => update({ cover: v })} min={35} max={70} />
            </Section>
          </div>

          <Legend items={[
            { color: '#C0392B', label: 'X向底部钢筋' },
            { color: '#2980B9', label: 'Y向底部钢筋' },
            { color: '#E67E22', label: 'X向面筋' },
            { color: '#27AE60', label: 'Y向面筋' },
            { color: '#8E44AD', label: '柱插筋' },
            { color: '#BDC3C7', label: '混凝土（半透明）', opacity: 0.6 },
          ]} />
        </div>

        {/* 中栏：3D模型 + 数据 tab */}
        <div className={`${showAI ? 'lg:col-span-6' : 'lg:col-span-9'} space-y-4 min-w-0 transition-all`}>
          <RaftViewer params={params} />
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
                    <RaftCrossSection params={params} />
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
              componentType="raft"
              currentParams={params}
              onApplyParams={(p) => update(p as Partial<RaftFoundationParams>)}
              context={aiContext}
              notationSlot={<RaftExplain params={params} />}
              initialMessage={aiMessage}
              onSwitchTab={(tab) => setDataTab(tab as typeof dataTab)}
              onNavigateComponent={(type: ComponentType, message?: string) => {
                const encoded = message ? `?ai=${encodeURIComponent(message)}` : '';
                router.push(`/${type}${encoded}`);
              }}
              onApplyPreset={(preset) => {
                if (preset in RAFT_PRESETS) applyPreset(preset as keyof typeof RAFT_PRESETS);
              }}
              onGetCurrentState={() => aiContext}
            />
          </div>
        )}
      </div>
    </main>
  );
}
