import type { RefObject } from 'react';
import type { ScrollView, View } from 'react-native';

export function focusScrollTarget(node: Pick<View, 'measureLayout'>, scroll: RefObject<ScrollView | null>, inner: RefObject<View | null>, complete: () => void = () => {}) {
  const measure = (retry: boolean) => {
    if (!inner.current) { if (retry) requestAnimationFrame(() => measure(false)); return; }
    node.measureLayout(inner.current, (_x, y) => {
      if (!scroll.current) return;
      scroll.current.scrollTo({ y: Math.max(0, y - 16), animated: false });
      complete();
    }, () => { if (retry) requestAnimationFrame(() => measure(false)); });
  };
  requestAnimationFrame(() => measure(true));
}
