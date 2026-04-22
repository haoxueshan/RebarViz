import type { ComponentType } from './types';

export type FoundationFamilyComponent = 'foundation' | 'stripfoundation' | 'pilecap' | 'raft';

export interface FoundationKnowledgeItem {
  title: string;
  page: string;
  note: string;
}

export interface FoundationKnowledgeNote {
  text: string;
  page: string;
}

export interface FoundationKnowledgeDoc {
  title: string;
  intro: string;
  pageIndex: FoundationKnowledgeItem[];
  notationGuides?: FoundationKnowledgeNote[];
  drawingChecklist?: FoundationKnowledgeNote[];
  relatedDetails?: FoundationKnowledgeItem[];
  keyRules: string[];
  mustSpecify: FoundationKnowledgeNote[];
  defaultsWhenOmitted?: FoundationKnowledgeNote[];
}

export const FOUNDATION_KNOWLEDGE: Record<FoundationFamilyComponent, FoundationKnowledgeDoc> = {
  foundation: {
    title: '独立基础',
    intro: '覆盖独立基础平法注写、双柱普通独立基础、杯口/短柱扩展和底板配筋减短构造。',
    pageIndex: [
      {
        title: '独立基础平法施工图规则',
        page: '1-3~1-14',
        note: '独立基础可采用平面、截面、列表三种表达方式；平面注写由集中标注和原位标注组成。',
      },
      {
        title: '独立基础平面注写示例',
        page: '1-15',
        note: '可对照 DJj、DJz、BJj、BJz 的平法编号、平面尺寸和标注习惯。',
      },
      {
        title: '柱纵向钢筋在基础中构造',
        page: '2-10',
        note: '用于判断柱插筋直锚/弯锚、锚固区横向钢筋和仅角筋伸入底板网片的做法。',
      },
      {
        title: '普通独立基础底板配筋构造',
        page: '2-11',
        note: '适用于单柱普通独立基础的底板双向配筋和柱边锚固。',
      },
      {
        title: '双柱普通独立基础底部与顶部配筋',
        page: '2-12',
        note: '柱间顶部受力筋、分布筋和双柱基础底板配筋的主要依据。',
      },
      {
        title: '设置基础梁的双柱普通独立基础',
        page: '2-13',
        note: '双柱基础与基础梁组合时，应结合该页明确梁和顶面钢筋的关系。',
      },
      {
        title: '独立基础底板配筋长度减短 10%',
        page: '2-14',
        note: '大尺寸基础可采用隔一布一减短布置，图纸应明确是否采用该做法。',
      },
      {
        title: '杯口、高杯口与短柱构造',
        page: '2-15~2-19',
        note: '包含杯口基础、双杯口、高杯口以及带短柱独立基础的扩展构造。',
      },
    ],
    notationGuides: [
      {
        text: '平面注写由集中标注和原位标注组成；集中标注必注编号、截面竖向尺寸、配筋，选注底面标高和必要文字说明。',
        page: '1-3~1-10',
      },
      {
        text: '独立基础可采用平面注写、截面注写、列表注写三种表达方式，同一工程可按图面复杂度组合使用。',
        page: '1-2、1-12~1-14',
      },
      {
        text: '双柱独立基础的顶部钢筋、基础梁和底板配筋可结合条形基础相关注写规则表达；四柱双梁基础可注明梁间受力筋/分布筋。',
        page: '1-11~1-12',
      },
    ],
    drawingChecklist: [
      {
        text: '施工图应注明所采用的平法图集号（如 22G101-3），避免版本混用。',
        page: '1-2',
      },
      {
        text: '应注明混凝土强度等级和钢筋种类；若采用机械锚固，应同时指定机械锚固形式。',
        page: '1-2',
      },
      {
        text: '应注明基础各部位环境类别及保护层厚度，并用表格或其他方式注明基础底面基准标高、±0.000 绝对标高。',
        page: '1-1~1-2',
      },
      {
        text: '设置后浇带时，应写明位置、封闭时间、后浇混凝土强度等级及其他特殊要求；采用防水混凝土时，应注明抗渗等级。',
        page: '1-2',
      },
    ],
    relatedDetails: [
      {
        title: '基础联系梁 JLL 与搁置在基础上的非框架梁',
        page: '2-49',
        note: '当独立基础与基础联系梁、非框架梁联合出现时，应转入该页核对梁配筋和节点衔接。',
      },
      {
        title: '后浇带 HJD、抗水压垫层与超前止水、基坑 JK',
        page: '2-50~2-51',
        note: '地下室或大体积基础常与后浇带、防水及基坑构造联动，不能只看基础本体配筋。',
      },
      {
        title: '上柱墩 SZD、防水底板 FSB 与各类基础连接',
        page: '2-52~2-54',
        note: '涉及柱墩、筏板局部加厚或防水底板连接时，应结合这些共用构造页一起判断。',
      },
    ],
    keyRules: [
      '编号采用 DJj、DJz、BJj、BJz；锥形基础坡度应有利于混凝土浇筑和振捣密实。',
      '平面注写的集中标注至少应写明编号、竖向尺寸和配筋；底面标高、减短方式等属于选注内容。',
      '双柱独立基础除底筋外，常需要同时交代柱间顶部受力筋、分布筋或基础梁信息。',
      '列表注写时可按工程需要增加顶部配筋、基础梁、短柱或基础底面标高等栏目。',
    ],
    mustSpecify: [
      {
        text: '若仅将柱四角纵筋伸至底板钢筋网片上，设计应明确写明该构造做法。',
        page: '2-10、2-61',
      },
      {
        text: '若采用底板配筋长度减短 10% 构造，应在图中或文字注解中注明。',
        page: '2-14',
      },
      {
        text: '双柱基础若设置顶部柱间钢筋或基础梁，应在表注、列表或文字注解中明确。',
        page: '2-12、2-13',
      },
    ],
  },
  pilecap: {
    title: '桩基承台',
    intro: '覆盖矩形承台、三桩承台、六边形承台、双柱联合承台、承台梁以及灌注桩桩顶连接构造。',
    pageIndex: [
      {
        title: '矩形承台 CTj / CTz',
        page: '2-38',
        note: '矩形承台底筋布置、柱插筋和承台平面尺寸可优先参照此页。',
      },
      {
        title: '等边三桩与等腰三桩承台',
        page: '2-39~2-40',
        note: '三桩承台的底筋走向、受力筋端部直段和弯折构造见此范围。',
      },
      {
        title: '六边形承台',
        page: '2-41',
        note: '多边形承台的钢筋布置和构造转换可由该页对照理解。',
      },
      {
        title: '双柱联合承台',
        page: '2-43',
        note: '双柱情形需要同时考虑底部与顶部配筋的配置关系。',
      },
      {
        title: '墙下单排 / 双排桩承台梁 CTL',
        page: '2-44~2-45',
        note: '承台梁与墙下桩基组合时，应按 CTL 单独处理，不宜套用普通承台。',
      },
      {
        title: '灌注桩配筋与螺旋箍',
        page: '2-46~2-47',
        note: '包括通长等截面、变截面配筋和螺旋箍、加劲箍构造。',
      },
      {
        title: '钢筋混凝土灌注桩桩顶与承台连接',
        page: '2-48',
        note: '用于确认桩顶进入承台高度和桩头连接做法。',
      },
    ],
    notationGuides: [
      {
        text: '桩基础平法施工图规则与平面注写示例集中在第 1-38~1-45 页，可用于对照承台编号、桩位布置、平面尺寸和构造表达。',
        page: '1-38~1-45',
      },
      {
        text: '基础相关共用构造另列于第 1-47 页及第 2-49~2-54 页，承台与基础联系梁、后浇带、防水底板联动时应一并核对。',
        page: '1-47、2-49~2-54',
      },
    ],
    drawingChecklist: [
      {
        text: '施工图应注明所采用的平法图集号，以及承台所用混凝土强度等级、钢筋种类和必要的机械锚固形式。',
        page: '1-2',
      },
      {
        text: '应注明环境类别、承台保护层、基础底面基准标高和 ±0.000 绝对标高。',
        page: '1-1~1-2',
      },
      {
        text: '地下工程涉及后浇带、防水混凝土或特殊抗渗要求时，应在施工图中单独写明。',
        page: '1-2',
      },
    ],
    relatedDetails: [
      {
        title: '墙下单排 / 双排桩承台梁 CTL',
        page: '2-44~2-45',
        note: '墙下桩基础不宜套用普通承台底板做法，应切换到 CTL 专用构造。',
      },
      {
        title: '灌注桩 GZH 配筋与螺旋箍、加劲箍',
        page: '2-46~2-47',
        note: '承台与灌注桩配合时，桩身通长筋、螺旋箍和加劲箍的默认做法要一起确认。',
      },
      {
        title: '桩顶与承台连接、上柱墩 SZD、防水底板 FSB',
        page: '2-48、2-52~2-54',
        note: '桩顶嵌入承台、上柱墩和防水底板连接均属于承台常见的跨页联动节点。',
      },
    ],
    keyRules: [
      '承台底筋在桩处的直段不足 35d+0.1D 时应弯折，但至少仍应满足 25d+0.1D 的最小直段要求（圆桩）。',
      '桩顶进入承台高度按桩径或边长小于 800 取 50mm，大于等于 800 取 100mm。',
      '双柱联合承台需要区分底部与顶部配筋，不能仅沿用单柱承台的底筋配置。',
      '墙下桩承台梁应按 CTL 详图单独处理，避免和普通承台底板配筋逻辑混淆。',
    ],
    mustSpecify: [
      {
        text: '若采用双柱联合承台，应明确顶部钢筋配置和柱间受力做法。',
        page: '2-43',
      },
      {
        text: '当墙下采用桩承台梁时，应明确选用单排桩或双排桩 CTL 构造。',
        page: '2-44、2-45',
      },
    ],
    defaultsWhenOmitted: [
      {
        text: '灌注桩焊接加劲箍未注明时，直径取 12mm，强度等级不低于 HRB400。',
        page: '2-46、2-47、2-61',
      },
    ],
  },
  stripfoundation: {
    title: '条形基础',
    intro: '覆盖条形基础底板 TJBj / TJBp 的平法注写，以及与 JL / JCL 相关的梁板式条基构造。',
    pageIndex: [
      {
        title: '条形基础平法施工图规则',
        page: '1-16~1-22',
        note: '条形基础可采用平面注写和列表注写；当底面标高变化或梁/墙中心线与轴线不重合时，应明确定位与标高。',
      },
      {
        title: '条形基础平面注写示例',
        page: '1-23',
        note: '用于对照梁板式、板式、双梁或双墙共用底板时的图面表达。',
      },
      {
        title: '条形基础底板配筋构造',
        page: '2-20~2-22',
        note: '底板底部配筋、顶部配筋、底板不平及配筋长度减短等做法集中在这里。',
      },
      {
        title: '基础梁 JL 与基础次梁 JCL 构造',
        page: '2-23~2-31',
        note: '梁板式条基常会与 JL / JCL 联动，应一起核对端部、外伸、变截面和连接区构造。',
      },
    ],
    notationGuides: [
      {
        text: '条形基础平面注写以集中标注和原位修正为主；底板配筋通常以 B: 横向受力筋 / 纵向分布筋 表示，双梁或双墙时可增加 T: 顶部配筋。',
        page: '1-18~1-20',
      },
      {
        text: '当集中标注不适用于某跨或某外伸部位时，可将修正内容原位标注在该跨或外伸段，施工时原位标注优先。',
        page: '1-20',
      },
      {
        text: '双梁或双墙共用底板时，两支承之间顶部钢筋和锚固做法应单独表达，不能只看底板底筋。',
        page: '1-19~1-20、2-20~2-22',
      },
    ],
    drawingChecklist: [
      {
        text: '应注明所采用的图集版本、混凝土强度等级、钢筋种类、环境类别、保护层厚度和基础底面基准标高。',
        page: '1-1~1-2',
      },
      {
        text: '当梁板式条基的梁中心或板式条基板中心与建筑定位轴线不重合时，应标明定位尺寸。',
        page: '1-16',
      },
      {
        text: '基础底面标高变化范围、后浇带、防水混凝土和抗渗等级等特殊要求应在图中写明。',
        page: '1-2、1-16',
      },
    ],
    relatedDetails: [
      {
        title: '基础梁 JL 端部、外伸、连接区和变截面',
        page: '2-23~2-28',
        note: '梁板式条形基础中的基础梁与独立基础、筏板的 JL 规则共通，但仍需按条基页码核对。',
      },
      {
        title: '基础次梁 JCL 构造',
        page: '2-29~2-31',
        note: '当条基内设置次梁时，应转入 JCL 页，单独判断次梁端部、外伸和两种箍筋做法。',
      },
    ],
    keyRules: [
      '条形基础整体可分为梁板式和板式两类，识图前应先分清条基底板与基础梁是不是组合出现。',
      '底板配筋通常区分底部 B 和顶部 T；双梁或双墙条基顶部钢筋一般只布置在两梁(墙)之间的受拉区。',
      '集中标注是全段默认值，某跨或某外伸段不同时，应以原位标注修正且原位优先。',
      '条形基础常与 JL / JCL 梁构造联动，端部锚固、外伸、交叉纵筋上下关系不宜脱开条基单独理解。',
    ],
    mustSpecify: [
      {
        text: '基础梁相交处位于同一层面的交叉纵筋上下关系应写明。',
        page: '2-23、2-61',
      },
      {
        text: '当基础梁、基础次梁底部纵筋多于两排时，从第三排起非贯通纵筋伸入跨内的长度值应写明。',
        page: '2-23、2-29、2-61',
      },
      {
        text: '双梁或双墙条基两支承之间顶部钢筋及其锚固做法应在图中明确。',
        page: '1-19~1-20、2-20~2-22',
      },
    ],
    defaultsWhenOmitted: [
      {
        text: '基础梁、基础次梁外伸部位箍筋未写明时，按梁端第一种箍筋设置。',
        page: '2-25、2-29、2-61',
      },
    ],
  },
  raft: {
    title: '筏形基础',
    intro: '覆盖梁板式筏基 JL / JCL / LPB，以及平板式筏基 ZXB / KZB / BPB 和局部加厚 JBH 构造。',
    pageIndex: [
      {
        title: '梁板式筏形基础施工图规则',
        page: '1-24~1-31',
        note: '先区分基础主梁 JL、基础次梁 JCL 和梁间平板 LPB 的标注与注写习惯。',
      },
      {
        title: 'LPB 标注图示与平板式规则入口',
        page: '1-31~1-32',
        note: '梁板式过渡到平板式时，可用此处衔接 LPB、ZXB、KZB、BPB 的图面表达。',
      },
      {
        title: '平板式筏形基础规则与图示',
        page: '1-32~1-37',
        note: '包含平板式施工图制图规则、柱下板带 ZXB、跨中板带 KZB 与平板 BPB 的注写。',
      },
      {
        title: 'JL / JCL 构造',
        page: '2-24~2-31',
        note: '涵盖梁端与外伸锚固、侧面构造纵筋、拉筋、变截面和加腋等内容。',
      },
      {
        title: 'LPB 构造与端部 / 变截面',
        page: '2-32~2-33',
        note: '梁板式筏基平板 LPB 的钢筋构造、边支座锚固和外伸部位做法以此为准。',
      },
      {
        title: 'ZXB / KZB 构造',
        page: '2-34',
        note: '平板式筏基柱下板带与跨中板带的纵向钢筋关系在该页统一处理。',
      },
      {
        title: 'BPB 构造',
        page: '2-35',
        note: '平板式筏基普通平板 BPB 的底筋、面筋和同层交叉筋关系可查此页。',
      },
      {
        title: '平板式端部、外伸与变截面',
        page: '2-36~2-37',
        note: '用于判断 ZXB、KZB、BPB 的边缘锚固、侧面封边和变截面配筋。',
      },
      {
        title: '柱下筏板局部增加板厚 JBH',
        page: '2-53',
        note: '柱下局部加厚时，应与柱插筋和板带受力范围一并核对。',
      },
    ],
    notationGuides: [
      {
        text: '筏板施工图先区分梁板式与平板式，再分别识别 JL、JCL、LPB 或 ZXB、KZB、BPB 的注写与构造。',
        page: '1-24~1-37',
      },
      {
        text: '梁板式筏板重点看基础主梁/次梁标注、梁间平板 LPB 及其端部、外伸和变截面做法。',
        page: '1-24~1-31、2-24~2-33',
      },
      {
        text: '平板式筏板重点看柱下板带 ZXB、跨中板带 KZB 与普通平板 BPB 的分区、交叉钢筋上下关系和边缘构造。',
        page: '1-32~1-37、2-34~2-37',
      },
    ],
    drawingChecklist: [
      {
        text: '施工图应注明所采用的平法图集号、混凝土强度等级、钢筋种类及必要的机械锚固形式。',
        page: '1-2',
      },
      {
        text: '应注明环境类别、保护层厚度、基础底面基准标高和 ±0.000 绝对标高；地下室筏板通常还要联动后浇带和防水要求。',
        page: '1-1~1-2',
      },
      {
        text: '设置后浇带或采用防水混凝土时，应明确位置、封闭时间、后浇混凝土等级和抗渗要求。',
        page: '1-2',
      },
    ],
    relatedDetails: [
      {
        title: '基础联系梁 JLL、后浇带 HJD 与抗水压垫层',
        page: '2-49~2-51',
        note: '大面积地下室筏板经常与后浇带、防水节点同时出现，应整体核对。',
      },
      {
        title: '柱下筏板局部增加板厚 JBH',
        page: '2-53',
        note: '局部加厚不只是几何变化，还会影响柱插筋锚固和板带钢筋范围判断。',
      },
      {
        title: '防水底板 FSB 与各类基础连接',
        page: '2-54',
        note: '当筏板兼作防水底板或与防水底板衔接时，应按该页补足连接构造。',
      },
    ],
    keyRules: [
      '筏板必须先区分梁板式和平板式，再分别识别 JL、JCL、LPB、ZXB、KZB、BPB 的配筋位置和注写规则。',
      'JL / JCL 的连接区、端部外伸锚固和变截面构造要按对应详图分别判断，不能直接套用一般梁规则。',
      '平板式筏板同层交叉纵筋的上下关系、边支座锚固和封边做法要结合 2-32~2-37 统一处理。',
      '柱下局部加厚、仅角筋伸至底板网片等做法，应与柱插筋锚固构造一起综合判断。',
    ],
    mustSpecify: [
      {
        text: '筏形基础平板底部钢筋在边支座的锚固要求必须写明。',
        page: '2-33、2-37、2-61',
      },
      {
        text: '基础平板同一层面交叉纵筋的上下关系必须写明。',
        page: '2-32、2-33、2-34、2-35、2-61',
      },
      {
        text: '若仅将柱四角纵筋伸至底板钢筋网片上，应明确说明该做法。',
        page: '2-10、2-61',
      },
      {
        text: '当基础梁、基础次梁底部纵筋多于两排时，从第三排起非贯通纵筋伸入跨内的长度值应写明。',
        page: '2-23、2-29、2-61',
      },
    ],
    defaultsWhenOmitted: [
      {
        text: '筏板边缘侧面封边构造未写明时，可由施工单位选做。',
        page: '2-37、2-61',
      },
      {
        text: '基础梁、基础次梁外伸部位箍筋未写明时，按梁端第一种箍筋设置。',
        page: '2-25、2-29、2-61',
      },
    ],
  },
};

