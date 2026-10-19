import { test } from "node:test";
import assert from "node:assert/strict";
import { readNbt, writeNbt, compound, tag, list, xyz } from "../src/core/nbt";
import {
  unpackIndices,
  packIndices,
  parseRoot,
  parseSchematic,
} from "../src/core/parser";
import { AIR, eachBlock, materials, type Compound } from "../src/core/types";
import { demoFile } from "../src/core/demo";

const palette = [
  { Name: tag(8, "minecraft:air") },
  { Name: tag(8, "minecraft:stone") },
];
function fixture(region: Compound, version = 6): Compound {
  return {
    Version: tag(3, version),
    MinecraftDataVersion: tag(3, 3953),
    Metadata: compound({
      Name: tag(8, "測試藍圖"),
      Author: tag(8, "測試作者"),
    }),
    Regions: compound({ main: compound(region) }),
  };
}
test("3-bit indices cross a signed 64-bit word without padding", () => {
  // 21 entries × 3 bits = 63. The next ID (7) occupies bit 63 and bits 0–1.
  const words = [-(1n << 63n), 3n];
  const result = unpackIndices(words, 8, 22);
  assert.deepEqual([...result.slice(0, 21)], Array(21).fill(0));
  assert.equal(result[21], 7);
});
test("palette width uses minimum 2 bits and expands at power-of-two boundaries", () => {
  for (const p of [1, 2, 4, 5, 8, 9, 16, 17, 256, 257]) {
    const values = Uint32Array.from({ length: 145 }, (_, i) => i % p),
      words = packIndices(values, p);
    assert.equal(
      words.length,
      Math.ceil((145 * Math.max(2, Math.ceil(Math.log2(p)))) / 64),
    );
    assert.deepEqual(unpackIndices(words, p, 145), values);
  }
});
test("rejects truncated words and invalid palette references", () => {
  assert.throws(() => unpackIndices([], 2, 1), /長度/);
  assert.throws(() => unpackIndices([3n], 2, 1), /範圍/);
});
test("negative region sizes preserve minimum corner and X-Z-Y array order", () => {
  const c = fixture({
    Position: xyz([10, 5, 20]),
    Size: xyz([-3, -2, 2]),
    BlockStatePalette: list(10, palette),
    BlockStates: tag(
      12,
      packIndices(Uint32Array.from([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]), 2),
    ),
  });
  const s = parseRoot(c, "test.litematic"),
    r = s.regions[0];
  assert.deepEqual(r.min, [8, 4, 20]);
  assert.deepEqual(r.size, [3, 2, 2]);
  assert.deepEqual(
    [...eachBlock(r)].map((b) => b.position),
    [
      [8, 4, 20],
      [10, 5, 21],
    ],
  );
  assert.equal(s.blockCount, 2);
  assert.deepEqual(materials(s), [{ name: "minecraft:stone", count: 2 }]);
});
test("all NBT numeric array types and 64-bit values survive gzip and raw round trips", () => {
  const root: Compound = {
    Byte: tag(1, -5),
    Short: tag(2, -1234),
    Int: tag(3, 200000),
    Long: tag(4, -9223372036854775808n),
    Float: tag(5, 1.5),
    Double: tag(6, Math.PI),
    Bytes: tag(7, new Uint8Array([0, 128, 255])),
    Name: tag(8, "繁體中文 🧱"),
    List: list(3, [1, 2, 3]),
    Ints: tag(11, new Int32Array([-1, 2, 2147483647])),
    Longs: tag(12, new BigInt64Array([-1n, 1n << 62n])),
    Empty: list(10, []),
  };
  for (const compressed of [true, false]) {
    const result = readNbt(writeNbt(root, compressed));
    assert.equal(result.Long.value, root.Long.value);
    assert.equal(result.Name.value, root.Name.value);
    assert.deepEqual(result.Ints.value, root.Ints.value);
    assert.deepEqual(result.Longs.value, root.Longs.value);
    assert.equal((result.List.value as unknown[]).length, 3);
  }
});
test("invalid NBT and excessive region volumes fail before allocating blocks", () => {
  assert.throws(
    () => readNbt(new Uint8Array([10, 0, 0, 12, 0, 1, 97, 127, 255, 255, 255])),
    /資料不完整/,
  );
  assert.throws(
    () =>
      parseRoot(
        fixture({
          Position: xyz([0, 0, 0]),
          Size: xyz([1000, 1000, 1000]),
          BlockStatePalette: list(10, palette),
          BlockStates: tag(12, new BigInt64Array(1)),
        }),
        "bad.litematic",
      ),
    /800 萬/,
  );
});
test("vanilla structure without air in its palette keeps empty cells as air", () => {
  const s = parseRoot(
    {
      size: list(3, [2, 1, 1]),
      palette: list(10, [{ Name: tag(8, "minecraft:stone") }]),
      blocks: list(10, [{ pos: list(3, [1, 0, 0]), state: tag(3, 0) }]),
    },
    "structure.nbt",
  );
  assert.deepEqual(s.regions[0].palette[0], AIR);
  assert.equal(s.blockCount, 1);
  assert.deepEqual([...eachBlock(s.regions[0])][0].position, [1, 0, 0]);
});
test("Sponge v2 VarInts and v3 nested blocks normalize into the same model", () => {
  const common = {
    Version: tag(3, 2),
    Width: tag(2, 2),
    Height: tag(2, 1),
    Length: tag(2, 1),
    Offset: tag(11, new Int32Array([-2, 0, 4])),
  };
  const p = compound({
    "minecraft:air": tag(3, 0),
    "minecraft:stone": tag(3, 1),
  });
  const v2 = parseRoot(
    { ...common, Palette: p, BlockData: tag(7, new Uint8Array([0, 1])) },
    "test.schem",
  );
  const v3 = parseRoot(
    {
      Schematic: compound({
        ...common,
        Version: tag(3, 3),
        Blocks: compound({ Palette: p, Data: tag(7, new Uint8Array([0, 1])) }),
      }),
    },
    "test.schem",
  );
  assert.equal(v2.blockCount, 1);
  assert.equal(v3.blockCount, 1);
  assert.deepEqual(v3.min, [-2, 0, 4]);
});
test("procedural demo is a real compressed multi-region litematic", async () => {
  const f = demoFile(),
    bytes = new Uint8Array(await f.arrayBuffer());
  assert.equal(bytes[0], 31);
  const s = parseSchematic(bytes, f.name);
  assert.equal(s.name, "林間小屋");
  assert.equal(s.regions.length, 2);
  assert(s.blockCount > 1000);
  assert(s.regions.some((r) => r.position[0] < 0));
  assert(materials(s).some((m) => m.name === "minecraft:spruce_stairs"));
});
