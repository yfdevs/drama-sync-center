import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type PlatformStatus = "normal" | "needs-login";
type ImportStatus = "success" | "partial" | "failed";

type Platform = {
  id: string;
  name: string;
  logo?: string;
  accountCount: number;
  status: PlatformStatus;
};

type ImportRecord = {
  taskName: string;
  platform: string;
  platformLogo?: string;
  account: string;
  drama: string;
  total: number;
  success: number;
  failed: number;
  status: ImportStatus;
  startedAt: string;
  endedAt: string;
  duration: string;
};

const platforms: Platform[] = [
  { id: "wx", name: "视频号", logo: "/platform/wx.svg", accountCount: 3, status: "normal" },
  {
    id: "kuaishou",
    name: "快手",
    logo: "/platform/kuaishou.svg",
    accountCount: 4,
    status: "normal",
  },
  { id: "pdd", name: "拼多多", logo: "/platform/pdd.svg", accountCount: 2, status: "needs-login" },
  { id: "meituan", name: "美团", logo: "/platform/meituan.svg", accountCount: 2, status: "normal" },
  { id: "tencent", name: "腾讯视频", accountCount: 3, status: "normal" },
  { id: "qq", name: "QQ漫剧", logo: "/platform/qq.svg", accountCount: 2, status: "normal" },
  { id: "tiktok", name: "TikTok", logo: "/platform/tiktok.svg", accountCount: 2, status: "normal" },
];

const importRecords: ImportRecord[] = [
  {
    taskName: "视频号每日同步任务",
    platform: "视频号",
    platformLogo: "/platform/wx.svg",
    account: "视频号_主账号",
    drama: "都市逆袭之我为王者",
    total: 120,
    success: 120,
    failed: 0,
    status: "success",
    startedAt: "2025-05-20 10:20:15",
    endedAt: "2025-05-20 10:23:45",
    duration: "00:03:30",
  },
  {
    taskName: "快手热门剧集同步",
    platform: "快手",
    platformLogo: "/platform/kuaishou.svg",
    account: "快手_主账号",
    drama: "重生之绝世医仙",
    total: 98,
    success: 95,
    failed: 3,
    status: "partial",
    startedAt: "2025-05-20 10:15:02",
    endedAt: "2025-05-20 10:18:36",
    duration: "00:03:34",
  },
  {
    taskName: "拼多多素材同步",
    platform: "拼多多",
    platformLogo: "/platform/pdd.svg",
    account: "拼多多_主账号",
    drama: "闪婚老公是豪门",
    total: 76,
    success: 0,
    failed: 76,
    status: "failed",
    startedAt: "2025-05-20 10:05:11",
    endedAt: "2025-05-20 10:07:28",
    duration: "00:02:17",
  },
  {
    taskName: "腾讯视频同步任务",
    platform: "腾讯视频",
    account: "腾讯视频_主账号",
    drama: "长夜将明",
    total: 152,
    success: 152,
    failed: 0,
    status: "success",
    startedAt: "2025-05-20 09:55:30",
    endedAt: "2025-05-20 09:59:02",
    duration: "00:03:32",
  },
  {
    taskName: "TikTok每日同步",
    platform: "TikTok",
    platformLogo: "/platform/tiktok.svg",
    account: "TikTok_主账号",
    drama: "她的小梨涡",
    total: 64,
    success: 62,
    failed: 2,
    status: "partial",
    startedAt: "2025-05-20 09:45:18",
    endedAt: "2025-05-20 09:47:40",
    duration: "00:02:22",
  },
];

function App() {
  return (
    <main className="min-h-screen overflow-x-hidden bg-[#eef2f7] text-slate-900">
      <div className="flex min-h-screen flex-col border-x border-slate-300/70 bg-[#f6f8fb]">
        <section className="grid grid-cols-[repeat(auto-fit,minmax(176px,1fr))] gap-2.5 border-b border-slate-200 bg-[#f3f6fa] px-3 py-3 lg:grid-cols-7">
          {platforms.map((platform) => (
            <PlatformCard key={platform.id} platform={platform} />
          ))}
        </section>

        <section className="px-3 py-3">
          <div className="flex h-9 items-center justify-between px-1">
            <h2 className="text-[15px] font-semibold text-slate-950">最近导入记录</h2>
            <span className="text-xs text-slate-500">共 5 条任务</span>
          </div>
          <ImportTable records={importRecords} />
        </section>

        <Footer />
      </div>
    </main>
  );
}

