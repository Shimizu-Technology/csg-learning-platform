import {
  clampImageTranslation,
  createSerialTaskQueue,
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

describe('image viewer lifecycle sequencing', () => {
  it('runs orientation transitions in request order even when the first is delayed', async () => {
    const queue = createSerialTaskQueue();
    const events: string[] = [];
    let releaseFirst: () => void = () => undefined;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });

    const unlock = queue(async () => {
      events.push('unlock:start');
      await firstGate;
      events.push('unlock:end');
    });
    const lock = queue(async () => {
      events.push('lock');
    });

    await Promise.resolve();
    expect(events).toEqual(['unlock:start']);
    releaseFirst();
    await Promise.all([unlock, lock]);
    expect(events).toEqual(['unlock:start', 'unlock:end', 'lock']);
  });

  it('continues the queue after a native transition rejects', async () => {
    const queue = createSerialTaskQueue();
    const events: string[] = [];
    await queue(async () => { throw new Error('orientation unavailable'); });
    await queue(async () => { events.push('recovered'); });
    expect(events).toEqual(['recovered']);
  });
});
