import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Resources } from "./resources";
import {
  blockAt,
  coordKey,
  eachBlock,
  isAir,
  stateKey,
  type BlockState,
  type PickedBlock,
  type Schematic,
  type Vec3,
  type ViewSettings,
} from "../core/types";

export interface DiffResult {
  added: number;
  removed: number;
  changed: number;
  cells: Map<string, "added" | "removed" | "changed">;
  removedBlocks: PickedBlock[];
}
export async function compareSchematics(
  a: Schematic,
  b: Schematic,
): Promise<DiffResult> {
  if (a.blockCount + b.blockCount > 1_000_000)
    throw new Error("比較模式目前最多支援合計 100 萬個非空氣方塊。");
  const before = new Map<string, string>(),
    after = new Map<string, string>(),
    oldBlocks = new Map<string, PickedBlock>();
  for (const r of a.regions)
    for (const c of eachBlock(r)) {
      const key = coordKey(c.position);
      before.set(key, stateKey(c.state));
      oldBlocks.set(key, { region: r.name, ...c });
    }
  await new Promise((r) => setTimeout(r, 0));
  for (const r of b.regions)
    for (const c of eachBlock(r))
      after.set(coordKey(c.position), stateKey(c.state));
  const cells: DiffResult["cells"] = new Map(),
    removedBlocks: PickedBlock[] = [];
  let added = 0,
    removed = 0,
    changed = 0;
  for (const [key, state] of after) {
    if (!before.has(key)) {
      cells.set(key, "added");
      added++;
    } else if (before.get(key) !== state) {
      cells.set(key, "changed");
      changed++;
    }
  }
  for (const key of before.keys())
    if (!after.has(key)) {
      cells.set(key, "removed");
      removedBlocks.push(oldBlocks.get(key)!);
      removed++;
    }
  return { added, removed, changed, cells, removedBlocks };
}
const fullyOpaque = (s: BlockState | undefined) =>
  !!s &&
  !isAir(s) &&
  !/glass|leaves|stairs|slab|fence|door|trapdoor|wall$|pane|water|lava|torch|lantern|flower|poppy|tulip|sapling|rail|wire|lever|button|carpet|bed$|chest|hopper|chain|iron_bars|sign|banner|grass$|vine|ladder|cactus|snow$|campfire|candle|head|skull|pot|anvil|repeater|comparator|lily|bamboo|scaffolding|mushroom|seagrass|kelp|coral|lichen|roots|crop|wheat|beetroot|carrot|potato|stem|bush|dripleaf|azalea|fern|flowering|sugar_cane|lightning_rod|end_rod|tripwire|brewing|cauldron|enchanting|grindstone|stonecutter|bell|lectern|conduit|sea_pickle|turtle_egg|cocoa|snow|pointed|amethyst|pressure_plate|farmland|dirt_path/.test(
    s.name,
  );

