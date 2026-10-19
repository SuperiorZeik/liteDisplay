import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BlockDefinition } from "deepslate/render";
import {
  appearanceKey,
  bannerPatterns,
  blockEntityIndex,
  blockEntityPosition,
  componentText,
  signFaces,
} from "../src/core/block-entities";
import { compound, list, tag, xyz } from "../src/core/nbt";
import { packIndices, parseRoot, parseSchematic } from "../src/core/parser";
import { blockEntityDemoFile } from "../src/core/demo";
import { Resources } from "../src/render/resources";
import { specialBlockMesh, meshGeometry } from "../src/render/block-entities";
import type { BlockState, Compound } from "../src/core/types";

const state = (
  name: string,
  properties: Record<string, string> = {},
): BlockState => ({ name: `minecraft:${name}`, properties });
const atlas = JSON.parse(readFileSync("public/minecraft/atlas.json", "utf8"));
const requested = new Set<string>();
const provider = {
  getTextureAtlas: () => ({}) as ImageData,
  getTextureUV: (id: { path: string }) => {
    const path =
      id.path === "entity/banner/banner_base" ? "entity/banner_base" : id.path;
    requested.add(path);
    const extra =
      path === "entity/player/wide/steve"
        ? "steve.png"
        : /^entity\/signs\/hanging\//.test(path)
          ? `hanging-sign-${path.split("/").at(-1)}.png`
          : undefined;
    const png = extra ? readFileSync(`public/minecraft/${extra}`) : undefined;
    const rect =
      atlas[path] ??
      (png ? [0, 1248, png.readUInt32BE(16), png.readUInt32BE(20)] : undefined);
    assert(rect, `Bundled texture missing: ${path}`);
    const [x, y, w, h] = rect;
    return [x / 2048, y / 1312, (x + w) / 2048, (y + h) / 1312] as [
      number,
      number,
      number,
      number,
    ];
  },
};

test("locates region-local block entities in modern, Sponge, and vanilla forms", () => {
  assert.deepEqual(
    blockEntityPosition({ x: tag(3, 1), y: tag(3, 2), z: tag(3, 3) }),
    [1, 2, 3],
  );
  assert.deepEqual(
    blockEntityPosition({ Pos: tag(11, new Int32Array([2, 0, 4])) }),
    [2, 0, 4],
  );
  assert.deepEqual(blockEntityPosition({ pos: list(3, [3, 1, 0]) }), [3, 1, 0]);
  assert.equal(blockEntityPosition({}), undefined);
  assert.equal(
    blockEntityIndex([{}, { Pos: tag(11, new Int32Array([2, 0, 4])) }]).size,
    1,
  );
});

test("normalizes legacy and modern banner patterns to the same appearance key", () => {
  const modern = {
    patterns: list(10, [
      { pattern: tag(8, "minecraft:cross"), color: tag(8, "red") },
    ]),
  };
  const legacy = {
    Patterns: list(10, [{ Pattern: tag(8, "cr"), Color: tag(3, 14) }]),
  };
  assert.deepEqual(bannerPatterns(legacy), bannerPatterns(modern));
  assert.equal(
    appearanceKey(state("white_banner"), legacy),
    appearanceKey(state("white_banner"), modern),
  );
  assert.notEqual(
    appearanceKey(state("white_banner"), legacy),
    appearanceKey(state("white_banner")),
  );
  assert.equal(
    bannerPatterns({
      patterns: list(10, [
        { pattern: tag(8, "https://example.com"), color: tag(8, "red") },
      ]),
    }).length,
    0,
  );
});

test("sign text supports front/back and legacy text without interpreting events or HTML", () => {
  const c = {
    front_text: compound({
      messages: list(8, [
        JSON.stringify({
          text: "你好",
          extra: [{ text: "世界" }],
          clickEvent: { action: "run_command", value: "/op" },
        }),
      ]),
      color: tag(8, "red"),
      has_glowing_text: tag(1, 1),
    }),
    back_text: compound({ messages: list(8, ['"背面"']) }),
  };
  assert.deepEqual(signFaces(c)[0], {
    lines: ["你好世界", "", "", ""],
    color: "red",
    glow: true,
  });
  assert.equal(signFaces(c)[1].lines[0], "背面");
  assert.equal(
    signFaces({ Text1: tag(8, '{"text":"舊版"}'), Color: tag(8, "blue") })[0]
      .lines[0],
    "舊版",
  );
  assert.equal(componentText('{"text":"<script>"}'), "<script>");
  assert.equal(componentText("x".repeat(2000)).length, 512);
  assert.notEqual(
    appearanceKey(state("oak_sign"), c),
    appearanceKey(state("oak_sign")),
  );
  assert.equal(
    appearanceKey(state("chest"), { Items: list(10, []), x: tag(3, 1) }),
    appearanceKey(state("chest"), { x: tag(3, 9) }),
  );
});

