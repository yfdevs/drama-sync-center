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
