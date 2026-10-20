import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blockIndex,
  blockTransfers,
  createBlockArray,
  LARGE_VOLUME,
  MAX_BLOCK_BYTES,
  packedIndex,
  packedWords,
  startingSlice,
} from "../src/core/block-storage";
import { compound, list, tag, writeNbt, xyz } from "../src/core/nbt";
import {
  packIndices,
  parseRoot,
  parseSchematic,
  unpackIndices,
} from "../src/core/parser";
import {
  blockAt,
  eachBlock,
  isAir,
  materials,
  type Compound,
  type Vec3,
} from "../src/core/types";

function root(
  size: Vec3,
  names: string[],
  words: BigInt64Array,
  position: Vec3 = [0, 0, 0],
): Compound {
  return {
    Version: tag(3, 6),
    Regions: compound({
      main: compound({
        Position: xyz(position),
        Size: xyz(size),
        BlockStatePalette: list(
          10,
          names.map((name) => ({ Name: tag(8, `minecraft:${name}`) })),
        ),
        BlockStates: tag(12, words),
      }),
    }),
  };
}
function sparseRoot(
  size: Vec3,
  cells: [number, number][],
  position: Vec3 = [0, 0, 0],
): Compound {
  const volume = size.reduce((n, v) => n * Math.abs(v), 1),
    words = new BigInt64Array(Math.ceil((volume * 2) / 64));
  for (const [index, id] of cells) {
    const bit = index * 2,
      w = Math.floor(bit / 64);
    words[w] = BigInt.asIntN(
      64,
      BigInt.asUintN(64, words[w]) | (BigInt(id) << BigInt(bit % 64)),
    );
  }
  return root(size, ["air", "stone", "glass"], words, position);
}

test("opens 27 million cells without a 108 MB expanded block array", () => {
  const n = 300 ** 3;
  const s = parseRoot(
    sparseRoot(
      [300, 300, 300],
      [
        [0, 1],
        [300 * 300 + 301, 2],
        [n - 1, 1],
      ],
    ),
    "large.litematic",
  );
  const r = s.regions[0];
  assert.equal(s.volume, n);
  assert.equal(r.packedBits, 2);
  assert.equal(r.blocks.byteLength, Math.ceil((n * 2) / 64) * 8);
  assert(r.blocks.byteLength < n);
  assert.equal(s.blockCount, 3);
  assert.equal(blockAt(r, 1, 1, 1)?.name, "minecraft:glass");
  assert.deepEqual(
    [...eachBlock(r)].map((b) => b.index),
    [0, 300 * 300 + 301, n - 1],
  );
  assert.equal(r.occupiedChunks?.length, 2);
  assert.deepEqual(materials(s), [
    { name: "minecraft:stone", count: 2 },
    { name: "minecraft:glass", count: 1 },
  ]);
  assert.equal(r.counts?.[0], n - 3);
  assert.deepEqual(startingSlice(s), { mode: "single", layer: 0 });
  assert(s.warnings.some((w) => w.includes("大型藍圖")));
});

test("large gzip NBT survives serialization, parsing, and transferable worker-style cloning", () => {
  const size: Vec3 = [220, 220, 220],
    n = 220 ** 3;
  const bytes = writeNbt(
    sparseRoot(size, [
      [17, 1],
      [n - 1, 2],
    ]),
  );
  const s = parseSchematic(bytes, "large.litematic"),
    r = s.regions[0];
  assert(s.volume > LARGE_VOLUME);
  const copy = structuredClone(s, { transfer: blockTransfers(s.regions) });
  assert.equal(r.blocks.byteLength, 0);
  assert.equal(r.counts!.byteLength, 0);
  assert.equal(r.occupiedChunks!.byteLength, 0);
  assert.equal(copy.volume, n);
  assert.deepEqual(
    [...eachBlock(copy.regions[0])].map((b) => b.index),
    [17, n - 1],
  );
  assert.equal(
    blockAt(copy.regions[0], 219, 219, 219)?.name,
    "minecraft:glass",
  );
  assert.equal(
    materials(copy).reduce((n, m) => n + m.count, 0),
    2,
  );
});

