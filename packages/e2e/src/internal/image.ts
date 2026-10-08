/** RGBA images in memory: PNG decoding and encoding, resampling, cropping, painting boxes, and comparing two images. */

import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

/** An RGBA image, 8 bits per channel, rows top to bottom. */
export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

/** A box in image pixels. */
export interface ImageBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Decodes PNG bytes; throws on bytes that are not a PNG. */
export function decodePng(bytes: Uint8Array): RgbaImage {
  const png = PNG.sync.read(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  return { width: png.width, height: png.height, data: new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.byteLength) };
}

/** Encodes an image as PNG bytes. */
export function encodePng(image: RgbaImage): Uint8Array {
  const png = new PNG({ width: image.width, height: image.height });
  png.data = Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength);
  return new Uint8Array(PNG.sync.write(png));
}

/** Resamples an image to `width` by `height` with a box filter; the input itself when it already has that size. */
export function resampleImage(image: RgbaImage, width: number, height: number): RgbaImage {
  if (image.width === width && image.height === height) return image;
  const data = new Uint8Array(width * height * 4);
  boxResample(image.data, image.width, image.height, data, width, height);
  return { width, height, data };
}

/** Averages, per channel, every source pixel a target pixel covers. RGBA, 8 bits per channel. */
function boxResample(
  source: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
  target: Uint8Array,
  targetWidth: number,
  targetHeight: number,
): void {
  const xRatio = sourceWidth / targetWidth;
  const yRatio = sourceHeight / targetHeight;
  for (let ty = 0; ty < targetHeight; ty += 1) {
    const y0 = Math.floor(ty * yRatio);
    const y1 = Math.min(sourceHeight, Math.max(y0 + 1, Math.floor((ty + 1) * yRatio)));
    for (let tx = 0; tx < targetWidth; tx += 1) {
      const x0 = Math.floor(tx * xRatio);
      const x1 = Math.min(sourceWidth, Math.max(x0 + 1, Math.floor((tx + 1) * xRatio)));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;
      for (let y = y0; y < y1; y += 1) {
        let offset = (y * sourceWidth + x0) * 4;
        for (let x = x0; x < x1; x += 1) {
          r += source[offset]!;
          g += source[offset + 1]!;
          b += source[offset + 2]!;
          a += source[offset + 3]!;
          offset += 4;
          count += 1;
        }
      }
      const at = (ty * targetWidth + tx) * 4;
      target[at] = Math.round(r / count);
      target[at + 1] = Math.round(g / count);
      target[at + 2] = Math.round(b / count);
      target[at + 3] = Math.round(a / count);
    }
  }
}

/** The part of `box` inside the image, on whole pixels; undefined when none of it is. */
export function clipBox(image: Pick<RgbaImage, 'width' | 'height'>, box: ImageBox): ImageBox | undefined {
  const x0 = Math.max(0, Math.round(box.x));
  const y0 = Math.max(0, Math.round(box.y));
  const x1 = Math.min(image.width, Math.round(box.x + box.width));
  const y1 = Math.min(image.height, Math.round(box.y + box.height));
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : undefined;
}

/** The pixels of a box already inside the image (see `clipBox`). */
export function cropImage(image: RgbaImage, box: ImageBox): RgbaImage {
  const data = new Uint8Array(box.width * box.height * 4);
  for (let row = 0; row < box.height; row += 1) {
    const from = ((box.y + row) * image.width + box.x) * 4;
    data.set(image.data.subarray(from, from + box.width * 4), row * box.width * 4);
  }
  return { width: box.width, height: box.height, data };
}

/** A copy of the image with each box, clipped to it, painted opaque in `color`. */
export function fillBoxes(image: RgbaImage, boxes: readonly ImageBox[], color: readonly [number, number, number]): RgbaImage {
  const data = image.data.slice();
  for (const box of boxes) {
    const clipped = clipBox(image, box);
    if (clipped === undefined) continue;
    for (let y = clipped.y; y < clipped.y + clipped.height; y += 1) {
      for (let x = clipped.x; x < clipped.x + clipped.width; x += 1) {
        data.set([color[0], color[1], color[2], 255], (y * image.width + x) * 4);
      }
    }
  }
  return { width: image.width, height: image.height, data };
}

/** How far two images may differ and still match. */
export interface ImageTolerance {
  /** Per-pixel color distance, 0 to 1, below which two pixels are the same. */
  readonly threshold: number;
  readonly maxDiffPixels: number | undefined;
  readonly maxDiffPixelRatio: number | undefined;
}

/** What comparing two images found. */
export type ImageComparison =
  | { readonly kind: 'match'; readonly diffPixels: number }
  | { readonly kind: 'size'; readonly expected: ImageBox; readonly actual: ImageBox }
  | { readonly kind: 'pixels'; readonly diffPixels: number; readonly ratio: number; readonly diff: RgbaImage };

/**
 * Compares `actual` against `expected`. They match when they have one size
 * and at most the tolerated number of pixels differ: `maxDiffPixels`, a
 * `maxDiffPixelRatio` share of the image, the smaller of the two when both are
 * set, and none when neither is.
 */
export function compareImages(expected: RgbaImage, actual: RgbaImage, tolerance: ImageTolerance): ImageComparison {
  if (expected.width !== actual.width || expected.height !== actual.height) {
    return {
      kind: 'size',
      expected: { x: 0, y: 0, width: expected.width, height: expected.height },
      actual: { x: 0, y: 0, width: actual.width, height: actual.height },
    };
  }
  const { width, height } = expected;
  const diff = new Uint8Array(width * height * 4);
  const diffPixels = pixelmatch(expected.data, actual.data, diff, width, height, { threshold: tolerance.threshold });
  const total = width * height;
  const byRatio = tolerance.maxDiffPixelRatio === undefined ? undefined : total * tolerance.maxDiffPixelRatio;
  const allowed =
    tolerance.maxDiffPixels !== undefined && byRatio !== undefined
      ? Math.min(tolerance.maxDiffPixels, byRatio)
      : (tolerance.maxDiffPixels ?? byRatio ?? 0);
  if (diffPixels <= allowed) return { kind: 'match', diffPixels };
  return { kind: 'pixels', diffPixels, ratio: total === 0 ? 0 : diffPixels / total, diff: { width, height, data: diff } };
}
