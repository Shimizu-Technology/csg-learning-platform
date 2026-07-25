export const IMAGE_VIEWER_MIN_SCALE = 1;
export const IMAGE_VIEWER_MAX_SCALE = 4;
export const IMAGE_VIEWER_DOUBLE_TAP_SCALE = 2.5;

type Size = {
  width: number;
  height: number;
};

type TranslationBoundsInput = {
  image: Size;
  viewport: Size;
  scale: number;
};

type TranslationInput = TranslationBoundsInput & {
  x: number;
  y: number;
};

export function clamp(value: number, minimum: number, maximum: number) {
  'worklet';
  return Math.min(maximum, Math.max(minimum, value));
}

export function fittedImageSize(image: Size, viewport: Size): Size {
  'worklet';
  if (image.width <= 0 || image.height <= 0 || viewport.width <= 0 || viewport.height <= 0) {
    return viewport;
  }

  const ratio = Math.min(viewport.width / image.width, viewport.height / image.height);
  return { width: image.width * ratio, height: image.height * ratio };
}

export function translationBounds({ image, viewport, scale }: TranslationBoundsInput) {
  'worklet';
  const fitted = fittedImageSize(image, viewport);
  return {
    x: Math.max(0, (fitted.width * scale - viewport.width) / 2),
    y: Math.max(0, (fitted.height * scale - viewport.height) / 2),
  };
}

export function clampImageTranslation({ image, viewport, scale, x, y }: TranslationInput) {
  'worklet';
  const bounds = translationBounds({ image, viewport, scale });
  return {
    x: clamp(x, -bounds.x, bounds.x),
    y: clamp(y, -bounds.y, bounds.y),
  };
}

export function zoomTranslationAtPoint({
  image,
  viewport,
  fromScale,
  toScale,
  currentX,
  currentY,
  focalX,
  focalY,
}: Pick<TranslationBoundsInput, 'image' | 'viewport'> & {
  fromScale: number;
  toScale: number;
  currentX: number;
  currentY: number;
  focalX: number;
  focalY: number;
}) {
  'worklet';
  const centerX = viewport.width / 2;
  const centerY = viewport.height / 2;
  const ratio = toScale / Math.max(IMAGE_VIEWER_MIN_SCALE, fromScale);
  const nextX = currentX + (focalX - centerX - currentX) * (1 - ratio);
  const nextY = currentY + (focalY - centerY - currentY) * (1 - ratio);

  return clampImageTranslation({
    image,
    viewport,
    scale: toScale,
    x: nextX,
    y: nextY,
  });
}
