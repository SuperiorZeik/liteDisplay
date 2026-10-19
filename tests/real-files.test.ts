import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { parseSchematic } from "../src/core/parser";
import { readNbt } from "../src/core/nbt";
import type { Compound } from "../src/core/types";
import { compareSchematics } from "../src/render/scene";

// Public upstream integration fixtures are downloaded into an ignored test directory.
const dir = "test-results/fixtures/";
for (const name of [
  "donut.litematic",
  "donut_modified.litematic",
  "axolotl.litematic",
])
  test(`real upstream file: ${name}`, { skip: !existsSync(dir + name) }, () => {
    const data = new Uint8Array(readFileSync(dir + name)),
      s = parseSchematic(data, name),
      root = readNbt(data),
      metadata = root.Metadata.value as Compound;
    assert.equal(s.blockCount, Number(metadata.TotalBlocks.value));
    assert(s.blockCount > 0);
    assert(s.regions.length > 0);
    assert.equal(s.name, String(metadata.Name.value));
    assert.deepEqual(
      s.size,
      ["x", "y", "z"].map((k) =>
        Number((metadata.EnclosingSize.value as Compound)[k].value),
      ),
    );
  });
test(
  "real donut revision produces a non-empty comparison and identical copies produce no difference",
  { skip: !existsSync(dir + "donut.litematic") },
  async () => {
    const a = parseSchematic(
        new Uint8Array(readFileSync(dir + "donut.litematic")),
        "a",
      ),
      b = parseSchematic(
        new Uint8Array(readFileSync(dir + "donut_modified.litematic")),
        "b",
      );
    const same = await compareSchematics(a, a);
    assert.equal(same.cells.size, 0);
    const diff = await compareSchematics(a, b);
    assert(diff.cells.size > 0);
    assert.equal(diff.cells.size, diff.added + diff.removed + diff.changed);
  },
);
