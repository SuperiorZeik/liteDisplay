# liteDisplay

純靜態的 Minecraft 藍圖工作台。檔案在瀏覽器的 Web Worker 中解壓縮、讀取 NBT 並解包方塊資料，不會傳送到伺服器。顯示資源已隨網站打包，執行時不依賴第三方 API。

## 開發與建置

需要 Node.js 22.12 以上或 Node.js 24。

```powershell
npm ci
npm run dev
```

開啟終端顯示的本機網址。預設為 `http://127.0.0.1:5173/`。

```powershell
npm test
npm run build
npm run preview
```

`dist/` 是完整的靜態網站，可放到 GitHub Pages、Cloudflare Pages 或其他 HTTPS 靜態空間。支援子路徑部署；不需要 Node.js 伺服器、資料庫或 API 金鑰。直接以 `file://` 開啟不支援 Worker 與離線快取，請用 HTTP 預覽。

## Cloudflare Pages 自動部署

建議連接私人 GitHub repository，正式分支設為 `main`、建置指令 `npm run build:pages`、輸出目錄 `dist`、根目錄留空。Node.js 版本由 `.node-version` 指定為 24。設定一次後，每次 `git push origin main` 都會自動測試並部署，不需要 Cloudflare API token。

完整步驟與網站存取權注意事項請見 [Cloudflare Pages 部署說明](docs/cloudflare-pages.md)。私人 repository 不會讓 Pages 網站自動變成私人。

## 已實作

- `.litematic` v1–v7、誤命名的 `.litematica`、Sponge `.schem` v2/v3、原版 `.nbt`，以及本站 ZIP 檢視包。
- gzip／未壓縮 NBT、原生 BigInt long array、跨 64 位元邊界的緊密位元解包、負尺寸與多區域座標。
- Minecraft 1.21.1 的模型與像素材質、軌道操作、固定視角、透視／正交、網格、區域邊界、線框與低畫質模式。
- X／Y／Z 單層與累積剖面、區域隱藏與聚焦。
- 方塊點選、座標、完整 block state，以及可定位的方塊實體 NBT。
- 方塊實體靜態模型：單／雙箱、陷阱箱、終界箱、16 色床與界伏盒、未染色界伏盒、站立／壁掛頭顱、一般／壁掛／懸掛告示牌、旗幟、鐘、海靈核心與飾紋陶罐。
- 告示牌新舊 NBT、正反面文字、文字染色與發光描邊；旗幟新舊格式圖樣與顏色。不同外觀分開批次，物品欄內容不影響模型快取。文字只在本機 canvas 繪製，不執行事件、指令或 HTML。
- 在「顯示設定 → 探索方塊實體展示台」開啟可下載的測試藍圖；支援分層、點選與 PNG 匯出。
- 材料搜尋、排序、目前剖面統計、高亮、單一材料隔離與定位。
- 材料 CSV、1×／2× PNG、透明背景、名稱與尺寸標示、原始檔下載。
- 本機圖庫（IndexedDB）、縮圖、標籤搜尋、Y 層／區域建造進度（localStorage）。
- 同座標雙檔比較：新增、移除、狀態變更；完整狀態參與比較。
- 原始藍圖＋相機／檢視設定的 ZIP；分享視角網址以 SHA-256 綁定原始檔案。
- 本機 Java 資源包 ZIP 匯入，覆寫模型與貼圖。資源包僅存在目前分頁。
- 手機抽屜面板、觸控操作、鍵盤快捷鍵、對話框焦點循環。
- 正式建置產生有版本識別的 Service Worker，預先快取完整網站與顯示資源；完成快取後可離線重開。

## 資料與效能界線

