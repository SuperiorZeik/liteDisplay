import { AIR, type BlockState, type Compound, type Vec3 } from "./types";
import { compound, list, tag, writeNbt, xyz } from "./nbt";
import { packIndices } from "./parser";

export function demoFile(): File {
  const palette: BlockState[] = [AIR],
    regions: Compound = {};
  function make(
    name: string,
    pos: Vec3,
    size: Vec3,
    build: (
      put: (
        x: number,
        y: number,
        z: number,
        name: string,
        props?: Record<string, string>,
      ) => void,
    ) => void,
  ) {
    const blocks = new Uint32Array(size[0] * size[1] * size[2]);
    build((x, y, z, name, props = {}) => {
      if (
        x < 0 ||
        y < 0 ||
        z < 0 ||
        x >= size[0] ||
        y >= size[1] ||
        z >= size[2]
      )
        return;
      const state = { name: `minecraft:${name}`, properties: props };
      let id = palette.findIndex(
        (b) =>
          b.name === state.name &&
          JSON.stringify(b.properties) === JSON.stringify(props),
      );
      if (id < 0) {
        id = palette.length;
        palette.push(state);
      }
      blocks[(y * size[2] + z) * size[0] + x] = id;
    });
    // Each region owns a compact palette, including air at index zero.
    const ids = [0, ...[...new Set(blocks)].filter((x) => x !== 0)],
      map = new Map(ids.map((id, i) => [id, i]));
    const local = Uint32Array.from(blocks, (id) => map.get(id)!);
    const tags = ids.map((id) => ({
      Name: tag(8, palette[id].name),
      Properties: compound(
        Object.fromEntries(
          Object.entries(palette[id].properties).map(([k, v]) => [
            k,
            tag(8, v),
          ]),
        ),
      ),
    }));
    regions[name] = compound({
      Position: xyz(pos),
      Size: xyz(size),
      BlockStatePalette: list(10, tags),
      BlockStates: tag(12, packIndices(local, tags.length)),
      Entities: list(10, []),
      TileEntities: list(10, []),
      PendingBlockTicks: list(10, []),
      PendingFluidTicks: list(10, []),
    });
  }
  make("林間小屋", [0, 0, 0], [19, 17, 17], (put) => {
    for (let x = 2; x < 17; x++)
      for (let z = 2; z < 15; z++) put(x, 0, z, "stone_bricks");
    for (let x = 3; x < 16; x++)
      for (let z = 3; z < 14; z++) put(x, 1, z, "spruce_planks");
    for (let y = 2; y <= 7; y++)
      for (let x = 3; x <= 15; x++)
        for (let z = 3; z <= 13; z++) {
          if (x !== 3 && x !== 15 && z !== 3 && z !== 13) continue;
          const corner = (x === 3 || x === 15) && (z === 3 || z === 13);
          if (corner) {
            put(x, y, z, "stripped_spruce_log", { axis: "y" });
            continue;
          }
          if (z === 3 && x >= 8 && x <= 9 && y <= 4) continue;
          const window =
            y >= 3 &&
            y <= 5 &&
            (((z === 3 || z === 13) &&
              (x === 5 || x === 6 || x === 12 || x === 13)) ||
              ((x === 3 || x === 15) &&
                (z === 6 || z === 7 || z === 10 || z === 11)));
          put(x, y, z, window ? "glass" : "white_concrete");
        }
    for (let step = 0; step < 8; step++)
      for (let z = 1; z <= 15; z++) {
        put(1 + step, 8 + step, z, "spruce_stairs", {
          facing: "east",
          half: "bottom",
          shape: "straight",
          waterlogged: "false",
        });
        put(17 - step, 8 + step, z, "spruce_stairs", {
          facing: "west",
          half: "bottom",
          shape: "straight",
          waterlogged: "false",
        });
        if (step > 0)
          for (const end of [3, 13])
            for (let y = 8; y < 8 + step; y++) {
              put(1 + step, y, end, "white_concrete");
              put(17 - step, y, end, "white_concrete");
            }
      }
    for (let z = 1; z <= 15; z++)
      put(9, 15, z, "spruce_slab", { type: "bottom", waterlogged: "false" });
    for (let y = 8; y <= 15; y++)
      for (let x = 12; x <= 13; x++)
        for (let z = 10; z <= 11; z++) put(x, y, z, "bricks");
    put(8, 2, 3, "spruce_door", {
      facing: "north",
      half: "lower",
      hinge: "left",
      open: "false",
      powered: "false",
    });
    put(8, 3, 3, "spruce_door", {
      facing: "north",
      half: "upper",
      hinge: "left",
      open: "false",
      powered: "false",
    });
    for (let x = 5; x <= 13; x++)
      for (let z = 0; z <= 2; z++) put(x, 1, z, "spruce_planks");
    for (const x of [5, 13])
      for (let z = 0; z <= 2; z++)
        put(x, 2, z, "spruce_fence", {
          north: "true",
          south: "true",
          east: "false",
          west: "false",
          waterlogged: "false",
        });
    for (let x = 8; x <= 10; x++) put(x, 0, -0, "stone_bricks");
    for (const x of [5, 13])
      put(x, 6, 2, "lantern", { hanging: "true", waterlogged: "false" });
    put(4, 2, 12, "crafting_table");
    put(5, 2, 12, "furnace", { facing: "south", lit: "false" });
    put(6, 2, 12, "chest", {
      facing: "south",
      type: "single",
      waterlogged: "false",
    });
  });
  make("庭院與小徑", [-4, -1, -5], [27, 7, 27], (put) => {
    for (let x = 0; x < 27; x++)
      for (let z = 0; z < 27; z++) {
        const dx = (x - 13) / 14,
          dz = (z - 13) / 14;
        if (dx * dx + dz * dz > 1) continue;
        put(x, 0, z, "grass_block", { snowy: "false" });
        if (x >= 11 && x <= 13 && z < 8) put(x, 0, z, "gravel");
        if ((x * 13 + z * 7) % 37 === 0 && z > 18) put(x, 1, z, "poppy");
      }
    for (const [tx, tz] of [
      [3, 16],
      [23, 21],
      [23, 7],
    ]) {
      for (let y = 1; y < 5; y++) put(tx, y, tz, "oak_log", { axis: "y" });
      for (let y = 3; y < 7; y++)
        for (let x = -2; x <= 2; x++)
          for (let z = -2; z <= 2; z++)
            if (Math.abs(x) + Math.abs(z) + (y === 6 ? 2 : 0) < 5)
              put(tx + x, y, tz + z, "oak_leaves", {
                distance: "1",
                persistent: "true",
                waterlogged: "false",
              });
    }
  });
  const root: Compound = {
    Version: tag(3, 6),
    MinecraftDataVersion: tag(3, 3953),
    Metadata: compound({
      Name: tag(8, "林間小屋"),
      Author: tag(8, "liteDisplay"),
      Description: tag(
        8,
        "一間藏在樹林裡的小屋。試試分層檢視，看看屋頂底下的空間。\n此示範藍圖由程式產生，可下載至 Minecraft 使用。",
      ),
      TimeCreated: tag(4, 1720000000000n),
    }),
    Regions: compound(regions),
  };
  return new File(
    [writeNbt(root) as Uint8Array<ArrayBuffer>],
    "woodland-cottage.litematic",
    { type: "application/octet-stream" },
  );
}

