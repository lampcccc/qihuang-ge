import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Menu } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export function Topbar({ onOpenSidebar }: { onOpenSidebar: () => void }) {
  const [q, setQ] = useState("");
  const navigate = useNavigate();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = q.trim();
    if (t) navigate(`/search?q=${encodeURIComponent(t)}`);
  };

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background/85 backdrop-blur px-4 md:px-6">
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={onOpenSidebar} aria-label="菜单">
        <Menu className="h-5 w-5" />
      </Button>

      <form onSubmit={submit} className="relative flex-1 max-w-2xl">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索药名、书名、病症、术语…"
          className="pl-9 pr-20"
        />
        <Button type="submit" size="sm" className="absolute right-1 top-1/2 -translate-y-1/2">
          检索
        </Button>
      </form>

      <div className="hidden md:flex items-center gap-2 text-xs text-muted-foreground">
        <span className="rounded-full bg-tcm-jade/10 px-2.5 py-1 text-tcm-jade">经络</span>
        <span className="rounded-full bg-tcm-gold/15 px-2.5 py-1 text-tcm-gold">本草</span>
        <span className="rounded-full bg-tcm-cinnabar/10 px-2.5 py-1 text-tcm-cinnabar">方剂</span>
      </div>
    </header>
  );
}
