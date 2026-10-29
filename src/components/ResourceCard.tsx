import { Link } from "react-router-dom";
import { Card, CardContent } from "./ui/card";
import { Badge } from "./ui/badge";
import { cn } from "@/lib/utils";
import type { ListItem } from "@/lib/types";

const MODULE_LABEL: Record<string, string> = {
  dictionary: "药材",
  works: "著作",
  yian: "医案",
  zaji: "杂集",
};

export function ResourceCard({
  item,
  module,
  className,
}: {
  item: ListItem;
  module: string;
  className?: string;
}) {
  // 著作列表以“书名”聚合，卡片应跳转到该书目录而非章节
  const to = module === "works" ? `/works/book/${item.id}` : `/${module}/${item.id}`;
  const badge = module === "works" ? "书名" : MODULE_LABEL[module] ?? module;

  return (
    <Link to={to} className={cn("group block", className)}>
      <Card className="h-full transition-all hover:border-primary/40 hover:shadow-md">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-serif text-base font-semibold leading-snug text-foreground group-hover:text-primary">
              {item.title}
            </h3>
            <Badge variant="outline" className="shrink-0">
              {badge}
            </Badge>
          </div>
          {item.subtitle && (
            <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{item.subtitle}</p>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
