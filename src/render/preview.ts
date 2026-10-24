import type * as THREE from "three";
import { blockIndex } from "../core/block-storage";
import { appearanceKey, blockEntityIndex } from "../core/block-entities";
import { coordKey, eachBlock, type BlockState, type Compound, type PickedBlock, type Region, type Schematic, type ViewSettings } from "../core/types";
import { BlockIndices } from "./instances";
import { FACE_STEPS, fullyOpaque, MAX_PREVIEW_BLOCKS, PREVIEW_CHUNK_SIZE, sharedFaceMask } from "./visibility";
import type { Resources } from "./resources";
import type { DiffResult } from "./scene";

export interface PreviewStyle {
  state: BlockState;
  blockEntity?: Compound;
  geometry: THREE.BufferGeometry;
  type?: string;
}
export interface PreviewBatch {
  style: PreviewStyle;
  region?: Region;
  removed?: PickedBlock[];
  indices: BlockIndices;
}

export function pickBlock(batch: Pick<PreviewBatch, "region" | "removed" | "style">, index: number): PickedBlock {
  if (batch.removed) return batch.removed[index];
  const r = batch.region!;
  const x = index % r.size[0],
    z = Math.floor(index / r.size[0]) % r.size[2],
    y = Math.floor(index / (r.size[0] * r.size[2]));
  return {
    region: r.name,
    position: [r.min[0] + x, r.min[1] + y, r.min[2] + z],
    local: [x, y, z],
    state: batch.style.state,
    // The instance's own NBT, even when its appearance matches another block.
    blockEntity: blockEntityIndex(r.blockEntities).get(`${x},${y},${z}`),
  };
}

export async function buildPreview(
  state: Schematic,
  settings: ViewSettings,
  resources: Pick<Resources, "geometry">,
  diff?: DiffResult,
  cancelled = () => false,
) {
  const batches: PreviewBatch[] = [];
  let rendered = 0, visited = 0, renderLimitReached = false;
  const visibleState = (s: BlockState) => !settings.isolate || !settings.highlight || s.name === settings.highlight;
  const visiblePosition = (x: number, y: number, z: number) => {
    const value = settings.axis === 0 ? x : settings.axis === 1 ? y : z;
    return settings.mode === "all" || (settings.mode === "single" ? value === settings.layer : value <= settings.layer);
  };
  for (const r of state.regions) {
    if (settings.hidden.includes(r.name)) continue;
    const [sx, sy, sz] = r.size, plane = sx * sz;
    const opaque = r.palette.map((s) => fullyOpaque(s) && visibleState(s));
    const show = r.palette.map(visibleState);
    const shared = new Map<string, number[]>();
    for (const s of r.palette) {
      if (/^minecraft:(slime_block|farmland|dirt_path)$/.test(s.name) && !shared.has(s.name))
        shared.set(s.name, r.palette.map((near) => sharedFaceMask(s, near)));
    }
    const entities = blockEntityIndex(r.blockEntities);
    const styles = new Map<string | number, { style: PreviewStyle; chunks: Map<number, PreviewBatch> }>();
    const cx = Math.ceil(sx / PREVIEW_CHUNK_SIZE), cz = Math.ceil(sz / PREVIEW_CHUNK_SIZE);
    const strides = [1, -1, plane, -plane, sx, -sx];
    for (const b of eachBlock(r, settings)) {
      if (++visited % 12000 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (cancelled()) return;
      }
      const id = blockIndex(r, b.index);
      if (!show[id]) continue;
      const type = diff?.cells.get(coordKey(b.position));
      if (diff && !type) continue;
      const [x, y, z] = b.local;
      let mask = 0;
      if (!diff) {
        const same = shared.get(b.state.name);
        for (let face = 0; face < 6; face++) {
          const step = FACE_STEPS[face], nx = x + step[0], ny = y + step[1], nz = z + step[2];
          if (nx < 0 || nx >= sx || ny < 0 || ny >= sy || nz < 0 || nz >= sz) continue;
          if (!visiblePosition(r.min[0] + nx, r.min[1] + ny, r.min[2] + nz)) continue;
          const nearId = blockIndex(r, b.index + strides[face]);
          if (opaque[nearId] || (show[nearId] && ((same?.[nearId] ?? 0) & (1 << face))))
            mask |= 1 << face;
        }
        if (mask === 63 && opaque[id]) continue;
      }
      const entity = entities.size ? entities.get(coordKey(b.local)) : undefined;
      const key = entity
        ? `${appearanceKey(b.state, entity)}:${mask}:${type ?? ""}`
        : (id * 64 + mask) * 4 + (type === "added" ? 1 : type === "changed" ? 2 : 0);
      let style = styles.get(key);
      if (!style) {
        style = { style: { state: b.state, blockEntity: entity, geometry: resources.geometry(b.state, entity, mask), type }, chunks: new Map() };
        styles.set(key, style);
      }
      if (!style.style.geometry.getAttribute("position").count) continue;
      if (rendered >= MAX_PREVIEW_BLOCKS) { renderLimitReached = true; break; }
      const chunk = (Math.floor(y / PREVIEW_CHUNK_SIZE) * cz + Math.floor(z / PREVIEW_CHUNK_SIZE)) * cx + Math.floor(x / PREVIEW_CHUNK_SIZE);
      let batch = style.chunks.get(chunk);
      if (!batch) {
        // Also bound pathological files with thousands of distinct appearances.
        if (batches.length >= 16384) { renderLimitReached = true; break; }
        batch = { style: style.style, region: r, indices: new BlockIndices() };
        style.chunks.set(chunk, batch);
        batches.push(batch);
      }
      batch.indices.push(b.index);
      rendered++;
    }
    if (renderLimitReached) break;
  }
  if (diff && !renderLimitReached) {
    const removed = new Map<string, PreviewBatch>();
    for (let i = 0; i < diff.removedBlocks.length; i++) {
      if (++visited % 12000 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (cancelled()) return;
      }
      const b = diff.removedBlocks[i];
      if (settings.hidden.includes(b.region) || !visibleState(b.state) || !visiblePosition(...b.position)) continue;
      if (rendered >= MAX_PREVIEW_BLOCKS) { renderLimitReached = true; break; }
      const key = appearanceKey(b.state, b.blockEntity) + ":" + b.position.map((v) => Math.floor(v / PREVIEW_CHUNK_SIZE)).join(",");
      let batch = removed.get(key);
      if (!batch) {
        if (batches.length >= 16384) { renderLimitReached = true; break; }
        batch = { style: { state: b.state, blockEntity: b.blockEntity, geometry: resources.geometry(b.state, b.blockEntity), type: "removed" }, removed: diff.removedBlocks, indices: new BlockIndices() };
        removed.set(key, batch);
        batches.push(batch);
      }
      batch.indices.push(i);
      rendered++;
    }
  }
  return { batches, rendered, renderLimitReached };
}