- 檔案上限 64 MB、NBT 解壓縮上限 256 MB。總區域體積安全上限提高至 5.12 億格，所有區域的方塊索引合計上限 128 MiB；實際可開啟體積也受調色盤大小、格式與裝置記憶體影響，並非每個 5.12 億格的檔案都能開啟。
- Litematic 保留緊密位元資料，不再逐格展開成 32 位元索引；Sponge／原版結構依調色盤採用 8／16 位元索引。材料數量與有內容的 16×16×16 區塊索引於解析執行緒一次建立，主畫面只遍歷有內容且落在剖面內的區塊。
- 超過 800 萬格的大型藍圖預設以非空白 Y 單層開啟，仍保留完整資料、材料統計與原始檔下載。相機會依目前剖面的內容範圍置中，避免空氣區域把模型縮得太小。
- 預覽以 64 格空間區塊批次繪製，讓視野外的區塊略過繪製與點選測試。每個方塊只保存 3 個位置浮點數與 1 個索引，不保留逐格座標物件或 4×4 矩陣。網格、邊界、投影、畫質與線框切換可重用已建立的預覽。
- 依模型的 cullface 移除相鄰實心方塊遮住的面；耕地／土徑移除相同高度的共用側面，史萊姆移除共用外層面並保留內層。切換剖面或材料隔離時會重新計算，露出切面。
- 預覽最多顯示 200 萬個可見方塊或 16,384 個批次，達上限時保留已建立的預覽並顯示提示。實際流暢度仍取決於模型複雜度與裝置。用剖面、軸向與區域隱藏可查看其餘部分；匯出 PNG 僅包含目前實際顯示的預覽。
- 雙檔比較合計最多 100 萬個非空氣方塊，依藍圖座標原點對齊。
- 每次檢視最多產生 256 種不同告示牌文字面材質；重複外觀可共用。超過時保留牌身與 NBT，並提示縮小檢視範圍。旗幟最多顯示前 64 層圖樣。
- 區域重疊時材料數依區域累加。材料清單是方塊統計；組與盒以每組 64 格換算，沒有完整的建造物品轉換（例如床、門、雙半磚）。
- 顯示資源固定為 1.21.1，不執行 Minecraft DataFixer。未知／模組方塊，以及無法以靜態方塊模型呈現的種類，使用可選取的替代方塊並列出名稱。
- 玩家頭顱目前使用內建 Steve，不會連線取得自訂皮膚。陶罐紋飾、容器內物品、講台書本、附魔台書本、終界傳送門特效及其他未列出的動態方塊實體外觀尚未支援。
- 開箱／床／旗幟等動畫、動態流體、材質動畫、一般實體與紅石模擬尚未支援。材質動畫顯示第一幀；告示牌使用系統字型與純文字，不完全重現 Minecraft 富文字排版。部分 UV lock、光照與透明排序可能與遊戲不同。
- 差異比較仍以 block state 為準，不包含 NBT 文字、圖樣或物品欄內容的差異。
- 保留並可下載原始檔，不會重新序列化或降版使用者的藍圖。
- 清除網站資料會移除本機圖庫與建造進度。視角 ZIP 保存藍圖與檢視設定，不含本機進度及自訂資源包。

## 原始碼

| 路徑                        | 用途                                      |
| --------------------------- | ----------------------------------------- |
| `src/core/nbt.ts`           | 帶型別的 NBT、gzip、BigInt 讀寫與大小限制 |
| `src/core/parser.ts`        | 格式轉換、調色盤、座標與 bit packing      |
| `src/core/parse.worker.ts`  | 裝置端背景解析與進度                      |
| `src/core/demo.ts`          | 可下載的真實格式示範藍圖                  |
| `src/render/resources.ts`   | Deepslate 模型、材質圖集、資源包          |
| `src/render/scene.ts`       | Three.js instancing、視角、選取與差異渲染 |
| `src/core/storage.ts`       | IndexedDB、檔案雜湊與本機下載             |
| `src/App.tsx`               | 工作台與功能連動                          |
| `scripts/build-offline.mjs` | 離線快取與第三方授權資訊                  |

`npm test` 包含解析、記憶體限制、模型、剖面與點選的離線測試；另外 4 個真實檔案測試在 `test-results/fixtures/` 有對應檔案時執行，否則會明確標記略過。設定 `LITEDISPLAY_PERF_FIXTURE` 為本機 `1偵查者8X8區塊.litematic` 的路徑，可額外驗證百萬方塊預覽到最上層且不被截斷；檔案不會加入網站或上傳。

真實整合樣本來源：[RubixDev/rustmatica/test_files](https://github.com/RubixDev/rustmatica/tree/main/test_files)，使用 `donut.litematic`、`donut_modified.litematic`、`axolotl.litematic`。這些檔案僅位於忽略的測試目錄，不會發布到網站。

Minecraft 顯示資源來自 [misode/mcmeta](https://github.com/misode/mcmeta) 的固定 1.21.1 標籤。`npm run assets` 可重建本機靜態資源，需要網路。材質與遊戲資源屬 Mojang Studios／Microsoft；本站非官方產品。相依軟體授權會一併輸出到 `dist/third-party-notices.txt`。
