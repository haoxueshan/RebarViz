import { SlabResultsDiagram } from "@/components/calculator/SlabDiagrams";
import { countModeLabel } from "@/lib/slab-calculator";
import {
  arrangementLabel,
  buildSlabPrintReport,
  countModeFormulaText,
  printSelectionSummary,
} from "@/lib/slab-calculator-report";
import type {
  SlabPrintOptions,
  StoredCalculationRecord,
} from "@/lib/slab-calculator-storage";
import styles from "./SlabPrintReport.module.css";

export type SlabPrintReportProps = {
  record: StoredCalculationRecord;
  printedAt: string;
  options: SlabPrintOptions;
};

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function escapeCssString(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\A ");
}

function layerLabel(layer: "bottom" | "top"): string {
  return layer === "bottom" ? "地筋" : "面筋";
}

export function SlabPrintReport({
  record,
  printedAt,
  options,
}: SlabPrintReportProps) {
  const model = buildSlabPrintReport(record, options);
  const { slab } = record.inputSnapshot;
  const throughWall = record.calculation.throughWall;
  const visibleResultIds = model.isFullSelection
    ? undefined
    : new Set(model.rows.map((row) => row.resultId));
  const rangeSummary = printSelectionSummary(
    options.rangeMode,
    model.selectedRowCount,
    model.fullRowCount,
  );
  const contentBeforeDiagram =
    options.sections.weightSummary ||
    options.sections.parameters ||
    options.sections.roomDimensions;
  const contentAfterDiagram =
    options.sections.specificationSummary ||
    options.sections.resultDetails ||
    options.sections.calculationNotes;
  const diagramOnly =
    options.sections.diagram && !contentBeforeDiagram && !contentAfterDiagram;
  const footerContent = escapeCssString(
    `RebarViz　打印时间：${formatDateTime(printedAt)}　算法版本：${record.algorithmVersion}\n` +
      "计算结果仅供钢筋工程量估算、下料复核和学习参考，不替代设计图纸、现行规范及工程师审核。当前结果未计施工损耗。",
  );

  return (
    <>
    <style media="print">{`@page {
      @bottom-center {
        content: "${footerContent}";
        width: 267mm;
        padding-top: 1.5mm;
        border-top: 0.75pt solid #777;
        color: #333;
        font: 7pt/1.25 Arial, "Microsoft YaHei", sans-serif;
        text-align: left;
        white-space: pre-wrap;
      }
    }`}</style>
    <article
      className={`${styles.report} ${diagramOnly ? styles.diagramOnlyReport : ""}`}
      aria-label="楼板钢筋计算打印报表"
      data-testid="slab-print-report"
    >
      <header className={styles.reportHeader}>
        <div>
          <p className={styles.brand}>RebarViz</p>
          <h1>楼板钢筋计算结果</h1>
        </div>
        <dl className={styles.reportMeta}>
          <div>
            <dt>计算时间</dt>
            <dd>{formatDateTime(record.calculatedAt)}</dd>
          </div>
          <div>
            <dt>打印时间</dt>
            <dd>{formatDateTime(printedAt)}</dd>
          </div>
          <div>
            <dt>算法版本</dt>
            <dd>{record.algorithmVersion}</dd>
          </div>
          <div>
            <dt>本次打印范围</dt>
            <dd>{rangeSummary}</dd>
          </div>
          <div>
            <dt>选择数量</dt>
            <dd>{model.selectedRowCount}/{model.fullRowCount} 项</dd>
          </div>
        </dl>
      </header>

      {options.sections.weightSummary && (
        <section className={styles.summarySection} aria-label="重量汇总">
          <div className={styles.summaryCard}>
            <span>{model.isFullSelection ? "全部钢筋重量" : "本次打印重量"}</span>
            <strong>{model.selectedTotalWeightKg.toFixed(2)} kg</strong>
          </div>
          <div className={styles.summaryCard}>
            <span>{model.isFullSelection ? "地筋重量" : "所选地筋重量"}</span>
            <strong>{model.selectedBottomWeightKg.toFixed(2)} kg</strong>
          </div>
          <div className={styles.summaryCard}>
            <span>{model.isFullSelection ? "面筋重量" : "所选面筋重量"}</span>
            <strong>{model.selectedTopWeightKg.toFixed(2)} kg</strong>
          </div>
          {!model.isFullSelection && (
            <p className={styles.selectionSummary}>
              已选择{model.selectedRowCount}/{model.fullRowCount}项；完整正式计算结果总重量：{model.fullTotalWeightKg.toFixed(2)} kg
            </p>
          )}
        </section>
      )}

      {options.sections.parameters && (
        <section className={styles.section}>
          <h2>参数快照</h2>
          <dl className={styles.parameterGrid}>
            <div><dt>房间排列</dt><dd>{arrangementLabel(slab.arrangement)}</dd></div>
            <div><dt>房间数量</dt><dd>{slab.rooms.length} 间</dd></div>
            <div><dt>内墙厚度</dt><dd>{slab.innerWallThickness} mm</dd></div>
            <div><dt>外墙厚度</dt><dd>{slab.outerWallThickness} mm</dd></div>
            <div><dt>面筋锚固增加值</dt><dd>{slab.topAnchorExtra} mm</dd></div>
            <div><dt>根数算法</dt><dd>{countModeLabel(slab.countMode)}</dd></div>
            <div><dt>面筋通墙</dt><dd>{throughWall ? `启用（${throughWall.direction.toUpperCase()}向）` : "未启用"}</dd></div>
            <div><dt>通墙方向</dt><dd>{throughWall ? `${throughWall.direction.toUpperCase()}向` : "不适用"}</dd></div>
            <div><dt>通墙净尺寸合计</dt><dd>{throughWall ? `${throughWall.netSpanTotal} mm` : "不适用"}</dd></div>
            <div><dt>中间墙厚度合计</dt><dd>{throughWall ? `${throughWall.intermediateWallTotal} mm` : "不适用"}</dd></div>
          </dl>
        </section>
      )}

      {options.sections.roomDimensions && (
        <section className={styles.section}>
          <h2>房间尺寸表</h2>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>房间名称</th>
                <th>房间 ID</th>
                <th>X向净尺寸</th>
                <th>Y向净尺寸</th>
              </tr>
            </thead>
            <tbody>
              {slab.rooms.map((room) => (
                <tr key={room.id}>
                  <td>{room.name}</td>
                  <td>{room.id}</td>
                  <td>{room.spanX} mm</td>
                  <td>{room.spanY} mm</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {options.sections.diagram && (
        <section
          data-testid="slab-print-diagram-sheet"
          className={`${styles.section} ${styles.diagramSheet} ${
            contentBeforeDiagram ? styles.diagramBreakBefore : ""
          } ${contentAfterDiagram ? styles.diagramBreakAfter : ""}`}
        >
          <div className={styles.diagramHeading}>
            <div>
              <h2>楼板钢筋计算二维示意图</h2>
              <p>{rangeSummary}</p>
            </div>
            <p>≈ 表示锚固视觉长度经过压缩，工程数值以正式结果和下方明细为准。</p>
          </div>
          <div className={styles.diagramCanvas}>
            <SlabResultsDiagram
              state={record.inputSnapshot}
              calculation={record.calculation}
              visibleResultIds={visibleResultIds}
              selectionContext={
                options.rangeMode === "current-filters"
                  ? {
                      kind: "current-filters",
                      selectedCount: model.selectedRowCount,
                      totalCount: model.fullRowCount,
                    }
                  : options.rangeMode === "custom"
                    ? {
                        kind: "custom",
                        selectedCount: model.selectedRowCount,
                        totalCount: model.fullRowCount,
                      }
                    : undefined
              }
              showNote={false}
            />
          </div>
        </section>
      )}

      {options.sections.specificationSummary && (
        <section className={styles.section}>
          <h2>规格汇总</h2>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>层位</th>
                <th>方向</th>
                <th>规格</th>
                <th>总根数</th>
                <th>总长度</th>
                <th>总重量</th>
              </tr>
            </thead>
            <tbody>
              {model.specifications.map((item) => (
                <tr key={item.key}>
                  <td>{layerLabel(item.layer)}</td>
                  <td>{item.direction.toUpperCase()}向</td>
                  <td>Φ{item.diameter}@{item.spacing}</td>
                  <td>{item.totalCount} 根</td>
                  <td>{item.totalLengthM.toFixed(3)} m</td>
                  <td>{item.totalWeightKg.toFixed(2)} kg</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {options.sections.resultDetails && (
        <section className={styles.section}>
          <h2>图中编号与分组钢筋明细</h2>
          <table
            data-testid="slab-print-result-legend"
            className={`${styles.table} ${styles.detailTable} ${options.detailMode === "full" ? styles.fullDetailTable : styles.compactDetailTable}`}
          >
              {options.detailMode === "full" ? (
                <colgroup>
                  <col className={styles.colFigure} />
                  <col className={styles.colScope} />
                  <col className={styles.colType} />
                  <col className={styles.colSpec} />
                  <col className={styles.colCount} />
                  <col className={styles.colRun} />
                  <col className={styles.colAnchor} />
                  <col className={styles.colAnchor} />
                  <col className={styles.colExtra} />
                  <col className={styles.colLength} />
                  <col className={styles.colWeight} />
                </colgroup>
              ) : (
                <colgroup>
                  <col className={styles.colFigure} />
                  <col className={styles.colScope} />
                  <col className={styles.colType} />
                  <col className={styles.colSpec} />
                  <col className={styles.colCount} />
                  <col className={styles.colLength} />
                  <col className={styles.colLength} />
                  <col className={styles.colWeight} />
                </colgroup>
              )}
              <thead>
                <tr>
                  <th>图中编号</th>
                  <th>房间/组合区与分区范围</th>
                  <th>类型与方向</th>
                  <th>规格</th>
                  <th>{options.detailMode === "full" ? "正式根数/图示线" : "根数"}</th>
                  {options.detailMode === "full" && <th>净跨</th>}
                  {options.detailMode === "full" && <th>起点锚固</th>}
                  {options.detailMode === "full" && <th>终点锚固</th>}
                  {options.detailMode === "full" && <th>面筋增加位置</th>}
                  <th>{options.detailMode === "full" ? "单根/总长度" : "单根长度"}</th>
                  {options.detailMode === "compact" && <th>总长度</th>}
                  <th>重量</th>
                </tr>
              </thead>
              {model.groups.map((group) => (
                <tbody key={group.scopeId} data-scope-id={group.scopeId}>
                  <tr className={styles.groupRow}>
                    <th colSpan={options.detailMode === "full" ? 11 : 8}>
                      {group.scopeName}　
                      <small>{group.scopeType === "through" ? "通墙组合区" : `房间 ID：${group.roomId}`}</small>
                    </th>
                  </tr>
                  {group.rows.flatMap((row) => {
                    const parentRow = (
                      <tr key={row.resultId} data-result-id={row.resultId}>
                        <td><strong>{row.figureNumber}</strong></td>
                        <td>{row.scopeName}{row.lengthMode === "zoned" && <small>多长度，共{row.variantRows.length}个分区</small>}</td>
                        <td>{row.typeDirectionText}</td>
                        <td>Φ{row.diameter}@{row.spacing}</td>
                        <td>{row.count} 根{options.detailMode === "full" && <small>图示 {row.representativeCount} 条</small>}</td>
                        {options.detailMode === "full" && <td>{row.netRunSpanMm.toFixed(0)} mm</td>}
                        {options.detailMode === "full" && <td>{row.lengthMode === "zoned" ? "见分区行" : row.startAnchorText}</td>}
                        {options.detailMode === "full" && <td>{row.lengthMode === "zoned" ? "见分区行" : row.endAnchorText}</td>}
                        {options.detailMode === "full" && <td>{row.lengthMode === "zoned" ? "按分区实际端" : row.extraModeText}</td>}
                        <td>{row.lengthMode === "zoned" ? <><strong>多长度</strong><small>加权平均 {row.singleLengthM.toFixed(3)} m</small><small>总长 {row.totalLengthM.toFixed(3)} m</small></> : <>{row.singleLengthM.toFixed(3)} m{options.detailMode === "full" && <small>总长 {row.totalLengthM.toFixed(3)} m</small>}</>}</td>
                        {options.detailMode === "compact" && <td>{row.totalLengthM.toFixed(3)} m</td>}
                        <td>{row.weightKg.toFixed(2)} kg</td>
                      </tr>
                    );
                    if (row.lengthMode !== "zoned") return [parentRow];
                    return [
                      parentRow,
                      ...row.variantRows.map((variant) => (
                        <tr
                          key={variant.variantId}
                          data-result-id={row.resultId}
                          data-variant-id={variant.variantId}
                          className={styles.variantRow}
                        >
                          <td>{variant.figureNumber}</td>
                          <td>分区 {variant.rangeText}</td>
                          <td>分区长度</td>
                          <td>同父项</td>
                          <td>{variant.count} 根{options.detailMode === "full" && <small>图示 {variant.representativeCount} 条</small>}</td>
                          {options.detailMode === "full" && <td>{row.netRunSpanMm.toFixed(0)} mm</td>}
                          {options.detailMode === "full" && <td>{variant.startAnchorText}</td>}
                          {options.detailMode === "full" && <td>{variant.endAnchorText}</td>}
                          {options.detailMode === "full" && <td>{variant.extraModeText}</td>}
                          <td>{variant.singleLengthM.toFixed(3)} m{options.detailMode === "full" && <small>总长 {variant.totalLengthM.toFixed(3)} m</small>}</td>
                          {options.detailMode === "compact" && <td>{variant.totalLengthM.toFixed(3)} m</td>}
                          <td>{variant.weightKg.toFixed(2)} kg</td>
                        </tr>
                      )),
                    ];
                  })}
                  <tr className={styles.subtotalRow}>
                    <td colSpan={options.detailMode === "full" ? 10 : 7}>本组重量小计（仅父级正式结果汇总）</td>
                    <td>{group.subtotalWeightKg.toFixed(2)} kg</td>
                  </tr>
                </tbody>
              ))}
          </table>
        </section>
      )}

      {options.sections.calculationNotes && (
        <section className={`${styles.section} ${styles.notes}`}>
          <h2>计算说明</h2>
          <ul>
            <li>当前根数算法：{countModeLabel(slab.countMode)}；公式：{countModeFormulaText(slab.countMode)}。</li>
            <li>X向单根长度由X向净尺寸与西、东两端锚固组成；Y向由Y向净尺寸与南、北两端锚固组成。</li>
            <li>中间墙厚度只计入通墙方向钢筋的单根长度，不计入任何钢筋根数。</li>
            <li>手动锚固值为最终值；面筋增加值只作用于启用增加的自动内墙或外墙锚固端。</li>
            <li>理论单位重量公式：π × 直径² × 7850 ÷ 4 ÷ 1,000,000（kg/m）。</li>
          </ul>
        </section>
      )}

    </article>
    </>
  );
}
