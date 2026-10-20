import * as THREE from "three";
import { BlockState as MinecraftBlockState, Identifier } from "deepslate/core";
import { NbtCompound, NbtList, NbtString } from "deepslate/nbt";
import {
  BlockModel,
  SpecialRenderers,
  type Mesh,
  type TextureAtlasProvider,
} from "deepslate/render";
import {
  bannerPatterns,
  signFaces,
  type SignFace,
} from "../core/block-entities";
import type { BlockState, Compound } from "../core/types";

const facingAngle = (facing = "north") =>
  ({ north: 0, west: Math.PI / 2, south: Math.PI, east: -Math.PI / 2 })[
    facing
  ] ?? 0;
function transform(mesh: Mesh, matrix: THREE.Matrix4) {
  return mesh.transform(new Float32Array(matrix.elements));
}
function pivot(rotation: THREE.Matrix4) {
  return new THREE.Matrix4()
    .makeTranslation(0.5, 0.5, 0.5)
    .multiply(rotation)
    .multiply(new THREE.Matrix4().makeTranslation(-0.5, -0.5, -0.5));
}
export function isSpecialBlock(state: BlockState) {
  return (
    state.name.startsWith("minecraft:") &&
    /:(chest|trapped_chest|ender_chest|decorated_pot|bell|conduit|shulker_box)$|_(bed|sign|banner|shulker_box|head|skull)$/.test(
      state.name,
    )
  );
}

function doubleChest(state: BlockState, atlas: TextureAtlasProvider) {
  // Each half stays owned by its own block, so slicing and ray picking remain exact.
  const left = state.properties.type === "left";
  const texture = `entity/chest/${state.name.endsWith("trapped_chest") ? "trapped" : "normal"}_${left ? "left" : "right"}`;
  const box = (
    from: number[],
    to: number[],
    u: number,
    v: number,
    w: number,
    h: number,
    d: number,
    bottomCrop = 0,
  ) => {
    const face = (rect: number[], rotation = 180) => ({
      texture: "#0",
      uv: rect.map((n) => n / 4),
      rotation,
    });
    return {
      from,
      to,
      faces: {
        // The entity model faces south; our unrotated mesh faces north.
        // That half-turn swaps east/west UVs too. The unused inner side is
        // transparent in the split skins, so failing to swap it cuts a hole
        // into the visible outside wall of a double chest.
        north: face([
          u + d + w + d,
          v + d + bottomCrop,
          u + d + w + d + w,
          v + d + h,
        ]),
        east: face([u, v + d + bottomCrop, u + d, v + d + h]),
        south: face([u + d, v + d + bottomCrop, u + d + w, v + d + h]),
        west: face([u + d + w, v + d + bottomCrop, u + d + w + d, v + d + h]),
        up: face([u + d + 2 * w, v, u + d + w, v + d], 0),
        down: face([u + d, v, u + d + w, v + d]),
      },
    };
  };
  const min = left ? 1 : 0,
    max = left ? 16 : 15;
  const model = BlockModel.fromJson({
    textures: { 0: texture },
    elements: [
      box([min, 0, 1], [max, 10, 15], 0, 19, 15, 10, 14),
      // Vanilla's five-pixel lid starts at y=9, overlapping the body by one.
      // Crop that hidden row in both geometry and UVs to prevent z-fighting.
      box([min, 10, 1], [max, 14, 15], 0, 0, 15, 5, 14, 1),
      box([left ? 15 : 0, 7, 0], [left ? 16 : 1, 11, 1], 0, 0, 1, 4, 1),
    ],
  });
  const mesh = model.getMesh(atlas, {});
  transform(mesh, new THREE.Matrix4().makeScale(1 / 16, 1 / 16, 1 / 16));
  return transform(
    mesh,
    pivot(
      new THREE.Matrix4().makeRotationY(facingAngle(state.properties.facing)),
    ),
  );
}

