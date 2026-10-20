import type { Region, Schematic, ViewSettings } from "./types";

export const MAX_CELLS = 512_000_000;
export const MAX_BLOCK_BYTES = 128 * 1024 * 1024;
export const LARGE_VOLUME = 8_000_000;
export const CHUNK_SIZE = 16;
export type BlockArray = Uint8Array | Uint16Array | Uint32Array;

export function createBlockArray(
  volume: number,
  paletteSize: number,
): BlockArray {
  if (!Number.isSafeInteger(volume) || volume < 0 || volume > MAX_CELLS)
    throw new Error("方塊體積無效或超過安全上限。");
  if (
    !Number.isSafeInteger(paletteSize) ||
    paletteSize < 1 ||
    paletteSize > 65536
  )
    throw new Error("方塊調色盤為空或過大。");
  const width = paletteSize <= 256 ? 1 : 2;
  if (volume * width > MAX_BLOCK_BYTES)
    throw new Error("方塊索引超過 128 MiB 記憶體預算，請縮小區域。");
  return width === 1 ? new Uint8Array(volume) : new Uint16Array(volume);
}

/** Litematic packs across both 32-bit and 64-bit boundaries, with no padding. */
export function packedIndex(words: Uint32Array, bits: number, index: number) {
  const bit = index * bits,
    word = Math.floor(bit / 32),
    shift = bit % 32;
  const value = words[word] >>> shift;
  return (
    (shift + bits <= 32 ? value : value | (words[word + 1] << (32 - shift))) &
    ((1 << bits) - 1)
  );
}

export function packedWords(
  words: BigInt64Array | bigint[],
  paletteSize: number,
  volume: number,
) {
  if (!Number.isSafeInteger(volume) || volume < 0 || volume > MAX_CELLS)
    throw new Error("方塊體積無效或超過安全上限。");
  if (!Number.isInteger(paletteSize) || paletteSize < 1 || paletteSize > 65536)
    throw new Error("方塊調色盤為空或過大。");
  const bits = Math.max(2, Math.ceil(Math.log2(paletteSize))),
    needed = Math.ceil((volume * bits) / 64);
  if (words.length !== needed)
    throw new Error(
      `方塊資料長度不符：需要 ${needed} 個 long，實際 ${words.length}。`,
    );
  if (needed * 8 > MAX_BLOCK_BYTES)
    throw new Error("方塊索引超過 128 MiB 記憶體預算，請縮小區域。");
  const data =
    words instanceof BigInt64Array ? words : BigInt64Array.from(words);
  const littleEndian = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
  if (littleEndian)
    return {
      blocks: new Uint32Array(data.buffer, data.byteOffset, data.length * 2),
      bits,
    };
  const blocks = new Uint32Array(data.length * 2);
  for (let i = 0; i < data.length; i++) {
    const n = BigInt.asUintN(64, data[i]);
    blocks[i * 2] = Number(n & 0xffffffffn);
    blocks[i * 2 + 1] = Number(n >> 32n);
  }
  return { blocks, bits };
}

export const regionVolume = (r: Pick<Region, "size">) =>
  r.size[0] * r.size[1] * r.size[2];
export const blockIndex = (
  r: Pick<Region, "blocks" | "packedBits">,
  index: number,
) =>
  r.packedBits
    ? packedIndex(r.blocks as Uint32Array, r.packedBits, index)
    : r.blocks[index];

export function blockTransfers(regions: Region[]): ArrayBuffer[] {
  return [
    ...new Set(
      regions.flatMap((r) =>
        [r.blocks.buffer, r.counts?.buffer, r.occupiedChunks?.buffer].filter(
          (b): b is ArrayBuffer => b instanceof ArrayBuffer,
        ),
      ),
    ),
  ];
}

export function startingSlice(
  s: Schematic,
): Pick<ViewSettings, "mode" | "layer"> {
  if (s.volume <= LARGE_VOLUME) return { mode: "all", layer: s.max[1] };
  const r = s.regions.reduce((a, b) => (b.blockCount > a.blockCount ? b : a));
  return {
    mode: "single",
    layer: r.blockCount ? r.min[1] + (r.contentMin?.[1] ?? 0) : s.min[1],
  };
}
