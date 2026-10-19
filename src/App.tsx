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
  ArrowUpRight,
  Box,
  Boxes,
  Check,
  CheckCheck,
  ChevronDown,
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
  FilePlus2,
  FolderOpen,
  Grid2X2,
  Image,
  Layers3,
  Leaf,
  Library,
  LoaderCircle,
  LockKeyhole,
  Maximize2,
  Minus,
  MousePointer2,
  Package,
  PanelLeftClose,
  PanelRightClose,
  Plus,
  RotateCcw,
  ScanLine,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sprout,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { demoFile } from "./core/demo";
import {
  download,
  fingerprint,
  libraryDelete,
  libraryList,
  libraryPut,
} from "./core/storage";
import { nbtJson } from "./core/nbt";
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
        <header>
          <div>
            <span className="eyebrow">LITEDISPLAY WORKSPACE</span>
            <h2>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <IconButton label="關閉對話框" onClick={onClose}>
            <X size={20} />
          </IconButton>
        </header>
        {children}
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
    [stats, setStats] = useState<{ rendered: number; missing: string[] }>({
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
            setView({ ...initialView, layer: parsed.max[1] });
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
      for (const b of eachBlock(r)) {
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
        ctx.fillStyle = "rgba(17,24,23,.85)";
        ctx.fillRect(
          18 * scale,
          c.height - 58 * scale,
          Math.min(c.width - 36 * scale, 470 * scale),
          38 * scale,
        );
        ctx.fillStyle = "#d7edcb";
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
          const selected = { region: r.name, ...b };
          setPicked(selected);
          setRightTab("block");
          patch({ layer: b.position[view.axis] });
          setTimeout(() => engine.current?.select(selected, true), 50);
          return;
        }
    }
  }
  const axisName = ["X", "Y", "Z"][view.axis];
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
      <header className="app-header">
        <a
          className="brand"
          href="./"
          onClick={(e) => {
            e.preventDefault();
            engine.current?.fit();
          }}
          aria-label="liteDisplay 首頁"
        >
          <span className="brand-icon">
            <Boxes size={25} />
          </span>
          <span>
            lite<span className="brand-light">Display</span>
            <small>B L U E P R I N T &nbsp; S T U D I O</small>
          </span>
        </a>
        <div className="header-divider" />
        <div className="breadcrumb">
          <span>工作台</span>
          <ChevronRight size={13} />
          <span>{schematic?.name ?? "準備探索藍圖"}</span>
          <span className="file-pill">LOCAL</span>
        </div>
        <div className="header-actions">
          <span className="privacy">
            <span className="status-dot" />
            檔案留在你的裝置
          </span>
          <button
            className="button subtle"
            aria-label="本機圖庫"
            onClick={() => setModal("library")}
          >
            <Library size={16} />
            <span>本機圖庫</span>
          </button>
          <button
            className="button primary"
            onClick={() => fileInput.current?.click()}
            disabled={!!busy}
          >
            <Plus size={17} />
            <span>開啟藍圖</span>
          </button>
        </div>
      </header>
      <div className="workspace">
        <aside
          className={`left-panel ${mobilePanel === "left" ? "mobile-open" : ""}`}
        >
          <div className="panel-top">
            <span className="eyebrow">EXPLORER</span>
            <IconButton
              label="關閉區域面板"
              onClick={() => setMobilePanel(null)}
            >
              <PanelLeftClose size={16} />
            </IconButton>
          </div>
          <div className="project-card">
            <div className="project-image">
              <Sprout size={27} />
              <span>MINECRAFT SCHEMATIC</span>
              <Box size={63} strokeWidth={0.8} />
            </div>
            <div className="project-title">
              <h1>{schematic?.name ?? "你的下一個作品"}</h1>
              <button
                className="small-icon"
                title="查看藍圖資訊"
                onClick={() => setModal("info")}
              >
                <CircleHelp size={15} />
              </button>
            </div>
            <p className="muted author">
              {schematic?.author ?? "拖曳檔案，即可開始"}
            </p>
            <span className="format-badge">
              {schematic?.format ?? "Litematic"} <span>·</span>{" "}
              {source.current ? bytes(source.current.size) : "裝置端解析"}
            </span>
            <div className="project-stats">
              <div>
                <span>尺寸</span>
                <strong>{schematic?.size.join(" × ") ?? "—"}</strong>
              </div>
              <div>
                <span>方塊總數</span>
                <strong>
                  {fmt(schematic?.blockCount ?? 0)}
                  <small> blocks</small>
                </strong>
              </div>
            </div>
            <button
              className="button save-button"
              onClick={() => void saveLocal()}
              disabled={!schematic}
            >
              <ArrowDownToLine size={14} />
              儲存至本機圖庫
            </button>
          </div>
          <div className="section-heading">
            <span>
              <Layers3 size={15} />
              子區域
            </span>
            <span className="count-badge">
              {schematic?.regions.length ?? 0}
            </span>
          </div>
          <div className="regions">
            {schematic?.regions.map((r, i) => (
              <div
                className={`region-row ${view.hidden.includes(r.name) ? "hidden-region" : ""}`}
                key={r.name}
              >
                <button
                  className={`region-check ${done.includes(`region:${r.name}`) ? "checked" : ""}`}
                  aria-label={`標記${r.name}完成`}
                  title="標記建造完成"
                  onClick={() => toggleDone(`region:${r.name}`)}
                >
                  {done.includes(`region:${r.name}`) ? (
                    <Check size={12} />
                  ) : (
                    <span
                      style={{
                        background: [
                          "#b6d895",
                          "#c0a77c",
                          "#94bfc9",
                          "#bea7ce",
                        ][i % 4],
                      }}
                    />
                  )}
                </button>
                <button
                  className="region-name"
                  onClick={() => engine.current?.fit(r.name)}
                  title={`聚焦 ${r.name}`}
                >
                  <strong>{r.name}</strong>
                  <small>{fmt(r.blockCount)} 方塊</small>
                </button>
                <IconButton
                  label={`${view.hidden.includes(r.name) ? "顯示" : "隱藏"}${r.name}`}
                  onClick={() =>
                    patch({
                      hidden: view.hidden.includes(r.name)
                        ? view.hidden.filter((n) => n !== r.name)
                        : [...view.hidden, r.name],
                    })
                  }
                >
                  {view.hidden.includes(r.name) ? (
                    <EyeOff size={15} />
                  ) : (
                    <Eye size={15} />
                  )}
                </IconButton>
              </div>
            ))}
          </div>
          <button
            className="text-button region-reset"
            onClick={() => {
              patch({ hidden: [] });
              engine.current?.fit();
            }}
          >
            <RotateCcw size={13} />
            顯示全部區域
          </button>
          <div className="build-progress">
            <div>
              <span>
                <CheckCheck size={15} />
                建造進度
              </span>
              <small>
                {doneRegionCount} / {schematic?.regions.length ?? 0}
              </small>
            </div>
            <div className="progress-track">
              <i
                style={{
                  width: `${(doneRegionCount / (schematic?.regions.length || 1)) * 100}%`,
                }}
              />
            </div>
            <p>勾選區域，記下你的建造進度。</p>
          </div>
          <div className="left-spacer" />
          <button
            className="compare-button"
            disabled={!schematic || !!busy}
            onClick={() => compareInput.current?.click()}
          >
            <ArrowLeftRight size={17} />
            <div>
              <strong>比較另一份藍圖</strong>
              <small>探索方塊與狀態的變化</small>
            </div>
            <ChevronRight size={15} />
          </button>
          <div className="local-note">
            <ShieldCheck size={16} />
            <p>
              你的創作，只屬於你。
              <br />
              <span>所有檔案皆在瀏覽器內處理。</span>
            </p>
          </div>
        </aside>
        <main className="viewer-area">
          <div className="viewer-toolbar">
            <div className="toolbar-leading">
              <button
                className="mobile-toggle icon-button"
                aria-label="開啟區域面板"
                onClick={() =>
                  setMobilePanel((m) => (m === "left" ? null : "left"))
                }
              >
                <Layers3 size={18} />
              </button>
              <span className="view-badge">
                <Box size={15} />
                3D 預覽
              </span>
              <span className="toolbar-note">你的藍圖，換個角度看。</span>
            </div>
            <div className="toolbar-actions">
              <IconButton
                label="顯示網格（G）"
                active={view.grid}
                onClick={() => patch({ grid: !view.grid })}
              >
                <Grid2X2 size={17} />
              </IconButton>
              <IconButton
                label="顯示區域邊界"
                active={view.bounds}
                onClick={() => patch({ bounds: !view.bounds })}
              >
                <ScanLine size={17} />
              </IconButton>
              <span className="tool-divider" />
              <IconButton label="顯示設定" onClick={() => setModal("settings")}>
                <SlidersHorizontal size={17} />
              </IconButton>
              <IconButton
                label="匯出與分享"
                onClick={() => setModal("export")}
                disabled={!schematic}
              >
                <Download size={17} />
              </IconButton>
              <button
                className="mobile-toggle icon-button"
                aria-label="開啟材料面板"
                onClick={() =>
                  setMobilePanel((m) => (m === "right" ? null : "right"))
                }
              >
                <Package size={18} />
              </button>
            </div>
          </div>
          <div className="viewport" ref={canvas}>
            <div className="viewport-grain" />
            <div className="scene-caption">
              <span className="eyebrow">
                {diff ? "BLUEPRINT COMPARISON" : "A SPACE FOR YOUR NEXT BUILD"}
              </span>
              <div>
                {schematic?.name ?? "讓想像，有個形狀。"}
                <span>
                  {schematic ? "本機藍圖 · 自由探索" : "將藍圖拖曳到這裡"}
                </span>
              </div>
            </div>
            <div className="scene-top-right">
              <span className="render-status">
                <span className="status-dot" />
                {meshBusy
                  ? "建立模型中"
                  : ready
                    ? "WEBGL · 就緒"
                    : "載入顯示資源"}
              </span>
              <button
                className="help-icon"
                title="操作說明"
                aria-label="操作說明"
                onClick={() => setModal("help")}
              >
                <CircleHelp size={17} />
              </button>
            </div>
            <div className="view-presets">
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
              <span />
              <button
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
                <ChevronDown size={11} />
              </button>
            </div>
            <div className="viewport-controls">
              <IconButton
                label="放大"
                onClick={() => {
                  const c = engine.current?.controls;
                  if (c) {
                    const cam = engine.current!.camera;
                    if (cam.type === "OrthographicCamera") {
                      cam.zoom *= 1.25;
                      cam.updateProjectionMatrix();
                    } else cam.position.lerp(c.target, 0.2);
                    c.update();
                  }
                }}
              >
                <Plus size={18} />
              </IconButton>
              <IconButton
                label="縮小"
                onClick={() => {
                  const c = engine.current?.controls;
                  if (c) {
                    const cam = engine.current!.camera;
                    if (cam.type === "OrthographicCamera") {
                      cam.zoom /= 1.25;
                      cam.updateProjectionMatrix();
                    } else
                      cam.position.add(
                        cam.position.clone().sub(c.target).multiplyScalar(0.25),
                      );
                    c.update();
                  }
                }}
              >
                <Minus size={18} />
              </IconButton>
              <span />
              <IconButton
                label="置中藍圖（F）"
                onClick={() => engine.current?.fit()}
              >
                <Expand size={18} />
              </IconButton>
              <IconButton
                label="全螢幕預覽"
                onClick={() => {
                  if (document.fullscreenElement)
                    void document.exitFullscreen();
                  else
                    void canvas.current
                      ?.requestFullscreen()
                      .catch(() => notice("瀏覽器不支援全螢幕。", true));
                }}
              >
                <Maximize2 size={17} />
              </IconButton>
            </div>
            <div className="axis-gizmo" aria-hidden="true">
              <span className="axis-y">Y</span>
              <span className="axis-z">Z</span>
              <span className="axis-x">X</span>
              <i />
              <b />
            </div>
            {diff && (
              <div className="diff-legend">
                <span>
                  <i className="added" />
                  新增 {fmt(diff.added)}
                </span>
                <span>
                  <i className="removed" />
                  移除 {fmt(diff.removed)}
                </span>
                <span>
                  <i className="changed" />
                  變更 {fmt(diff.changed)}
                </span>
                <button onClick={() => setDiff(undefined)} title="結束比較">
                  <X size={14} />
                </button>
                <small>以「{comparisonName}」為舊版，按藍圖原點對齊</small>
              </div>
            )}
            {view.highlight && !diff && (
              <div className="highlight-bar">
                <span
                  className="material-dot"
                  style={{ background: blockColor(view.highlight) }}
                />
                <strong>{blockLabel(view.highlight)}</strong>
                <button
                  className={view.isolate ? "selected" : ""}
                  onClick={() => patch({ isolate: !view.isolate })}
                >
                  {view.isolate ? "僅顯示此材料" : "其他材料淡化"}
                </button>
                <button onClick={locateMaterial} title="定位第一個方塊">
                  <Crosshair size={14} />
                </button>
                <button
                  onClick={() => patch({ highlight: null, isolate: false })}
                  title="取消材料篩選"
                >
                  <X size={14} />
                </button>
              </div>
            )}
            <div className="canvas-bottom">
              <span>
                <MousePointer2 size={13} />
                拖曳旋轉<span className="dot-separator">·</span>右鍵平移
                <span className="dot-separator">·</span>滾輪縮放
              </span>
              <span>{fmt(stats.rendered)} 可見方塊</span>
            </div>
            {fatal && (
              <div className="fatal-state">
                <Box size={38} />
                <h2>預覽暫時無法啟動</h2>
                <p>{fatal}</p>
                <button className="button" onClick={() => location.reload()}>
                  重新載入
                </button>
              </div>
            )}
            {!ready && !fatal && (
              <div className="initial-loading">
                <LoaderCircle className="spin" size={28} />
                <span>準備你的藍圖工作台…</span>
              </div>
            )}
          </div>
          <div className="layer-panel">
            <div className="layer-head">
              <div>
                <Layers3 size={17} />
                <strong>分層檢視</strong>
                <span className="keyboard-hint">↑ ↓</span>
              </div>
              <div className="segmented">
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
              <select
                aria-label="剖面軸向"
                value={view.axis}
                onChange={(e) => {
                  const axis = Number(e.target.value) as 0 | 1 | 2;
                  patch({ axis, layer: schematic?.max[axis] ?? 0 });
                }}
              >
                <option value={0}>X 軸</option>
                <option value={1}>Y 軸</option>
                <option value={2}>Z 軸</option>
              </select>
            </div>
            <div className="layer-slider">
              <IconButton
                label="上一層"
                disabled={!schematic || view.layer <= schematic.min[view.axis]}
                onClick={() =>
                  patch({
                    mode: view.mode === "all" ? "single" : view.mode,
                    layer: view.layer - 1,
                  })
                }
              >
                <ChevronLeft size={16} />
              </IconButton>
              <span className="range-min">
                {schematic?.min[view.axis] ?? 0}
              </span>
              <input
                aria-label="目前顯示樓層"
                type="range"
                min={schematic?.min[view.axis] ?? 0}
                max={schematic?.max[view.axis] ?? 1}
                value={view.layer}
                onChange={(e) =>
                  patch({
                    layer: Number(e.target.value),
                    mode: view.mode === "all" ? "single" : view.mode,
                  })
                }
              />
              <span className="range-max">
                {schematic?.max[view.axis] ?? 0}
              </span>
              <IconButton
                label="下一層"
                disabled={!schematic || view.layer >= schematic.max[view.axis]}
                onClick={() =>
                  patch({
                    mode: view.mode === "all" ? "single" : view.mode,
                    layer: view.layer + 1,
                  })
                }
              >
                <ChevronRight size={16} />
              </IconButton>
              <div className="layer-value">
                <span>{axisName}</span>
                <input
                  aria-label={`${axisName} 座標`}
                  type="number"
                  min={schematic?.min[view.axis] ?? 0}
                  max={schematic?.max[view.axis] ?? 0}
                  value={view.layer}
                  onChange={(e) =>
                    patch({
                      layer: Math.max(
                        schematic?.min[view.axis] ?? 0,
                        Math.min(
                          schematic?.max[view.axis] ?? 0,
                          Math.round(Number(e.target.value)),
                        ),
                      ),
                      mode: view.mode === "all" ? "single" : view.mode,
                    })
                  }
                />
              </div>
              <button
                className={`layer-done ${layerDone ? "is-done" : ""}`}
                disabled={view.axis !== 1 || !schematic}
                title="標記此 Y 層建造完成"
                onClick={() => toggleDone(`layer:${view.layer}`)}
              >
                <Check size={15} />
                <span>{layerDone ? "已完成" : "完成此層"}</span>
              </button>
            </div>
          </div>
        </main>
        <aside
          className={`right-panel ${mobilePanel === "right" ? "mobile-open" : ""}`}
        >
          <div className="right-tabs">
            <button
              className={rightTab === "materials" ? "selected" : ""}
              onClick={() => setRightTab("materials")}
            >
              <Package size={16} />
              材料清單<span>{materialList.length}</span>
            </button>
            <button
              className={rightTab === "block" ? "selected" : ""}
              onClick={() => setRightTab("block")}
            >
              <MousePointer2 size={15} />
              方塊資訊
            </button>
            <button
              className="mobile-toggle small-icon"
              aria-label="關閉材料面板"
              onClick={() => setMobilePanel(null)}
            >
              <X size={17} />
            </button>
          </div>
          {rightTab === "materials" ? (
            <>
              <div className="materials-summary">
                <span className="eyebrow">EVERY BLOCK COUNTS</span>
                <div>
                  <strong>{fmt(totalMaterials)}</strong>
                  <span>個方塊</span>
                  <button
                    className="small-icon"
                    aria-label="下載材料 CSV"
                    title="下載 CSV"
                    onClick={exportCsv}
                    disabled={!schematic}
                  >
                    <Download size={17} />
                  </button>
                </div>
                <p>{materialList.length} 種材料，讓下一次建造準備就緒。</p>
              </div>
              <div className="material-search">
                <Search size={15} />
                <input
                  placeholder="搜尋材料或方塊 ID…"
                  aria-label="搜尋材料"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {search && (
                  <button
                    className="small-icon"
                    aria-label="清除搜尋"
                    onClick={() => setSearch("")}
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
              <div className="material-table-head">
                <button
                  onClick={() =>
                    setMaterialSort(materialSort === "name" ? "count" : "name")
                  }
                >
                  材料名稱 {materialSort === "name" ? "↓" : ""}
                </button>
                <button
                  onClick={() =>
                    setMaterialSort(materialSort === "count" ? "name" : "count")
                  }
                >
                  數量 {materialSort === "count" ? "↓" : ""}
                </button>
              </div>
              <div className="material-list">
                {rows.map((m) => (
                  <button
                    key={m.name}
                    className={`material-row ${view.highlight === m.name ? "selected" : ""}`}
                    onClick={() => selectMaterial(m.name)}
                    title={`${m.name}\n${Math.floor(m.count / 64)} 組 + ${m.count % 64} 個\n點選以高亮`}
                  >
                    <span
                      className="block-swatch"
                      style={
                        {
                          "--block-color": blockColor(m.name),
                        } as React.CSSProperties
                      }
                    >
                      <Box size={19} />
                    </span>
                    <span className="material-name">
                      <strong>{blockLabel(m.name)}</strong>
                      <small>{m.name.replace("minecraft:", "")}</small>
                    </span>
                    <span className="material-count">
                      {fmt(m.count)}
                      <small>
                        {Math.floor(m.count / 64)} 組{" "}
                        {m.count % 64 ? `+ ${m.count % 64}` : ""}
                      </small>
                    </span>
                  </button>
                ))}
                {!rows.length && (
                  <div className="empty-small">
                    <Search size={25} />
                    <p>找不到符合的材料</p>
                    <button
                      className="text-button"
                      onClick={() => setSearch("")}
                    >
                      清除搜尋
                    </button>
                  </div>
                )}
              </div>
              <div className="material-footer">
                <label>
                  <input
                    type="checkbox"
                    checked={onlyCurrentLayer}
                    onChange={(e) => setOnlyCurrentLayer(e.target.checked)}
                  />
                  統計目前剖面
                </label>
                <span>方塊數統計</span>
                <p>組／盒以 64 格換算；門、床及雙半磚等不等同實際物品需求。</p>
                <button
                  className="button"
                  onClick={exportCsv}
                  disabled={!schematic}
                >
                  <Download size={14} />
                  匯出材料清單
                  <ArrowUpRight size={14} />
                </button>
              </div>
            </>
          ) : (
            <div className="block-panel">
              {picked ? (
                <>
                  <span
                    className="large-block"
                    style={{ color: blockColor(picked.state.name) }}
                  >
                    <Box size={65} strokeWidth={1} />
                  </span>
                  <h2>{blockLabel(picked.state.name)}</h2>
                  <code>{picked.state.name}</code>
                  <div className="info-row">
                    <span>所屬區域</span>
                    <strong>{picked.region}</strong>
                  </div>
                  <div className="info-row">
                    <span>藍圖座標</span>
                    <strong>{picked.position.join(", ")}</strong>
                  </div>
                  <div className="info-row">
                    <span>區域陣列座標</span>
                    <strong>{picked.local.join(", ")}</strong>
                  </div>
                  <h3>方塊狀態</h3>
                  {Object.entries(picked.state.properties).length ? (
                    Object.entries(picked.state.properties).map(([k, v]) => (
                      <div className="property-row" key={k}>
                        <code>{k}</code>
                        <strong>{v}</strong>
                      </div>
                    ))
                  ) : (
                    <p className="muted">此方塊沒有額外狀態。</p>
                  )}
                  <button
                    className="button"
                    onClick={() => engine.current?.select(picked, true)}
                  >
                    <Crosshair size={15} />
                    聚焦此方塊
                  </button>
                  <button
                    className="button subtle"
                    onClick={() => {
                      patch({ highlight: picked.state.name });
                      setRightTab("materials");
                    }}
                  >
                    <Search size={15} />
                    高亮相同材料
                  </button>
                  {(() => {
                    const r = schematic?.regions.find(
                      (r) => r.name === picked.region,
                    );
                    const entities = r?.blockEntities.filter(
                      (e) =>
                        Number(e.x?.value) === picked.local[0] &&
                        Number(e.y?.value) === picked.local[1] &&
                        Number(e.z?.value) === picked.local[2],
                    );
                    return entities?.length ? (
                      <details>
                        <summary>方塊實體 NBT</summary>
                        <pre>{nbtJson(entities)}</pre>
                      </details>
                    ) : null;
                  })()}
                </>
              ) : (
                <div className="selection-empty">
                  <MousePointer2 size={36} strokeWidth={1} />
                  <h3>每一格，都有細節。</h3>
                  <p>
                    點選模型上的方塊，
                    <br />
                    查看它的座標、方向與狀態。
                  </p>
                </div>
              )}
            </div>
          )}
        </aside>
      </div>
      <footer className="app-footer">
        <span>
          <LockKeyhole size={11} />
          裝置端解析<span className="dot-separator">·</span>無檔案上傳
          <span className="dot-separator">·</span>
          {offlineStatus}
        </span>
        <span>
          顯示資源：{packName}
          {stats.missing.length > 0 && (
            <button onClick={() => setModal("settings")}>
              {" "}
              · {stats.missing.length} 種替代模型
            </button>
          )}
        </span>
        <button onClick={() => setModal("help")}>
          為每一個想蓋的世界 <Leaf size={12} />
        </button>
      </footer>
      {busy && (
        <div className="loading-overlay" role="status" aria-live="polite">
          <div className="loading-card">
            <LoaderCircle className="spin" size={26} />
            <h3>{busy.label}</h3>
            <div className="progress-track">
              <i style={{ width: `${busy.progress}%` }} />
            </div>
            <p>檔案正在你的裝置內處理 · {busy.progress}%</p>
            <button
              className="button subtle"
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
          className="drop-overlay"
          onDragLeave={(e) => {
            if (e.target === e.currentTarget) setDragging(false);
          }}
        >
          <div>
            <Upload size={40} />
            <h2>放下檔案，展開你的世界。</h2>
            <p>.litematic · .schem · .nbt · 檢視包 .zip</p>
            <span>
              <ShieldCheck size={15} />
              檔案全程留在這部裝置
            </span>
          </div>
        </div>
      )}
      {toast && (
        <div
          className={`toast ${toast.error ? "error" : ""}`}
          role={toast.error ? "alert" : "status"}
        >
          {toast.error ? <CircleHelp size={18} /> : <Check size={18} />}
          <span>{toast.message}</span>
          <button aria-label="關閉訊息" onClick={() => setToast(null)}>
            <X size={16} />
          </button>
        </div>
      )}
      {modal === "settings" && (
        <Modal
          title="讓預覽，適合你的方式。"
          description="調整顯示、模型資源與裝置效能。"
          onClose={closeModal}
        >
          <div className="settings-list">
            <label>
              <span>
                <Grid2X2 size={17} />
                地面網格
              </span>
              <input
                type="checkbox"
                checked={view.grid}
                onChange={(e) => patch({ grid: e.target.checked })}
              />
            </label>
            <label>
              <span>
                <ScanLine size={17} />
                區域邊界框
              </span>
              <input
                type="checkbox"
                checked={view.bounds}
                onChange={(e) => patch({ bounds: e.target.checked })}
              />
            </label>
            <label>
              <span>
                <Box size={17} />
                線框模式
              </span>
              <input
                type="checkbox"
                checked={view.wireframe}
                onChange={(e) => patch({ wireframe: e.target.checked })}
              />
            </label>
            <label>
              <span>
                <Eye size={17} />
                投影方式
              </span>
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
              <span>
                <Settings2 size={17} />
                顯示品質
              </span>
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
          <div className="setting-card">
            <span className="eyebrow">RESOURCE PACK</span>
            <h3>{packName}</h3>
            <p>
              內建 Minecraft 1.21.1 材質與靜態方塊模型。可匯入 Java 版資源包 ZIP
              覆寫模型與材質；動畫使用第一幀。
            </p>
            <button
              className="button"
              onClick={() => packInput.current?.click()}
            >
              <Upload size={15} />
              匯入本機資源包
            </button>
            {stats.missing.length > 0 && (
              <details>
                <summary>{stats.missing.length} 種方塊使用替代模型</summary>
                <pre>{stats.missing.join("\n")}</pre>
              </details>
            )}
          </div>
          <p className="muted footnote">
            特殊方塊實體外觀、實體渲染與紅石運作模擬尚未支援。資源包套用後需重新整理分頁才能還原。
          </p>
        </Modal>
      )}
      {modal === "info" && (
        <Modal title={schematic?.name ?? "藍圖資訊"} onClose={closeModal}>
          <p className="description">
            {schematic?.description || "這份藍圖沒有附加描述。"}
          </p>
          {[
            ["作者", schematic?.author],
            ["檔案", source.current?.name],
            ["格式", `${schematic?.format} v${schematic?.version}`],
            ["Minecraft DataVersion", schematic?.dataVersion || "未記錄"],
            [
              "藍圖範圍",
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
            <div className="info-row" key={String(k)}>
              <span>{k}</span>
              <strong>{v}</strong>
            </div>
          ))}
          {schematic?.warnings.map((w) => (
            <p className="notice-box" key={w}>
              {w}
            </p>
          ))}
          <label className="field-label">
            圖庫標籤
            <input
              value={tagText}
              placeholder="例如：生存、房屋、待建造"
              onChange={(e) => setTagText(e.target.value)}
            />
          </label>
          <button className="button primary" onClick={() => void saveLocal()}>
            <Library size={15} />
            儲存至本機圖庫
          </button>
        </Modal>
      )}
      {modal === "export" && (
        <Modal
          title="帶走你的下一步。"
          description="圖片、材料、檔案與檢視設定，都在裝置端產生。"
          onClose={closeModal}
        >
          <div className="export-card">
            <span className="export-icon">
              <Image size={24} />
            </span>
            <div>
              <h3>匯出預覽圖片</h3>
              <p>將目前視角儲存為 PNG。</p>
              <div className="export-options">
                <label>
                  <input
                    type="checkbox"
                    checked={transparent}
                    onChange={(e) => setTransparent(e.target.checked)}
                  />
                  透明背景
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={includeSize}
                    onChange={(e) => setIncludeSize(e.target.checked)}
                  />
                  名稱與尺寸
                </label>
                <select
                  aria-label="圖片解析度"
                  value={exportScale}
                  onChange={(e) => setExportScale(e.target.value)}
                >
                  <option value="1">1×</option>
                  <option value="2">2×</option>
                </select>
              </div>
              <button
                className="button primary"
                onClick={() => void exportPng()}
              >
                <Download size={14} />
                下載 PNG
              </button>
            </div>
          </div>
          <div className="export-grid">
            <button onClick={exportCsv}>
              <Package size={22} />
              <strong>材料清單</strong>
              <span>下載 CSV 表格</span>
            </button>
            <button
              onClick={() => {
                if (source.current)
                  download(source.current, source.current.name);
              }}
            >
              <FileBox size={22} />
              <strong>原始藍圖</strong>
              <span>下載未修改的檔案</span>
            </button>
            <button onClick={() => void exportBundle()}>
              <FolderOpen size={22} />
              <strong>藍圖檢視包</strong>
              <span>原始檔＋視角設定 ZIP</span>
            </button>
            <button onClick={() => void share()}>
              <Copy size={22} />
              <strong>複製視角連結</strong>
              <span>對方需開啟相同檔案</span>
            </button>
          </div>
        </Modal>
      )}
      {modal === "library" && (
        <Modal
          title="收藏你的每一個世界。"
          description="圖庫儲存在這個瀏覽器，重新開啟網站也能繼續。"
          wide
          onClose={closeModal}
        >
          <div className="library-actions">
            <div className="material-search">
              <Search size={15} />
              <input
                aria-label="搜尋本機圖庫"
                placeholder="搜尋名稱、作者或標籤…"
                value={librarySearch}
                onChange={(e) => setLibrarySearch(e.target.value)}
              />
            </div>
            <button
              className="button primary"
              disabled={!schematic}
              onClick={async () => {
                await saveLocal();
                setLibrary(await libraryList());
              }}
            >
              <Plus size={15} />
              儲存目前藍圖
            </button>
          </div>
          <div className="library-grid">
            {library
              .filter((e) =>
                `${e.name} ${e.author} ${e.tags}`.includes(librarySearch),
              )
              .map((e) => (
                <article className="library-card" key={e.id}>
                  <button
                    className="library-preview"
                    onClick={() => {
                      setModal(null);
                      void readFile(new File([e.blob], e.fileName));
                    }}
                  >
                    {e.thumbnail ? (
                      <img src={e.thumbnail} alt={e.name} />
                    ) : (
                      <Box size={45} />
                    )}
                  </button>
                  <div className="library-card-body">
                    <h3>{e.name}</h3>
                    <p>
                      {e.author} · {fmt(e.blockCount)} 方塊
                    </p>
                    {e.tags && <span className="format-badge">{e.tags}</span>}
                    <div>
                      <small>
                        {new Date(e.savedAt).toLocaleDateString("zh-TW")} ·{" "}
                        {bytes(e.bytes)}
                      </small>
                      <IconButton
                        label={`刪除圖庫中的${e.name}`}
                        onClick={async () => {
                          await libraryDelete(e.id);
                          setLibrary((v) => v.filter((x) => x.id !== e.id));
                          notice("已移除本機圖庫副本；原始檔案不受影響。");
                        }}
                      >
                        <Trash2 size={14} />
                      </IconButton>
                    </div>
                  </div>
                </article>
              ))}
          </div>
          {!library.length && (
            <div className="library-empty">
              <Library size={39} strokeWidth={1} />
              <h3>為喜歡的藍圖，留個位置。</h3>
              <p>儲存目前藍圖，或先探索內建小屋。</p>
              <button
                className="button"
                onClick={() => {
                  setModal(null);
                  void readFile(demoFile());
                }}
              >
                <Sprout size={15} />
                探索示範藍圖
              </button>
            </div>
          )}
          <p className="muted footnote">
            清除網站資料會移除圖庫與建造進度。需要備份時，請下載藍圖檢視包。
          </p>
        </Modal>
      )}
      {modal === "help" && (
        <Modal
          title="從一個方塊，開始探索。"
          description="liteDisplay 是在瀏覽器裡的 Minecraft 藍圖工作台。"
          onClose={closeModal}
        >
          <div className="help-steps">
            <div>
              <span>01</span>
              <section>
                <h3>開啟你的藍圖</h3>
                <p>
                  拖入 .litematic（v1–v7）、Sponge .schem（v2／v3）、原版
                  .nbt，或本站匯出的 ZIP 檢視包。檔案上限 64 MB，總區域體積上限
                  800 萬格。
                </p>
              </section>
            </div>
            <div>
              <span>02</span>
              <section>
                <h3>換個角度，看看細節</h3>
                <p>
                  拖曳旋轉、右鍵平移、滾輪縮放。手機可雙指縮放與平移。點選方塊查看座標與方向，材料清單可高亮相同材料。
                </p>
              </section>
            </div>
            <div>
              <span>03</span>
              <section>
                <h3>一層一層，慢慢完成</h3>
                <p>
                  選擇單層／累積檢視，使用 X、Y、Z 軸查看剖面。完成 Y
                  層或子區域後勾選，進度會自動保存。
                </p>
              </section>
            </div>
          </div>
          <div className="shortcut-grid">
            <span>
              <kbd>F</kbd>置中藍圖
            </span>
            <span>
              <kbd>G</kbd>切換網格
            </span>
            <span>
              <kbd>↑</kbd>
              <kbd>↓</kbd>切換樓層
            </span>
            <span>
              <kbd>Esc</kbd>關閉面板
            </span>
          </div>
          <div className="setting-card">
            <ShieldCheck size={21} />
            <h3>你的藍圖留在裝置內</h3>
            <p>
              檔案解析、材料統計與匯出皆在瀏覽器執行。首次開啟需下載網站與顯示資源；完成快取後可離線使用。未載入的網站版本仍需網路。
            </p>
          </div>
          <p className="muted footnote">
            使用 Three.js、Deepslate 與 mcmeta 顯示資源。Minecraft 素材 © Mojang
            Studios；本網站非官方產品。比較功能依藍圖座標對齊；區域重疊時材料統計按區域累加。
          </p>
        </Modal>
      )}
    </div>
  );
}