test("all first-batch special models have bundled textures and finite geometry", () => {
  for (const s of [
    state("chest", { facing: "south", type: "single" }),
    state("trapped_chest"),
    state("ender_chest"),
    state("red_bed", { part: "head", facing: "east" }),
    state("red_bed", { part: "foot" }),
    state("shulker_box", { facing: "east" }),
    state("blue_shulker_box", { facing: "down" }),
    state("oak_sign", { rotation: "4" }),
    state("cherry_wall_sign", { facing: "east" }),
    state("bamboo_hanging_sign", { rotation: "2" }),
    state("oak_wall_hanging_sign", { facing: "west" }),
    state("white_banner"),
    state("blue_wall_banner", { facing: "east" }),
    state("bell"),
    state("conduit"),
    state("decorated_pot"),
    ...[
      "skeleton_skull",
      "wither_skeleton_skull",
      "zombie_head",
      "creeper_head",
      "player_head",
      "dragon_head",
      "piglin_head",
      "skeleton_wall_skull",
      "player_wall_head",
    ].map((n) => state(n, { rotation: "0", facing: "north" })),
  ]) {
    const mesh = specialBlockMesh(s, undefined, provider)!;
    assert(mesh.quads.length > 0, s.name);
    const g = meshGeometry(mesh);
    assert(
      [...g.getAttribute("position").array].every(Number.isFinite),
      s.name,
    );
    assert(
      [...g.getAttribute("uv").array].every((n) => n >= 0 && n <= 1),
      s.name,
    );
    g.dispose();
  }
  assert(requested.has("entity/player/wide/steve"));
});

test("newer native-NBT text components also render as plain text", () => {
  const c = {
    front_text: compound({
      messages: list(10, [
        { text: tag(8, "原生"), extra: list(10, [{ text: tag(8, "文字") }]) },
      ]),
    }),
  };
  assert.equal(signFaces(c)[0].lines[0], "原生文字");
});

test("double chest halves join on the correct edge in all four directions", () => {
  const offset: Record<string, [number, number]> = {
    north: [1, 0],
    south: [-1, 0],
    west: [0, -1],
    east: [0, 1],
  };
  for (const facing of Object.keys(offset)) {
    const left = meshGeometry(
      specialBlockMesh(
        state("chest", { facing, type: "left" }),
        undefined,
        provider,
      )!,
    );
    const right = meshGeometry(
      specialBlockMesh(
        state("chest", { facing, type: "right" }),
        undefined,
        provider,
      )!,
    );
    left.computeBoundingBox();
    right.translate(offset[facing][0], 0, offset[facing][1]);
    right.computeBoundingBox();
    const a = left.boundingBox!,
      b = right.boundingBox!;
    const axis = offset[facing][0] ? "x" : "z";
    assert(
      Math.abs(
        offset[facing][0] + offset[facing][1] > 0
          ? a.max[axis] - b.min[axis]
          : a.min[axis] - b.max[axis],
      ) < 1e-6,
      facing,
    );
    left.dispose();
    right.dispose();
  }
});

test("banner layers change geometry/color, not just the cache key", () => {
  const plain = specialBlockMesh(state("white_banner"), undefined, provider)!;
  const patterned = specialBlockMesh(
    state("white_banner"),
    { Patterns: list(10, [{ Pattern: tag(8, "cr"), Color: tag(3, 14) }]) },
    provider,
  )!;
  assert(patterned.quads.length > plain.quads.length);
  assert.notDeepEqual(
    patterned.quads.at(-1)!.v1.color,
    plain.quads[0].v1.color,
  );
});

