import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TrendingUp, TrendingDown, Clock } from "lucide-react";
import { PATTERN_LABEL, type PatternKind } from "@/lib/patterns";

export interface SignalRow {
  id: string;
  symbol: string;
  timeframe: string;
  pattern: string;
  side: "buy" | "sell";
  confidence: number;
  entry: number;
  tp1: number;
  detected_at: string;
}

interface Props {
  signals: SignalRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function SignalsPanel({ signals, selectedId, onSelect }: Props) {
  return (
    <Card className="bg-card border-border h-full flex flex-col">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-tight">Active Signals</h2>
        <Badge variant="outline" className="text-xs">
          {signals.length}
        </Badge>
      </div>
      <ScrollArea className="flex-1">
        {signals.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            <Clock className="h-5 w-5 mx-auto mb-2 opacity-50" />
            Watching the market for confirmed patterns…
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {signals.map((s) => {
              const isBull = s.side === "buy";
              const targetPct = ((s.tp1 - s.entry) / s.entry) * 100;
              return (
                <li key={s.id}>
                  <button
                    onClick={() => onSelect(s.id)}
                    className={`w-full text-left px-4 py-3 transition-colors ${
                      selectedId === s.id ? "bg-accent" : "hover:bg-accent/50"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        {isBull ? (
                          <TrendingUp className="h-3.5 w-3.5 text-bull" />
                        ) : (
                          <TrendingDown className="h-3.5 w-3.5 text-bear" />
                        )}
                        <span className="font-medium text-sm">{s.symbol}</span>
                        <span className="text-xs text-muted-foreground">{s.timeframe}</span>
                      </div>
                      <Badge
                        variant="outline"
                        className={`text-[10px] ${
                          isBull
                            ? "border-bull/40 text-bull"
                            : "border-bear/40 text-bear"
                        }`}
                      >
                        {isBull ? "BUY" : "SELL"}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mb-1">
                      {PATTERN_LABEL[s.pattern as PatternKind] ?? s.pattern}
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">
                        Conf: <span className="text-foreground">{s.confidence.toFixed(0)}%</span>
                      </span>
                      <span className={isBull ? "text-bull" : "text-bear"}>
                        TP1: {targetPct >= 0 ? "+" : ""}
                        {targetPct.toFixed(2)}%
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </ScrollArea>
    </Card>
  );
}
