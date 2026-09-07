# 多平台剧数据同步中心

## 桌面端持久化与日志

渲染进程通过 `window.desktop` 使用主进程提供的安全桥接 API。

```ts
// 公共配置，持久化键为 global:language
await window.desktop.store.set("language", "zh-CN");
const language = await window.desktop.store.get<string>("language");

// 平台配置，持久化键为 platform:bangumi:auto-sync
await window.desktop.store.setForPlatform("bangumi", "auto-sync", true);
const autoSync = await window.desktop.store.getForPlatform<boolean>("bangumi", "auto-sync");

// 同时输出到控制台和日志文件
window.desktop.log.info("Sync started", { platform: "bangumi" });
```

平台 ID 与配置键统一使用小写 kebab-case。`electron-store` 数据是普通 JSON，不应用来明文保存密码或令牌；此类信息应改用系统安全凭据存储。

主窗口的尺寸、位置、最大化和全屏状态会自动恢复。日志文件名为 `drama-sync-center.log`，单文件达到 5 MB 后自动轮转，实际目录使用 Electron 当前系统的日志目录。

## 达人中心后台 API

接口客户端位于 workspace 包 `@drama-sync/daren-center-automation`。可直接使用的生产配置统一保存在不会提交到 Git 的根目录文件 `.env.production`。Electron 打包时会自动将它复制为 `build/automation/.env`，该文件只是构建中间产物，无需手工维护。

```bash
# 验证登录和 /api/b/auth/me
pnpm --filter @drama-sync/daren-center-automation run login
```

## 平台自动化包

平台抓取包统一使用 `@drama-sync/platform-*` 前缀：

- `@drama-sync/platform-weixin-channels`
- `@drama-sync/platform-kuaishou`
- `@drama-sync/platform-pinduoduo`
- `@drama-sync/platform-meituan`
- `@drama-sync/platform-tencent-video`
- `@drama-sync/platform-qq-short-drama`
- `@drama-sync/platform-tiktok-drama`

微信视频号卡片当前提供“助手 Excel”“助手 JSON”和“标准看板”三项处理任务，“加热明细”入口暂时隐藏。“助手 Excel”进入剧集统计页，点击页面的“下载数据”获取 Excel 文件，保存后按登录账号匹配数据来源并提交版权数据导入。“助手 JSON”捕获 `get-finder-native-drama-statistics-list` 请求及响应，按响应中的 `totalCount` 重新请求全部记录，将完整响应保存为 JSON，并把响应内层的 `{ list, baseResp, totalCount }` 连同格式为 `开始日期 - 结束日期` 的 `statisticTime` 免鉴权提交到 `/api/b/wechat-drama/statistics/ingest`。两个助手任务共用助手日期配置；最近处理记录中的任务名称会区分 Excel 与 JSON，JSON 的“总条数”按 `list 条数 / totalCount` 展示。“标准看板”进入加热平台的“标准数据分析-账户标准看板”，默认读取昨天的数据，自动配置数据明细维度（订单/计划、按天、短剧、加热对象、视频、作者、出价方式、订单类型、创建人）和指标（消耗金额、短剧广告变现金额、短剧广告变现 ROI、播放数），等待 CSV 下载完成后存档，并复用加热明细的 `/api/b/drama-heating/actions/import` 接口完成导入。

标准看板会阻止同一次任务重复处理相同视频号，避免重复下载和后续重复导入。

共享的 Playwright、Zod、环境校验和 persistent profile 管理由 `@drama-sync/platform-automation-core` 提供。每个平台可配置多个账号，账号 ID 使用逗号分隔，例如：

```dotenv
PLATFORM_PINDUODUO_ACCOUNT_IDS=main,secondary
PLATFORM_PINDUODUO_ACCOUNT_MAIN_LABEL=主账号
PLATFORM_PINDUODUO_ACCOUNT_MAIN_PHONE=手机号
PLATFORM_PINDUODUO_ACCOUNT_SECONDARY_LABEL=副账号
PLATFORM_PINDUODUO_ACCOUNT_SECONDARY_PHONE=手机号
```

每个账号的登录状态分别保存在 `<PLATFORM_BROWSER_PROFILE_ROOT>/<平台 ID>/<账号 ID>`。Electron 中相对路径基于应用 `userData` 目录解析，安装升级不会清除登录状态。

美团直接使用手机号作为账号 ID，不需要再配置账号别名和单独的手机号字段：

```dotenv
PLATFORM_MEITUAN_ACCOUNT_IDS=手机号1,手机号2
```

新增美团账号只需把手机号追加到该变量；应用重启后会自动更新账号数量，并为每个手机号创建独立的 persistent profile。

客户端会保存登录接口返回的 `tokenValue`，后续请求自动添加到 `Authorization` 请求头。当接口返回 `401 Unauthorized` 时，会自动重新登录并将原请求重试一次。多个并发请求同时遇到 401 时只会执行一次重新登录。

后续接口统一通过泛型 `request<TResponse, TBody>()` 添加薄封装：

