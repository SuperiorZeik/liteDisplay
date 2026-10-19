import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, relative, sep } from "node:path";
const out = resolve("dist");
const licenses = [];
for (const name of [
  "react",
  "react-dom",
  "three",
  "deepslate",
  "fflate",
  "lucide-react",
  "gl-matrix",
  "pako",
  "md5",
  "charenc",
  "crypt",
  "is-buffer",
]) {
  for (const filename of [
    "LICENSE",
    "LICENSE.md",
    "LICENSE.txt",
    "LICENSE-MIT",
  ]) {
    try {
      licenses.push(
        `\n--- ${name} ---\n${await readFile(resolve("node_modules", name, filename), "utf8")}`,
      );
      break;
    } catch {
      /* Packages differ in their license-file names. */
    }
  }
}
await writeFile(
  resolve(out, "third-party-notices.txt"),
  "Minecraft textures, models and translations © Mojang Studios / Microsoft. Not an official Minecraft product.\nDisplay assets: https://github.com/misode/mcmeta (Minecraft 1.21.1 tags).\nApplication dependencies:\n" +
    licenses.join("\n"),
);
async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((e) =>
        e.isDirectory()
          ? files(resolve(dir, e.name))
          : e.name === "sw.js"
            ? []
            : [resolve(dir, e.name)],
      ),
    )
  ).flat();
}
const all = await files(out),
  hasher = createHash("sha256");
for (const p of all) hasher.update(await readFile(p));
const version = hasher.digest("hex").slice(0, 12),
  paths = [
    "./",
    ...all.map((p) => "./" + relative(out, p).split(sep).join("/")),
  ];
const script = `const CACHE='litedisplay-${version}';
const FILES=${JSON.stringify(paths)};
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('litedisplay-')&&key!==CACHE).slice(0,-1).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
 event.respondWith(caches.open(CACHE).then(async cache=>{const hit=await cache.match(event.request,{ignoreSearch:true});if(hit)return hit;const previous=await caches.match(event.request,{ignoreSearch:true});if(previous)return previous;return fetch(event.request);}));});
`;
await writeFile(resolve(out, "sw.js"), script);
console.log(`Offline cache: ${paths.length} static files (${version})`);
