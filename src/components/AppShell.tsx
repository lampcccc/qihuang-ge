import { useState } from "react";
import { Outlet } from "react-router-dom";
import { SidebarContent } from "./Sidebar";
import { Topbar } from "./Topbar";
import { Sheet, SheetContent, SheetTitle } from "./ui/sheet";

export function AppShell() {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-background">
      {/* 桌面端固定侧栏 */}
      <aside className="hidden lg:block w-64 shrink-0 border-r border-border bg-card">
        <div className="sticky top-0 h-screen">
          <SidebarContent />
        </div>
      </aside>

      {/* 移动端抽屉侧栏 */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-64 p-0">
          <SheetTitle className="sr-only">导航菜单</SheetTitle>
          <SidebarContent />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onOpenSidebar={() => setOpen(true)} />
        <main className="flex-1 px-4 py-6 md:px-8 md:py-8">
          <div className="mx-auto w-full max-w-6xl">
            <Outlet />
          </div>
        </main>
        <footer className="border-t border-border px-4 py-6 text-center text-xs text-muted-foreground md:px-8">
          岐黄阁 · 中医知识查询平台 · 数据源自公开中医古籍 / 药材 / 方剂 / 医案资料库 · 仅供学习研究
        </footer>
      </div>
    </div>
  );
}