```ts
interface ListItem {
  id: number;
  name: string;
}

const result = await client.request<ListItem[]>("/api/b/example/list", {
  method: "GET",
  query: { page: 1, pageSize: 20 },
});

const created = await client.request<ListItem, { name: string }>("/api/b/example", {
  method: "POST",
  body: { name: "示例" },
});
```

渲染进程通过受限的 preload API 调用：

```ts
const login = await window.desktop.darenCenter.login();
const currentUser = await window.desktop.darenCenter.me();
```

每次响应都包含 HTTP `status`、`statusText` 和后台响应 `body`。非成功状态会抛出 `DarenCenterApiError`，错误对象同样保留这些字段。当前按需求将登录信息作为随包环境资源提供，它不是加密的密钥存储；若安装包会分发给不可信用户，应改为首次启动时输入凭据，并使用系统安全凭据库保存。

## 构建任务

构建流程使用 `vite.config.ts` 中的 Vite+ `run.tasks` 声明，不再在 `package.json` 中维护长串 `&&` 命令。

```text
app-package
├── app-bundle
│   ├── @drama-sync/daren-center-automation#build
│   ├── typecheck
│   └── prepare-icons
└── prepare-automation（禁用缓存，避免缓存凭据）
```

```bash
# 完整 Electron 安装包
pnpm build

# 只构建前端、主进程和 preload
pnpm exec vp run app-bundle

# 查看任务执行和缓存详情
pnpm exec vp run --verbose app-bundle
```

任务会缓存 workspace 包编译、图标、类型检查以及 Vite/Electron bundle。Electron installer 和包含凭据的环境资源始终重新生成。

## GitHub 发版与自动更新

Windows 和 macOS 安装包通过 GitHub Releases 分发。macOS 同时发布 Intel `x64` 与 Apple Silicon `arm64` 两个版本，最低支持 macOS 12 Monterey。应用启动 5 秒后检查更新，此后每 6 小时检查一次；依次尝试 GitHub 官方源、`gh-proxy.com` 和 `gh.3w.pm`，下载失败会自动切换下一个源。可在打包环境中用逗号分隔的 `DRAMA_SYNC_UPDATE_MIRRORS` 覆盖默认源列表。

发版前先修改 `package.json` 的版本号并提交全部改动，然后运行：

```bash
pnpm release
```

仓库的 Actions Secret `PRODUCTION_ENV_BASE64` 需要保存 `.env.production` 的 Base64 内容。工作流只在构建时还原该文件，不会把它提交到 Git；但当前安装包仍然包含运行所需的生产账号配置，因此只能分发给可信用户。

macOS 正式发版还需要在 `Settings > Secrets and variables > Actions` 配置以下 Secret：

- `MAC_CSC_LINK`：Base64 编码的 Developer ID Application `.p12` 证书，或 electron-builder 支持的证书地址
- `MAC_CSC_KEY_PASSWORD`：证书密码
- `APPLE_ID`：Apple Developer 账号
- `APPLE_APP_SPECIFIC_PASSWORD`：Apple ID 专用密码
- `APPLE_TEAM_ID`：Apple Developer Team ID

GitHub Actions 分别在 `macos-15-intel` 和 `macos-15` runner 上构建，使随包 Playwright Chromium 与目标架构一致。上述 5 个 Secret 全部配置时，构建会验证代码签名、Gatekeeper 和公证票据；任一环节失败都不会创建 Release。5 个 Secret 全部未配置时，Actions 会显示警告但仍生成未签名的测试包；只配置一部分时会直接失败。未签名包不应对外正式分发。

更新 Secret 时运行：

```bash
pnpm secret:update
```

脚本会读取根目录的 `.env.production`，转换为 Base64 并复制到剪贴板。将其粘贴到 GitHub 的 `Settings > Secrets and variables > Actions` 中即可。如果已经安装并登录 GitHub CLI，也可以直接上传：

```bash
pnpm secret:update -- -Upload
```

脚本会拒绝在工作区有未提交改动时运行，然后创建并推送 `v<版本号>` 标签。GitHub Actions 会构建 Windows x64、macOS x64 和 macOS arm64 安装包，再统一发布到对应 Release。自动更新依赖 `latest.yml`、合并后的 `latest-mac.yml`、ZIP 和 blockmap 等文件，请勿单独删除。

electron-builder 在构建阶段固定使用 `--publish never`，只负责生成发布文件；Release 的创建和上传统一由工作流最后的 `gh release create` 完成，因此不需要配置个人访问令牌 `GH_TOKEN`。

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react/README.md) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type aware lint rules:

- Configure the top-level `parserOptions` property like this:

```js
export default {
  // other rules...
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    project: ["./tsconfig.json", "./tsconfig.node.json"],
    tsconfigRootDir: __dirname,
  },
};
```

- Replace `plugin:@typescript-eslint/recommended` to `plugin:@typescript-eslint/recommended-type-checked` or `plugin:@typescript-eslint/strict-type-checked`
- Optionally add `plugin:@typescript-eslint/stylistic-type-checked`
- Install [eslint-plugin-react](https://github.com/jsx-eslint/eslint-plugin-react) and add `plugin:react/recommended` & `plugin:react/jsx-runtime` to the `extends` list