function PlatformCard({ platform }: { platform: Platform }) {
  const needsLogin = platform.status === "needs-login";

  return (
    <article className="min-w-0 rounded-lg border border-slate-300/80 bg-white overflow-hidden shadow-[0_1px_1px_rgba(15,23,42,0.025)]">
      <div className="flex min-h-[72px] items-start gap-3 px-3 py-3">
        <PlatformLogo platform={platform} />
        <div className="min-w-0 flex-1 pt-0.5">
          <div className="truncate text-[15px] font-semibold text-slate-950">{platform.name}</div>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-sm text-slate-500">
            <span>{platform.accountCount} 个账号</span>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 whitespace-nowrap",
                needsLogin ? "text-amber-600" : "text-slate-500",
              )}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  needsLogin ? "bg-amber-500" : "bg-emerald-600",
                )}
              />
              {needsLogin ? "需验证" : "正常"}
            </span>
          </div>
        </div>
      </div>
      <div className="flex justify-end border-t border-slate-100 bg-slate-50/70 px-2.5 py-2">
        <Button
          variant="outline"
          size="xs"
          className={cn(
            "h-7 rounded-md bg-white px-2.5 text-xs font-medium shadow-none",
            needsLogin
              ? "border-amber-300 text-amber-700 hover:bg-amber-50"
              : "border-blue-200 text-blue-700 hover:border-blue-300 hover:bg-blue-50",
          )}
        >
          {needsLogin ? "修复登录" : "开始同步"}
        </Button>
      </div>
    </article>
  );
}

function PlatformLogo({ platform }: { platform: Platform }) {
  if (platform.logo) {
    return <img src={platform.logo} alt="" className="size-9 shrink-0 rounded-md object-contain" />;
  }

  return (
    <span className="relative flex size-9 shrink-0 items-center justify-center rounded-md bg-white">
      <span className="absolute inset-1 rounded-[10px] bg-gradient-to-br from-emerald-400 via-cyan-400 to-blue-500" />
      <span className="relative ml-0.5 h-0 w-0 border-y-[10px] border-l-[15px] border-y-transparent border-l-white" />
    </span>
  );
}

function ImportTable({ records }: { records: ImportRecord[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-300/80 bg-white">
      <table className="min-w-[680px] table-fixed border-collapse text-left text-[13px] lg:w-full">
        <thead className="bg-[#f1f4f8] text-slate-600">
          <tr className="h-9 border-b border-slate-300/80">
            <TableHead className="w-[18%]">来源平台</TableHead>
            <TableHead className="w-[23%]">账号</TableHead>
            <TableHead className="w-[12%] text-center">总条数</TableHead>
            <TableHead className="w-[11%] text-center">成功</TableHead>
            <TableHead className="w-[11%] text-center">失败</TableHead>
            <TableHead className="w-[14%]">状态</TableHead>
            <TableHead className="w-[21%]">开始时间</TableHead>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr
              key={`${record.taskName}-${record.startedAt}`}
              className="h-11 border-b border-slate-100 last:border-b-0 hover:bg-blue-50/40"
            >
              <TableCell>
                <span className="flex items-center gap-2">
                  <SmallPlatformLogo logo={record.platformLogo} name={record.platform} />
                  {record.platform}
                </span>
              </TableCell>
              <TableCell>{record.account}</TableCell>
              <TableCell className="text-center tabular-nums">{record.total}</TableCell>
              <TableCell className="text-center font-medium text-emerald-600 tabular-nums">
                {record.success}
              </TableCell>
              <TableCell className="text-center font-medium text-red-600 tabular-nums">
                {record.failed}
              </TableCell>
              <TableCell>
                <StatusBadge status={record.status} />
              </TableCell>
              <TableCell className="tabular-nums">{record.startedAt}</TableCell>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TableHead({ className, children }: { className?: string; children: React.ReactNode }) {
  return <th className={cn("px-2.5 font-medium", className)}>{children}</th>;
}

function TableCell({ className, children }: { className?: string; children: React.ReactNode }) {
  return <td className={cn("truncate px-2.5 text-slate-600", className)}>{children}</td>;
}

function SmallPlatformLogo({ logo, name }: { logo?: string; name: string }) {
  if (logo) {
    return <img src={logo} alt="" className="size-5 shrink-0 object-contain" />;
  }

  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded bg-gradient-to-br from-emerald-400 via-cyan-400 to-blue-500">
      <span className="ml-0.5 h-0 w-0 border-y-[5px] border-l-[8px] border-y-transparent border-l-white" />
      <span className="sr-only">{name}</span>
    </span>
  );
}

function StatusBadge({ status }: { status: ImportStatus }) {
  const statusMap = {
    success: { label: "成功", dot: "bg-emerald-600" },
    partial: { label: "部分失败", dot: "bg-amber-500" },
    failed: { label: "失败", dot: "bg-red-600" },
  } satisfies Record<ImportStatus, { label: string; dot: string }>;

  const item = statusMap[status];

  return (
    <span className="inline-flex items-center gap-2 text-slate-700">
      <span className={cn("size-2 rounded-full", item.dot)} />
      {item.label}
    </span>
  );
}

function Footer() {
  return (
    <footer className="mt-auto flex min-h-9 flex-wrap items-center justify-between gap-x-8 gap-y-2 border-t border-slate-300/80 bg-[#f8fafc] px-3 py-2 text-xs text-slate-500">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
        <span className="inline-flex items-center gap-2 text-slate-700">
          <span className="size-2 rounded-full bg-emerald-600" />
          服务运行中
        </span>
        <span>版本：v1.2.0</span>
      </div>
      <span>数据更新时间：2025-05-20 10:23:50</span>
    </footer>
  );
}

export default App;
