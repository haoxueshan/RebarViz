'use client';

import { useMemo, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import type { ComponentType, StripFoundationParams } from '@/lib/types';
import { STRIPFOUNDATION_PRESETS } from '@/lib/rebar';
import { calcStripFoundation } from '@/lib/calc';
import { calcStripFoundationConcrete } from '@/lib/calc-concrete';
import { StripFoundationCrossSection } from '@/components/CrossSection';
import { StripFoundationExplain } from '@/components/NotationExplain';
import { WeightCalc } from '@/components/WeightCalc';
import { ConcreteCalc } from '@/components/ConcreteCalc';
import { StripFoundationRulePanel } from '@/components/StripFoundationRulePanel';
import { ShareButton } from '@/components/ShareButton';
import { Field, NumField, Legend, ResetButton, Section, SelectField } from '@/components/FormControls';
import { ViewerSkeleton } from '@/components/ViewerSkeleton';
import { CONCRETE_GRADES } from '@/lib/anchor';
import type { ConcreteGrade } from '@/lib/anchor';
import { LazyAISidebar as AISidebar } from '@/components/LazyAISidebar';
import { buildStripFoundationContext } from '@/lib/ai-context';
import { decodeSharedParam } from '@/lib/share-params';
import { CompliancePanel, ComplianceBadge } from '@/components/CompliancePanel';
import { checkStripFoundationCompliance } from '@/lib/compliance';
import { useHistory } from '@/lib/useHistory';
import { HistoryPanel } from '@/components/HistoryPanel';
import { MetricComparePanel } from '@/components/MetricComparePanel';
import { metricFromNumber, metricFromText } from '@/lib/compare-utils';
import { Sparkles } from 'lucide-react';

const DATA_TABS = [
  { key: 'section', label: '截面图' },
  { key: 'compliance', label: '规范校验' },
  { key: 'weight', label: '用量估算' },
  { key: 'concrete', label: '混凝土量' },
  { key: 'guide', label: '构造要点' },
  { key: 'compare', label: '方案对比' },
] as const;

const StripFoundationViewer = dynamic(() => import('@/components/StripFoundationViewer'), {
  ssr: false,
  loading: () => <ViewerSkeleton />,
});

const presetList = [
  { key: 'singleBeam', label: '单梁条基', dot: 'bg-blue-400' },
  { key: 'doubleBeam', label: '双梁条基', dot: 'bg-orange-400' },
  { key: 'doubleWall', label: '双墙条基', dot: 'bg-emerald-400' },
] as const;

const DEFAULT: StripFoundationParams = { ...STRIPFOUNDATION_PRESETS.singleBeam };

export function StripFoundationPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [params, setParams] = useState<StripFoundationParams>(() => {
    const p = searchParams.get('p');
    const shared = decodeSharedParam<Partial<StripFoundationParams>>(p ?? undefined);
    if (shared && shared.length && shared.width) {
      return { ...DEFAULT, ...shared };
    }
    return DEFAULT;
  });
  const [dataTab, setDataTab] = useState<typeof DATA_TABS[number]['key']>('section');
  const aiMessage = searchParams.get('ai') || undefined;
  const [showAI, setShowAI] = useState(!!aiMessage);

  const update = (patch: Partial<StripFoundationParams>) => setParams(prev => ({ ...prev, ...patch }));
  const calcResult = useMemo(() => calcStripFoundation(params), [params]);
  const concreteResult = useMemo(() => calcStripFoundationConcrete(params), [params]);
  const complianceResults = useMemo(() => checkStripFoundationCompliance(params), [params]);
  const aiContext = useMemo(() => buildStripFoundationContext(params), [params]);

  const {
    history,
    favorites,
    addToHistory,
    addToFavorites,
    removeFromFavorites,
    removeFromHistory,
    clearHistory,
    isFavorite,
  } = useHistory<StripFoundationParams>('stripfoundation');

  useEffect(() => {
    const timer = setTimeout(() => addToHistory(params, params.id), 2000);
    return () => clearTimeout(timer);
  }, [params, addToHistory]);

  const [compareParams, setCompareParams] = useState<StripFoundationParams | null>(null);
  const [compareLabel, setCompareLabel] = useState('历史方案');

  const applyPreset = (key: keyof typeof STRIPFOUNDATION_PRESETS) => {
    setParams({ ...STRIPFOUNDATION_PRESETS[key] });
  };

  const handleSelectHistory = (id: string, fromFavorites: boolean) => {
    const list = fromFavorites ? favorites : history;
    const item = list.find(i => i.id === id);
    if (item) setParams(item.params as StripFoundationParams);
  };

  const handleSelectForCompare = (id: string, fromFavorites: boolean) => {
    const list = fromFavorites ? favorites : history;
    const item = list.find(i => i.id === id);
    if (item) {
      setCompareParams(item.params as StripFoundationParams);
      setCompareLabel(item.name);
      setDataTab('compare');
    }
  };

  const compareMetrics = useMemo(() => {
    if (!compareParams) return [];
    return [
      metricFromText('条基类型', compareParams.stripKind === 'beamPlate' ? '梁板式' : '板式', params.stripKind === 'beamPlate' ? '梁板式' : '板式'),
      metricFromNumber('条基长度', compareParams.length, params.length, 'mm'),
      metricFromNumber('底板总宽', compareParams.width, params.width, 'mm'),
      metricFromNumber('底板厚度', compareParams.h, params.h, 'mm'),
      metricFromText('底部横向筋', compareParams.bottomBar, params.bottomBar),
      metricFromText('底部分布筋', compareParams.distBar, params.distBar),
      metricFromText('顶部横向筋', compareParams.topBar || '无', params.topBar || '无'),
      metricFromText('顶部分布筋', compareParams.topDistBar || '无', params.topDistBar || '无'),
      metricFromText('JL 底筋', compareParams.jlBottom || '无', params.jlBottom || '无'),
      metricFromText('JL 顶筋', compareParams.jlTop || '无', params.jlTop || '无'),
      metricFromText('JL 箍筋', compareParams.jlStirrup || '无', params.jlStirrup || '无'),
      metricFromText('JCL', compareParams.hasJcl ? '有' : '无', params.hasJcl ? '有' : '无'),
      metricFromText('原位修正', compareParams.hasLocalOverride ? '有' : '无', params.hasLocalOverride ? '有' : '无'),
      metricFromNumber('支承道数', compareParams.supportCount, params.supportCount),
      metricFromNumber('支承中心距', compareParams.supportSpacing || 0, params.supportSpacing || 0, 'mm'),
      metricFromNumber('钢筋总用量', Number(calcStripFoundation(compareParams).items.reduce((sum, item) => sum + item.weightKg, 0).toFixed(1)), Number(calcResult.items.reduce((sum, item) => sum + item.weightKg, 0).toFixed(1)), 'kg'),
      metricFromNumber('混凝土总量', Number(calcStripFoundationConcrete(compareParams).totalVolume.toFixed(3)), Number(concreteResult.totalVolume.toFixed(3)), 'm³'),
    ].filter((item): item is NonNullable<typeof item> => Boolean(item));
  }, [compareParams, params, calcResult.items, concreteResult.totalVolume]);

  return (
    <main className="px-4 py-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="space-y-4 lg:col-span-3 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto lg:scrollbar-thin">
          <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-primary">参数输入</h2>
              <div className="flex items-center gap-2">
                <ResetButton onClick={() => setParams(DEFAULT)} />
                <ShareButton params={params} />
              </div>
            </div>

            <div className="mb-4">
              <label className="mb-2 block text-xs text-muted">快速示例</label>
              <div className="flex flex-wrap gap-1.5">
                {presetList.map(({ key, label, dot }) => (
                  <button
                    key={key}
                    onClick={() => applyPreset(key)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-600 transition-all hover:border-gray-300 hover:bg-white hover:shadow-sm cursor-pointer active:scale-95"
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <Field label="条基编号" value={params.id} onChange={v => update({ id: v })} />
              <SelectField
                label="条基类型"
                value={params.stripKind}
                onChange={v => update({ stripKind: v as StripFoundationParams['stripKind'] })}
                options={[
                  { value: 'beamPlate', label: '梁板式条基' },
                  { value: 'slab', label: '板式条基' },
                ]}
              />
              <NumField label="条基长度 l (mm)" value={params.length} onChange={v => update({ length: v })} min={3000} max={30000} />
              <NumField label="底板总宽 b (mm)" value={params.width} onChange={v => update({ width: v })} min={600} max={4000} />
              <NumField label="底板厚 h (mm)" value={params.h} onChange={v => update({ h: v })} min={200} max={1200} />
            </div>

            <Section title="底板配筋" defaultOpen>
              <Field label="底部横向受力筋 B" value={params.bottomBar} onChange={v => update({ bottomBar: v })} placeholder="如: C14@150" />
              <Field label="底部分布筋" value={params.distBar} onChange={v => update({ distBar: v })} placeholder="如: A8@250" />
            </Section>

            <Section title="支承条件" defaultOpen>
              <SelectField
                label="上部支承"
                value={params.supportType}
                onChange={v => update({ supportType: v as StripFoundationParams['supportType'] })}
                options={[
                  { value: 'beam', label: '基础梁' },
                  { value: 'wall', label: '墙' },
                ]}
              />
              <SelectField
                label="支承道数"
                value={String(params.supportCount)}
                onChange={v => update({ supportCount: Number(v) as 1 | 2 })}
                options={[
                  { value: '1', label: '单道' },
                  { value: '2', label: '双道' },
                ]}
              />
              <NumField label="支承宽度 bw / 墙厚 (mm)" value={params.supportWidth} onChange={v => update({ supportWidth: v })} min={150} max={1200} />
              <NumField label="支承高度 hw (mm)" value={params.supportHeight} onChange={v => update({ supportHeight: v })} min={0} max={1500} />
              {params.supportCount === 2 && (
                <NumField label="双梁(墙)中心距 s (mm)" value={params.supportSpacing || 1200} onChange={v => update({ supportSpacing: v })} min={400} max={3000} />
              )}
            </Section>

            {params.supportType === 'beam' && (
              <Section title="JL 主梁细部筋" defaultOpen>
                <Field label="JL 底部纵筋" value={params.jlBottom || ''} onChange={v => update({ jlBottom: v || undefined })} placeholder="如: 4C22" />
                <Field label="JL 顶部纵筋" value={params.jlTop || ''} onChange={v => update({ jlTop: v || undefined })} placeholder="如: 4C20" />
                <Field label="JL 箍筋" value={params.jlStirrup || ''} onChange={v => update({ jlStirrup: v || undefined })} placeholder="如: A10@150(4)" />
              </Section>
            )}

            {params.supportType === 'beam' && (
              <Section title="JCL 次梁">
                <SelectField
                  label="是否设置 JCL"
                  value={params.hasJcl ? 'yes' : 'no'}
                  onChange={v => update({ hasJcl: v === 'yes' })}
                  options={[
                    { value: 'no', label: '否' },
                    { value: 'yes', label: '是' },
                  ]}
                />
                {params.hasJcl && (
                  <>
                    <NumField label="JCL 道数" value={params.jclCount || 1} onChange={v => update({ jclCount: v })} min={1} max={6} />
                    <NumField label="JCL 中心距 (mm)" value={params.jclSpacing || 6000} onChange={v => update({ jclSpacing: v })} min={800} max={12000} />
                    <NumField label="JCL 宽度 b (mm)" value={params.jclB || 350} onChange={v => update({ jclB: v })} min={200} max={1200} />
                    <NumField label="JCL 高度 h (mm)" value={params.jclH || 650} onChange={v => update({ jclH: v })} min={300} max={1500} />
                    <Field label="JCL 底部纵筋" value={params.jclBottom || ''} onChange={v => update({ jclBottom: v || undefined })} placeholder="如: 4C18" />
                    <Field label="JCL 顶部纵筋" value={params.jclTop || ''} onChange={v => update({ jclTop: v || undefined })} placeholder="如: 4C16" />
                    <Field label="JCL 箍筋" value={params.jclStirrup || ''} onChange={v => update({ jclStirrup: v || undefined })} placeholder="如: A8@200(2)" />
                  </>
                )}
              </Section>
            )}

            {params.supportCount === 2 && (
              <Section title="顶部钢筋">
                <Field label="顶部横向受力筋 T" value={params.topBar || ''} onChange={v => update({ topBar: v || undefined })} placeholder="如: C14@150" />
                <Field label="顶部分布筋" value={params.topDistBar || ''} onChange={v => update({ topDistBar: v || undefined })} placeholder="如: A8@250" />
              </Section>
            )}

            <Section title="原位修正">
              <SelectField
                label="是否设置原位修正段"
                value={params.hasLocalOverride ? 'yes' : 'no'}
                onChange={v => update({ hasLocalOverride: v === 'yes' })}
                options={[
                  { value: 'no', label: '否' },
                  { value: 'yes', label: '是' },
                ]}
              />
              {params.hasLocalOverride && (
                <>
                  <NumField label="修正段起点 (mm)" value={params.localOverrideStart || 0} onChange={v => update({ localOverrideStart: v })} min={0} max={params.length} />
                  <NumField label="修正段长度 (mm)" value={params.localOverrideLength || 1200} onChange={v => update({ localOverrideLength: v })} min={200} max={params.length} />
                  <Field label="修正底筋" value={params.localBottomBar || ''} onChange={v => update({ localBottomBar: v || undefined })} placeholder="如: C18@150" />
                  <Field label="修正顶筋" value={params.localTopBar || ''} onChange={v => update({ localTopBar: v || undefined })} placeholder="如: C16@150" />
                  <Field label="修正说明" value={params.localOverrideNote || ''} onChange={v => update({ localOverrideNote: v || undefined })} placeholder="如: 跨中原位修正段" />
                </>
              )}
            </Section>

            <Section title="材料">
              <SelectField
                label="混凝土等级"
                value={params.concreteGrade}
                onChange={v => update({ concreteGrade: v as ConcreteGrade })}
                options={CONCRETE_GRADES.map(g => ({ value: g, label: g }))}
              />
              <NumField label="保护层 (mm)" value={params.cover} onChange={v => update({ cover: v })} min={35} max={70} />
            </Section>
          </div>

          <Legend items={[
            { color: '#C0392B', label: '底部横向受力筋' },
            { color: '#2980B9', label: '底部分布筋' },
            { color: '#E67E22', label: '顶部横向受力筋' },
            { color: '#27AE60', label: '顶部分布筋' },
            { color: '#AAB4C3', label: params.supportType === 'beam' ? '基础梁' : '墙' },
            ...(params.supportType === 'beam' ? [
              { color: '#8B4513', label: 'JL底部纵筋' },
              { color: '#C97B36', label: 'JL顶部纵筋' },
              { color: '#2E8B57', label: 'JL箍筋' },
            ] : []),
            ...(params.hasJcl ? [
              { color: '#6B3F2A', label: 'JCL底部纵筋' },
              { color: '#B66A2B', label: 'JCL顶部纵筋' },
              { color: '#3B8F6A', label: 'JCL箍筋' },
            ] : []),
            ...(params.hasLocalOverride ? [
              { color: '#EC4899', label: '原位修正段', opacity: 0.75 },
            ] : []),
            { color: '#D5DBE3', label: '条基底板', opacity: 0.6 },
          ]} />

          <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
            <h3 className="text-sm font-semibold text-primary mb-3">历史记录</h3>
            <HistoryPanel
              history={history}
              favorites={favorites}
              isFavorite={isFavorite(params)}
              onSelect={handleSelectHistory}
              onAddFavorite={() => addToFavorites(params, params.id)}
              onRemoveFavorite={removeFromFavorites}
              onRemoveHistory={removeFromHistory}
              onClearHistory={clearHistory}
            />
          </div>
        </div>

        <div className={`${showAI ? 'lg:col-span-6' : 'lg:col-span-9'} min-w-0 space-y-4 transition-all`}>
          <StripFoundationViewer params={params} />
          <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
            <div className="flex items-center gap-1 border-b border-gray-100 px-3 py-2">
              <div className="flex items-center gap-1 rounded-lg bg-gray-100/80 p-0.5">
                {DATA_TABS.map(t => (
                  <button
                    key={t.key}
                    onClick={() => setDataTab(t.key)}
                    className={`cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition-all flex items-center gap-1.5 ${dataTab === t.key ? 'bg-white text-accent shadow-sm' : 'text-muted hover:text-primary'}`}
                  >
                    {t.label}
                    {t.key === 'compliance' && <ComplianceBadge results={complianceResults} />}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setShowAI(v => !v)}
                className={`ml-auto flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${showAI ? 'bg-gradient-to-r from-blue-500 to-violet-500 text-white shadow-md shadow-blue-500/20' : 'bg-gradient-to-r from-blue-50 to-violet-50 text-violet-600 hover:from-blue-100 hover:to-violet-100'}`}
              >
                <Sparkles className="h-3.5 w-3.5" />
                AI 助手
              </button>
            </div>
            <div className="p-5">
              {dataTab === 'section' && (
                <>
                  <h2 className="mb-3 text-sm font-semibold text-primary">条形基础平面配筋示意（俯视）</h2>
                  <div className="flex justify-center">
                    <StripFoundationCrossSection params={params} />
                  </div>
                </>
              )}
              {dataTab === 'compliance' && <CompliancePanel results={complianceResults} />}
              {dataTab === 'weight' && <WeightCalc result={calcResult} />}
              {dataTab === 'concrete' && <ConcreteCalc result={concreteResult} />}
              {dataTab === 'guide' && <StripFoundationRulePanel params={params} />}
              {dataTab === 'compare' && (
                <div className="space-y-4">
                  {compareParams ? (
                    <MetricComparePanel
                      metrics={compareMetrics}
                      summary={{
                        title: '钢筋用量变化',
                        valueA: calcStripFoundation(compareParams).items.reduce((sum, item) => sum + item.weightKg, 0),
                        valueB: calcResult.items.reduce((sum, item) => sum + item.weightKg, 0),
                        unit: 'kg',
                        labelA: compareLabel,
                        labelB: '当前方案',
                      }}
                      labelA={compareLabel}
                      labelB="当前方案"
                    />
                  ) : (
                    <div className="text-center py-8">
                      <p className="text-sm text-gray-500 mb-3">从历史记录或收藏中选择一个方案进行对比</p>
                      <div className="flex flex-wrap justify-center gap-2">
                        {[...favorites, ...history].slice(0, 6).map(item => (
                          <button
                            key={item.id}
                            onClick={() => handleSelectForCompare(item.id, favorites.some(f => f.id === item.id))}
                            className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs rounded-lg cursor-pointer transition-colors"
                          >
                            {item.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {compareParams && (
                    <button
                      onClick={() => setCompareParams(null)}
                      className="text-xs text-gray-400 hover:text-gray-600 cursor-pointer"
                    >
                      清除对比方案
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {showAI && (
          <div className="lg:col-span-3">
            <AISidebar
              componentType="stripfoundation"
              currentParams={params}
              onApplyParams={(p) => update(p as Partial<StripFoundationParams>)}
              context={aiContext}
              notationSlot={<StripFoundationExplain params={params} />}
              initialMessage={aiMessage}
              onSwitchTab={(tab) => setDataTab(tab as typeof dataTab)}
              onNavigateComponent={(type: ComponentType, message?: string) => {
                const encoded = message ? `?ai=${encodeURIComponent(message)}` : '';
                router.push(`/${type}${encoded}`);
              }}
              onApplyPreset={(preset) => {
                if (preset in STRIPFOUNDATION_PRESETS) applyPreset(preset as keyof typeof STRIPFOUNDATION_PRESETS);
              }}
              onGetCurrentState={() => aiContext}
              onRunComplianceCheck={() => ({
                results: complianceResults,
                summary: `校验完成: ${complianceResults.filter(r => r.status === 'pass').length}项通过, ${complianceResults.filter(r => r.status === 'fail').length}项不通过, ${complianceResults.filter(r => r.status === 'warn').length}项警告`,
              })}
              onSaveFavorite={(name, note) => addToFavorites(params, name, note)}
              onResetParams={() => setParams({ ...STRIPFOUNDATION_PRESETS.singleBeam })}
            />
          </div>
        )}
      </div>
    </main>
  );
}
