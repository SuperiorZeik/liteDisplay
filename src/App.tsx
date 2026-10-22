import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowDownToLine,
  ArrowLeftRight,
  Box,
  Boxes,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Copy,
  Crosshair,
  Download,
  Expand,
  Eye,
  EyeOff,
  FileBox,
  FolderOpen,
  Grid2X2,
  Info,
  Layers3,
  Library,
  LoaderCircle,
  LockKeyhole,
  Maximize2,
  Minus,
  MousePointer2,
  Package,
  PanelLeftClose,
  Plus,
  RotateCcw,
  ScanLine,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sprout,
  Trash2,
  TriangleAlert,
  Upload,
  X,
} from "lucide-react";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { demoFile, blockEntityDemoFile } from "./core/demo";
import {
  download,
  fingerprint,
  libraryDelete,
  libraryList,
  libraryPut,
} from "./core/storage";
import { nbtJson } from "./core/nbt";
import { blockEntityIndex } from "./core/block-entities";
import { startingSlice } from "./core/block-storage";
import {
  eachBlock,
  materials,
  type LibraryEntry,
  type PickedBlock,
  type Schematic,
  type Vec3,
  type ViewSettings,
} from "./core/types";
import {
  BlueprintScene,
  compareSchematics,
  type DiffResult,
} from "./render/scene";
import { blockColor, blockLabel } from "./render/resources";

const initialView: ViewSettings = {
  axis: 1,
  mode: "all",
  layer: 0,
  hidden: [],
  highlight: null,
  isolate: false,
  projection: "perspective",
  grid: true,
  bounds: false,
  wireframe: false,
  quality: "high",
};
const fmt = (n: number) => n.toLocaleString("zh-TW");
const bytes = (n: number) =>
  n < 1024 * 1024
    ? `${(n / 1024).toFixed(1)} KB`
    : `${(n / 1024 / 1024).toFixed(1)} MB`;
