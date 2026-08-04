import { SlabResultsDiagram } from "@/components/calculator/SlabDiagrams";
import { countModeLabel } from "@/lib/slab-calculator";
import {
  arrangementLabel,
  buildSlabPrintReport,
  countModeFormulaText,
  printRangeLabel,
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
  const visibleResultIds = new Set(model.rows.map((row) => row.resultId));

  return (
    <article className={styles.report} aria-label="楼板钢筋计算打印报表">
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
            <dd>{printRangeLabel(options.rangeMode)}</dd>
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
        <section className={`${styles.section} ${styles.diagramSection}`}>
          <h2>钢筋示意图</h2>
          <SlabResultsDiagram
            state={record.inputSnapshot}
            calculation={record.calculation}
            visibleResultIds={visibleResultIds}
            showNote={false}
          />
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
          <h2>分组钢筋明细</h2>
          {model.groups.map((group) => (
            <section className={styles.resultGroup} key={group.scopeId}>
              <div className={styles.groupHeading}>
                <h3>{group.scopeName}</h3>
                <span>{group.scopeType === "through" ? "通墙组合区" : `房间 ID：${group.roomId}`}</span>
              </div>
              <table className={`${styles.table} ${styles.detailTable} ${options.detailMode === "full" ? styles.fullDetailTable : styles.compactDetailTable}`}>
              {options.detailMode === "full" ? (
                <colgroup>
                  <col className={styles.colSequence} />
                  <col className={styles.colScope} />
                  <col className={styles.colType} />
                  <col className={styles.colSpec} />
                  <col className={styles.colCount} />
                  <col className={styles.colLength} />
                  <col className={styles.colLength} />
                  <col className={styles.colAnchor} />
                  <col className={styles.colAnchor} />
                  <col className={styles.colExtra} />
                  <col className={styles.colWeight} />
                </colgroup>
              ) : (
                <colgroup>
                  <col className={styles.colSequence} />
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
                  <th>序号</th>
                  <th>房间/组合区</th>
                  <th>类型与方向</th>
                  <th>规格</th>
                  <th>根数</th>
                  <th>单根长度</th>
                  <th>总长度</th>
                  {options.detailMode === "full" && <th>起点锚固</th>}
                  {options.detailMode === "full" && <th>终点锚固</th>}
                  {options.detailMode === "full" && <th>面筋增加位置</th>}
                  <th>重量</th>
                </tr>
              </thead>
              <tbody>
                {group.rows.map((row) => (
                  <tr key={row.resultId}>
                    <td>{row.sequence}</td>
                    <td>{row.scopeName}</td>
                    <td>{row.typeDirectionText}</td>
                    <td>Φ{row.diameter}@{row.spacing}</td>
                    <td>{row.count} 根</td>
                    <td>{row.singleLengthM.toFixed(3)} m</td>
                    <td>{row.totalLengthM.toFixed(3)} m</td>
                    {options.detailMode === "full" && <td>{row.startAnchorText}</td>}
                    {options.detailMode === "full" && <td>{row.endAnchorText}</td>}
                    {options.detailMode === "full" && <td>{row.extraModeText}</td>}
                    <td>{row.weightKg.toFixed(2)} kg</td>
                  </tr>
                ))}
                <tr className={styles.subtotalRow}>
                  <td colSpan={options.detailMode === "full" ? 10 : 7}>本组重量小计</td>
                  <td>{group.subtotalWeightKg.toFixed(2)} kg</td>
                </tr>
              </tbody>
              </table>
            </section>
          ))}
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

      <footer className={styles.footer}>
        <p>本报表由 RebarViz 自动生成。</p>
        <p>计算结果仅供钢筋工程量估算、下料复核和学习参考，不替代设计图纸、现行规范及工程师审核。当前结果未计施工损耗。</p>
        <p>打印时间：{formatDateTime(printedAt)}　算法版本：{record.algorithmVersion}　<span className={styles.pageNumber} /></p>
      </footer>
    </article>
  );
}
