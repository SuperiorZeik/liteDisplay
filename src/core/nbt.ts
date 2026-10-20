import { Gunzip, gzipSync } from "fflate";
import type { Compound, Tag } from "./types";

const MAX_BYTES = 256 * 1024 * 1024;
const decoder = new TextDecoder();
export function decompress(input: Uint8Array): Uint8Array {
  if (input.length > 64 * 1024 * 1024)
    throw new Error("檔案超過 64 MB，請先在 Litematica 分割區域。");
  if (input[0] !== 0x1f || input[1] !== 0x8b) return input;
  const chunks: Uint8Array[] = [];
  let total = 0;
  const stream = new Gunzip((chunk) => {
    total += chunk.length;
    if (total > MAX_BYTES)
      throw new Error("解壓縮資料超過 256 MB，請使用較小的藍圖。");
    chunks.push(chunk);
  });
  for (let offset = 0; offset < input.length; offset += 8192)
    stream.push(
      input.subarray(offset, offset + 8192),
      offset + 8192 >= input.length,
    );
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
export function readNbt(input: Uint8Array): Compound {
  const bytes = decompress(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  let tags = 0;
  const need = (n: number) => {
    if (!Number.isSafeInteger(n) || n < 0 || offset + n > bytes.length)
      throw new Error("NBT 資料不完整，或陣列長度無效。");
  };
  const u8 = () => {
    need(1);
    return view.getUint8(offset++);
  };
  const i32 = () => {
    need(4);
    const v = view.getInt32(offset);
    offset += 4;
    return v;
  };
  const str = () => {
    need(2);
    const n = view.getUint16(offset);
    offset += 2;
    need(n);
    const s = decoder.decode(bytes.subarray(offset, offset + n));
    offset += n;
    return s;
  };
  function read(type: number, depth = 0): Tag {
    if (++tags > 4000000 || depth > 128)
      throw new Error("NBT 結構過於龐大或巢狀層數過深。");
    let value: unknown;
    switch (type) {
      case 1:
        need(1);
        value = view.getInt8(offset++);
        break;
      case 2:
        need(2);
        value = view.getInt16(offset);
        offset += 2;
        break;
      case 3:
        value = i32();
        break;
      case 4:
        need(8);
        value = view.getBigInt64(offset);
        offset += 8;
        break;
      case 5:
        need(4);
        value = view.getFloat32(offset);
        offset += 4;
        break;
      case 6:
        need(8);
        value = view.getFloat64(offset);
        offset += 8;
        break;
      case 7: {
        const n = i32();
        need(n);
        value = bytes.slice(offset, offset + n);
        offset += n;
        break;
      }
      case 8:
        value = str();
        break;
      case 9: {
        const listType = u8(),
          n = i32();
        if (n < 0 || n > 4000000 || (n > 0 && (listType < 1 || listType > 12)))
          throw new Error("NBT 清單型別或長度無效。");
        need(n);
        const list: Tag[] = [];
        for (let i = 0; i < n; i++) list.push(read(listType, depth + 1));
        return { type, value: list, listType };
      }
      case 10: {
        const obj: Compound = Object.create(null);
        for (;;) {
          const t = u8();
          if (!t) break;
          if (t > 12) throw new Error("未知 NBT 標籤型別。");
          const key = str();
          obj[key] = read(t, depth + 1);
        }
        value = obj;
        break;
      }
      case 11: {
        const n = i32();
        need(n * 4);
        const a = new Int32Array(n);
        for (let i = 0; i < n; i++) a[i] = i32();
        value = a;
        break;
      }
      case 12: {
        const n = i32();
        need(n * 8);
        const a = new BigInt64Array(n);
        for (let i = 0; i < n; i++) {
          a[i] = view.getBigInt64(offset);
          offset += 8;
        }
        value = a;
        break;
      }
      default:
        throw new Error(`不支援的 NBT 型別 ${type}`);
    }
    return { type, value };
  }
  if (u8() !== 10)
    throw new Error("找不到 NBT 根節點，請選擇有效的 Minecraft 藍圖。");
  str();
  return read(10).value as Compound;
}

export const tag = (type: number, value: unknown, listType?: number): Tag => ({
  type,
  value,
  ...(listType === undefined ? {} : { listType }),
});
export const compound = (c: Compound) => tag(10, c);
export const list = (type: number, values: unknown[]) =>
  tag(
    9,
    values.map((v) => tag(type, v)),
    type,
  );
export const xyz = (v: number[]) =>
  compound({ x: tag(3, v[0]), y: tag(3, v[1]), z: tag(3, v[2]) });
export function writeNbt(root: Compound, compressed = true): Uint8Array {
  const chunks: Uint8Array[] = [];
  const enc = new TextEncoder();
  const num = (n: number, bytes: number, kind: "int" | "float" = "int") => {
    const a = new Uint8Array(bytes),
      d = new DataView(a.buffer);
    if (kind === "float") {
      if (bytes === 4) d.setFloat32(0, n);
      else d.setFloat64(0, n);
    } else if (bytes === 1) d.setInt8(0, n);
    else if (bytes === 2) d.setInt16(0, n);
    else d.setInt32(0, n);
    chunks.push(a);
  };
  const string = (s: string) => {
    const a = enc.encode(s);
    if (a.length > 65535) throw new Error("NBT 字串過長");
    const b = new Uint8Array(2);
    new DataView(b.buffer).setUint16(0, a.length);
    chunks.push(b, a);
  };
  function write(t: Tag) {
    switch (t.type) {
      case 1:
        num(Number(t.value), 1);
        break;
      case 2:
        num(Number(t.value), 2);
        break;
      case 3:
        num(Number(t.value), 4);
        break;
      case 4: {
        const a = new Uint8Array(8);
        new DataView(a.buffer).setBigInt64(
          0,
          BigInt.asIntN(64, BigInt(t.value as bigint)),
        );
        chunks.push(a);
        break;
      }
      case 5:
        num(Number(t.value), 4, "float");
        break;
      case 6:
        num(Number(t.value), 8, "float");
        break;
      case 7: {
        const a = t.value as Uint8Array;
        num(a.length, 4);
        chunks.push(a);
        break;
      }
      case 8:
        string(String(t.value));
        break;
      case 9: {
        const a = t.value as Tag[];
        num(t.listType ?? a[0]?.type ?? 10, 1);
        num(a.length, 4);
        a.forEach(write);
        break;
      }
      case 10:
        for (const [key, v] of Object.entries(t.value as Compound)) {
          num(v.type, 1);
          string(key);
          write(v);
        }
        num(0, 1);
        break;
      case 11: {
        const a = t.value as Int32Array;
        num(a.length, 4);
        for (const n of a) num(n, 4);
        break;
      }
      case 12: {
        const a = t.value as BigInt64Array;
        num(a.length, 4);
        const bytes = new Uint8Array(a.length * 8),
          view = new DataView(bytes.buffer);
        for (let i = 0; i < a.length; i++) view.setBigInt64(i * 8, a[i]);
        chunks.push(bytes);
        break;
      }
    }
  }
  num(10, 1);
  string("");
  write(compound(root));
  const out = new Uint8Array(chunks.reduce((n, a) => n + a.length, 0));
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  return compressed ? gzipSync(out) : out;
}
export function nbtJson(value: unknown): string {
  return JSON.stringify(
    value,
    (_k, v) =>
      typeof v === "bigint"
        ? `${v}L`
        : ArrayBuffer.isView(v)
          ? Array.from(v as unknown as ArrayLike<unknown>)
          : v,
    2,
  );
}