test("chunk traversal preserves X-Z-Y order and exact X/Y/Z single and cumulative slices", () => {
  const size: Vec3 = [35, 19, 34],
    n = size[0] * size[1] * size[2];
  const data = Uint32Array.from({ length: n }, (_, i) =>
    i % 43 === 0 ? 1 + (i % 4) : 0,
  );
  const s = parseRoot(
    root(
      size,
      ["air", "stone", "glass", "dirt", "sand"],
      packIndices(data, 5),
      [-20, -7, 9],
    ),
    "chunks.litematic",
  );
  const r = s.regions[0],
    all = [...eachBlock(r)];
  assert.deepEqual(
    all.map((b) => b.index),
    [...data].flatMap((id, i) => (id ? [i] : [])),
  );
  assert(all.every((b) => blockAt(r, ...b.local) === b.state));
  for (const axis of [0, 1, 2] as const)
    for (const mode of ["single", "below"] as const)
      for (const layer of [
        r.min[axis] - 1,
        r.min[axis],
        r.min[axis] + 16,
        s.max[axis],
        s.max[axis] + 1,
      ]) {
        assert.deepEqual(
          [...eachBlock(r, { axis, mode, layer })].map((b) => b.index),
          all
            .filter((b) =>
              mode === "single"
                ? b.position[axis] === layer
                : b.position[axis] <= layer,
            )
            .map((b) => b.index),
        );
      }
});

test("negative dimensions preserve local positions and choose a non-empty starting layer", () => {
  const n = 300 ** 3,
    index = (20 * 300 + 25) * 300 + 17;
  const s = parseRoot(
    sparseRoot(
      [-300, -300, 300],
      [
        [index, 1],
        [n - 1, 2],
      ],
      [100, 100, -20],
    ),
    "negative-large.litematic",
  );
  const r = s.regions[0];
  assert.deepEqual(r.min, [-199, -199, -20]);
  assert.deepEqual([...eachBlock(r)][0].local, [17, 20, 25]);
  assert.deepEqual(startingSlice(s), { mode: "single", layer: -179 });
});

test("fractional slices never produce blocks at fractional or aliased coordinates", () => {
  const s = parseRoot(
      sparseRoot(
        [3, 2, 2],
        [
          [0, 1],
          [1, 1],
          [4, 2],
        ],
      ),
      "fraction.litematic",
    ),
    r = s.regions[0];
  assert.equal(blockAt(r, 0.5, 0, 0), undefined);
  assert.deepEqual(
    [...eachBlock(r, { axis: 0, mode: "single", layer: 0.5 })],
    [],
  );
  assert.deepEqual(
    [...eachBlock(r, { axis: 0, mode: "below", layer: 0.5 })].map(
      (b) => b.index,
    ),
    [0],
  );
  assert.throws(() => createBlockArray(NaN, 2), /體積/);
  assert.throws(() => packedWords(new BigInt64Array(), 2, -1), /體積/);
});

test("does not treat palette index zero as air when it contains a solid block", () => {
  const size: Vec3 = [33, 3, 17],
    n = size[0] * size[1] * size[2];
  const data = new Uint32Array(n);
  data[0] = 1;
  data[n - 1] = 2;
  const s = parseRoot(
    root(size, ["stone", "air", "cave_air"], packIndices(data, 3)),
    "zero-solid.litematic",
  );
  assert.equal(s.blockCount, n - 2);
  assert.equal([...eachBlock(s.regions[0])].length, n - 2);
  assert.deepEqual(materials(s), [{ name: "minecraft:stone", count: n - 2 }]);
});

test("all-air regions have no occupied chunks and no preview traversal", () => {
  const s = parseRoot(sparseRoot([300, 300, 300], []), "air.litematic");
  assert.equal(s.blockCount, 0);
  assert.equal(s.regions[0].occupiedChunks?.length, 0);
  assert.deepEqual([...eachBlock(s.regions[0])], []);
  assert.deepEqual(materials(s), []);
});

