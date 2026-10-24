import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import * as THREE from "three";
import { compound, list, tag, xyz } from "../src/core/nbt";
import { packIndices, parseRoot, parseSchematic } from "../src/core/parser";
import { BlockInstances, translatedMaterial } from "../src/render/instances";
import { buildPreview } from "../src/render/preview";
import { allView, headlessScene, modelResources } from "./helpers/render";
import type { Vec3 } from "../src/core/types";

function fixture(size: Vec3, names: string[], values: number[]) {
  return parseRoot({ Version: tag(3, 6), Regions: compound({ main: compound({
    Position: xyz([0, 0, 0]), Size: xyz(size),
    BlockStatePalette: list(10, names.map((name) => ({ Name: tag(8, `minecraft:${name}`),
      ...(name === "farmland" ? { Properties: compound({ moisture: tag(8, "0") }) } : {}),
    }))),
    BlockStates: tag(12, packIndices(Uint32Array.from(values), names.length)),
  }) }) }, "test.litematic");
}

test("adjacent farmland keeps its recessed top, but removes shared sides and the covered bottom", async () => {
  const resources = modelResources();
  const s = fixture([3, 2, 3], ["stone", "farmland"], [...Array(9).fill(0), ...Array(9).fill(1)]);
  const preview = (await buildPreview(s, allView, resources))!;
  const center = preview.batches.find((b) => [...b.indices.finish()].includes(13))!;
  const geometry = center.style.geometry, positions = geometry.getAttribute("position");
  assert.equal(positions.count, 6, "only the two top triangles remain");
  for (let i = 0; i < positions.count; i++) assert.equal(positions.getY(i), 15 / 16);
  const sliced = (await buildPreview(s, { ...allView, mode: "single", layer: 1 }, resources))!;
  const exposed = sliced.batches.find((b) => [...b.indices.finish()].includes(13))!;
  assert.equal(exposed.style.geometry.getAttribute("position").count, 12, "slicing exposes the bottom again");
  const isolated = (await buildPreview(s, { ...allView, highlight: "minecraft:farmland", isolate: true }, resources))!;
  assert.equal(isolated.batches.find((b) => [...b.indices.finish()].includes(13))!.style.geometry.getAttribute("position").count, 12);
  resources.dispose();
});

test("slime neighbors remove shared outer faces while preserving their inner cubes and neighboring solid faces", async () => {
  const resources = modelResources();
  const s = fixture([3, 3, 3], ["slime_block"], Array(27).fill(0));
  const preview = (await buildPreview(s, allView, resources))!;
  assert.equal(preview.rendered, 27);
  const center = preview.batches.find((b) => [...b.indices.finish()].includes(13))!;
  assert.equal(center.style.geometry.getAttribute("position").count, 36);
  assert.equal(resources.geometry(s.regions[0].palette[0]).getAttribute("position").count, 72);
  const mixed = fixture([2, 1, 1], ["stone", "slime_block"], [0, 1]);
  const pair = (await buildPreview(mixed, allView, resources))!;
  assert.equal(pair.batches.find((b) => b.style.state.name === "minecraft:stone")!.style.geometry.getAttribute("position").count, 36);
  resources.dispose();
});

test("fully culled known models stay empty while unsupported models keep their fallback", () => {
  const resources = modelResources();
  const stone = { name: "minecraft:stone", properties: {} };
  assert.equal(resources.geometry(stone, undefined, 63).getAttribute("position").count, 0);
  assert(!resources.missing.has(stone.name));
  assert(resources.geometry({ name: "mod:unknown", properties: {} }, undefined, 63).userData.fallback);
  resources.dispose();
});

