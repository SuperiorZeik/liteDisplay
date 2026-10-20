import {
  blockIndex,
  CHUNK_SIZE,
  regionVolume,
  type BlockArray,
} from "./block-storage";

export type Vec3 = [number, number, number];
export interface BlockState {
  name: string;
  properties: Record<string, string>;
}
export interface Tag {
  type: number;
  value: unknown;
  listType?: number;
}
export type Compound = Record<string, Tag>;
export interface Region {
  name: string;
  position: Vec3;
  signedSize: Vec3;
  size: Vec3;
  min: Vec3;
  palette: BlockState[];
  blocks: BlockArray;
  packedBits?: number;
  counts?: Uint32Array;
  occupiedChunks?: Uint32Array;
  contentMin?: Vec3;
  contentMax?: Vec3;
  blockCount: number;
  entities: Compound[];
  blockEntities: Compound[];
}
export interface Schematic {
  name: string;
  author: string;
  description: string;
  format: string;
  version: number;
  dataVersion: number;
  regions: Region[];
  min: Vec3;
  max: Vec3;
  size: Vec3;
  volume: number;
  blockCount: number;
  created: string | null;
  warnings: string[];
}
export interface Material {
  name: string;
  count: number;
}
export interface PickedBlock {
  region: string;
  position: Vec3;
  local: Vec3;
  state: BlockState;
  blockEntity?: Compound;
}
export type LayerMode = "all" | "single" | "below";
export interface ViewSettings {
  axis: 0 | 1 | 2;
  mode: LayerMode;
  layer: number;
  hidden: string[];
  highlight: string | null;
  isolate: boolean;
  projection: "perspective" | "orthographic";
  grid: boolean;
  bounds: boolean;
  wireframe: boolean;
  quality: "high" | "low";
}
export interface LibraryEntry {
  id: string;
  fileName: string;
  name: string;
  author: string;
  bytes: number;
  blockCount: number;
  savedAt: number;
  tags: string;
  blob: Blob;
  thumbnail?: string;
}
export const AIR: BlockState = { name: "minecraft:air", properties: {} };
export const isAir = (s: BlockState) =>
  /^(minecraft:)?(air|cave_air|void_air|structure_void)$/.test(s.name);
export const stateKey = (s: BlockState) =>
  `${s.name}[${Object.entries(s.properties)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(",")}]`;
export const coordKey = (p: Vec3) => p.join(",");
export function blockAt(r: Region, x: number, y: number, z: number) {
  if (
    ![x, y, z].every(Number.isInteger) ||
    x < 0 ||
    y < 0 ||
    z < 0 ||
    x >= r.size[0] ||
    y >= r.size[1] ||
    z >= r.size[2]
  )
    return undefined;
  return r.palette[blockIndex(r, (y * r.size[2] + z) * r.size[0] + x)];
}
export function* eachBlock(
  r: Region,
  view?: Pick<ViewSettings, "axis" | "mode" | "layer">,
): Generator<{
  position: Vec3;
  local: Vec3;
  state: BlockState;
  index: number;
}> {
  if (!r.blockCount) return;
  const [sx, , sz] = r.size;
  const min = [...(r.contentMin ?? [0, 0, 0])] as Vec3;
  const max = [...(r.contentMax ?? r.size.map((n) => n - 1))] as Vec3;
  if (view && view.mode !== "all") {
    const a = view.axis,
      localLayer = view.layer - r.min[a];
    if (view.mode === "single" && !Number.isInteger(localLayer)) return;
    max[a] = Math.min(max[a], Math.floor(localLayer));
    if (view.mode === "single") min[a] = Math.max(min[a], localLayer);
  }
  if (min.some((n, a) => n > max[a])) return;
  function* span(x0: number, x1: number, y: number, z: number) {
    for (let x = x0; x <= x1; x++) {
      const index = (y * sz + z) * sx + x,
        state = r.palette[blockIndex(r, index)];
      if (state && !isAir(state))
        yield {
          position: [r.min[0] + x, r.min[1] + y, r.min[2] + z] as Vec3,
          local: [x, y, z] as Vec3,
          state,
          index,
        };
    }
  }
  if (!r.occupiedChunks) {
    for (let y = min[1]; y <= max[1]; y++)
      for (let z = min[2]; z <= max[2]; z++) yield* span(min[0], max[0], y, z);
    return;
  }
  // Group sorted occupied chunks without building a per-cell or per-row Map.
  // Visiting local Y, then Z, then X preserves the original array's X-Z-Y order.
  const chunks = r.occupiedChunks,
    cx = Math.ceil(sx / CHUNK_SIZE),
    cz = Math.ceil(sz / CHUNK_SIZE),
    plane = cx * cz;
  for (let start = 0; start < chunks.length; ) {
    const cy = Math.floor(chunks[start] / plane);
    let end = start + 1;
    while (end < chunks.length && Math.floor(chunks[end] / plane) === cy) end++;
    for (
      let y = Math.max(min[1], cy * CHUNK_SIZE);
      y <= Math.min(max[1], (cy + 1) * CHUNK_SIZE - 1);
      y++
    ) {
      for (let row = start; row < end; ) {
        const chunkZ = Math.floor(chunks[row] / cx) % cz;
        let rowEnd = row + 1;
        while (rowEnd < end && Math.floor(chunks[rowEnd] / cx) % cz === chunkZ)
          rowEnd++;
        for (
          let z = Math.max(min[2], chunkZ * CHUNK_SIZE);
          z <= Math.min(max[2], (chunkZ + 1) * CHUNK_SIZE - 1);
          z++
        ) {
          for (let j = row; j < rowEnd; j++) {
            const chunkX = chunks[j] % cx;
            yield* span(
              Math.max(min[0], chunkX * CHUNK_SIZE),
              Math.min(max[0], (chunkX + 1) * CHUNK_SIZE - 1),
              y,
              z,
            );
          }
        }
        row = rowEnd;
      }
    }
    start = end;
  }
}
export function materials(s: Schematic, hidden: string[] = []): Material[] {
  const counts = new Map<string, number>();
  for (const r of s.regions) {
    if (hidden.includes(r.name)) continue;
    const local = r.counts ?? new Uint32Array(r.palette.length);
    if (!r.counts)
      for (let i = 0; i < regionVolume(r); i++) local[blockIndex(r, i)]++;
    r.palette.forEach((b, i) => {
      if (!isAir(b) && local[i])
        counts.set(b.name, (counts.get(b.name) ?? 0) + local[i]);
    });
  }
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
