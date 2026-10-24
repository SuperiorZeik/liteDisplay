import { readFileSync } from "node:fs";
import * as THREE from "three";
import { BlockDefinition } from "deepslate/render";
import { Resources } from "../../src/render/resources";
import { BlueprintScene } from "../../src/render/scene";
import type { Schematic, ViewSettings } from "../../src/core/types";

export const allView: ViewSettings = {
  axis: 1, mode: "all", layer: 0, hidden: [], highlight: null, isolate: false,
  projection: "perspective", grid: false, bounds: false, wireframe: false, quality: "low",
};

/** Use the bundled model/UV data without a DOM or GPU; no model stubs. */
export function modelResources() {
  const resources = new Resources(), r = resources as any;
  r.rawModels = JSON.parse(readFileSync("public/minecraft/models.json", "utf8"));
  const defs = JSON.parse(readFileSync("public/minecraft/blockstates.json", "utf8"));
  for (const [key, data] of Object.entries(defs))
    r.definitions.set(`minecraft:${key}`, BlockDefinition.fromJson(data));
  const atlas = JSON.parse(readFileSync("public/minecraft/atlas.json", "utf8"));
  r.uv = Object.fromEntries(Object.entries(atlas).map(([key, raw]) => {
    const v = raw as number[];
    return [key, [v[0] / 2048, v[1] / 1312, (v[0] + v[2]) / 2048, (v[1] + v[3]) / 1312]];
  }));
  r.buildModels();
  resources.texture = new THREE.Texture();
  return resources;
}

export function headlessScene(s: Schematic, resources = modelResources()) {
  const scene = Object.create(BlueprintScene.prototype) as BlueprintScene;
  Object.assign(scene, {
    state: s, generation: 0, world: new THREE.Group(), boxes: new THREE.Group(),
    markers: new THREE.Group(), grid: new THREE.Group(), highlightBox: { visible: false },
    pickables: [], renderer: { setPixelRatio: () => {} }, resources, onStats: () => {},
  });
  return scene;
}