export function specialBlockMesh(
  state: BlockState,
  nbt: Compound | undefined,
  atlas: TextureAtlasProvider,
): Mesh | undefined {
  if (!isSpecialBlock(state)) return undefined;
  if (
    /:(chest|trapped_chest)$/.test(state.name) &&
    ["left", "right"].includes(state.properties.type)
  )
    return doubleChest(state, atlas);
  const properties: Record<string, string> = {
    ...state.properties,
    waterlogged: "false",
  };
  if (state.name === "minecraft:shulker_box") {
    const mesh = SpecialRenderers.shulkerBoxRenderer(
      Identifier.create("shulker"),
    )(atlas);
    transform(mesh, new THREE.Matrix4().makeScale(1 / 16, 1 / 16, 1 / 16));
    const f = properties.facing ?? "up";
    const r =
      f === "down"
        ? new THREE.Matrix4().makeRotationX(Math.PI)
        : f === "up"
          ? new THREE.Matrix4()
          : new THREE.Matrix4()
              .makeRotationY(facingAngle(f) + Math.PI)
              .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
    return transform(mesh, pivot(r));
  }
  const wallHead = /_wall_(head|skull)$/.test(state.name);
  const name = wallHead ? state.name.replace("_wall_", "_") : state.name;
  if (wallHead) properties.rotation = "8";
  else if (/_(head|skull)$/.test(name))
    properties.rotation = String(-Number(properties.rotation ?? 0));
  if (/_sign$/.test(name) && !/_wall_/.test(name))
    properties.rotation = String(8 - Number(properties.rotation ?? 0));
  const patterns = new NbtList(
    bannerPatterns(nbt).map((p) =>
      new NbtCompound()
        .set("pattern", new NbtString(p.pattern))
        .set("color", new NbtString(p.color)),
    ),
    10,
  );
  const data = new NbtCompound().set("patterns", patterns);
  const mesh = SpecialRenderers.getBlockMesh(
    new MinecraftBlockState(name, properties),
    data,
    atlas,
    {},
  );
  if (wallHead) {
    transform(mesh, new THREE.Matrix4().makeTranslation(0, 0.25, 0.25));
    transform(
      mesh,
      pivot(new THREE.Matrix4().makeRotationY(facingAngle(properties.facing))),
    );
  }
  return mesh;
}

export function meshGeometry(mesh: Mesh) {
  const positions: number[] = [],
    colors: number[] = [],
    uvs: number[] = [];
  for (const q of mesh.quads)
    for (const v of [q.v1, q.v2, q.v3, q.v1, q.v3, q.v4]) {
      positions.push(...v.pos.components());
      colors.push(...v.color);
      uvs.push(...(v.texture ?? [0, 0]));
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  return geometry;
}

const textColors: Record<string, string> = {
  black: "#1d1d21",
  red: "#b02e26",
  green: "#5e7c16",
  brown: "#835432",
  blue: "#3c44aa",
  purple: "#8932b8",
  cyan: "#169c9c",
  light_gray: "#9d9d97",
  gray: "#474f52",
  pink: "#f38baa",
  lime: "#80c71f",
  yellow: "#fed83d",
  light_blue: "#3ab3da",
  magenta: "#c74ebd",
  orange: "#f9801d",
  white: "#f9fffe",
};
function signTexture(face: SignFace) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = '36px "Noto Sans TC", "Microsoft JhengHei", sans-serif';
  ctx.fillStyle = textColors[face.color] ?? textColors.black;
  for (let i = 0; i < 4; i++) {
    const text = face.lines[i].replace(/§[0-9a-fk-or]/gi, "");
    if (face.glow) {
      ctx.strokeStyle = face.color === "black" ? "#eeeeee" : "#171717";
      ctx.lineWidth = 3;
      ctx.strokeText(text, 256, 35 + i * 60, 492);
    }
    ctx.fillText(text, 256, 35 + i * 60, 492);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
export interface SignOverlay {
  geometry: THREE.BufferGeometry;
  texture: THREE.Texture;
}
export function signOverlays(state: BlockState, nbt?: Compound): SignOverlay[] {
  if (!state.name.startsWith("minecraft:") || !/_sign$/.test(state.name))
    return [];
  const hanging = /hanging_sign$/.test(state.name),
    wall = /_wall_/.test(state.name);
  const scale = hanging ? 1 : 2 / 3;
  const cy = hanging
    ? 5 / 16
    : wall
      ? 0.5 + (10 / 16 - 0.5) * scale
      : 0.5 + (14 / 16 - 0.5) * scale;
  const cz = hanging ? 0.5 : wall ? 0.5 + (18 / 16 - 0.5) * scale : 0.5;
  const angle = wall
    ? facingAngle(state.properties.facing)
    : Math.PI - (Number(state.properties.rotation ?? 0) / 16) * 2 * Math.PI;
  const rotation = pivot(new THREE.Matrix4().makeRotationY(angle));
  return signFaces(nbt).flatMap((face, side) => {
    if (!face.lines.some(Boolean)) return [];
    const geometry = new THREE.PlaneGeometry(
      ((hanging ? 14 : 24) / 16) * scale * 0.94,
      ((hanging ? 10 : 12) / 16) * scale * 0.92,
    );
    if (side === 0) geometry.rotateY(Math.PI);
    geometry.translate(
      0.5,
      cy,
      cz + (side === 0 ? -1 : 1) * (scale / 16 + 0.002),
    );
    geometry.applyMatrix4(rotation);
    return [{ geometry, texture: signTexture(face) }];
  });
}
