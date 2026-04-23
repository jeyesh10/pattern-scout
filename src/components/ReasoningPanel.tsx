import { Card } from "@/components/ui/card";
import { Brain } from "lucide-react";

export function ReasoningPanel({ reasoning }: { reasoning: string | null }) {
  return (
    <Card className="bg-card border-border">
      <div className="px-4 py-3 border-b border-border flex items-center gap-2">
        <Brain className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold tracking-tight">Latest Reasoning Trace</h2>
      </div>
      <div className="p-4">
        {reasoning ? (
          <pre className="font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-foreground">
            {reasoning}
          </pre>
        ) : (
          <p className="text-sm text-muted-foreground">
            Select a signal to view the full reasoning trace, or wait for one to be generated.
          </p>
        )}
      </div>
    </Card>
  );
}