export function getFoundationKnowledge(componentType: ComponentType): FoundationKnowledgeDoc | null {
  if (componentType !== 'foundation' && componentType !== 'stripfoundation' && componentType !== 'pilecap' && componentType !== 'raft') {
    return null;
  }
  return FOUNDATION_KNOWLEDGE[componentType];
}

export function buildFoundationKnowledgePrompt(componentType: ComponentType): string {
  const knowledge = getFoundationKnowledge(componentType);
  if (!knowledge) return '';

  const pageLines = knowledge.pageIndex
    .map(item => `- ${item.title}：第${item.page}页；${item.note}`)
    .join('\n');

  const ruleLines = knowledge.keyRules
    .map(rule => `- ${rule}`)
    .join('\n');

  const notationLines = knowledge.notationGuides?.length
    ? knowledge.notationGuides.map(item => `- ${item.text}（详见 ${item.page}）`).join('\n')
    : '- 以页码速查和构造要求为主。';

  const checklistLines = knowledge.drawingChecklist?.length
    ? knowledge.drawingChecklist.map(item => `- ${item.text}（详见 ${item.page}）`).join('\n')
    : '- 无额外清单。';

  const mustSpecifyLines = knowledge.mustSpecify
    .map(item => `- ${item.text}（详见 ${item.page}）`)
    .join('\n');

  const defaultLines = knowledge.defaultsWhenOmitted?.length
    ? knowledge.defaultsWhenOmitted.map(item => `- ${item.text}（详见 ${item.page}）`).join('\n')
    : '- 无特别默认项。';

  const relatedLines = knowledge.relatedDetails?.length
    ? knowledge.relatedDetails.map(item => `- ${item.title}：第${item.page}页；${item.note}`).join('\n')
    : '- 无额外关联页。';

  return `## 22G101-3 基础专题速查
当前构件属于${knowledge.title}。${knowledge.intro}

### 页码速查
${pageLines}

### 图纸表达与识图
${notationLines}

### 出图检查清单
${checklistLines}

### 回答重点
${ruleLines}

### 设计需写明
${mustSpecifyLines}

### 未注明时的默认/可选做法
${defaultLines}

### 相关扩展构造
${relatedLines}`;
}
