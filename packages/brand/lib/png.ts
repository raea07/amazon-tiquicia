import { inflateSync } from "node:zlib";

/*
 * A small PNG reader for the asset tests: 8-bit RGB and RGBA, not interlaced
 * (what the specification's render script writes). Plain Node, no dependency.
 */

export interface Png {
  width: number;
  height: number;
  /** 2 = RGB, 6 = RGBA. */
  colourType: 2 | 6;
  /** RGBA, 4 bytes per pixel, row after row. */
  rgba: Uint8Array;
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

export function readPng(file: Buffer): Png {
  if (!file.subarray(0, 8).equals(SIGNATURE)) throw new Error("Not a PNG file");
  let offset = 8;
  let width = 0;
  let height = 0;
  let colourType = 0;
  const data: Buffer[] = [];
  while (offset < file.length) {
    const length = file.readUInt32BE(offset);
    const type = file.toString("latin1", offset + 4, offset + 8);
    const body = file.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const depth = body[8];
      colourType = body[9] ?? 0;
      const interlace = body[12];
      if (depth !== 8 || (colourType !== 2 && colourType !== 6) || interlace !== 0) {
        throw new Error(`Unsupported PNG: depth ${depth}, colour type ${colourType}`);
      }
    } else if (type === "IDAT") {
      data.push(body);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  const channels = colourType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(data));
  if (raw.length !== height * (stride + 1)) throw new Error("PNG data has the wrong length");
  const pixels = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const row = y * stride;
    const prior = row - stride;
    for (let x = 0; x < stride; x++) {
      const value = raw[y * (stride + 1) + 1 + x] ?? 0;
      const left = x >= channels ? (pixels[row + x - channels] ?? 0) : 0;
      const up = y > 0 ? (pixels[prior + x] ?? 0) : 0;
      const upLeft = y > 0 && x >= channels ? (pixels[prior + x - channels] ?? 0) : 0;
      let out: number;
      switch (filter) {
        case 0:
          out = value;
          break;
        case 1:
          out = value + left;
          break;
        case 2:
          out = value + up;
          break;
        case 3:
          out = value + ((left + up) >> 1);
          break;
        case 4:
          out = value + paeth(left, up, upLeft);
          break;
        default:
          throw new Error(`Unknown PNG filter ${filter}`);
      }
      pixels[row + x] = out & 0xff;
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0, j = 0; i < pixels.length; i += channels, j += 4) {
    rgba[j] = pixels[i] ?? 0;
    rgba[j + 1] = pixels[i + 1] ?? 0;
    rgba[j + 2] = pixels[i + 2] ?? 0;
    rgba[j + 3] = channels === 4 ? (pixels[i + 3] ?? 0) : 255;
  }
  return { width, height, colourType: colourType as 2 | 6, rgba };
}

/** The share of pixels equal to the most common RGBA value, and the share with alpha > 8. */
export function pngStats(png: Png): { mostCommonShare: number; visibleShare: number } {
  const counts = new Map<number, number>();
  let visible = 0;
  const view = new DataView(png.rgba.buffer, png.rgba.byteOffset, png.rgba.byteLength);
  const total = png.width * png.height;
  for (let i = 0; i < total; i++) {
    const value = view.getUint32(i * 4);
    counts.set(value, (counts.get(value) ?? 0) + 1);
    if ((png.rgba[i * 4 + 3] ?? 0) > 8) visible += 1;
  }
  const most = Math.max(...counts.values());
  return { mostCommonShare: most / total, visibleShare: visible / total };
}

/** How many of the top-left 16 × 16 pixels are Chromium's broken-image grey. */
export function brokenImageGrey(png: Png): number {
  let grey = 0;
  for (let y = 0; y < Math.min(16, png.height); y++) {
    for (let x = 0; x < Math.min(16, png.width); x++) {
      const i = (y * png.width + x) * 4;
      if (
        png.rgba[i] === 192 &&
        png.rgba[i + 1] === 192 &&
        png.rgba[i + 2] === 192 &&
        (png.rgba[i + 3] ?? 0) > 200
      ) {
        grey += 1;
      }
    }
  }
  return grey;
}
