import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
// Fixed upstream tags make the browser renderer reproducible and independent of live APIs.
const base = "https://raw.githubusercontent.com/misode/mcmeta/";
const files = {
  "blockstates.json": "1.21.1-summary/assets/block_definition/data.min.json",
  "models.json": "1.21.1-summary/assets/model/data.min.json",
  "atlas.json": "1.21.1-atlas/all/data.min.json",
  "atlas.png": "1.21.1-atlas/all/atlas.png",
  "steve.png":
    "1.21.1-assets/assets/minecraft/textures/entity/player/wide/steve.png",
  ...Object.fromEntries(
    [
      "oak",
      "spruce",
      "birch",
      "jungle",
      "acacia",
      "dark_oak",
      "mangrove",
      "cherry",
      "bamboo",
      "crimson",
      "warped",
    ].map((wood) => [
      `hanging-sign-${wood}.png`,
      `1.21.1-assets/assets/minecraft/textures/entity/signs/hanging/${wood}.png`,
    ]),
  ),
  "zh_tw.json": "1.21.1-assets/assets/minecraft/lang/zh_tw.json",
};
const dir = resolve("public/minecraft");
await mkdir(dir, { recursive: true });
await Promise.all(
  Object.entries(files).map(async ([name, path]) => {
    const response = await fetch(base + path);
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
    const buffer = new Uint8Array(await response.arrayBuffer());
    await writeFile(resolve(dir, name), buffer);
    if (name === "zh_tw.json") {
      const labels = Object.fromEntries(
        Object.entries(JSON.parse(new TextDecoder().decode(buffer))).filter(
          ([key]) => /^(block|item)\.minecraft\./.test(key),
        ),
      );
      await mkdir(resolve("src/data"), { recursive: true });
      await writeFile(
        resolve("src/data/block-labels.json"),
        JSON.stringify(labels),
      );
    }
    console.log(`${name}: ${buffer.length} bytes`);
  }),
);
await writeFile(
  resolve(dir, "sources.json"),
  JSON.stringify(
    {
      version: "1.21.1",
      source: "https://github.com/misode/mcmeta",
      files,
      attribution:
        "Minecraft assets © Mojang Studios. Not an official Minecraft product.",
    },
    null,
    2,
  ),
);
