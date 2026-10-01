import type { Candle, MarketQuote, ModelView } from "./types";

export const MODEL_VERSION = "spot-close-v3-baseline";
export type ForecastTarget = "coinbase_window_close" | "kalshi_official_settlement";

/** Only closed, valid, unique one-minute observations may enter a forecast. */
export function completedCandles(candles: Candle[], now = Date.now()) {
  const rows = new Map<number, Candle>();
  for (const c of candles) {
    if (c.t % 60 !== 0 || c.t + 60 > now / 1000) continue;
    if (![c.t, c.o, c.h, c.l, c.c].every(Number.isFinite) || Math.min(c.o, c.h, c.l, c.c) <= 0) continue;
    if (c.h < Math.max(c.o, c.c) || c.l > Math.min(c.o, c.c)) continue;
    rows.set(c.t, c);
  }
  return [...rows.values()].sort((a, b) => a.t - b.t);
}

function continuous(rows: Candle[], count: number) {
  return rows.length === count && rows.every((c, i) => i === 0 || c.t - rows[i - 1]!.t === 60);
}

export function realizedSigma(candles: Candle[]) {
  const rows = candles.slice(-61);
  if (!continuous(rows, 61)) return null;
  const returns = rows.slice(1).map((c, i) => Math.log(c.c / rows[i]!.c));
  const variance = (values: number[]) => {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1);
  };
  // Use one transparent trailing horizon. The prior 75/25 blend added a tuned
  // parameter without a held-out test showing it improved forecasts.
  const perMin = Math.sqrt(variance(returns));
  if (!Number.isFinite(perMin) || perMin < 1e-8) return null;
  return { perMin, sigma15: perMin * Math.sqrt(15) };
}

export function momentum5(candles: Candle[]) {
  const rows = candles.slice(-6);
  if (!continuous(rows, 6)) return null;
  return Math.log(rows[5]!.c / rows[0]!.c);
}

type WindowRow = { open: number; close: number; start: number };
export function fifteenMinuteWindows(candles: Candle[], excludeStart?: number, now = Date.now()): WindowRow[] {
  const buckets = new Map<number, Candle[]>();
  for (const c of completedCandles(candles, now)) {
    const start = Math.floor(c.t / 900) * 900;
    const list = buckets.get(start) ?? [];
    list.push(c);
    buckets.set(start, list);
  }
  return [...buckets].filter(([start, rows]) => start !== excludeStart && continuous(rows, 15))
    .map(([start, rows]) => ({ start, open: rows[0]!.o, close: rows[14]!.c }))
    .sort((a, b) => b.start - a.start);
}

// Standard normal CDF. A transparent diffusion baseline, not a calibrated probability.
export function normalCdf(z: number) {
  if (z === 0) return 0.5;
  const x = Math.abs(z);
  const t = 1 / (1 + 0.2316419 * x);
  const tail = Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI) * t *
    (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - tail : tail;
}

export function buildModel(input: {
  candles: Candle[];
  spot: number | null;
  market: MarketQuote | null;
  now: number;
  targetType?: ForecastTarget;
  spotAt?: number | null;
}): ModelView {
  const { spot, market, now } = input;
  const targetType = input.targetType ?? "coinbase_window_close";
  const candles = completedCandles(input.candles, now);
  const sigma = realizedSigma(candles);
  const mom = momentum5(candles);
  const strike = market?.strike;
  const tauMin = market ? (market.closeTime - now) / 60_000 : 0;
  const inSettle = tauMin > 0 && tauMin <= 1;
  const regime: ModelView["regime"] = inSettle ? "settlement-minute" :
    mom != null && sigma && Math.abs(mom) > sigma.sigma15 * 0.35 ? "trend" : "chop";
  const volLabel = !sigma ? "unknown vol" : sigma.sigma15 > 0.004 ? "elevated vol" : sigma.sigma15 < 0.0012 ? "quiet vol" : "normal vol";
  const base: ModelView = {
    paused: true, reason: null, pUp: null,
    volLabel, regime, momentum: mom,
    sigmaDollar: sigma && spot ? spot * sigma.sigma15 : null, sigmaToStrike: null,
  };
  const age = input.spotAt == null ? null : now - input.spotAt;
  const reason = !Number.isFinite(now) ? "Invalid clock" :
    !market ? "No target: waiting for this window" :
    strike == null || !Number.isFinite(strike) || strike <= 0 ? "No strike / target" :
    spot == null || !Number.isFinite(spot) || spot <= 0 ? "No valid spot price" :
    age == null || age > 10_000 || age < -2_000 ? "Spot timestamp missing or stale (over 10 seconds)" :
    !Number.isFinite(tauMin) || tauMin <= 0 || now < market.openTime ? "Market is outside its active window" :
    !["open", "active"].includes(market.status) ? "Market is not open" :
    !sigma ? "Need 61 consecutive completed candles for 60 one-minute returns" :
    now / 1000 - (candles[candles.length - 1]!.t + 60) > 90 ? "Candle history is stale" :
    targetType === "kalshi_official_settlement" ? "Official BRTI settlement observations are unavailable; Coinbase spot is not a substitute" : null;
  if (reason || !sigma || !market || spot == null || strike == null) return { ...base, reason };

  const sigmaToStrike = Math.log(spot / strike) / (sigma.perMin * Math.sqrt(tauMin));
  // Zero-drift log-price diffusion is the deliberately simple v3 baseline.
  // Momentum, candle names, order flow, Kalshi prices and analog matches are
  // excluded until they demonstrate incremental value on chronological data.
  const p = normalCdf(sigmaToStrike);
  return { ...base, paused: false, pUp: p, sigmaToStrike,
    reason: "Uncalibrated Coinbase spot-close baseline; no Kalshi settlement or trade edge is inferred" };
}
