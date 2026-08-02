import type { Metadata } from 'next';
import { CalculatorClient } from './CalculatorClient';

export const metadata: Metadata = {
  title: '计算器 | RebarViz',
  description: '楼板钢筋根数、长度与重量离线计算器。',
};

export default function CalculatorPage() {
  return <CalculatorClient />;
}
