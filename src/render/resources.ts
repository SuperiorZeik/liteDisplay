import * as THREE from "three";
import {
  BlockDefinition,
  BlockModel,
  type UV,
  type TextureAtlasProvider,
} from "deepslate/render";
import { Identifier } from "deepslate/core";
import { unzipSync } from "fflate";
import { type BlockState, type Compound } from "../core/types";
import { appearanceKey } from "../core/block-entities";
import { meshGeometry, specialBlockMesh } from "./block-entities";
import translations from "../data/block-labels.json";
import { FACE_DIRECTIONS } from "./visibility";

export const labels: Record<string, string> = translations;
export function blockLabel(name: string) {
  const [ns, path] = name.split(":");
  return (
    labels[`block.${ns}.${path}`] ??
    labels[`item.${ns}.${path}`] ??
    path ??
    name
  );
}
export function blockColor(name: string): string {
  if (/leaves|grass|moss|fern|vine/.test(name)) return "#679b55";
  if (/spruce|dark_oak/.test(name)) return "#7d593d";
  if (/oak|wood|log|planks|chest/.test(name)) return "#b18c56";
  if (/glass|ice/.test(name)) return "#a0d0cc";
  if (/water|blue|lapis/.test(name)) return "#588fb6";
  if (/brick|redstone|red_|poppy/.test(name)) return "#ac6357";
  if (/sand|birch|end_stone/.test(name)) return "#d9cd95";
  if (/white|quartz|snow|iron/.test(name)) return "#dcded4";
  if (/black|coal|obsidian/.test(name)) return "#49444e";
  if (/gold|yellow|lantern/.test(name)) return "#e7be59";
  if (/copper|orange/.test(name)) return "#bc8558";
  return "#919a91";
}
export class Resources {
  private models = new Map<string, BlockModel>();
  private definitions = new Map<string, BlockDefinition>();
  private geometries = new Map<string, THREE.BufferGeometry>();
  private rawModels: Record<string, any> = {};
  private uv: Record<string, number[]> = {};
  private atlasSize = 1024;
  private pixelData!: ImageData;
  texture!: THREE.Texture;
  missing = new Set<string>();
  customName = "";
  revision = 0;
  private urls: string[] = [];
  async load() {
    const base = import.meta.env.BASE_URL + "minecraft/";
    const read = async (name: string) => {
      const r = await fetch(base + name);
      if (!r.ok) throw new Error(`無法讀取顯示資源 ${name}`);
      return r.json();
    };
    const [defs, models, atlas] = await Promise.all([
      read("blockstates.json"),
      read("models.json"),
      read("atlas.json"),
    ]);
    this.rawModels = models;
    for (const [key, data] of Object.entries(defs))
      this.definitions.set(`minecraft:${key}`, BlockDefinition.fromJson(data));
    this.texture = await new THREE.TextureLoader().loadAsync(
      base + "atlas.png",
    );
    const img = this.texture.image as HTMLImageElement;
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height + 64;
    canvas.getContext("2d")!.drawImage(img, 0, 0);
    // Deep texture paths are omitted upstream: supply skins and hanging signs locally.
    const extras = [
      ["entity/player/wide/steve", "steve.png"],
      ...[
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
        `entity/signs/hanging/${wood}`,
        `hanging-sign-${wood}.png`,
      ]),
    ];
    const extraUV: Record<string, number[]> = {};
    await Promise.all(
      extras.map(async ([key, file], i) => {
        const skin = await new THREE.TextureLoader().loadAsync(base + file);
        const x = i * 64,
          width = skin.image.width,
          height = skin.image.height;
        canvas.getContext("2d")!.drawImage(skin.image, x, img.height);
        extraUV[key] = [
          x / img.width,
          img.height / canvas.height,
          (x + width) / img.width,
          (img.height + height) / canvas.height,
        ];
        skin.dispose();
      }),
    );
    this.pixelData = canvas
      .getContext("2d")!
      .getImageData(0, 0, canvas.width, canvas.height);
    this.texture.dispose();
    this.texture = new THREE.CanvasTexture(canvas);
    this.atlasSize = img.width;
    this.uv = Object.fromEntries(
      Object.entries(atlas as Record<string, number[]>).map(
        ([key, [x, y, w, h]]) => [
          key,
          [
            x / img.width,
            y / canvas.height,
            (x + w) / img.width,
            (y + (key.startsWith("entity/") ? h : Math.min(w, h))) /
              canvas.height,
          ],
        ],
      ),
    );
    Object.assign(this.uv, extraUV);
    this.configureTexture();
    this.buildModels();
  }
  private configureTexture() {
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.flipY = false;
    this.texture.generateMipmaps = false;
  }
  private buildModels() {
    this.revision++;
    this.models.clear();
    for (const [key, data] of Object.entries(this.rawModels))
      this.models.set(
        key.includes(":") ? key : `minecraft:${key}`,
        BlockModel.fromJson(data),
      );
    this.models.set(
      "minecraft:builtin/entity",
      BlockModel.fromJson({ elements: [] }),
    );
    const provider = {
      getBlockModel: (id: Identifier) => this.models.get(id.toString()) ?? null,
    };
    for (const m of this.models.values()) m.flatten(provider);
    for (const g of this.geometries.values()) g.dispose();
    this.geometries.clear();
    this.missing.clear();
  }
  geometry(state: BlockState, blockEntity?: Compound, faceMask = 0): THREE.BufferGeometry {
    const key = appearanceKey(state, blockEntity) + `|faces:${faceMask}`;
    if (this.geometries.has(key)) {
      const geometry = this.geometries.get(key)!;
      if (geometry.userData.fallback) this.missing.add(state.name);
      return geometry;
    }
    const definition = this.definitions.get(state.name);
    let geometry: THREE.BufferGeometry | undefined;
    try {
      const atlas: TextureAtlasProvider = {
        getTextureAtlas: () => this.pixelData,
        getTextureUV: (id: Identifier): UV => {
          const path =
            id.path === "entity/banner/banner_base"
              ? "entity/banner_base"
              : id.path;
          const uv = this.uv[id.toString()] ?? this.uv[path];
          if (!uv) throw new Error(`Missing texture: ${id}`);
          // mcmeta atlas uses normalized [u0,v0,u1,v1] coordinates.
          return uv as UV;
        },
      };
      const mesh = definition?.getMesh(
        Identifier.parse(state.name),
        state.properties,
        atlas,
        {
          getBlockModel: (id: Identifier) =>
            this.models.get(id.toString()) ?? null,
        },
        Object.fromEntries(FACE_DIRECTIONS.map((face, i) => [face, !!(faceMask & (1 << i))])),
      );
      const special = specialBlockMesh(state, blockEntity, atlas);
      // Bell supports use ordinary block models; the moving body uses an entity model.
      if (mesh && special) mesh.merge(special);
      const complete = mesh ?? special;
      if (complete?.quads.length) geometry = meshGeometry(complete);
      else if (faceMask && complete && this.geometry(state, blockEntity).userData.fallback !== true) {
        // A completely culled model is empty, not an unsupported block.
        geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(), 3));
      }
    } catch {
      /* Unknown modded/unsupported models remain identifiable and selectable. */
    }
    if (!geometry) {
      this.missing.add(state.name);
      geometry = new THREE.BoxGeometry(1, 1, 1);
      geometry.translate(0.5, 0.5, 0.5);
      const color = new THREE.Color(blockColor(state.name));
      const data = new Float32Array(
        geometry.getAttribute("position").count * 3,
      );
      for (let i = 0; i < data.length; i += 3) {
        data[i] = color.r;
        data[i + 1] = color.g;
        data[i + 2] = color.b;
      }
      geometry.setAttribute("color", new THREE.BufferAttribute(data, 3));
      geometry.userData.fallback = true;
    }
    geometry.computeBoundingSphere();
    this.geometries.set(key, geometry);
    return geometry;
  }
  async importPack(file: File) {
    if (file.size > 64 * 1024 * 1024) throw new Error("資源包上限為 64 MB。");
    let total = 0;
    const files = unzipSync(new Uint8Array(await file.arrayBuffer()), {
      filter: (f) => {
        const use =
          /^assets\/[^/]+\/(blockstates\/.*\.json|models\/.*\.json|textures\/.*\.png)$/.test(
            f.name,
          );
        if (use) {
          total += f.originalSize;
          if (total > 128 * 1024 * 1024)
            throw new Error("資源包解壓縮後超過 128 MB。");
        }
        return use;
      },
    });
    const canvas = document.createElement("canvas");
    const images: { key: string; image: ImageBitmap }[] = [];
    for (const [path, data] of Object.entries(files)) {
      const [, namespace, kind, ...parts] = path.split("/"),
        key = parts.join("/").replace(/\.(png|json)$/, "");
      if (kind === "blockstates")
        this.definitions.set(
          `${namespace}:${key}`,
          BlockDefinition.fromJson(JSON.parse(new TextDecoder().decode(data))),
        );
      if (kind === "models")
        this.rawModels[`${namespace}:${key}`] = JSON.parse(
          new TextDecoder().decode(data),
        );
      if (kind === "textures") {
        const image = await createImageBitmap(
          new Blob([data as Uint8Array<ArrayBuffer>], { type: "image/png" }),
        );
        if (image.width > 1024 || image.height > 16384) {
          image.close();
          throw new Error("材質尺寸過大。");
        }
        images.push({ key: `${namespace}:${key}`, image });
      }
    }
    if (!images.length && !Object.keys(files).length)
      throw new Error("找不到 assets/ 內的模型或 PNG 材質。");
    // Preserve the default atlas in the upper-left; resource-pack sprites occupy additional rows.
    const tile = Math.max(
        16,
        ...images.map((x) =>
          Math.max(
            x.image.width,
            x.key.includes(":entity/") ? x.image.height : x.image.width,
          ),
        ),
      ),
      cols = Math.floor(this.atlasSize / tile);
    if (cols < 1) throw new Error("材質寬度超過圖集限制。");
    const oldHeight = this.pixelData.height,
      newHeight = THREE.MathUtils.ceilPowerOfTwo(
        oldHeight + Math.ceil(images.length / cols) * tile,
      );
    if (newHeight > 8192) throw new Error("資源包圖集超過 8192 像素。");
    canvas.width = this.atlasSize;
    canvas.height = newHeight;
    const ctx = canvas.getContext("2d")!;
    ctx.putImageData(this.pixelData, 0, 0);
    for (const key of Object.keys(this.uv)) {
      const uv = this.uv[key];
      this.uv[key] = [
        uv[0],
        (uv[1] * oldHeight) / newHeight,
        uv[2],
        (uv[3] * oldHeight) / newHeight,
      ];
    }
    images.forEach(({ key, image }, i) => {
      const x = (i % cols) * tile,
        y = oldHeight + Math.floor(i / cols) * tile;
      const height = key.includes(":entity/")
        ? image.height
        : Math.min(image.width, image.height);
      ctx.drawImage(
        image,
        0,
        0,
        image.width,
        height,
        x,
        y,
        image.width,
        height,
      );
      this.uv[key] = [
        x / this.atlasSize,
        y / newHeight,
        (x + image.width) / this.atlasSize,
        (y + height) / newHeight,
      ];
      if (key.startsWith("minecraft:")) this.uv[key.slice(10)] = this.uv[key];
      image.close();
    });
    this.pixelData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    this.texture.dispose();
    this.texture = new THREE.CanvasTexture(canvas);
    this.configureTexture();
    this.customName = file.name;
    this.buildModels();
  }
  dispose() {
    this.texture?.dispose();
    for (const g of this.geometries.values()) g.dispose();
    for (const url of this.urls) URL.revokeObjectURL(url);
  }
}
