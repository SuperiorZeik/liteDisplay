# 部署到 Cloudflare Pages

這個專案只需要靜態託管，沒有後端、資料庫或執行階段環境變數。使用 Cloudflare 的 Git 整合，之後每次推送 `main` 都會自動測試、建置與部署；不需要 GitHub Actions 的 Cloudflare API token。

## 第一次連接

1. 在 GitHub 建立 `SuperiorZeik/liteDisplay`，可見度選 **Private**，不要另外產生 README、授權檔或 `.gitignore`。如果 repository 已存在，先確認內容再接上，不要覆寫它。
2. 將本專案目錄（包含 `package.json` 的這一層）推送到該 repository 的 `main`。
3. 登入 [Cloudflare Dashboard](https://dash.cloudflare.com/)，選擇正確帳號，進入 **Workers & Pages → Create application → Pages → Connect to Git**。請選 Pages，不是 Workers。
4. 連接 GitHub 時，只授權 `SuperiorZeik/liteDisplay` 這一個 repository，避免授權所有私人 repository。
5. 選取 repository，填入下表，然後儲存並部署。

| 設定 | 值 |
| --- | --- |
| Production branch | `main` |
| Framework preset | `React (Vite)`；若沒有這個選項，可選 `None` |
| Root directory | 留空（repository 根目錄就是本專案） |
| Build command | `npm run build:pages` |
| Build output directory | `dist` |
| Node.js | `.node-version` 已指定 `24`；也可在建置環境設定 `NODE_VERSION=24` |
| 執行階段環境變數／Secrets | 不需要 |

若你自行把整個上層 `liteDisplay` 目錄放進另一個 repository，Root directory 才要改成 `lite-display`。不要把上層的目錄名稱誤填成這個 repository 的根目錄。

`npm run build:pages` 會先執行測試；任一步驟失敗就不會部署新版。顯示資源已納入 Git，不需要在 Cloudflare 上執行 `npm run assets`。`_headers` 會隨 Vite 複製到 `dist`，讓入口頁與 Service Worker 重新驗證，檔名有雜湊的 JS/CSS 則可長期快取。

GitHub 的 `CI` 工作流程也會在推送與 pull request 時執行相同檢查，但它不負責部署，也不持有 Cloudflare 憑證。Cloudflare 的部署會獨立執行 `build:pages`，不依賴 GitHub Actions 的執行結果。

## 之後更新

在這個專案目錄內執行：

```powershell
npm run build:pages
git status
git add src/App.tsx
git commit -m "Update blueprint viewer"
git push origin main
```

`git add` 請換成這次實際修改的檔案；先確認差異，不要提交 API token、私人藍圖或下載的測試檔。`.env*`、`.dev.vars*`、`.wrangler/`、`test-results/` 與建置產物都已忽略。

Cloudflare 收到 GitHub 的 push 後就會自動更新正式網站。其他分支可在 Cloudflare 的 Branch control 設定是否產生預覽部署。這不是自動監看本機檔案：你仍要提交並推送要發布的變更。

## 私人 repo 不等於私人網站

GitHub Private 只保護原始碼 repository；Cloudflare Pages 的正式與預覽網址預設可公開存取，瀏覽器收到的 HTML、JavaScript、材質也能被下載。若網站也需要私人存取，請先設定並驗證 Cloudflare Access，不要只依賴 repo 的 Private 標記；預覽部署的 Access 設定也不等於保護正式網站與自訂網域。

無論網站是否公開，使用者匯入的藍圖仍只在瀏覽器解析，不會上傳到 GitHub 或 Cloudflare。

## 與既有 Sites 網站並存

`.openai/hosting.json` 保留原本 Sites 專案的識別資訊，Cloudflare Pages 不會使用它。本部署流程不會變更原本 Sites 網站的存取權限。GitHub 推送只會更新已連接的 Cloudflare Pages；不會自動同步原本的 Sites 網站。

## 排除常見問題

- GitHub 找不到 repository：確認 Cloudflare GitHub App 已獲得這一個私人 repository 的權限。
- 顯示找不到 `package.json`：確認 Root directory 留空，且推送的是本專案而非上層包裝目錄。
- Node 版本錯誤：確認使用目前的建置系統，並檢查 `.node-version` 或設定 `NODE_VERSION=24`。
- 網站沒有更新：先確認 `main` 推送成功，再看 Cloudflare 的部署紀錄與對應 commit。瀏覽器若仍保留舊分頁，可重新開啟；已開啟的分頁可能要重新整理才能載入新版 Service Worker。
- 測試顯示部分 integration fixtures 被略過：`test-results/fixtures` 是本機選用檔案，沒有納入 Git；核心解析與方塊實體測試仍會執行。

官方文件：[Git 整合](https://developers.cloudflare.com/pages/get-started/git-integration/)、[建置設定](https://developers.cloudflare.com/pages/configuration/build-configuration/)、[Node 版本](https://developers.cloudflare.com/pages/configuration/build-image/)、[GitHub 權限](https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/)。
