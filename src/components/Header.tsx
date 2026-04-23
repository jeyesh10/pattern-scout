import { Link } from "@tanstack/react-router";
import { Activity, BarChart3 } from "lucide-react";

export function Header() {
  return (
    <header className="border-b border-border bg-card/50 backdrop-blur sticky top-0 z-30">
      <div className="max-w-[1600px] mx-auto px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          <span className="font-semibold tracking-tight">PatternScope</span>
          <span className="text-xs text-muted-foreground hidden sm:inline">
            Crypto chart pattern recognition · educational
          </span>
        </div>
        <nav className="flex items-center gap-1 text-sm">
          <Link
            to="/"
            className="px-3 py-1.5 rounded-md hover:bg-accent transition-colors"
            activeOptions={{ exact: true }}
            activeProps={{ className: "px-3 py-1.5 rounded-md bg-accent text-accent-foreground" }}
          >
            Dashboard
          </Link>
          <Link
            to="/analytics"
            className="px-3 py-1.5 rounded-md hover:bg-accent transition-colors flex items-center gap-1.5"
            activeProps={{
              className:
                "px-3 py-1.5 rounded-md bg-accent text-accent-foreground flex items-center gap-1.5",
            }}
          >
            <BarChart3 className="h-4 w-4" />
            Analytics
          </Link>
        </nav>
      </div>
    </header>
  );
}