test("32-bit packed decoder matches 64-bit packing through 16-bit palettes", () => {
  for (const paletteSize of [1, 2, 3, 5, 17, 129, 257, 4097, 65536]) {
    const values = Uint32Array.from(
        { length: 517 },
        (_, i) => (i * 7919) % paletteSize,
      ),
      words = packIndices(values, paletteSize);
    const packed = packedWords(words, paletteSize, values.length);
    assert.equal(packed.blocks.buffer, words.buffer);
    assert.deepEqual(
      [...values].map((_, i) => packedIndex(packed.blocks, packed.bits, i)),
      [...values],
    );
    assert.deepEqual(unpackIndices(words, paletteSize, values.length), values);
  }
});

test("rejects invalid packed indices even when zero-air spans are skipped", () => {
  const s = sparseRoot([40, 1, 1], []),
    r = (s.Regions.value as Compound).main.value as Compound;
  const data = r.BlockStates.value as BigInt64Array;
  data[1] = 3n << 10n;
  assert.throws(() => parseRoot(s, "bad.litematic"), /超出調色盤範圍/);
});

test("volume and byte budgets are checked before allocating expanded indices", () => {
  assert.throws(
    () =>
      parseRoot(
        root([1000, 1000, 1000], ["air"], new BigInt64Array()),
        "huge.litematic",
      ),
    /安全上限/,
  );
  assert.throws(() => createBlockArray(MAX_BLOCK_BYTES + 1, 2), /128 MiB/);
  assert.throws(
    () => createBlockArray(MAX_BLOCK_BYTES / 2 + 1, 257),
    /128 MiB/,
  );
  assert(createBlockArray(100, 2) instanceof Uint8Array);
  assert(createBlockArray(100, 257) instanceof Uint16Array);
});

test("large vanilla structures use narrow indices and retain only occupied chunk coordinates", () => {
  const s = parseRoot(
    {
      size: list(3, [210, 210, 210]),
      palette: list(10, [{ Name: tag(8, "minecraft:stone") }]),
      blocks: list(10, [{ pos: list(3, [209, 150, 209]), state: tag(3, 0) }]),
    },
    "large.nbt",
  );
  assert(s.regions[0].blocks instanceof Uint8Array);
  assert.equal(s.regions[0].blocks.byteLength, s.volume);
  assert.equal(s.blockCount, 1);
  assert.equal(blockIndex(s.regions[0], (150 * 210 + 209) * 210 + 209), 1);
  assert.deepEqual([...eachBlock(s.regions[0])][0].position, [209, 150, 209]);
  assert.equal(s.regions[0].occupiedChunks?.length, 1);
  assert.deepEqual(startingSlice(s), { mode: "single", layer: 150 });
});

test("supports the 512 million cell safety ceiling using packed storage", () => {
  const n = 800 ** 3;
  const s = parseRoot(
    sparseRoot(
      [800, 800, 800],
      [
        [0, 1],
        [n - 1, 2],
      ],
    ),
    "ceiling.litematic",
  );
  assert.equal(s.volume, 512_000_000);
  assert.equal(s.regions[0].blocks.byteLength, 128_000_000);
  assert(s.regions[0].blocks.byteLength <= MAX_BLOCK_BYTES);
  assert.deepEqual(
    [...eachBlock(s.regions[0])].map((b) => b.index),
    [0, n - 1],
  );
  assert.equal(s.blockCount, 2);
});

test("very thin sparse regions use a bounded sparse chunk index instead of a huge occupancy grid", () => {
  const n = 32_000_016;
  const s = parseRoot(
    sparseRoot(
      [n, 1, 1],
      [
        [0, 1],
        [n - 1, 2],
      ],
    ),
    "thin.litematic",
  );
  assert.equal(s.regions[0].occupiedChunks?.length, 2);
  assert.deepEqual(
    [...eachBlock(s.regions[0])].map((b) => b.index),
    [0, n - 1],
  );
});
