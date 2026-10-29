import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export function NotFound() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center text-center">
      <p className="font-serif text-6xl font-bold text-primary">404</p>
      <p className="mt-3 text-muted-foreground">未找到该页面</p>
      <Link to="/" className="mt-5">
        <Button>返回首页</Button>
      </Link>
    </div>
  );
}
