import { readNbt } from "./nbt";
import {
  AIR,
  isAir,
  type BlockState,
  type Compound,
  type Region,
  type Schematic,
  type Tag,
  type Vec3,
} from "./types";

export const MAX_CELLS = 8_000_000;
const obj = (c: Compound, k: string): Compound =>
  c[k]?.type === 10 ? (c[k].value as Compound) : Object.create(null);
const val = (c: Compound, k: string, f: unknown = 0): any => c[k]?.value ?? f;
const items = (c: Compound, k: string): Tag[] =>
  c[k]?.type === 9 ? (c[k].value as Tag[]) : [];
const comps = (c: Compound, k: string): Compound[] =>
  items(c, k)
    .filter((t) => t.type === 10)
    .map((t) => t.value as Compound);
const pos = (c: Compound): Vec3 => [
  Number(val(c, "x")),
  Number(val(c, "y")),
  Number(val(c, "z")),
];
const vec = (t: Tag | undefined): Vec3 =>
  t?.type === 10
    ? pos(t.value as Compound)
    : t?.type === 11
      ? (Array.from(t.value as Int32Array) as Vec3)
      : t?.type === 9
        ? ((t.value as Tag[]).map((x) => Number(x.value)) as Vec3)
        : [0, 0, 0];
function validateSize(size: Vec3) {
  if (
    size.length !== 3 ||
    size.some(
      (n) => !Number.isSafeInteger(n) || n === 0 || Math.abs(n) > MAX_CELLS,
    )
  )
    throw new Error("區域尺寸無效。");
  const n = Math.abs(size[0] * size[1] * size[2]);
  if (n > MAX_CELLS) throw new Error("區域超過 800 萬格，請分割藍圖後開啟。");
  return n;
}
export function unpackIndices(
  words: BigInt64Array | bigint[],
  paletteSize: number,
  volume: number,
): Uint32Array {
  if (!paletteSize || paletteSize > 65536)
    throw new Error("方塊調色盤為空或過大。");
  const bits = Math.max(2, Math.ceil(Math.log2(paletteSize))),
    needed = Math.ceil((volume * bits) / 64);
  if (words.length !== needed)
    throw new Error(
      `方塊資料長度不符：需要 ${needed} 個 long，實際 ${words.length}。`,
    );
  const out = new Uint32Array(volume),
    mask = (1n << BigInt(bits)) - 1n,
    uwords = BigUint64Array.from(words, (n) => BigInt.asUintN(64, n));
  for (let i = 0; i < volume; i++) {
    const bit = i * bits,
      w = Math.floor(bit / 64),
      shift = bit % 64;
    let n = uwords[w] >> BigInt(shift);
    if (shift + bits > 64) n |= uwords[w + 1] << BigInt(64 - shift);
    const id = Number(n & mask);
    if (id >= paletteSize) throw new Error(`方塊索引 ${id} 超出調色盤範圍。`);
    out[i] = id;
  }
  return out;
}
export function packIndices(
  indices: Uint32Array,
  paletteSize: number,
): BigInt64Array {
  const bits = Math.max(2, Math.ceil(Math.log2(paletteSize))),
    words = new BigUint64Array(Math.ceil((indices.length * bits) / 64));
  indices.forEach((id, i) => {
    const bit = i * bits,
      w = Math.floor(bit / 64),
      s = bit % 64;
    words[w] |= BigInt(id) << BigInt(s);
    if (s + bits > 64) words[w + 1] |= BigInt(id) >> BigInt(64 - s);
  });
  return BigInt64Array.from(words, (n) => BigInt.asIntN(64, n));
}
function paletteEntry(c: Compound): BlockState {
  const name = String(val(c, "Name", "minecraft:air"));
  return {
    name: name.includes(":") ? name : `minecraft:${name}`,
    properties: Object.fromEntries(
      Object.entries(obj(c, "Properties")).map(([k, t]) => [
        k,
        String(t.value),
      ]),
    ),
  };
}
function region(
  name: string,
  position: Vec3,
  signedSize: Vec3,
  palette: BlockState[],
  blocks: Uint32Array,
  entities: Compound[] = [],
  blockEntities: Compound[] = [],
): Region {
  const size = signedSize.map(Math.abs) as Vec3,
    min = position.map(
      (n, a) => n + (signedSize[a] < 0 ? signedSize[a] + 1 : 0),
    ) as Vec3;
  let blockCount = 0;
  for (const id of blocks) if (palette[id] && !isAir(palette[id])) blockCount++;
  return {
    name,
    position,
    signedSize,
    size,
    min,
    palette,
    blocks,
    blockCount,
    entities,
    blockEntities,
  };
}
export function finishSchematic(
  regions: Region[],
  meta: Partial<Schematic>,
): Schematic {
  if (!regions.length) throw new Error("藍圖沒有可讀取的區域。");
  const min = [0, 1, 2].map((a) =>
    Math.min(...regions.map((r) => r.min[a])),
  ) as Vec3;
  const max = [0, 1, 2].map((a) =>
    Math.max(...regions.map((r) => r.min[a] + r.size[a] - 1)),
  ) as Vec3;
  const volume = regions.reduce((n, r) => n + r.blocks.length, 0);
  if (volume > MAX_CELLS)
    throw new Error("藍圖總體積超過 800 萬格，請分割後開啟。");
  return {
    name: "未命名藍圖",
    author: "未知作者",
    description: "",
    format: "Litematic",
    version: 0,
    dataVersion: 0,
    created: null,
    warnings: [],
    ...meta,
    regions,
    min,
    max,
    size: max.map((n, a) => n - min[a] + 1) as Vec3,
    volume,
    blockCount: regions.reduce((n, r) => n + r.blockCount, 0),
  };
}
export function parseSchematic(
  input: Uint8Array,
  fileName: string,
  onProgress = (p: number, text: string) => {},
): Schematic {
  onProgress(10, "解壓縮與讀取 NBT");
  const root = readNbt(input);
  return parseRoot(root, fileName, onProgress);
}
export function parseRoot(
  root: Compound,
  fileName: string,
  onProgress = (p: number, text: string) => {},
): Schematic {
  const regions: Region[] = [],
    m = obj(root, "Metadata"),
    baseName = fileName.replace(
      /\.(litematic|litematica|schem|schematic|nbt)$/i,
      "",
    );
  const meta: Partial<Schematic> = {
    name: String(val(m, "Name", baseName)),
    author: String(val(m, "Author", "未知作者")),
    description: String(val(m, "Description", "")),
    version: Number(val(root, "Version")),
    dataVersion: Number(
      val(root, "MinecraftDataVersion", val(root, "DataVersion")),
    ),
    warnings: [],
  };
  const time = Number(val(m, "TimeCreated"));
  meta.created =
    Number.isFinite(time) && time > 0 && time < 8.64e15
      ? new Date(time).toISOString()
      : null;
  if (root.Regions?.type === 10) {
    if (meta.version! < 1 || meta.version! > 7)
      throw new Error(
        `尚未支援 Litematic 格式 v${meta.version}（支援 v1–v7）。`,
      );
    let total = 0;
    const entries = Object.entries(obj(root, "Regions"));
    if (entries.length > 1024) throw new Error("區域數超過 1024 個。");
    entries.forEach(([name, t], i) => {
      if (t.type !== 10) throw new Error("區域格式無效。");
      const c = t.value as Compound,
        p = vec(c.Position),
        s = vec(c.Size),
        n = validateSize(s);
      total += n;
      if (total > MAX_CELLS) throw new Error("總體積超過 800 萬格。");
      if (p.some((n) => !Number.isSafeInteger(n) || Math.abs(n) > 30000000))
        throw new Error("區域座標無效。");
      const palette = comps(c, "BlockStatePalette").map(paletteEntry);
      if (c.BlockStates?.type !== 12)
        throw new Error(`區域 ${name} 缺少 BlockStates。`);
      const blocks = unpackIndices(
        c.BlockStates.value as BigInt64Array,
        palette.length,
        n,
      );
      const entities = comps(c, "Entities").map((e) =>
          meta.version === 1 ? obj(e, "EntityData") : e,
        ),
        tiles = comps(c, "TileEntities").map((e) =>
          meta.version === 1 ? obj(e, "TileNBT") : e,
        );
      regions.push(region(name, p, s, palette, blocks, entities, tiles));
      onProgress(
        30 + Math.round((60 * (i + 1)) / entries.length),
        `解析區域 ${i + 1} / ${entries.length}`,
      );
    });
  } else if (root.palette?.type === 9 && root.blocks?.type === 9) {
    meta.format = "Vanilla NBT";
    meta.author = String(val(root, "author", "未知作者"));
    const size = vec(root.size),
      n = validateSize(size);
    if (size.some((x) => x < 0)) throw new Error("原版結構尺寸必須為正數。");
    const palette = [AIR, ...comps(root, "palette").map(paletteEntry)],
      blocks = new Uint32Array(n),
      tiles: Compound[] = [];
    for (const b of comps(root, "blocks")) {
      const p = vec(b.pos),
        id = Number(val(b, "state", -1));
      if (
        p.some((v, a) => !Number.isInteger(v) || v < 0 || v >= size[a]) ||
        !Number.isInteger(id) ||
        id < 0 ||
        id + 1 >= palette.length
      )
        throw new Error("原版結構的座標或方塊索引無效。");
      blocks[(p[1] * size[2] + p[2]) * size[0] + p[0]] = id + 1;
      if (b.nbt) tiles.push(obj(b, "nbt"));
    }
    regions.push(
      region(
        "main",
        [0, 0, 0],
        size,
        palette,
        blocks,
        comps(root, "entities"),
        tiles,
      ),
    );
  } else {
    const c = root.Schematic?.type === 10 ? obj(root, "Schematic") : root,
      version = Number(val(c, "Version"));
    if (!(c.Palette || c.Blocks?.type === 10))
      throw new Error(
        "不支援的藍圖格式。請使用 .litematic、Sponge .schem 或原版 .nbt。",
      );
    if (version !== 2 && version !== 3)
      throw new Error(`Sponge .schem 目前支援 v2、v3，收到 v${version}。`);
    meta.format = `Sponge v${version}`;
    meta.dataVersion = Number(val(c, "DataVersion"));
    const size: Vec3 = [
        Number(val(c, "Width")),
        Number(val(c, "Height")),
        Number(val(c, "Length")),
      ],
      n = validateSize(size);
    const bc = version === 3 ? obj(c, "Blocks") : c,
      raw = obj(bc, "Palette"),
      keys = Object.keys(raw);
    if (keys.length > 65536) throw new Error("調色盤過大。");
    const palette: BlockState[] = Array.from(
      { length: keys.length },
      () => AIR,
    );
    for (const key of keys) {
      const id = Number(val(raw, key));
      if (!Number.isInteger(id) || id < 0 || id >= keys.length)
        throw new Error("Sponge 調色盤索引無效。");
      const match = key.match(/^([^\[]+)(?:\[(.*)\])?$/);
      if (!match) throw new Error("方塊名稱無效");
      palette[id] = {
        name: match[1],
        properties: Object.fromEntries(
          (match[2] ?? "")
            .split(",")
            .filter(Boolean)
            .map((s) => s.split("=")),
        ),
      };
    }
    const data = val(
      bc,
      version === 3 ? "Data" : "BlockData",
      null,
    ) as Uint8Array;
    if (!(data instanceof Uint8Array)) throw new Error("Sponge 缺少方塊資料。");
    const blocks = new Uint32Array(n);
    let cursor = 0;
    for (let i = 0; i < n; i++) {
      let id = 0,
        shift = 0,
        b = 0;
      do {
        if (cursor >= data.length || shift >= 35)
          throw new Error("Sponge VarInt 資料損毀。");
        b = data[cursor++];
        id += (b & 127) * 2 ** shift;
        shift += 7;
      } while (b & 128);
      if (id >= palette.length) throw new Error("Sponge 方塊索引無效。");
      blocks[i] = id;
    }
    regions.push(
      region(
        "main",
        vec(c.Offset),
        size,
        palette,
        blocks,
        comps(c, "Entities"),
        comps(bc, "BlockEntities"),
      ),
    );
  }
  const entityCount = regions.reduce((n, r) => n + r.entities.length, 0);
  if (entityCount)
    meta.warnings!.push(
      `保留 ${entityCount} 個實體的 NBT；目前 3D 畫面僅顯示方塊。`,
    );
  if (meta.dataVersion! > 3955)
    meta.warnings!.push(
      "顯示資源以 Minecraft 1.21.1 為基準；較新或模組方塊可能以替代模型呈現。",
    );
  onProgress(100, "完成");
  return finishSchematic(regions, meta);
}
