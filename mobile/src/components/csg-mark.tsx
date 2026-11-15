import { SvgXml } from 'react-native-svg';
import { brand } from '../lib/brand';

export function CsgMark({ width = 25, height = 36 }: { width?: number; height?: number }) {
  return <SvgXml xml={brand.logoSvg} width={width} height={height} accessibilityLabel={brand.schoolName} accessibilityRole="image" />;
}
