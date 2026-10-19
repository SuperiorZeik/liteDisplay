import {
  coordKey,
  stateKey,
  type BlockState,
  type Compound,
  type Tag,
  type Vec3,
} from "./types";

const value = (c: Compound | undefined, k: string) => c?.[k]?.value;
const object = (c: Compound | undefined, k: string): Compound | undefined =>
  c?.[k]?.type === 10 ? (c[k].value as Compound) : undefined;
const entries = (t: Tag | undefined): Tag[] =>
  t?.type === 9 ? (t.value as Tag[]) : [];

/** Positions are region-local, measured from its minimum corner, not its signed origin. */
export function blockEntityPosition(c: Compound): Vec3 | undefined {
  let p: number[];
  if (["x", "y", "z"].every((k) => c[k]))
    p = ["x", "y", "z"].map((k) => Number(value(c, k)));
  else {
    const t = c.Pos ?? c.pos;
    p =
      t?.type === 11
        ? Array.from(t.value as Int32Array)
        : entries(t).map((t) => Number(t.value));
  }
  return p.length === 3 && p.every(Number.isSafeInteger)
    ? (p as Vec3)
    : undefined;
}

export function blockEntityIndex(entities: Compound[]) {
  const index = new Map<string, Compound>();
  for (const c of entities) {
    const p = blockEntityPosition(c);
    if (p) index.set(coordKey(p), c);
  }
  return index;
}

export const dyeNames = [
  "white",
  "orange",
  "magenta",
  "light_blue",
  "yellow",
  "lime",
  "pink",
  "gray",
  "light_gray",
  "cyan",
  "purple",
  "blue",
  "brown",
  "green",
  "red",
  "black",
];
const legacyPatterns: Record<string, string> = {
  b: "base",
  bl: "square_bottom_left",
  br: "square_bottom_right",
  tl: "square_top_left",
  tr: "square_top_right",
  bs: "stripe_bottom",
  ts: "stripe_top",
  ls: "stripe_left",
  rs: "stripe_right",
  cs: "stripe_center",
  ms: "stripe_middle",
  drs: "stripe_downright",
  dls: "stripe_downleft",
  ss: "small_stripes",
  cr: "cross",
  sc: "straight_cross",
  bt: "triangle_bottom",
  tt: "triangle_top",
  bts: "triangles_bottom",
  tts: "triangles_top",
  ld: "diagonal_left",
  rd: "diagonal_up_right",
  lud: "diagonal_up_left",
  rud: "diagonal_right",
  mc: "circle",
  mr: "rhombus",
  vh: "half_vertical",
  hh: "half_horizontal",
  vhr: "half_vertical_right",
  hhb: "half_horizontal_bottom",
  bo: "border",
  cbo: "curly_border",
  gra: "gradient",
  gru: "gradient_up",
  bri: "bricks",
  glb: "globe",
  cre: "creeper",
  sku: "skull",
  flo: "flower",
  moj: "mojang",
  pig: "piglin",
  flw: "flow",
  gus: "guster",
};
export function bannerPatterns(
  c?: Compound,
): { pattern: string; color: string }[] {
  return entries(c?.patterns ?? c?.Patterns)
    .slice(0, 64)
    .flatMap((t) => {
      if (t.type !== 10) return [];
      const p = t.value as Compound;
      const raw = String(value(p, "pattern") ?? value(p, "Pattern") ?? "");
      const pattern = legacyPatterns[raw] ?? raw;
      const color = value(p, "color") ?? dyeNames[Number(value(p, "Color"))];
      return /^(?:[a-z0-9_.-]+:)?[a-z0-9_][a-z0-9_/-]*$/.test(pattern) &&
        dyeNames.includes(String(color))
        ? [
            {
              pattern: pattern.includes(":") ? pattern : `minecraft:${pattern}`,
              color: String(color),
            },
          ]
        : [];
    });
}

/** Plain text only: never interpret HTML, commands, click events, URLs, or remote translation keys. */
export function componentText(input: unknown, depth = 0): string {
  if (depth > 16) return "";
  if (typeof input === "string") {
    if (depth === 0 && /^[\s]*[\[{"]/.test(input)) {
      try {
        return componentText(JSON.parse(input), depth + 1).slice(0, 512);
      } catch {
        /* legacy plain string */
      }
    }
    return input.slice(0, 512);
  }
  if (Array.isArray(input))
    return input
      .slice(0, 64)
      .map((v) => componentText(v, depth + 1))
      .join("")
      .slice(0, 512);
  if (!input || typeof input !== "object") return "";
  const c = input as Record<string, unknown>;
  return (
    componentText(c.text, depth + 1) + componentText(c.extra, depth + 1)
  ).slice(0, 512);
}

export interface SignFace {
  lines: string[];
  color: string;
  glow: boolean;
}
function nbtComponentText(t?: Tag, depth = 0): string {
  if (!t || depth > 16) return "";
  if (t.type === 8) return componentText(t.value);
  if (t.type === 9)
    return entries(t)
      .slice(0, 64)
      .map((child) => nbtComponentText(child, depth + 1))
      .join("")
      .slice(0, 512);
  if (t.type === 10) {
    const c = t.value as Compound;
    return (
      nbtComponentText(c.text, depth + 1) + nbtComponentText(c.extra, depth + 1)
    ).slice(0, 512);
  }
  return "";
}
export function signFaces(c?: Compound): [SignFace, SignFace] {
  const face = (key: string, legacy = false): SignFace => {
    const text = object(c, key);
    const messages = entries(text?.messages);
    return {
      lines: Array.from({ length: 4 }, (_, i) =>
        messages[i]
          ? nbtComponentText(messages[i])
          : componentText(legacy ? value(c, `Text${i + 1}`) : ""),
      ),
      color: String(
        value(text, "color") ??
          (legacy ? value(c, "Color") : undefined) ??
          "black",
      ),
      glow:
        Number(
          value(text, "has_glowing_text") ??
            (legacy ? value(c, "GlowingText") : 0),
        ) === 1,
    };
  };
  return [face("front_text", true), face("back_text")];
}

/** Only appearance-changing fields participate; inventories and coordinates must not explode batching. */
export function appearanceKey(state: BlockState, c?: Compound) {
  const visual = /_banner$/.test(state.name)
    ? bannerPatterns(c)
    : /_sign$/.test(state.name)
      ? signFaces(c)
      : null;
  return stateKey(state) + (visual ? JSON.stringify(visual) : "");
}
