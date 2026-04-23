import { AlertTriangle } from "lucide-react";

export function Disclaimer() {
  return (
    <div className="border border-warning/40 bg-warning/10 text-foreground rounded-lg p-3 text-xs leading-relaxed flex gap-3">
      <AlertTriangle className="h-5 w-5 text-warning shrink-0 mt-0.5" />
      <div>
        <strong className="text-warning">CRITICAL WARNING — Educational tool only.</strong>{" "}
        Chart patterns have approximately 55–65% accuracy in ideal conditions, meaning 35–45% of
        signals WILL BE LOSERS. No system can guarantee profits, prevent losses, or predict
        sudden moves from news. Paper trading results do not predict real-money results. The
        builder accepts zero liability for any financial losses incurred through use of this
        system.
      </div>
    </div>
  );
}
