/** The in-memory image operations `toHaveScreenshot` is built on: clipping, cropping, painting, the PNG round trip, and the comparison's tolerance. */

import { describe, expect, it } from 'vitest';
import { clipBox, compareImages, cropImage, decodePng, encodePng, fillBoxes, resampleImage, type RgbaImage } from '../../src/internal/image.ts';

/** A width by height image of one gray level. */
function gray(width: number, height: number, level: number): RgbaImage {
  const data = new Uint8Array(width * height * 4);
  for (let at = 0; at < data.length; at += 4) data.set([level, level, level, 255], at);
  return { width, height, data };
}

const exact = { threshold: 0, maxDiffPixels: undefined, maxDiffPixelRatio: undefined };

describe('image', () => {
  it('round-trips through PNG', () => {
    const image = gray(3, 2, 120);
    expect(decodePng(encodePng(image))).toEqual(image);
  });

  it('clips a box to the image on whole pixels, and has none for a box outside it', () => {
    expect(clipBox({ width: 10, height: 10 }, { x: -2.4, y: 3.6, width: 5, height: 20 })).toEqual({ x: 0, y: 4, width: 3, height: 6 });
    expect(clipBox({ width: 10, height: 10 }, { x: 12, y: 0, width: 5, height: 5 })).toBeUndefined();
  });

  it('crops the pixels of a box and paints boxes clipped to the image', () => {
    const blank = gray(4, 4, 0);
    const image = fillBoxes(blank, [{ x: 2, y: 2, width: 10, height: 10 }], [255, 0, 0]);
    expect(blank).toEqual(gray(4, 4, 0));
    expect([...cropImage(image, { x: 1, y: 1, width: 2, height: 2 }).data]).toEqual([
      0, 0, 0, 255, 0, 0, 0, 255,
      0, 0, 0, 255, 255, 0, 0, 255,
    ]);
  });

  it('averages the pixels each target pixel covers when it resamples', () => {
    const image: RgbaImage = { width: 2, height: 1, data: new Uint8Array([0, 0, 0, 255, 200, 200, 200, 255]) };
    expect([...resampleImage(image, 1, 1).data]).toEqual([100, 100, 100, 255]);
    expect(resampleImage(image, 2, 1)).toBe(image);
  });

  it('reports a size mismatch, and counts differing pixels against maxDiffPixels and maxDiffPixelRatio, the smaller one when both are set', () => {
    expect(compareImages(gray(2, 2, 0), gray(2, 3, 0), exact)).toMatchObject({ kind: 'size' });
    const expected = gray(10, 10, 255);
    const actual = fillBoxes(gray(10, 10, 255), [{ x: 0, y: 0, width: 5, height: 1 }], [0, 0, 0]);
    expect(compareImages(expected, actual, exact)).toMatchObject({ kind: 'pixels', diffPixels: 5, ratio: 0.05 });
    expect(compareImages(expected, actual, { ...exact, maxDiffPixels: 5 })).toMatchObject({ kind: 'match' });
    expect(compareImages(expected, actual, { ...exact, maxDiffPixelRatio: 0.05 })).toMatchObject({ kind: 'match' });
    expect(compareImages(expected, actual, { ...exact, maxDiffPixels: 10, maxDiffPixelRatio: 0.04 })).toMatchObject({ kind: 'pixels' });
  });

  it('counts a pixel as the same when its color is within the threshold', () => {
    expect(compareImages(gray(4, 4, 200), gray(4, 4, 204), { ...exact, threshold: 0.2 })).toMatchObject({ kind: 'match' });
    expect(compareImages(gray(4, 4, 200), gray(4, 4, 204), exact)).toMatchObject({ kind: 'pixels', diffPixels: 16 });
  });
});
