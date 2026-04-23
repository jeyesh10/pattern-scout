CREATE TABLE public.signals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  pattern TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('buy','sell')),
  confidence NUMERIC NOT NULL,
  entry NUMERIC NOT NULL,
  stop_loss NUMERIC NOT NULL,
  tp1 NUMERIC NOT NULL,
  tp2 NUMERIC NOT NULL,
  risk_reward NUMERIC NOT NULL,
  reasoning TEXT NOT NULL,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  pattern_start_ts BIGINT,
  pattern_end_ts BIGINT,
  pattern_meta JSONB
);

CREATE INDEX idx_signals_symbol_tf ON public.signals(symbol, timeframe, detected_at DESC);
CREATE INDEX idx_signals_pattern ON public.signals(pattern);

ALTER TABLE public.signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view signals" ON public.signals FOR SELECT USING (true);
CREATE POLICY "Anyone can insert signals" ON public.signals FOR INSERT WITH CHECK (true);

CREATE TABLE public.paper_trades (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  signal_id UUID REFERENCES public.signals(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  pattern TEXT NOT NULL,
  side TEXT NOT NULL,
  confidence NUMERIC NOT NULL,
  entry NUMERIC NOT NULL,
  stop_loss NUMERIC NOT NULL,
  tp1 NUMERIC NOT NULL,
  tp2 NUMERIC NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','tp1','tp2','stop','closed')),
  exit_price NUMERIC,
  pnl_pct NUMERIC,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ
);

CREATE INDEX idx_paper_trades_status ON public.paper_trades(status);
CREATE INDEX idx_paper_trades_symbol ON public.paper_trades(symbol);

ALTER TABLE public.paper_trades ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view paper trades" ON public.paper_trades FOR SELECT USING (true);
CREATE POLICY "Anyone can insert paper trades" ON public.paper_trades FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update paper trades" ON public.paper_trades FOR UPDATE USING (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.signals;
ALTER PUBLICATION supabase_realtime ADD TABLE public.paper_trades;