import { Fragment } from "react";
import { NavLink } from "react-router-dom";
import {
  Home, BookOpen, Library, GraduationCap, Award, BookMarked, FileText, Layers, Leaf, Sprout, Soup,
} from "lucide-react";
import { Logo } from "./Logo";
import { cn } from "@/lib/utils";

interface NavItem {
  to: string;
  label: string;
  icon: typeof Home;
  end?: boolean;
  children?: NavItem[];
}

const navGroups: { label: string; items: NavItem[] }[] = [
  {
    label: "核心模块",
    items: [
      { to: "/", label: "首页", icon: Home, end: true },
      {
        to: "/herbs",
        label: "中药材",
        icon: Sprout,
        // 汤方是中药材下的子模块，故作为子项挂在中药材之后
        children: [{ to: "/prescriptions", label: "汤方", icon: Soup }],
      },
      { to: "/dictionary", label: "中医术语词典", icon: BookOpen },
      { to: "/works", label: "中医著作", icon: Library },
      { to: "/textbooks", label: "中医教材", icon: GraduationCap },
      { to: "/exam", label: "备考资源", icon: Award },
      { to: "/manual", label: "使用手册", icon: BookMarked },
    ],
  },
  {
    label: "资料库",
    items: [
      { to: "/yian", label: "医案心得", icon: FileText },
      { to: "/zaji", label: "杂集", icon: Layers },
    ],
  },
];

export function SidebarContent() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-5 py-5 border-b border-border">
        <Logo />
        <div className="leading-tight">
          <div className="font-serif text-lg font-bold text-foreground">岐黄阁</div>
          <div className="text-[11px] text-muted-foreground tracking-widest">中医知识查询平台</div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {navGroups.map((g) => (
          <div key={g.label}>
            <div className="px-3 mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
              {g.label}
            </div>
            <div className="space-y-1">
              {g.items.map((it) => (
                <Fragment key={it.to}>
                  {/* 主菜单项：保持独立 wrapper，不再内嵌子菜单 */}
                  <div>
                    <NavLink
                      to={it.to}
                      end={it.end}
                      className={({ isActive }) => cn("nav-link", isActive && "nav-link-active")}
                    >
                      <it.icon className="h-4 w-4 shrink-0" />
                      <span>{it.label}</span>
                    </NavLink>
                  </div>
                  {/* 子模块（如中药材下的汤方）：渲染为顶级平铺项，与备考资源同级、
                      无缩进无竖线；每个子项单独用 <div> 包裹 <a>，写法与其它主菜单项一致 */}
                  {it.children && it.children.map((c) => (
                    <div key={c.to}>
                      <NavLink
                        to={c.to}
                        end={c.end}
                        className={({ isActive }) => cn("nav-link", isActive && "nav-link-active")}
                      >
                        <c.icon className="h-4 w-4 shrink-0" />
                        <span>{c.label}</span>
                      </NavLink>
                    </div>
                  ))}
                </Fragment>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-border px-5 py-3 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <Leaf className="h-3.5 w-3.5 text-tcm-jade" />
          数据源自中医古籍 / 药材 / 方剂库
        </div>
        <div className="mt-1">仅供学习研究 · 临床请遵医嘱</div>
      </div>
    </div>
  );
}