const accepted = ".litematic,.litematica,.schem,.nbt,.zip";
type SavedView = {
  version: 1;
  hash: string;
  view: ViewSettings;
  camera?: { position: number[]; target: number[]; zoom: number };
};
function validView(input: any, s: Schematic): ViewSettings {
  const axis = ([0, 1, 2].includes(input?.axis) ? input.axis : 1) as 0 | 1 | 2;
  return {
    ...initialView,
    axis,
    mode: ["all", "single", "below"].includes(input?.mode) ? input.mode : "all",
    layer: Math.max(
      s.min[axis],
      Math.min(s.max[axis], Math.round(Number(input?.layer) || 0)),
    ),
    hidden: Array.isArray(input?.hidden)
      ? input.hidden.filter(
          (n: unknown) =>
            typeof n === "string" && s.regions.some((r) => r.name === n),
        )
      : [],
    highlight: typeof input?.highlight === "string" ? input.highlight : null,
    isolate: input?.isolate === true,
    projection:
      input?.projection === "orthographic" ? "orthographic" : "perspective",
    grid: input?.grid !== false,
    bounds: input?.bounds === true,
    wireframe: input?.wireframe === true,
    quality: input?.quality === "low" ? "low" : "high",
  };
}
function IconButton({
  children,
  label,
  onClick,
  active,
  disabled = false,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`icon-button ${active ? "active" : ""}`}
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
function Modal({
  title,
  description,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const last = document.activeElement as HTMLElement;
    const first = ref.current?.querySelector<HTMLElement>(
      "button,input,select",
    );
    first?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const all = ref.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],textarea",
        );
        if (!all?.length) return;
        const first = all[0],
          last = all[all.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      last?.focus();
    };
  }, [onClose]);
  return (
    <div
      className="modal-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`modal ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
      >
        <header className="modal-head">
          <div>
            <h2>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <IconButton label="關閉對話框" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export default function App() {
  const canvas = useRef<HTMLDivElement>(null),
    engine = useRef<BlueprintScene | null>(null),
    worker = useRef<Worker | null>(null),
    source = useRef<File | null>(null),
    fileInput = useRef<HTMLInputElement>(null),
    compareInput = useRef<HTMLInputElement>(null),
    packInput = useRef<HTMLInputElement>(null),
    loadId = useRef(0);
  const [ready, setReady] = useState(false),
    [schematic, setSchematic] = useState<Schematic | null>(null),
    [view, setView] = useState<ViewSettings>(initialView),
    [picked, setPicked] = useState<PickedBlock | null>(null),
    [fileHash, setFileHash] = useState("");
  const [busy, setBusy] = useState<{ progress: number; label: string } | null>(
      null,
    ),
    [meshBusy, setMeshBusy] = useState(false),
    [toast, setToast] = useState<{ message: string; error: boolean } | null>(
      null,
    ),
    [fatal, setFatal] = useState("");
  const [modal, setModal] = useState<
      "library" | "settings" | "export" | "help" | "info" | null
    >(null),
    [library, setLibrary] = useState<LibraryEntry[]>([]),
    [search, setSearch] = useState(""),
    [librarySearch, setLibrarySearch] = useState(""),
    [materialSort, setMaterialSort] = useState<"count" | "name">("count");
  const [rightTab, setRightTab] = useState<"materials" | "block">("materials"),
    [mobilePanel, setMobilePanel] = useState<"left" | "right" | null>(null),
    [dragging, setDragging] = useState(false),
    [stats, setStats] = useState<{
      rendered: number;
      missing: string[];
      textOmitted?: number;
      renderLimitReached?: boolean;
    }>({
      rendered: 0,
      missing: [],
    });
  const [done, setDone] = useState<string[]>([]),
    [diff, setDiff] = useState<DiffResult | undefined>(),
    [comparisonName, setComparisonName] = useState(""),
    [packName, setPackName] = useState("Minecraft 1.21.1"),
    [transparent, setTransparent] = useState(false),
    [exportScale, setExportScale] = useState("2"),
    [includeSize, setIncludeSize] = useState(true);
  const [tagText, setTagText] = useState(""),
    [onlyCurrentLayer, setOnlyCurrentLayer] = useState(false);
  const [offlineStatus, setOfflineStatus] = useState(
    import.meta.env.DEV ? "開發預覽" : "準備離線快取",
  );
  const pendingView = useRef<SavedView | null>(null),
    restoring = useRef(false);
  const notice = useCallback(
    (message: string, error = false) => setToast({ message, error }),
    [],
  );
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), toast.error ? 10000 : 4000);
    return () => clearTimeout(id);
  }, [toast]);
  const closeModal = useCallback(() => setModal(null), []);
  const patch = (change: Partial<ViewSettings>) =>
    setView((v) => ({ ...v, ...change }));
  const readFile = useCallback(
    async (file: File, compare = false) => {
      const id = ++loadId.current;
      worker.current?.terminate();
      worker.current = null;
      try {
        setBusy({ progress: 2, label: "讀取裝置內的檔案" });
        if (file.size > 64 * 1024 * 1024)
          throw new Error("檔案超過 64 MB，請先分割藍圖。");
        let actual = file,
          saved: SavedView | null = null;
        if (file.name.toLowerCase().endsWith(".zip")) {
          let total = 0;
          const entries = unzipSync(new Uint8Array(await file.arrayBuffer()), {
            filter: (f) => {
              total += f.originalSize;
              if (total > 128 * 1024 * 1024)
                throw new Error("檢視包解壓縮後超過 128 MB。");
              return true;
            },
          });
          const path = Object.keys(entries).find((k) =>
            /\.(litematic|litematica|schem|nbt)$/i.test(k),
          );
          if (!path)
            throw new Error("ZIP 中找不到藍圖；資源包請由顯示設定匯入。");
          actual = new File(
            [entries[path] as Uint8Array<ArrayBuffer>],
            path.split("/").pop()!,
          );
          if (entries["view.json"])
            try {
              saved = JSON.parse(strFromU8(entries["view.json"]));
            } catch {
              throw new Error("檢視包的 view.json 格式無效。");
            }
        }
        const buffer = await actual.arrayBuffer();
        if (id !== loadId.current) return;
        const hash = await fingerprint(buffer);
        if (!compare && !saved && location.hash.startsWith("#view="))
          try {
            saved = JSON.parse(decodeURIComponent(location.hash.slice(6)));
          } catch {
            notice("分享視角格式無效，使用預設視角。", true);
          }
        const w = new Worker(
          new URL("./core/parse.worker.ts", import.meta.url),
          { type: "module" },
        );
        worker.current = w;
        const parsed = await new Promise<Schematic>((resolve, reject) => {
          w.onmessage = (e) => {
            if (id !== loadId.current) return;
            if (e.data.type === "progress")
              setBusy({ progress: e.data.progress, label: e.data.label });
            else if (e.data.type === "done") resolve(e.data.schematic);
            else if (e.data.type === "error") reject(new Error(e.data.message));
          };
          w.onerror = () =>
            reject(new Error("解析執行緒中斷，請重新開啟檔案。"));
          w.postMessage({ buffer, name: actual.name }, [buffer]);
        });
        w.terminate();
        worker.current = null;
        if (id !== loadId.current) return;
        if (compare) {
          if (!schematic) throw new Error("請先開啟主要藍圖。");
          setBusy({ progress: 90, label: "比較同一座標的方塊與狀態" });
          const result = await compareSchematics(parsed, schematic);
          if (id !== loadId.current) return;
          setDiff(result);
          setComparisonName(parsed.name);
          notice(
            `比較完成：新增 ${fmt(result.added)}、移除 ${fmt(result.removed)}、變更 ${fmt(result.changed)}`,
          );
        } else {
          source.current = actual;
          setSchematic(parsed);
          setFileHash(hash);
          setPicked(null);
          setDiff(undefined);
          setComparisonName("");
          setSearch("");
          setTagText("");
          if (saved?.hash === hash) {
            pendingView.current = saved;
            setView(validView(saved.view, parsed));
            notice("已套用與此檔案相符的分享視角。");
          } else {
            const slice = startingSlice(parsed);
            setView({ ...initialView, ...slice });
            if (slice.mode === "single")
              notice(
                "大型藍圖已以單層模式開啟，可調整樓層或切換全部；完整材料統計仍保留。",
              );
            if (saved) notice("分享視角屬於另一份檔案，已使用預設視角。", true);
          }
          try {
            setDone(
              JSON.parse(
                localStorage.getItem(`litedisplay-progress:${hash}`) ?? "[]",
              ).filter((x: unknown) => typeof x === "string"),
            );
          } catch {
            setDone([]);
          }
          setRightTab("materials");
          setMobilePanel(null);
        }
        setBusy(null);
      } catch (error) {
        if (id === loadId.current) {
          setBusy(null);
          notice(error instanceof Error ? error.message : "開啟失敗。", true);
          worker.current?.terminate();
          worker.current = null;
        }
      }
    },
    [notice, schematic],
  );
  const readFileRef = useRef(readFile);
  readFileRef.current = readFile;
  useEffect(() => {
    if (!canvas.current) return;
    let alive = true;
    let scene: BlueprintScene;
    try {
      scene = new BlueprintScene(canvas.current);
      engine.current = scene;
      scene.onPick = (b) => {
        setPicked(b);
        if (b) setRightTab("block");
      };
      scene.onStats = (s) => {
        if (alive) setStats(s);
      };
      scene
        .initialize()
        .then(() => {
          if (!alive) return;
          setReady(true);
          void readFileRef.current(demoFile());
        })
        .catch((e) => {
          if (alive) setFatal(`顯示資源載入失敗：${e.message}`);
        });
    } catch (e) {
      setFatal(`無法啟動 WebGL：${e instanceof Error ? e.message : e}`);
      return;
    }
    return () => {
      alive = false;
      loadId.current++;
      worker.current?.terminate();
      scene.dispose();
      engine.current = null;
    };
  }, []);
  useEffect(() => {
    if (!ready || !schematic || !engine.current) return;
    let alive = true;
    setMeshBusy(true);
    engine.current
      .update(schematic, view, diff)
      .then(() => {
        if (!alive) return;
        setMeshBusy(false);
        if (pendingView.current?.camera && !restoring.current) {
          restoring.current = true;
          engine.current?.setCamera(pendingView.current.camera);
          pendingView.current = null;
          restoring.current = false;
        }
      })
      .catch((e) => {
        if (alive) {
          setMeshBusy(false);
          notice(e.message, true);
        }
      });
    return () => {
      alive = false;
    };
  }, [ready, schematic, view, diff, notice]);
  useEffect(() => {
    if (ready) engine.current?.projection(view.projection);
  }, [ready, view.projection]);
  useEffect(() => {
    if (fileHash)
      try {
        localStorage.setItem(
          `litedisplay-progress:${fileHash}`,
          JSON.stringify(done),
        );
      } catch {
        notice("裝置儲存空間不足，進度暫時無法保存。", true);
      }
  }, [done, fileHash, notice]);
  useEffect(() => {
    if (modal === "library")
      libraryList()
        .then(setLibrary)
        .catch(() =>
          notice("瀏覽器無法開啟本機圖庫；請確認未停用網站儲存。", true),
        );
  }, [modal, notice]);
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement).closest("input,textarea,select") ||
        modal ||
        busy
      )
        return;
      if (e.key.toLowerCase() === "f") {
        e.preventDefault();
        engine.current?.fit();
      }
      if (e.key.toLowerCase() === "g")
        setView((v) => ({ ...v, grid: !v.grid }));
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        setView((v) => ({
          ...v,
          mode: v.mode === "all" ? "single" : v.mode,
          layer: Math.max(
            schematic?.min[v.axis] ?? 0,
            Math.min(
              schematic?.max[v.axis] ?? 0,
              v.layer + (e.key === "ArrowUp" ? 1 : -1),
            ),
          ),
        }));
      }
      if (e.key === "Escape") {
        setPicked(null);
        setMobilePanel(null);
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [modal, busy, schematic]);
  useEffect(() => {
    if (import.meta.env.DEV) return;
    if (!("serviceWorker" in navigator)) {
      setOfflineStatus("此瀏覽器不支援離線");
      return;
    }
    navigator.serviceWorker
      .register(import.meta.env.BASE_URL + "sw.js")
      .then(() => navigator.serviceWorker.ready)
      .then(() => setOfflineStatus("離線快取已就緒"))
      .catch(() => setOfflineStatus("離線快取未啟用"));
  }, []);

  const materialList = useMemo(() => {
    if (!schematic) return [];
    if (!onlyCurrentLayer || view.mode === "all")
      return materials(schematic, view.hidden);
    const count = new Map<string, number>();
    for (const r of schematic.regions) {
      if (view.hidden.includes(r.name)) continue;
      for (const b of eachBlock(r, view)) {
        const p = b.position[view.axis];
        if (view.mode === "single" ? p === view.layer : p <= view.layer)
          count.set(b.state.name, (count.get(b.state.name) ?? 0) + 1);
      }
    }
    return [...count]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [
    schematic,
    view.hidden,
    view.axis,
    view.layer,
    view.mode,
    onlyCurrentLayer,
  ]);
  const rows = useMemo(
    () =>
      materialList
        .filter((m) =>
          `${m.name} ${blockLabel(m.name)}`
            .toLowerCase()
            .includes(search.toLowerCase()),
        )
        .sort((a, b) =>
          materialSort === "count"
            ? b.count - a.count
            : blockLabel(a.name).localeCompare(blockLabel(b.name), "zh-TW"),
        ),
    [materialList, search, materialSort, ready],
  );
  const totalMaterials = materialList.reduce((n, m) => n + m.count, 0);
  const layerDone = done.includes(`layer:${view.layer}`),
    doneRegionCount =
      schematic?.regions.filter((r) => done.includes(`region:${r.name}`))
        .length ?? 0;
  const toggleDone = (key: string) =>
    setDone((d) =>
      d.includes(key) ? d.filter((k) => k !== key) : [...d, key],
    );
  const makeSavedView = (): SavedView => ({
    version: 1,
    hash: fileHash,
    view,
    camera: engine.current?.getCamera(),
  });
  async function saveLocal() {
    if (!schematic || !source.current) return;
    try {
      let thumbnail: string | undefined;
      try {
        thumbnail = engine.current?.screenshot(false);
      } catch {}
      await libraryPut({
        id: fileHash,
        fileName: source.current.name,
        name: schematic.name,
        author: schematic.author,
        bytes: source.current.size,
        blockCount: schematic.blockCount,
        savedAt: Date.now(),
        tags: tagText,
        blob: source.current,
        thumbnail,
      });
      notice("已儲存至這部裝置的本機圖庫。");
    } catch {
      notice("保存失敗，請確認瀏覽器可使用 IndexedDB，且有足夠空間。", true);
    }
  }
  function exportCsv() {
    const quote = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const csv =
      "\uFEFF名稱,方塊 ID,方塊數,組（64格換算）,界伏盒（1728格換算）\r\n" +
      materialList
        .map((m) =>
          [
            quote(blockLabel(m.name)),
            quote(m.name),
            m.count,
            Math.ceil(m.count / 64),
            Math.ceil(m.count / 1728),
          ].join(","),
        )
        .join("\r\n");
    download(
      csv,
      `${schematic?.name ?? "materials"}-materials.csv`,
      "text/csv;charset=utf-8",
    );
    notice("已匯出材料統計 CSV。");
  }
  async function exportPng() {
    if (!engine.current || !schematic) return;
    try {
      const url = engine.current.screenshot(transparent, Number(exportScale));
      const img = new window.Image();
      img.src = url;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      if (includeSize) {
        const scale = Number(exportScale);
        ctx.font = `${14 * scale}px sans-serif`;
        ctx.fillStyle = "rgba(14,15,17,.85)";
        ctx.fillRect(
          18 * scale,
          c.height - 58 * scale,
          Math.min(c.width - 36 * scale, 470 * scale),
          38 * scale,
        );
        ctx.fillStyle = "#e7e9ec";
        ctx.fillText(
          `${schematic.name}  ·  ${schematic.size.join(" × ")}  ·  liteDisplay`,
          30 * scale,
          c.height - 33 * scale,
        );
      }
      c.toBlob((blob) => {
        if (blob) download(blob, `${schematic.name}.png`);
      }, "image/png");
      notice("已匯出預覽圖片。");
    } catch (e) {
      notice(`圖片匯出失敗：${e instanceof Error ? e.message : e}`, true);
    }
  }
  async function exportBundle() {
    if (!source.current) return;
    try {
      const file = source.current;
      download(
        zipSync({
          [file.name]: new Uint8Array(await file.arrayBuffer()),
          "view.json": strToU8(JSON.stringify(makeSavedView(), null, 2)),
        }),
        `${schematic?.name ?? "blueprint"}-view.zip`,
      );
      notice("已下載含原始藍圖與視角設定的檢視包。");
    } catch (e) {
      notice(String(e), true);
    }
  }
  async function share() {
    const url = new URL(location.href);
    url.hash = `view=${encodeURIComponent(JSON.stringify(makeSavedView()))}`;
    try {
      await navigator.clipboard.writeText(url.href);
      notice("視角連結已複製；對方需開啟相同藍圖檔案。");
    } catch {
      notice("無法使用剪貼簿，已下載視角設定。");
      download(
        JSON.stringify(makeSavedView(), null, 2),
        "view.json",
        "application/json",
      );
    }
  }
  async function importPack(file: File) {
    try {
      setBusy({ progress: 15, label: "讀取裝置內的資源包" });
      await engine.current?.resources.importPack(file);
      setPackName(file.name);
      setView((v) => ({ ...v }));
      setBusy(null);
      notice("已套用資源包；此資源包僅保留在目前分頁。");
    } catch (e) {
      setBusy(null);
      notice(e instanceof Error ? e.message : "資源包讀取失敗。", true);
    }
  }
  const selectMaterial = (name: string) => {
    patch({ highlight: view.highlight === name ? null : name });
  };
  function locateMaterial() {
    if (!schematic || !view.highlight) return;
    for (const r of schematic.regions) {
      if (view.hidden.includes(r.name)) continue;
      for (const b of eachBlock(r))
        if (b.state.name === view.highlight) {
          const selected = {
            region: r.name,
            ...b,
            blockEntity: blockEntityIndex(r.blockEntities).get(
              b.local.join(","),
            ),
          };
          setPicked(selected);
          setRightTab("block");
          patch({ layer: b.position[view.axis] });
          setTimeout(() => engine.current?.select(selected, true), 50);
          return;
        }
    }
  }
  const axisName = ["X", "Y", "Z"][view.axis];
  const regionCount = schematic?.regions.length ?? 0;
  const regionColors = ["#7fb069", "#d4a259", "#5fa8d3", "#b48ead"];
  const layerMin = schematic?.min[view.axis] ?? 0,
    layerMax = schematic?.max[view.axis] ?? 0;
  const setLayer = (layer: number) =>
    patch({
      layer: Math.max(layerMin, Math.min(layerMax, layer)),
      mode: view.mode === "all" ? "single" : view.mode,
    });
  const zoom = (factor: number) => {
    const c = engine.current?.controls;
    if (!c) return;
    const cam = engine.current!.camera;
    if (cam.type === "OrthographicCamera") {
      cam.zoom *= factor;
      cam.updateProjectionMatrix();
    } else if (factor > 1) cam.position.lerp(c.target, 0.2);
    else
      cam.position.add(
        cam.position.clone().sub(c.target).multiplyScalar(0.25),
      );
    c.update();
  };
  return (
    <div
      className="app"
      onDragOver={(e) => {
        e.preventDefault();
        if (e.dataTransfer.types.includes("Files")) setDragging(true);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) void readFile(file);
      }}
    >
      <input
        hidden
        ref={fileInput}
        type="file"
        accept={accepted}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void readFile(f);
          e.target.value = "";
        }}
      />
      <input
        hidden
        ref={compareInput}
        type="file"
        accept={accepted}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void readFile(f, true);
          e.target.value = "";
        }}
      />
      <input
        hidden
        ref={packInput}
        type="file"
        accept=".zip"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importPack(f);
          e.target.value = "";
        }}
      />
      <header className="topbar">
        <a
          className="brand"
          href="./"
          onClick={(e) => {
            e.preventDefault();
            engine.current?.fit();
          }}
          aria-label="liteDisplay 首頁"
        >
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span className="brand-name">liteDisplay</span>
        </a>
        <span className="topbar-sep" />
        <div className="doc-title">
          <strong>{schematic?.name ?? "未開啟藍圖"}</strong>
          {schematic && (
            <span className="doc-meta">
              {schematic.format}
              {source.current && ` · ${bytes(source.current.size)}`}
            </span>
          )}
        </div>
        <div className="topbar-actions">
          <button
            className="btn ghost only-mobile"
            aria-label="區域面板"
            aria-pressed={mobilePanel === "left"}
            onClick={() => setMobilePanel((m) => (m === "left" ? null : "left"))}
          >
            <Layers3 size={16} />
          </button>
          <button
            className="btn ghost only-mobile"
            aria-label="材料面板"
            aria-pressed={mobilePanel === "right"}
            onClick={() =>
              setMobilePanel((m) => (m === "right" ? null : "right"))
            }
          >
            <Package size={16} />
          </button>
          <button
            className="btn ghost"
            aria-label="本機圖庫"
            onClick={() => setModal("library")}
          >
            <Library size={16} />
            <span className="label">圖庫</span>
          </button>
          <button
            className="btn primary"
            onClick={() => fileInput.current?.click()}
            disabled={!!busy}
          >
            <FolderOpen size={16} />
            <span className="label">開啟藍圖</span>
          </button>
        </div>
      </header>
      <div className="workspace">
        {mobilePanel && (
          <div className="scrim" onClick={() => setMobilePanel(null)} />
        )}
        <aside
          className={`sidebar sidebar-left ${mobilePanel === "left" ? "open" : ""}`}
        >
          <section className="side-section blueprint-summary">
            <div className="section-head">
              <h2>藍圖</h2>
              <div className="section-tools">
                <IconButton
                  label="藍圖資訊"
                  onClick={() => setModal("info")}
                  disabled={!schematic}
                >
                  <Info size={15} />
                </IconButton>
                <span className="only-mobile">
                  <IconButton
                    label="關閉區域面板"
                    onClick={() => setMobilePanel(null)}
                  >
                    <PanelLeftClose size={15} />
                  </IconButton>
                </span>
              </div>
            </div>
            <h1 className="blueprint-name">{schematic?.name ?? "—"}</h1>
            <p className="blueprint-author">
              {schematic?.author || "未記錄作者"}
            </p>
            <dl className="stat-grid">
              <div>
                <dt>尺寸</dt>
                <dd>{schematic?.size.join(" × ") ?? "—"}</dd>
              </div>
              <div>
                <dt>方塊</dt>
                <dd>{fmt(schematic?.blockCount ?? 0)}</dd>
              </div>
              <div>
                <dt>區域</dt>
                <dd>{regionCount}</dd>
              </div>
            </dl>
            <button
              className="btn block"
              onClick={() => void saveLocal()}
              disabled={!schematic}
            >
              <ArrowDownToLine size={15} />
              儲存至圖庫
            </button>
          </section>
          <section className="side-section regions-section">
            <div className="section-head">
              <h2>
                區域<span className="count">{regionCount}</span>
              </h2>
              {view.hidden.length > 0 && (
                <button
                  className="link-btn"
                  onClick={() => {
                    patch({ hidden: [] });
                    engine.current?.fit();
                  }}
                >
                  <RotateCcw size={12} />
                  全部顯示
                </button>
              )}
            </div>
            <ul className="region-list">
              {schematic?.regions.map((r, i) => {
                const hidden = view.hidden.includes(r.name),
                  finished = done.includes(`region:${r.name}`);
                return (
                  <li
                    className={`region ${hidden ? "is-hidden" : ""}`}
                    key={r.name}
                  >
                    <button
                      className={`region-check ${finished ? "checked" : ""}`}
                      aria-label={`標記${r.name}完成`}
                      aria-pressed={finished}
                      title="標記建造完成"
                      style={
                        {
                          "--region-color": regionColors[i % 4],
                        } as React.CSSProperties
                      }
                      onClick={() => toggleDone(`region:${r.name}`)}
                    >
                      {finished && <Check size={11} strokeWidth={3} />}
                    </button>
                    <button
                      className="region-name"
                      onClick={() => engine.current?.fit(r.name)}
                      title={`聚焦 ${r.name}`}
                    >
                      <span>{r.name}</span>
                      <small>{fmt(r.blockCount)}</small>
                    </button>
                    <IconButton
                      label={`${hidden ? "顯示" : "隱藏"}${r.name}`}
                      onClick={() =>
                        patch({
                          hidden: hidden
                            ? view.hidden.filter((n) => n !== r.name)
                            : [...view.hidden, r.name],
                        })
                      }
                    >
                      {hidden ? <EyeOff size={14} /> : <Eye size={14} />}
                    </IconButton>
                  </li>
                );
              })}
            </ul>
            <div className="progress-block">
              <div className="progress-label">
                <span>建造進度</span>
                <span className="num">
                  {doneRegionCount} / {regionCount}
                </span>
              </div>
              <div className="meter">
                <i
                  style={{
                    width: `${(doneRegionCount / (regionCount || 1)) * 100}%`,
                  }}
                />
              </div>
            </div>
          </section>
          <div className="side-fill" />
          <section className="side-section">
            <button
              className="action-row"
              disabled={!schematic || !!busy}
              onClick={() => compareInput.current?.click()}
            >
              <ArrowLeftRight size={16} />
              <span>
                <strong>比較另一份藍圖</strong>
                <small>標示新增、移除與狀態變更</small>
              </span>
              <ChevronRight size={15} />
            </button>
          </section>
        </aside>
        <main className="stage">
          <div className="viewport" ref={canvas}>
            <div className="hud hud-top-left">
              <div className="seg" role="group" aria-label="預設視角">
                {(
                  [
                    ["iso", "等角"],
                    ["top", "俯視"],
                    ["front", "正面"],
                    ["side", "側面"],
                  ] as const
                ).map(([key, label]) => (
                  <button key={key} onClick={() => engine.current?.view(key)}>
                    {label}
                  </button>
                ))}
              </div>
              <button
                className="hud-chip"
                title="切換投影方式"
                onClick={() =>
                  patch({
                    projection:
                      view.projection === "perspective"
                        ? "orthographic"
                        : "perspective",
                  })
                }
              >
                {view.projection === "perspective" ? "透視" : "正交"}
              </button>
            </div>
            <div className="hud hud-top-right">
              <div className="tool-group">
                <IconButton
                  label="地面網格（G）"
                  active={view.grid}
                  onClick={() => patch({ grid: !view.grid })}
                >
                  <Grid2X2 size={16} />
                </IconButton>
                <IconButton
                  label="區域邊界"
                  active={view.bounds}
                  onClick={() => patch({ bounds: !view.bounds })}
                >
                  <ScanLine size={16} />
                </IconButton>
                <IconButton
                  label="線框模式"
                  active={view.wireframe}
                  onClick={() => patch({ wireframe: !view.wireframe })}
                >
                  <Box size={16} />
                </IconButton>
              </div>
              <div className="tool-group">
                <IconButton
                  label="顯示設定"
                  onClick={() => setModal("settings")}
                >
                  <SlidersHorizontal size={16} />
                </IconButton>
                <IconButton
                  label="匯出與分享"
                  onClick={() => setModal("export")}
                  disabled={!schematic}
                >
                  <Download size={16} />
                </IconButton>
                <IconButton label="使用說明" onClick={() => setModal("help")}>
                  <CircleHelp size={16} />
                </IconButton>
              </div>
            </div>
            {(diff || (view.highlight && !diff)) && (
              <div className="hud hud-top-center">
                {diff ? (
                  <div className="hud-panel diff-legend">
                    <span>
                      <i className="added" />
                      新增 <b>{fmt(diff.added)}</b>
                    </span>
                    <span>
                      <i className="removed" />
                      移除 <b>{fmt(diff.removed)}</b>
                    </span>
                    <span>
                      <i className="changed" />
                      變更 <b>{fmt(diff.changed)}</b>
                    </span>
                    <small title="依藍圖原點對齊">
                      舊版：{comparisonName}
                    </small>
                    <IconButton
                      label="結束比較"
                      onClick={() => setDiff(undefined)}
                    >
                      <X size={14} />
                    </IconButton>
                  </div>
                ) : (
                  view.highlight && (
                    <div className="hud-panel highlight-bar">
                      <span
                        className="swatch"
                        style={
                          {
                            "--block-color": blockColor(view.highlight),
                          } as React.CSSProperties
                        }
                      />
                      <strong>{blockLabel(view.highlight)}</strong>
                      <div className="seg small">
                        <button
                          className={!view.isolate ? "selected" : ""}
                          onClick={() => patch({ isolate: false })}
                        >
                          淡化其他
                        </button>
                        <button
                          className={view.isolate ? "selected" : ""}
                          onClick={() => patch({ isolate: true })}
                        >
                          僅顯示
                        </button>
                      </div>
                      <IconButton
                        label="定位第一個方塊"
                        onClick={locateMaterial}
                      >
                        <Crosshair size={14} />
                      </IconButton>
                      <IconButton
                        label="取消材料篩選"
                        onClick={() =>
                          patch({ highlight: null, isolate: false })
                        }
                      >
                        <X size={14} />
                      </IconButton>
                    </div>
                  )
                )}
              </div>
            )}
            <div className="hud hud-bottom-right">
              <div className="tool-group vertical">
                <IconButton label="放大" onClick={() => zoom(1.25)}>
                  <Plus size={16} />
                </IconButton>
                <IconButton label="縮小" onClick={() => zoom(1 / 1.25)}>
                  <Minus size={16} />
                </IconButton>
              </div>
              <div className="tool-group vertical">
                <IconButton
                  label="置中藍圖（F）"
                  onClick={() => engine.current?.fit()}
                >
                  <Expand size={16} />
                </IconButton>
                <IconButton
                  label="全螢幕"
                  onClick={() => {
                    if (document.fullscreenElement)
                      void document.exitFullscreen();
                    else
                      void canvas.current
                        ?.requestFullscreen()
                        .catch(() => notice("瀏覽器不支援全螢幕。", true));
                  }}
                >
                  <Maximize2 size={15} />
                </IconButton>
              </div>
            </div>
            <div className="hud hud-bottom-left" aria-hidden="true">
              <div className="axis-gizmo">
                <i className="ax-x" />
                <i className="ax-y" />
                <i className="ax-z" />
                <span className="ax-x">X</span>
                <span className="ax-y">Y</span>
                <span className="ax-z">Z</span>
              </div>
            </div>
            {(!!stats.textOmitted || stats.renderLimitReached) && (
              <div className="hud hud-bottom-center">
                <div className="hud-panel warn">
                  <TriangleAlert size={14} />
                  {stats.renderLimitReached
                    ? "已達預覽上限，請分層或隱藏區域。"
                    : `${fmt(stats.textOmitted!)} 面告示牌文字已略過，請縮小檢視範圍。`}
                </div>
              </div>
            )}
            {fatal && (
              <div className="viewport-state">
                <TriangleAlert size={28} />
                <h2>無法啟動預覽</h2>
                <p>{fatal}</p>
                <button className="btn" onClick={() => location.reload()}>
                  重新載入
                </button>
              </div>
            )}
            {!ready && !fatal && (
              <div className="viewport-state">
                <LoaderCircle className="spin" size={24} />
                <p>載入顯示資源…</p>
              </div>
            )}
          </div>
          <div className="layerbar">
            <div className="layerbar-group">
              <div className="seg" role="group" aria-label="剖面模式">
                {(
                  [
                    ["all", "全部"],
                    ["single", "單層"],
                    ["below", "累積"],
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    className={view.mode === mode ? "selected" : ""}
                    aria-pressed={view.mode === mode}
                    onClick={() => patch({ mode })}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="seg" role="group" aria-label="剖面軸向">
                {(["X", "Y", "Z"] as const).map((name, axis) => (
                  <button
                    key={name}
                    className={view.axis === axis ? "selected" : ""}
                    aria-pressed={view.axis === axis}
                    onClick={() =>
                      patch({
                        axis: axis as 0 | 1 | 2,
                        layer: schematic?.max[axis] ?? 0,
                      })
                    }
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>
            <div
              className={`layer-slider ${view.mode === "all" ? "is-idle" : ""}`}
            >
              <IconButton
                label="上一層（↓）"
                disabled={!schematic || view.layer <= layerMin}
                onClick={() => setLayer(view.layer - 1)}
              >
                <ChevronLeft size={16} />
              </IconButton>
              <span className="range-end">{layerMin}</span>
              <input
                aria-label="目前顯示樓層"
                type="range"
                min={layerMin}
                max={schematic ? layerMax : 1}
                value={view.layer}
                style={
                  {
                    "--fill": `${layerMax > layerMin ? ((view.layer - layerMin) / (layerMax - layerMin)) * 100 : 100}%`,
                  } as React.CSSProperties
                }
                onChange={(e) => setLayer(Number(e.target.value))}
              />
              <span className="range-end">{layerMax}</span>
              <IconButton
                label="下一層（↑）"
                disabled={!schematic || view.layer >= layerMax}
                onClick={() => setLayer(view.layer + 1)}
              >
                <ChevronRight size={16} />
              </IconButton>
            </div>
            <div className="layerbar-group">
              <label className="layer-input">
                <span>{axisName}</span>
                <input
                  aria-label={`${axisName} 座標`}
                  type="number"
                  min={layerMin}
                  max={layerMax}
                  value={view.layer}
                  onChange={(e) => setLayer(Math.round(Number(e.target.value)))}
                />
              </label>
              <button
                className={`btn layer-done ${layerDone ? "is-done" : ""}`}
                disabled={view.axis !== 1 || !schematic}
                aria-pressed={layerDone}
                title="標記此 Y 層建造完成"
                onClick={() => toggleDone(`layer:${view.layer}`)}
              >
                <Check size={14} />
                <span className="label">{layerDone ? "已完成" : "完成此層"}</span>
              </button>
            </div>
          </div>
        </main>
        <aside
          className={`sidebar sidebar-right ${mobilePanel === "right" ? "open" : ""}`}
        >
          <div className="tabs" role="tablist">
            <button
              role="tab"
              aria-selected={rightTab === "materials"}
              className={rightTab === "materials" ? "selected" : ""}
              onClick={() => setRightTab("materials")}
            >
              材料<span className="count">{materialList.length}</span>
            </button>
            <button
              role="tab"
              aria-selected={rightTab === "block"}
              className={rightTab === "block" ? "selected" : ""}
              onClick={() => setRightTab("block")}
            >
              方塊
            </button>
            <span className="only-mobile tabs-close">
              <IconButton
                label="關閉材料面板"
                onClick={() => setMobilePanel(null)}
              >
                <X size={16} />
              </IconButton>
            </span>
          </div>
          {rightTab === "materials" ? (
            <>
              <div className="materials-head">
                <div className="total">
                  <strong className="num">{fmt(totalMaterials)}</strong>
                  <span>
                    個方塊 · {materialList.length} 種
                    {onlyCurrentLayer && view.mode !== "all" && "（目前剖面）"}
                  </span>
                </div>
                <div className="search">
                  <Search size={14} />
                  <input
                    placeholder="搜尋名稱或 ID"
                    aria-label="搜尋材料"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  {search && (
                    <button
                      className="search-clear"
                      aria-label="清除搜尋"
                      onClick={() => setSearch("")}
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
              </div>
              <div className="list-head">
                <button
                  className={materialSort === "name" ? "selected" : ""}
                  onClick={() => setMaterialSort("name")}
                >
                  名稱
                </button>
                <button
                  className={materialSort === "count" ? "selected" : ""}
                  onClick={() => setMaterialSort("count")}
                >
                  數量
                </button>
              </div>
              <div className="material-list">
                {rows.map((m) => (
                  <button
                    key={m.name}
                    className={`material ${view.highlight === m.name ? "selected" : ""}`}
                    onClick={() => selectMaterial(m.name)}
                    title={`${m.name}\n點選以高亮`}
                  >
                    <span
                      className="swatch"
                      style={
                        {
                          "--block-color": blockColor(m.name),
                        } as React.CSSProperties
                      }
                    />
                    <span className="material-name">
                      <span>{blockLabel(m.name)}</span>
                      <small>{m.name.replace("minecraft:", "")}</small>
                    </span>
                    <span className="material-count">
                      <span className="num">{fmt(m.count)}</span>
                      <small>
                        {m.count >= 64
                          ? `${Math.floor(m.count / 64)} 組${m.count % 64 ? ` + ${m.count % 64}` : ""}`
                          : `${m.count} 個`}
                      </small>
                    </span>
                  </button>
                ))}
                {!rows.length && (
                  <div className="empty">
                    <p>沒有符合的材料</p>
                    {search && (
                      <button className="link-btn" onClick={() => setSearch("")}>
                        清除搜尋
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div className="materials-foot">
                <label className="check">
                  <input
                    type="checkbox"
                    checked={onlyCurrentLayer}
                    onChange={(e) => setOnlyCurrentLayer(e.target.checked)}
                  />
                  只統計目前剖面
                </label>
                <button
                  className="btn"
                  onClick={exportCsv}
                  disabled={!schematic}
                >
                  <Download size={14} />
                  匯出 CSV
                </button>
                <p>組以 64 格換算；門、床、雙半磚等與實際物品數不同。</p>
              </div>
            </>
          ) : (
            <div className="block-panel">
              {picked ? (
                <>
                  <div className="block-head">
                    <span
                      className="swatch large"
                      style={
                        {
                          "--block-color": blockColor(picked.state.name),
                        } as React.CSSProperties
                      }
                    />
                    <div>
                      <h2>{blockLabel(picked.state.name)}</h2>
                      <code>{picked.state.name}</code>
                    </div>
                  </div>
                  <dl className="kv">
                    <div>
                      <dt>區域</dt>
                      <dd>{picked.region}</dd>
                    </div>
                    <div>
                      <dt>藍圖座標</dt>
                      <dd className="num">{picked.position.join(", ")}</dd>
                    </div>
                    <div>
                      <dt>區域內座標</dt>
                      <dd className="num">{picked.local.join(", ")}</dd>
                    </div>
                  </dl>
                  <h3 className="sub-head">方塊狀態</h3>
                  {Object.entries(picked.state.properties).length ? (
                    <dl className="kv mono">
                      {Object.entries(picked.state.properties).map(([k, v]) => (
                        <div key={k}>
                          <dt>{k}</dt>
                          <dd>{v}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <p className="muted">無額外狀態</p>
                  )}
                  <div className="btn-row">
                    <button
                      className="btn"
                      onClick={() => engine.current?.select(picked, true)}
                    >
                      <Crosshair size={14} />
                      聚焦
                    </button>
                    <button
                      className="btn"
                      onClick={() => {
                        patch({ highlight: picked.state.name });
                        setRightTab("materials");
                      }}
                    >
                      <Search size={14} />
                      高亮同材料
                    </button>
                  </div>
                  {picked.blockEntity && (
                    <details className="disclosure">
                      <summary>
                        <ChevronRight size={14} />
                        方塊實體 NBT
                      </summary>
                      <pre>{nbtJson(picked.blockEntity)}</pre>
                    </details>
                  )}
                </>
              ) : (
                <div className="empty tall">
                  <MousePointer2 size={22} strokeWidth={1.5} />
                  <p>尚未選取方塊</p>
                  <small>點選模型上的方塊，查看座標與狀態。</small>
                </div>
              )}
            </div>
          )}
        </aside>
      </div>
      <footer className="statusbar">
        <span className="status-item">
          <span
            className={`dot ${fatal ? "bad" : meshBusy || !ready ? "busy" : "ok"}`}
          />
          {fatal ? "錯誤" : meshBusy ? "建立模型中" : ready ? "就緒" : "載入中"}
        </span>
        <span className="status-item num">{fmt(stats.rendered)} 可見方塊</span>
        <span className="status-item hide-sm">
          拖曳旋轉 · 右鍵平移 · 滾輪縮放
        </span>
        <span className="status-fill" />
        <span className="status-item hide-sm">
          <LockKeyhole size={11} />
          裝置端解析 · {offlineStatus}
        </span>
        <button className="status-item" onClick={() => setModal("settings")}>
          {packName}
          {stats.missing.length > 0 && ` · ${stats.missing.length} 種替代模型`}
        </button>
      </footer>
      {busy && (
        <div className="overlay" role="status" aria-live="polite">
          <div className="loading-card">
            <div className="loading-title">
              <LoaderCircle className="spin" size={16} />
              <span>{busy.label}</span>
              <span className="num">{busy.progress}%</span>
            </div>
            <div className="meter">
              <i style={{ width: `${busy.progress}%` }} />
            </div>
            <button
              className="btn"
              onClick={() => {
                loadId.current++;
                worker.current?.terminate();
                worker.current = null;
                setBusy(null);
                notice("已取消讀取。");
              }}
            >
              取消
            </button>
          </div>
        </div>
      )}
      {dragging && (
        <div
          className="overlay drop"
          onDragLeave={(e) => {
            if (e.target === e.currentTarget) setDragging(false);
          }}
        >
          <div className="drop-card">
            <Upload size={28} />
            <h2>放開以開啟</h2>
            <p>.litematic · .schem · .nbt · 檢視包 .zip</p>
          </div>
        </div>
      )}
      {toast && (
        <div
          className={`toast ${toast.error ? "error" : ""}`}
          role={toast.error ? "alert" : "status"}
        >
          {toast.error ? <TriangleAlert size={16} /> : <Check size={16} />}
          <span>{toast.message}</span>
          <button aria-label="關閉訊息" onClick={() => setToast(null)}>
            <X size={14} />
          </button>
        </div>
      )}
      {modal === "settings" && (
        <Modal title="顯示設定" onClose={closeModal}>
          <div className="form-list">
            <label>
              <span>地面網格</span>
              <input
                type="checkbox"
                className="switch"
                checked={view.grid}
                onChange={(e) => patch({ grid: e.target.checked })}
              />
            </label>
            <label>
              <span>區域邊界框</span>
              <input
                type="checkbox"
                className="switch"
                checked={view.bounds}
                onChange={(e) => patch({ bounds: e.target.checked })}
              />
            </label>
            <label>
              <span>線框模式</span>
              <input
                type="checkbox"
                className="switch"
                checked={view.wireframe}
                onChange={(e) => patch({ wireframe: e.target.checked })}
              />
            </label>
            <label>
              <span>投影方式</span>
              <select
                value={view.projection}
                onChange={(e) =>
                  patch({
                    projection: e.target.value as ViewSettings["projection"],
                  })
                }
              >
                <option value="perspective">透視</option>
                <option value="orthographic">正交</option>
              </select>
            </label>
            <label>
              <span>顯示品質</span>
              <select
                value={view.quality}
                onChange={(e) =>
                  patch({ quality: e.target.value as ViewSettings["quality"] })
                }
              >
                <option value="high">高（最高 2× 像素密度）</option>
                <option value="low">低（省電）</option>
              </select>
            </label>
          </div>
          <section className="card">
            <div className="card-head">
              <div>
                <span className="card-kicker">資源包</span>
                <h3>{packName}</h3>
              </div>
              <button
                className="btn"
                onClick={() => packInput.current?.click()}
              >
                <Upload size={14} />
                匯入
              </button>
            </div>
            <p>
              內建 Minecraft 1.21.1 材質與靜態方塊模型。可匯入 Java 版資源包 ZIP
              覆寫模型與材質；動畫使用第一幀。套用後需重新整理分頁才能還原。
            </p>
            {stats.missing.length > 0 && (
              <details className="disclosure">
                <summary>
                  <ChevronRight size={14} />
                  {stats.missing.length} 種方塊使用替代模型
                </summary>
                <pre>{stats.missing.join("\n")}</pre>
              </details>
            )}
          </section>
          <section className="card">
            <div className="card-head">
              <div>
                <span className="card-kicker">方塊實體</span>
                <h3>展示台</h3>
              </div>
              <button
                className="btn"
                onClick={() => {
                  closeModal();
                  void readFile(blockEntityDemoFile());
                }}
              >
                <Boxes size={14} />
                開啟
              </button>
            </div>
            <p>
              支援箱子、床、界伏盒、頭顱、告示牌（含文字）、旗幟（含圖樣）、鐘、海靈核心與飾紋陶罐的靜態外觀。玩家頭顱使用預設皮膚；陶罐紋飾、容器內物品、動畫、一般實體與紅石模擬尚未支援。
            </p>
          </section>
        </Modal>
      )}
      {modal === "info" && (
        <Modal title={schematic?.name ?? "藍圖資訊"} onClose={closeModal}>
          {schematic?.description && (
            <p className="description">{schematic.description}</p>
          )}
          <dl className="kv">
            {[
              ["作者", schematic?.author || "未記錄"],
              ["檔案", source.current?.name],
              ["格式", `${schematic?.format} v${schematic?.version}`],
              ["DataVersion", schematic?.dataVersion || "未記錄"],
              [
                "範圍",
                `${schematic?.min.join(", ")} → ${schematic?.max.join(", ")}`,
              ],
              ["區域體積（含空氣）", fmt(schematic?.volume ?? 0)],
              [
                "建立時間",
                schematic?.created
                  ? new Date(schematic.created).toLocaleString("zh-TW")
                  : "未記錄",
              ],
              [
                "實體／方塊實體",
                `${schematic?.regions.reduce((n, r) => n + r.entities.length, 0)} / ${schematic?.regions.reduce((n, r) => n + r.blockEntities.length, 0)}`,
              ],
            ].map(([k, v]) => (
              <div key={String(k)}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          {schematic?.warnings.map((w) => (
            <p className="callout" key={w}>
              <TriangleAlert size={14} />
              {w}
            </p>
          ))}
          <label className="field">
            <span>圖庫標籤</span>
            <input
              value={tagText}
              placeholder="例如：生存、房屋、待建造"
              onChange={(e) => setTagText(e.target.value)}
            />
          </label>
          <div className="modal-actions">
            <button className="btn primary" onClick={() => void saveLocal()}>
              <ArrowDownToLine size={14} />
              儲存至圖庫
            </button>
          </div>
        </Modal>
      )}
      {modal === "export" && (
        <Modal
          title="匯出與分享"
          description="所有檔案都在瀏覽器內產生。"
          onClose={closeModal}
        >
          <section className="card">
            <div className="card-head">
              <div>
                <span className="card-kicker">圖片</span>
                <h3>目前視角 PNG</h3>
              </div>
              <button
                className="btn primary"
                onClick={() => void exportPng()}
              >
                <Download size={14} />
                下載
              </button>
            </div>
            <div className="inline-options">
              <label className="check">
                <input
                  type="checkbox"
                  checked={transparent}
                  onChange={(e) => setTransparent(e.target.checked)}
                />
                透明背景
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={includeSize}
                  onChange={(e) => setIncludeSize(e.target.checked)}
                />
                標示名稱與尺寸
              </label>
              <div className="seg small" role="group" aria-label="圖片解析度">
                {["1", "2"].map((s) => (
                  <button
                    key={s}
                    className={exportScale === s ? "selected" : ""}
                    aria-pressed={exportScale === s}
                    onClick={() => setExportScale(s)}
                  >
                    {s}×
                  </button>
                ))}
              </div>
            </div>
          </section>
          <div className="option-list">
            <button onClick={exportCsv}>
              <Package size={18} />
              <span>
                <strong>材料清單</strong>
                <small>CSV 表格</small>
              </span>
              <ChevronRight size={15} />
            </button>
            <button
              onClick={() => {
                if (source.current)
                  download(source.current, source.current.name);
              }}
            >
              <FileBox size={18} />
              <span>
                <strong>原始藍圖</strong>
                <small>未修改的檔案</small>
              </span>
              <ChevronRight size={15} />
            </button>
            <button onClick={() => void exportBundle()}>
              <FolderOpen size={18} />
              <span>
                <strong>檢視包</strong>
                <small>原始檔＋視角設定 ZIP</small>
              </span>
              <ChevronRight size={15} />
            </button>
            <button onClick={() => void share()}>
              <Copy size={18} />
              <span>
                <strong>複製視角連結</strong>
                <small>對方需開啟相同檔案</small>
              </span>
              <ChevronRight size={15} />
            </button>
          </div>
        </Modal>
      )}
      {modal === "library" && (
        <Modal
          title="本機圖庫"
          description="儲存在這個瀏覽器；清除網站資料會一併移除。"
          wide
          onClose={closeModal}
        >
          <div className="library-bar">
            <div className="search">
              <Search size={14} />
              <input
                aria-label="搜尋本機圖庫"
                placeholder="搜尋名稱、作者或標籤"
                value={librarySearch}
                onChange={(e) => setLibrarySearch(e.target.value)}
              />
            </div>
            <button
              className="btn primary"
              disabled={!schematic}
              onClick={async () => {
                await saveLocal();
                setLibrary(await libraryList());
              }}
            >
              <Plus size={14} />
              儲存目前藍圖
            </button>
          </div>
          {library.length ? (
            <div className="library-grid">
              {library
                .filter((e) =>
                  `${e.name} ${e.author} ${e.tags}`.includes(librarySearch),
                )
                .map((e) => (
                  <article className="library-card" key={e.id}>
                    <button
                      className="library-thumb"
                      onClick={() => {
                        setModal(null);
                        void readFile(new File([e.blob], e.fileName));
                      }}
                    >
                      {e.thumbnail ? (
                        <img src={e.thumbnail} alt={e.name} />
                      ) : (
                        <Box size={32} strokeWidth={1.25} />
                      )}
                    </button>
                    <div className="library-body">
                      <h3>{e.name}</h3>
                      <p>
                        {e.author} · {fmt(e.blockCount)} 方塊
                      </p>
                      {e.tags && <span className="tag">{e.tags}</span>}
                      <div className="library-foot">
                        <small>
                          {new Date(e.savedAt).toLocaleDateString("zh-TW")} ·{" "}
                          {bytes(e.bytes)}
                        </small>
                        <IconButton
                          label={`刪除圖庫中的${e.name}`}
                          onClick={async () => {
                            await libraryDelete(e.id);
                            setLibrary((v) => v.filter((x) => x.id !== e.id));
                            notice("已移除圖庫副本；原始檔案不受影響。");
                          }}
                        >
                          <Trash2 size={14} />
                        </IconButton>
                      </div>
                    </div>
                  </article>
                ))}
            </div>
          ) : (
            <div className="empty tall">
              <Library size={22} strokeWidth={1.5} />
              <p>圖庫是空的</p>
              <small>儲存目前的藍圖，或開啟示範藍圖。</small>
              <button
                className="btn"
                onClick={() => {
                  setModal(null);
                  void readFile(demoFile());
                }}
              >
                <Sprout size={14} />
                開啟示範藍圖
              </button>
            </div>
          )}
        </Modal>
      )}
      {modal === "help" && (
        <Modal title="使用說明" onClose={closeModal}>
          <ol className="steps">
            <li>
              <h3>開啟藍圖</h3>
              <p>
                拖入 .litematic（v1–v7）、Sponge .schem（v2／v3）、原版
                .nbt，或本站匯出的 ZIP 檢視包。檔案上限 64 MB，總區域體積上限
                5.12 億格，方塊索引上限 128 MiB。大型藍圖會以單層模式開啟，預覽最多顯示
                50 萬個可見方塊。
              </p>
            </li>
            <li>
              <h3>檢視與選取</h3>
              <p>
                拖曳旋轉、右鍵平移、滾輪縮放；手機可雙指縮放與平移。點選方塊查看座標與狀態，在材料清單點選可高亮相同材料。
              </p>
            </li>
            <li>
              <h3>分層與進度</h3>
              <p>
                選擇單層或累積檢視，依 X、Y、Z 軸查看剖面。完成 Y
                層或區域後勾選，進度會自動保存。
              </p>
            </li>
          </ol>
          <div className="shortcuts">
            <span>
              <kbd>F</kbd>置中
            </span>
            <span>
              <kbd>G</kbd>網格
            </span>
            <span>
              <kbd>↑</kbd>
              <kbd>↓</kbd>切換樓層
            </span>
            <span>
              <kbd>Esc</kbd>取消選取
            </span>
          </div>
          <section className="card">
            <div className="card-head">
              <div>
                <span className="card-kicker">隱私</span>
                <h3>檔案不會離開裝置</h3>
              </div>
              <ShieldCheck size={18} />
            </div>
            <p>
              解析、統計與匯出都在瀏覽器執行。首次開啟需下載網站與顯示資源，快取完成後可離線使用。
            </p>
          </section>
          <p className="muted footnote">
            使用 Three.js、Deepslate 與 mcmeta 顯示資源。Minecraft 素材 © Mojang
            Studios；本網站非官方產品。比較功能依藍圖座標對齊；區域重疊時材料統計按區域累加。
          </p>
        </Modal>
      )}
    </div>
  );
}
