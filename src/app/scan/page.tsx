import { ScanPage } from './ScanPage';

export const metadata = {
  title: '图纸扫描识别 | 钢筋配筋可视化',
  description: '上传结构施工图，AI 自动识别配筋信息并生成 3D 模型',
};

export default function Page() {
  return <ScanPage />;
}
