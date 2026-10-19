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
  blocks: Uint32Array;
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
    x < 0 ||
    y < 0 ||
    z < 0 ||
    x >= r.size[0] ||
    y >= r.size[1] ||
    z >= r.size[2]
  )
    return undefined;
  return r.palette[r.blocks[(y * r.size[2] + z) * r.size[0] + x]];
}
export function* eachBlock(
  r: Region,
): Generator<{
  position: Vec3;
  local: Vec3;
  state: BlockState;
  index: number;
}> {
  const [sx, , sz] = r.size;
  for (let i = 0; i < r.blocks.length; i++) {
    const state = r.palette[r.blocks[i]];
    if (!state || isAir(state)) continue;
    const x = i % sx,
      z = Math.floor(i / sx) % sz,
      y = Math.floor(i / (sx * sz));
    yield {
      position: [r.min[0] + x, r.min[1] + y, r.min[2] + z],
      local: [x, y, z],
      state,
      index: i,
    };
  }
}
export function materials(s: Schematic, hidden: string[] = []): Material[] {
  const counts = new Map<string, number>();
  for (const r of s.regions) {
    if (hidden.includes(r.name)) continue;
    const local = new Uint32Array(r.palette.length);
    for (const id of r.blocks) local[id]++;
    r.palette.forEach((b, i) => {
      if (!isAir(b) && local[i])
        counts.set(b.name, (counts.get(b.name) ?? 0) + local[i]);
    });
  }
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