test("compact translated instances have correct bounds and exact picking under a parent transform", () => {
  const base = new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5);
  const material = translatedMaterial(new THREE.MeshLambertMaterial());
  const mesh = new BlockInstances(base, material, new Float32Array([-3, 2, 7, 4, 2, 7]));
  const parent = new THREE.Group();
  parent.position.set(10, -2, -5);
  parent.add(mesh);
  parent.updateMatrixWorld(true);
  assert.deepEqual(mesh.geometry.boundingBox!.min.toArray(), [-3, 2, 7]);
  assert.deepEqual(mesh.geometry.boundingBox!.max.toArray(), [5, 3, 8]);
  const ray = new THREE.Raycaster(new THREE.Vector3(14.5, 0.5, 10), new THREE.Vector3(0, 0, -1));
  const hits = ray.intersectObject(mesh);
  assert(hits.length);
  assert.equal(hits[0].instanceId, 1);
  assert.equal(hits[0].object, mesh);
  assert.equal(hits[0].distance, 7);
  assert.equal(mesh.offsets.array.byteLength, 24);
  mesh.geometry.dispose(); base.dispose(); material.dispose();
});

test("spatial batching keeps block picking and NBT precise, and resource changes invalidate reused meshes", async () => {
  const s = fixture([-130, 1, 1], ["stone"], Array(130).fill(0));
  s.regions[0].blockEntities = [0, 129].map((x) => ({
    x: tag(3, x), y: tag(3, 0), z: tag(3, 0), note: tag(8, `block-${x}`),
  }));
  const scene = headlessScene(s);
  await scene.update(s, allView);
  const meshes = [...(scene as any).world.children] as BlockInstances[];
  assert(meshes.length >= 3);
  const positions = meshes.flatMap((mesh) => Array.from({ length: mesh.count }, (_, i) => mesh.userData.pick(i).position[0]));
  assert.deepEqual(positions.sort((a, b) => a - b), Array.from({ length: 130 }, (_, i) => i - 129));
  const entities = meshes.flatMap((mesh) => Array.from({ length: mesh.count }, (_, i) => mesh.userData.pick(i)))
    .filter((b) => b.blockEntity);
  assert.deepEqual(entities.map((b) => [b.local[0], b.blockEntity.note.value]).sort((a, b) => Number(a[0]) - Number(b[0])), [[0, "block-0"], [129, "block-129"]]);
  await scene.update(s, { ...allView, bounds: true });
  assert.equal((scene as any).world.children[0], meshes[0]);
  scene.resources.revision++;
  await scene.update(s, allView);
  assert.notEqual((scene as any).world.children[0], meshes[0]);
  (scene as any).clear(); scene.resources.dispose();
});

test("a new slice cancels an in-flight large preview without leaving stale meshes", async () => {
  const s = fixture([200, 1, 200], ["stone"], Array(40000).fill(0));
  const scene = headlessScene(s);
  const first = scene.update(s, allView);
  const second = scene.update(s, { ...allView, axis: 0, mode: "single", layer: 199 });
  await Promise.all([first, second]);
  const meshes = (scene as any).world.children as BlockInstances[];
  assert.equal(meshes.reduce((n, mesh) => n + mesh.count, 0), 200);
  for (const mesh of meshes)
    for (let i = 0; i < mesh.count; i++) assert.equal(mesh.userData.pick(i).position[0], 199);
  (scene as any).clear(); scene.resources.dispose();
});

const realFile = process.env.LITEDISPLAY_PERF_FIXTURE;
test("large user fixture reaches its highest occupied layer without preview truncation", { skip: !realFile || !existsSync(realFile) }, async () => {
  const s = parseSchematic(new Uint8Array(readFileSync(realFile!)), "large.litematic");
  const scene = headlessScene(s);
  let limited = true;
  scene.onStats = (stats) => { limited = !!stats.renderLimitReached; };
  await scene.update(s, allView);
  assert.equal(limited, false);
  const meshes = (scene as any).world.children as BlockInstances[];
  const maxY = Math.max(...meshes.map((m) => m.geometry.boundingBox!.max.y));
  assert(maxY >= Math.max(...s.regions.map((r) => r.min[1] + r.contentMax![1])));
  assert.equal(s.blockCount, 1251970);
  (scene as any).clear(); scene.resources.dispose();
});