/** Small, downloadable fixture exercises appearance-dependent instancing without uploads. */
export function blockEntityDemoFile(): File {
  const size: Vec3 = [15, 4, 11],
    palette: BlockState[] = [AIR],
    blocks = new Uint32Array(size[0] * size[1] * size[2]);
  const tiles: Compound[] = [];
  const put = (
    x: number,
    y: number,
    z: number,
    name: string,
    properties: Record<string, string> = {},
    nbt?: Compound,
  ) => {
    palette.push({ name: `minecraft:${name}`, properties });
    blocks[(y * size[2] + z) * size[0] + x] = palette.length - 1;
    if (nbt) tiles.push({ ...nbt, x: tag(3, x), y: tag(3, y), z: tag(3, z) });
  };
  for (let x = 0; x < size[0]; x++)
    for (let z = 0; z < size[2]; z++)
      put(x, 0, z, (x + z) % 2 ? "smooth_stone" : "polished_andesite");
  put(1, 1, 2, "chest", { facing: "south", type: "single" });
  put(4, 1, 2, "chest", { facing: "south", type: "right" });
  put(5, 1, 2, "chest", { facing: "south", type: "left" });
  put(7, 1, 2, "ender_chest", { facing: "south" });
  put(10, 1, 2, "purple_shulker_box", { facing: "up" });
  put(12, 1, 2, "shulker_box", { facing: "east" });
  put(1, 1, 5, "red_bed", { facing: "south", part: "foot" });
  put(1, 1, 6, "red_bed", { facing: "south", part: "head" });
  put(4, 1, 5, "skeleton_skull", { rotation: "0" });
  put(6, 1, 5, "player_head", { rotation: "0" });
  put(8, 1, 5, "decorated_pot", { facing: "south", cracked: "false" });
  put(10, 1, 5, "conduit", { waterlogged: "false" });
  put(12, 1, 5, "bell", {
    facing: "south",
    attachment: "floor",
    powered: "false",
  });
  const text = (lines: string[], color: string, glow = false) =>
    compound({
      messages: list(
        8,
        lines.map((text) => JSON.stringify({ text })),
      ),
      color: tag(8, color),
      has_glowing_text: tag(1, glow ? 1 : 0),
    });
  put(
    2,
    1,
    9,
    "oak_sign",
    { rotation: "0" },
    {
      front_text: text(
        ["你好，Minecraft", "全裝置端預覽", "方塊實體", "liteDisplay"],
        "black",
      ),
      back_text: text(["BACK", "背面文字", "", ""], "blue"),
    },
  );
  put(
    5,
    1,
    9,
    "oak_sign",
    { rotation: "0" },
    {
      front_text: text(
        ["不同的文字", "不會合併外觀", "Hello!", ""],
        "red",
        true,
      ),
    },
  );
  put(
    8,
    1,
    9,
    "white_banner",
    { rotation: "0" },
    {
      patterns: list(10, [
        { pattern: tag(8, "minecraft:stripe_center"), color: tag(8, "blue") },
        { pattern: tag(8, "minecraft:border"), color: tag(8, "red") },
      ]),
    },
  );
  put(
    11,
    1,
    9,
    "white_banner",
    { rotation: "0" },
    {
      Patterns: list(10, [
        { Pattern: tag(8, "cr"), Color: tag(3, 14) },
        { Pattern: tag(8, "bo"), Color: tag(3, 15) },
      ]),
    },
  );
  const root: Compound = {
    Version: tag(3, 6),
    MinecraftDataVersion: tag(3, 3955),
    Metadata: compound({
      Name: tag(8, "方塊實體展示台"),
      Author: tag(8, "liteDisplay"),
      Description: tag(
        8,
        "箱子、床、界伏盒、頭顱、陶罐、海靈核心、鐘、不同文字的告示牌，以及新舊格式旗幟圖樣。",
      ),
    }),
    Regions: compound({
      展示台: compound({
        Position: xyz([0, 0, 0]),
        Size: xyz(size),
        BlockStatePalette: list(
          10,
          palette.map((s) => ({
            Name: tag(8, s.name),
            Properties: compound(
              Object.fromEntries(
                Object.entries(s.properties).map(([k, v]) => [k, tag(8, v)]),
              ),
            ),
          })),
        ),
        BlockStates: tag(12, packIndices(blocks, palette.length)),
        TileEntities: list(10, tiles),
        Entities: list(10, []),
      }),
    }),
  };
  return new File(
    [writeNbt(root) as Uint8Array<ArrayBuffer>],
    "block-entities.litematic",
    { type: "application/octet-stream" },
  );
}
