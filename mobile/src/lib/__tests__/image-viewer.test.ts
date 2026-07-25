import {
  clampImageTranslation,
  fittedImageSize,
  translationBounds,
  zoomTranslationAtPoint,
} from '../image-viewer';

describe('image viewer geometry', () => {
  const viewport = { width: 390, height: 780 };

  it('contains portrait and landscape images without cropping at rest', () => {
    expect(fittedImageSize({ width: 1_000, height: 2_000 }, viewport)).toEqual({ width: 390, height: 780 });
    expect(fittedImageSize({ width: 2_000, height: 1_000 }, viewport)).toEqual({ width: 390, height: 195 });
  });

  it('clamps panning to the scaled image bounds', () => {
    const image = { width: 2_000, height: 1_000 };
    expect(translationBounds({ image, viewport, scale: 2 })).toEqual({ x: 195, y: 0 });
    expect(clampImageTranslation({ image, viewport, scale: 2, x: 400, y: 90 })).toEqual({ x: 195, y: 0 });
  });

  it('zooms toward the touched point while retaining valid bounds', () => {
    const image = { width: 1_000, height: 2_000 };
    expect(zoomTranslationAtPoint({
      image,
      viewport,
      fromScale: 1,
      toScale: 2,
      currentX: 0,
      currentY: 0,
      focalX: 300,
      focalY: 600,
    })).toEqual({ x: -105, y: -210 });
  });
});
