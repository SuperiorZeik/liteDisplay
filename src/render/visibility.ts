import type { BlockState } from "../core/types";

export const MAX_PREVIEW_BLOCKS = 2_000_000;
export const PREVIEW_CHUNK_SIZE = 64;
// This order also defines the six-bit model face mask.
export const FACE_DIRECTIONS = ["east", "west", "up", "down", "south", "north"] as const;
export const FACE_STEPS = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0],
  [0, -1, 0], [0, 0, 1], [0, 0, -1],
] as const;

export function fullyOpaque(s: BlockState) {
  return !/air$|structure_void|slime|honey|piston|glass|leaves|stairs|slab|fence|door|trapdoor|wall$|pane|water|lava|torch|lantern|flower|poppy|tulip|sapling|rail|wire|lever|button|carpet|bed$|chest|hopper|chain|iron_bars|sign|banner|grass$|vine|ladder|cactus|snow$|campfire|candle|head|skull|pot|anvil|repeater|comparator|lily|bamboo|scaffolding|mushroom|seagrass|kelp|coral|lichen|roots|crop|wheat|beetroot|carrot|potato|stem|bush|dripleaf|azalea|fern|flowering|sugar_cane|lightning_rod|end_rod|tripwire|brewing|cauldron|enchanting|grindstone|stonecutter|bell|lectern|conduit|sea_pickle|turtle_egg|cocoa|snow|pointed|amethyst|pressure_plate|farmland|dirt_path/.test(s.name);
}

/** Additional shared faces which are hidden even though the neighbor is not a full opaque cube. */
export function sharedFaceMask(a: BlockState, b: BlockState) {
  if (a.name === "minecraft:slime_block" && b.name === a.name) return 63;
  if (
    /^minecraft:(farmland|dirt_path)$/.test(a.name) &&
    /^minecraft:(farmland|dirt_path)$/.test(b.name)
  ) return 1 | 2 | 16 | 32; // Both surfaces are 15/16 high; their top stays visible.
  return 0;
}