test("renderer geometry cache keeps different NBT appearances apart and includes bell supports", () => {
  const resources = new Resources();
  const r = resources as any;
  r.rawModels = JSON.parse(
    readFileSync("public/minecraft/models.json", "utf8"),
  );
  const defs = JSON.parse(
    readFileSync("public/minecraft/blockstates.json", "utf8"),
  );
  for (const [key, data] of Object.entries(defs))
    r.definitions.set(`minecraft:${key}`, BlockDefinition.fromJson(data));
  r.uv = Object.fromEntries(
    Object.entries(atlas).map(([k, v]: [string, any]) => [
      k,
      [v[0] / 2048, v[1] / 1312, (v[0] + v[2]) / 2048, (v[1] + v[3]) / 1312],
    ]),
  );
  r.buildModels();
  const plain = resources.geometry(state("white_banner")),
    patterned = resources.geometry(state("white_banner"), {
      Patterns: list(10, [{ Pattern: tag(8, "cr"), Color: tag(3, 14) }]),
    });
  assert.notEqual(plain, patterned);
  assert.equal(plain, resources.geometry(state("white_banner")));
  const bell = resources.geometry(
    state("bell", { facing: "south", attachment: "floor", powered: "false" }),
  );
  assert(
    bell.getAttribute("position").count >
      meshGeometry(
        specialBlockMesh(state("bell"), undefined, provider)!,
      ).getAttribute("position").count,
  );
  assert(!bell.userData.fallback);
  resources.dispose();
});

test("vanilla NBT and Sponge v3 preserve outer position alongside inner visual NBT", () => {
  const text = { Text1: tag(8, '"座標"') };
  const vanilla = parseRoot(
    {
      size: list(3, [2, 1, 1]),
      palette: list(10, [{ Name: tag(8, "minecraft:oak_sign") }]),
      blocks: list(10, [
        { pos: list(3, [1, 0, 0]), state: tag(3, 0), nbt: compound(text) },
      ]),
    },
    "sign.nbt",
  );
  assert.equal(
    blockEntityIndex(vanilla.regions[0].blockEntities).get("1,0,0")?.Text1
      .value,
    '"座標"',
  );
  const sponge = parseRoot(
    {
      Version: tag(3, 3),
      Width: tag(2, 2),
      Height: tag(2, 1),
      Length: tag(2, 1),
      Offset: tag(11, new Int32Array([8, 2, -4])),
      Blocks: compound({
        Palette: compound({ "minecraft:oak_sign": tag(3, 0) }),
        Data: tag(7, new Uint8Array([0, 0])),
        BlockEntities: list(10, [
          {
            Pos: tag(11, new Int32Array([1, 0, 0])),
            Id: tag(8, "minecraft:sign"),
            Data: compound(text),
          },
        ]),
      }),
    },
    "sign.schem",
  );
  assert.equal(
    blockEntityIndex(sponge.regions[0].blockEntities).get("1,0,0")?.Text1.value,
    '"座標"',
  );
});

test("Litematic v1 wrapper and negative region sizes use minimum-corner local block-entity positions", () => {
  const s = parseRoot(
    {
      Version: tag(3, 1),
      Regions: compound({
        main: compound({
          Position: xyz([10, 5, 20]),
          Size: xyz([-2, -1, 1]),
          BlockStatePalette: list(10, [{ Name: tag(8, "minecraft:oak_sign") }]),
          BlockStates: tag(12, packIndices(new Uint32Array(2), 1)),
          TileEntities: list(10, [
            {
              Pos: xyz([1, 0, 0]),
              TileNBT: compound({ Text1: tag(8, '"舊版"') }),
            },
          ]),
        }),
      }),
    },
    "old.litematic",
  );
  assert.deepEqual(s.regions[0].min, [9, 5, 20]);
  assert.equal(
    blockEntityIndex(s.regions[0].blockEntities).get("1,0,0")?.Text1.value,
    '"舊版"',
  );
});

test("downloadable exhibition includes distinct sign text and modern/legacy banner NBT", async () => {
  const file = blockEntityDemoFile();
  const s = parseSchematic(new Uint8Array(await file.arrayBuffer()), file.name);
  assert.equal(s.name, "方塊實體展示台");
  const es = s.regions[0].blockEntities;
  assert.equal(es.length, 4);
  assert.notEqual(signFaces(es[0])[0].lines[0], signFaces(es[1])[0].lines[0]);
  assert.equal(bannerPatterns(es[2]).length, 2);
  assert.equal(bannerPatterns(es[3]).length, 2);
});