export class BlueprintScene {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  controls: OrbitControls;
  resources = new Resources();
  private world = new THREE.Group();
  private boxes = new THREE.Group();
  private markers = new THREE.Group();
  private grid = new THREE.GridHelper(64, 64, 0x4b6257, 0x293b32);
  private pickables: THREE.InstancedMesh[] = [];
  private highlightBox = new THREE.Box3Helper(new THREE.Box3(), 0xc2f79c);
  private resizeObserver: ResizeObserver;
  private raf = 0;
  private generation = 0;
  private down: [number, number] = [0, 0];
  private state?: Schematic;
  private settings?: ViewSettings;
  private diff?: DiffResult;
  private disposed = false;
  private dirty = true;
  onPick: (b: PickedBlock | null) => void = () => {};
  onStats: (stats: { rendered: number; missing: string[] }) => void = () => {};
  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.host.appendChild(this.renderer.domElement);
    this.renderer.domElement.setAttribute(
      "aria-label",
      "可旋轉的 Minecraft 藍圖 3D 預覽",
    );
    this.renderer.domElement.setAttribute("role", "img");
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    this.controls.maxPolarAngle = Math.PI * 0.98;
    this.controls.addEventListener("change", () => (this.dirty = true));
    this.scene.add(
      this.world,
      this.boxes,
      this.grid,
      this.markers,
      this.highlightBox,
    );
    this.highlightBox.visible = false;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x849b8c, 2.4));
    const sun = new THREE.DirectionalLight(0xfff3db, 2.2);
    sun.position.set(-30, 70, 40);
    this.scene.add(sun);
    this.scene.fog = new THREE.FogExp2(0x17231e, 0.0012);
    this.camera.position.set(40, 35, 40);
    this.controls.target.set(0, 5, 0);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
    this.renderer.domElement.addEventListener("pointerdown", this.pointerDown);
    this.renderer.domElement.addEventListener("pointerup", this.pointerUp);
    const animate = () => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(animate);
      this.controls.update();
      if (this.dirty) {
        this.renderer.render(this.scene, this.camera);
        this.dirty = false;
      }
    };
    animate();
  }
  async initialize() {
    await this.resources.load();
  }
  private pointerDown = (e: PointerEvent) => {
    this.down = [e.clientX, e.clientY];
  };
  private pointerUp = (e: PointerEvent) => {
    if (
      Math.hypot(e.clientX - this.down[0], e.clientY - this.down[1]) > 5 ||
      e.button !== 0
    )
      return;
    const rect = this.renderer.domElement.getBoundingClientRect(),
      pointer = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        (-(e.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      ray = new THREE.Raycaster();
    ray.setFromCamera(pointer, this.camera);
    const hit = ray.intersectObjects(this.pickables, false)[0];
    if (hit && hit.instanceId !== undefined) {
      const m = hit.object as THREE.InstancedMesh;
      const b = (m.userData.blocks as PickedBlock[])[hit.instanceId];
      this.select(b);
      this.onPick(b);
    } else {
      this.highlightBox.visible = false;
      this.onPick(null);
      this.dirty = true;
    }
  };
  private resize() {
    const w = this.host.clientWidth,
      h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    if (this.camera instanceof THREE.PerspectiveCamera)
      this.camera.aspect = w / h;
    else {
      const half = (this.camera.top - this.camera.bottom) / 2;
      this.camera.left = (-half * w) / h;
      this.camera.right = (half * w) / h;
    }
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }
  private clear() {
    this.world.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) {
        o.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
    this.world.clear();
    this.pickables = [];
    this.boxes.traverse((o) => {
      if (o instanceof THREE.Box3Helper) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
    this.boxes.clear();
  }
  async update(state: Schematic, settings: ViewSettings, diff?: DiffResult) {
    const token = ++this.generation,
      changed = this.state !== state;
    this.state = state;
    this.settings = settings;
    this.diff = diff;
    this.clear();
    this.highlightBox.visible = false;
    this.grid.visible = settings.grid;
    this.boxes.visible = settings.bounds;
    this.renderer.setPixelRatio(
      settings.quality === "low" ? 1 : Math.min(devicePixelRatio, 2),
    );
    const center = new THREE.Vector3(
      (state.min[0] + state.max[0] + 1) / 2,
      state.min[1],
      (state.min[2] + state.max[2] + 1) / 2,
    );
    this.world.position.set(-center.x, -center.y, -center.z);
    this.boxes.position.copy(this.world.position);
    this.markers.position.copy(this.world.position);
    this.grid.position.y = -0.025;
    this.grid.scale.setScalar(Math.max(...state.size) / 48);
    if (changed) this.fit();
    const batches = new Map<
      string,
      { state: BlockState; blocks: PickedBlock[]; type?: string }
    >();
    let visited = 0,
      rendered = 0;
    const visible = (p: Vec3, s: BlockState) =>
      (settings.mode === "all" ||
        (settings.mode === "single"
          ? p[settings.axis] === settings.layer
          : p[settings.axis] <= settings.layer)) &&
      (!settings.isolate ||
        !settings.highlight ||
        s.name === settings.highlight);
    const add = (b: PickedBlock, type?: string) => {
      const key = stateKey(b.state) + (type ?? "");
      if (!batches.has(key))
        batches.set(key, { state: b.state, blocks: [], type });
      batches.get(key)!.blocks.push(b);
      rendered++;
    };
    for (const r of state.regions) {
      if (settings.hidden.includes(r.name)) continue;
      const box = new THREE.Box3(
        new THREE.Vector3(...r.min),
        new THREE.Vector3(...(r.min.map((v, a) => v + r.size[a]) as Vec3)),
      );
      this.boxes.add(new THREE.Box3Helper(box, 0x9dba84));
      for (const b of eachBlock(r)) {
        if (++visited % 12000 === 0) {
          await new Promise((r) => setTimeout(r, 0));
          if (token !== this.generation) return;
        }
        if (!visible(b.position, b.state)) continue;
        const type = diff?.cells.get(coordKey(b.position));
        if (diff && !type) continue;
        if (!diff && fullyOpaque(b.state)) {
          const [x, y, z] = b.local;
          let surrounded = true;
          for (const [dx, dy, dz] of [
            [1, 0, 0],
            [-1, 0, 0],
            [0, 1, 0],
            [0, -1, 0],
            [0, 0, 1],
            [0, 0, -1],
          ]) {
            const near = blockAt(r, x + dx, y + dy, z + dz),
              p: Vec3 = [
                b.position[0] + dx,
                b.position[1] + dy,
                b.position[2] + dz,
              ];
            if (!fullyOpaque(near) || !visible(p, near!)) {
              surrounded = false;
              break;
            }
          }
          if (surrounded) continue;
        }
        if (rendered >= 500000)
          throw new Error(
            "目前可見方塊超過 50 萬個，請使用分層或隱藏部分區域後重試。",
          );
        add(
          {
            region: r.name,
            position: b.position,
            local: b.local,
            state: b.state,
          },
          type,
        );
      }
    }
    if (diff)
      for (const b of diff.removedBlocks)
        if (visible(b.position, b.state)) add(b, "removed");
    if (token !== this.generation) return;
    this.resources.missing.clear();
    const matrix = new THREE.Matrix4();
    for (const batch of batches.values()) {
      const geometry = this.resources.geometry(batch.state),
        isGlass = /glass|ice|water/.test(batch.state.name),
        dim = !!settings.highlight && batch.state.name !== settings.highlight;
      const color =
        batch.type === "added"
          ? 0x72e79a
          : batch.type === "removed"
            ? 0xe78578
            : batch.type === "changed"
              ? 0xffcd6b
              : settings.highlight === batch.state.name
                ? 0xc5ffb1
                : 0xffffff;
      const material = new THREE.MeshLambertMaterial({
        map:
          geometry.userData.fallback || batch.type
            ? null
            : this.resources.texture,
        vertexColors: !batch.type,
        color,
        side: THREE.DoubleSide,
        alphaTest: 0.1,
        transparent: isGlass || dim || batch.type === "removed",
        opacity: dim
          ? 0.12
          : batch.type === "removed"
            ? 0.45
            : isGlass
              ? 0.65
              : 1,
        depthWrite: !isGlass && !dim,
        wireframe: settings.wireframe,
      });
      const mesh = new THREE.InstancedMesh(
        geometry,
        material,
        batch.blocks.length,
      );
      mesh.userData.blocks = batch.blocks;
      batch.blocks.forEach((b, i) => {
        matrix.makeTranslation(...b.position);
        mesh.setMatrixAt(i, matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      this.world.add(mesh);
      this.pickables.push(mesh);
    }
    this.onStats({ rendered, missing: [...this.resources.missing] });
    this.dirty = true;
  }
  fit(regionName?: string) {
    if (!this.state) return;
    const r = regionName
      ? this.state.regions.find((r) => r.name === regionName)
      : undefined;
    const size = r?.size ?? this.state.size,
      min = r?.min ?? this.state.min;
    const center = new THREE.Vector3(
      min[0] + size[0] / 2,
      min[1] + size[1] / 2,
      min[2] + size[2] / 2,
    ).add(this.world.position);
    const aspect = this.host.clientWidth / this.host.clientHeight;
    const direction = new THREE.Vector3(1, 0.85, 1.2).normalize();
    const right = new THREE.Vector3()
      .crossVectors(new THREE.Vector3(0, 1, 0), direction)
      .normalize();
    const up = new THREE.Vector3().crossVectors(direction, right).normalize();
    const tanV = Math.tan((20 * Math.PI) / 180),
      tanH = tanV * aspect;
    let distance = 1,
      halfHeight = 1;
    for (const x of [-size[0] / 2, size[0] / 2])
      for (const y of [-size[1] / 2, size[1] / 2])
        for (const z of [-size[2] / 2, size[2] / 2]) {
          const corner = new THREE.Vector3(x, y, z);
          distance = Math.max(
            distance,
            corner.dot(direction) +
              Math.max(
                Math.abs(corner.dot(up)) / tanV,
                Math.abs(corner.dot(right)) / tanH,
              ),
          );
          halfHeight = Math.max(
            halfHeight,
            Math.abs(corner.dot(up)),
            Math.abs(corner.dot(right)) / aspect,
          );
        }
    this.controls.target.copy(center);
    this.camera.position
      .copy(center)
      .add(direction.multiplyScalar(distance * 1.12));
    if (this.camera instanceof THREE.OrthographicCamera) {
      const h = halfHeight * 1.12;
      this.camera.top = h;
      this.camera.bottom = -h;
      this.camera.left = -h * aspect;
      this.camera.right = h * aspect;
      this.camera.zoom = 1;
      this.camera.updateProjectionMatrix();
    }
    this.controls.update();
    this.dirty = true;
  }
  view(direction: "iso" | "top" | "front" | "side") {
    if (direction === "iso") {
      this.fit();
      return;
    }
    const distance = this.camera.position.distanceTo(this.controls.target);
    const v =
      direction === "top"
        ? new THREE.Vector3(0, 1, 0.0001)
        : direction === "front"
          ? new THREE.Vector3(0, 0, -1)
          : new THREE.Vector3(1, 0, 0);
    this.camera.position
      .copy(this.controls.target)
      .add(v.multiplyScalar(distance));
    this.controls.update();
    this.dirty = true;
  }
  projection(type: "perspective" | "orthographic") {
    const w = this.host.clientWidth,
      h = this.host.clientHeight,
      position = this.camera.position.clone(),
      target = this.controls.target.clone();
    this.controls.dispose();
    if (type === "perspective")
      this.camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 100000);
    else {
      const half = position.distanceTo(target) * Math.tan((20 * Math.PI) / 180);
      this.camera = new THREE.OrthographicCamera(
        (-half * w) / h,
        (half * w) / h,
        half,
        -half,
        -100000,
        100000,
      );
    }
    this.camera.position.copy(position);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.target.copy(target);
    this.controls.addEventListener("change", () => (this.dirty = true));
    this.controls.update();
    this.dirty = true;
  }
  select(b: PickedBlock, focus = false) {
    const p = new THREE.Vector3(...b.position).add(this.world.position);
    this.highlightBox.box.set(p, p.clone().addScalar(1));
    this.highlightBox.visible = true;
    if (focus) {
      const delta = this.camera.position
        .clone()
        .sub(this.controls.target)
        .normalize()
        .multiplyScalar(10);
      this.controls.target.copy(p.clone().addScalar(0.5));
      this.camera.position.copy(this.controls.target).add(delta);
      this.controls.update();
    }
    this.dirty = true;
  }
  getCamera() {
    return {
      position: this.camera.position.toArray(),
      target: this.controls.target.toArray(),
      zoom: this.camera.zoom,
    };
  }
  setCamera(c: { position: number[]; target: number[]; zoom: number }) {
    if (
      !Array.isArray(c.position) ||
      !Array.isArray(c.target) ||
      c.position.length !== 3 ||
      c.target.length !== 3 ||
      ![...c.position, ...c.target, c.zoom].every(Number.isFinite)
    )
      return;
    this.camera.position.fromArray(c.position);
    this.controls.target.fromArray(c.target);
    this.camera.zoom = Math.max(0.01, Math.min(100, c.zoom));
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.dirty = true;
  }
  screenshot(transparent = false, scale = 1) {
    const old = this.renderer.getSize(new THREE.Vector2());
    const gridVisible = this.grid.visible;
    this.grid.visible = transparent ? false : gridVisible;
    this.renderer.setClearColor(0x17231e, transparent ? 0 : 1);
    this.renderer.setSize(old.x * scale, old.y * scale, false);
    this.renderer.render(this.scene, this.camera);
    const url = this.renderer.domElement.toDataURL("image/png");
    this.renderer.setSize(old.x, old.y, false);
    this.renderer.setClearColor(0x17231e, 0);
    this.grid.visible = gridVisible;
    this.dirty = true;
    return url;
  }
  dispose() {
    this.disposed = true;
    this.generation++;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.clear();
    this.resources.dispose();
    this.grid.geometry.dispose();
    (this.grid.material as THREE.Material).dispose();
    this.highlightBox.geometry.dispose();
    (this.highlightBox.material as THREE.Material).dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
