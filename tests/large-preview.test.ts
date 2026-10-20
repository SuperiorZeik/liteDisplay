import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { BlueprintScene } from "../src/render/scene";
import { compound, list, tag, xyz } from "../src/core/nbt";
import { parseRoot } from "../src/core/parser";
import { materials, type ViewSettings } from "../src/core/types";

test("preview keeps a bounded mesh and reports truncation instead of throwing away large files", async () => {
  const n = 501_000;
  const schematic = parseRoot(
    {
      Version: tag(3, 6),
      Regions: compound({
        main: compound({
          Position: xyz([0, 0, 0]),
          Size: xyz([1000, 1, 501]),
          BlockStatePalette: list(10, [{ Name: tag(8, "minecraft:stone") }]),
          BlockStates: tag(12, new BigInt64Array(Math.ceil((n * 2) / 64))),
        }),
      }),
    },
    "preview-limit.litematic",
  );
  // Exercise real batching/instancing without creating a browser or WebGL context.
  const scene = Object.create(BlueprintScene.prototype) as BlueprintScene;
  let stats: { rendered: number; renderLimitReached?: boolean } | undefined;
  const geometry = new THREE.BoxGeometry(1, 1, 1),
    texture = new THREE.Texture();
  Object.assign(scene, {
    state: schematic,
    generation: 0,
    world: new THREE.Group(),
    boxes: new THREE.Group(),
    markers: new THREE.Group(),
    grid: new THREE.Group(),
    highlightBox: { visible: false },
    pickables: [],
    renderer: { setPixelRatio: () => {} },
    resources: { missing: new Set(), geometry: () => geometry, texture },
    onStats: (s: typeof stats) => {
      stats = s;
    },
  });
  const view: ViewSettings = {
    axis: 1,
    mode: "all",
    layer: 0,
    hidden: [],
    highlight: null,
    isolate: false,
    projection: "perspective",
    grid: false,
    bounds: false,
    wireframe: false,
    quality: "low",
  };
  await scene.update(schematic, view);
  assert.equal(stats?.rendered, 500_000);
  assert.equal(stats?.renderLimitReached, true);
  assert.equal((scene as any).world.children[0].count, 500_000);
  assert.equal(materials(schematic)[0].count, n);
  assert.equal(schematic.blockCount, n);
  (scene as any).clear();
  geometry.dispose();
  texture.dispose();
});
