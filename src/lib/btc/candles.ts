import { aggregate, ema, readTech } from "./ta";
import type { Candle } from "./types";

export type CandleDirection = "bullish" | "bearish" | "neutral";
export type CandleStatus = "confirmed" | "forming";

export type CandleFeature = {
  timestamp: number;
  timeframe: "1m" | "5m" | "15m";
  pattern: string;
  direction: CandleDirection;
  status: CandleStatus;
  bodyRatio: number;
  upperWickRatio: number;
  lowerWickRatio: number;
  relativeVolume: number | null;
  trendContext: string;
  vwapContext: string;
  emaContext: string;
  structureContext: string;
};

export type TimeframeRead = {
  label: "1 MINUTE" | "5 MINUTE" | "15 MINUTE";
  mark: "BULLISH" | "MIXED" | "BEARISH" | "QUIET";
  name: string;
  status: "CONFIRMED" | "FORMING" | "NONE";
  strength: "STRONG" | "MODERATE" | "WEAK" | "NONE";
  detail: string;
  meaning: string;
};

export type CandleSignal = {
  direction: CandleDirection;
  strength: "none" | "weak" | "moderate" | "strong";
  timeframeAgreement: "aligned" | "mixed";
  confirmedPatterns: string[];
  formingPatterns: string[];
  volumeConfirmed: boolean;
  trendConfirmed: boolean;
  structureConfirmed: boolean;
  overall: string;
  reads: TimeframeRead[];
  supportsUp: string[];
  supportsDown: string[];
  features: CandleFeature[];
};

const NONE: CandleSignal = {
  direction: "neutral",
  strength: "none",
  timeframeAgreement: "mixed",
  confirmedPatterns: [],
  formingPatterns: [],
  volumeConfirmed: false,
  trendConfirmed: false,
  structureConfirmed: false,
  overall: "MIXED",
  reads: [],
  supportsUp: [],
  supportsDown: [],
  features: [],
};

function parts(c: Candle) {
  const range = Math.max(0, c.h - c.l);
  const body = Math.abs(c.c - c.o);
  const upper = Math.max(0, c.h - Math.max(c.o, c.c));
  const lower = Math.max(0, Math.min(c.o, c.c) - c.l);
  return {
    range,
    body,
    upper,
    lower,
    bull: c.c >= c.o,
    bodyRatio: range > 0 ? body / range : 0,
    upperRatio: range > 0 ? upper / range : 0,
    lowerRatio: range > 0 ? lower / range : 0,
  };
}

type Hit = { name: string; direction: CandleDirection; detail: string; meaning: string };

function named(rows: Candle[]): Hit | null {
  const c = rows.at(-1);
  const p = rows.at(-2);
  const a = rows.at(-3);
  if (!c) return null;
  const cp = parts(c);
  if (cp.range <= 0) return null;
  if (a && p) {
    const ap = parts(a);
    const pp = parts(p);
    if ([a, p, c].every((row) => row.c > row.o) && p.c > a.c && c.c > p.c && pp.bodyRatio >= 0.45 && cp.bodyRatio >= 0.45 && ap.bodyRatio >= 0.45) {
      return { name: "Three white soldiers", direction: "bullish", detail: "Three closed candles in a row finished higher, each one above the last.", meaning: "Buyers kept control for three candles, not just one jump." };
    }
    if ([a, p, c].every((row) => row.c < row.o) && p.c < a.c && c.c < p.c && pp.bodyRatio >= 0.45 && cp.bodyRatio >= 0.45 && ap.bodyRatio >= 0.45) {
      return { name: "Three black crows", direction: "bearish", detail: "Three closed candles in a row finished lower, each one under the last.", meaning: "Sellers kept control for three candles, not just one drop." };
    }
    if (!ap.bull && ap.bodyRatio >= 0.55 && pp.bodyRatio <= 0.35 && cp.bull && cp.bodyRatio >= 0.5 && c.c > (a.o + a.c) / 2) {
      return { name: "Morning star", direction: "bullish", detail: "A drop, a small pause, then a bounce that got back through the middle of the drop.", meaning: "The selloff stalled and buyers took back the middle of that move." };
    }
    if (ap.bull && ap.bodyRatio >= 0.55 && pp.bodyRatio <= 0.35 && !cp.bull && cp.bodyRatio >= 0.5 && c.c < (a.o + a.c) / 2) {
      return { name: "Evening star", direction: "bearish", detail: "A rise, a small pause, then a drop back through the middle of the rise.", meaning: "The rally stalled and sellers took back the middle of that move." };
    }
  }
  if (p) {
    const pp = parts(p);
    if (!pp.bull && cp.bull && c.o <= p.c && c.c >= p.o && cp.body > pp.body) {
      return { name: "Bullish engulfing", direction: "bullish", detail: "Buyers closed above the whole previous red candle.", meaning: "Short-term buying pressure is increasing." };
    }
    if (pp.bull && !cp.bull && c.o >= p.c && c.c <= p.o && cp.body > pp.body) {
      return { name: "Bearish engulfing", direction: "bearish", detail: "Sellers closed below the whole previous green candle.", meaning: "Short-term selling pressure is increasing." };
    }
    if (!pp.bull && cp.bull && c.o < p.l && c.c > (p.o + p.c) / 2 && c.c < p.o) {
      return { name: "Piercing line", direction: "bullish", detail: "Price opened below the last red candle and closed back through its middle.", meaning: "Buyers recovered more than half of the previous drop." };
    }
    if (pp.bull && !cp.bull && c.o > p.h && c.c < (p.o + p.c) / 2 && c.c > p.o) {
      return { name: "Dark cloud cover", direction: "bearish", detail: "Price opened above the last green candle and closed back through its middle.", meaning: "Sellers took back more than half of the previous rise." };
    }
    if (!pp.bull && cp.bull && pp.bodyRatio >= 0.55 && cp.body < pp.body * 0.6 && c.o >= p.c && c.c <= p.o) {
      return { name: "Bullish harami", direction: "bullish", detail: "A small green candle sat inside the previous red candle.", meaning: "The drop slowed. Buyers have not taken control yet." };
    }
    if (pp.bull && !cp.bull && pp.bodyRatio >= 0.55 && cp.body < pp.body * 0.6 && c.o <= p.c && c.c >= p.o) {
      return { name: "Bearish harami", direction: "bearish", detail: "A small red candle sat inside the previous green candle.", meaning: "The rise slowed. Sellers have not taken control yet." };
    }
    if (!pp.bull && cp.bull && Math.abs(c.l - p.l) <= Math.max(cp.range, pp.range) * 0.08) {
      return { name: "Tweezer bottom", direction: "bullish", detail: "Two candles stopped at almost the same low, and the second closed up.", meaning: "Sellers failed twice at the same price." };
    }
    if (pp.bull && !cp.bull && Math.abs(c.h - p.h) <= Math.max(cp.range, pp.range) * 0.08) {
      return { name: "Tweezer top", direction: "bearish", detail: "Two candles stopped at almost the same high, and the second closed down.", meaning: "Buyers failed twice at the same price." };
    }
    if (c.h >= p.h && c.l <= p.l && cp.bull && cp.body > pp.body) {
      return { name: "Bullish outside bar", direction: "bullish", detail: "This candle stretched past both sides of the last one and closed up.", meaning: "The range expanded upward." };
    }
    if (c.h >= p.h && c.l <= p.l && !cp.bull && cp.body > pp.body) {
      return { name: "Bearish outside bar", direction: "bearish", detail: "This candle stretched past both sides of the last one and closed down.", meaning: "The range expanded downward." };
    }
    if (c.h <= p.h && c.l >= p.l) {
      return { name: "Inside bar", direction: "neutral", detail: "This candle stayed inside the previous candle’s high and low.", meaning: "Price is pausing. Direction is not decided." };
    }
  }
  if (cp.bodyRatio >= 0.9 && cp.bull) {
    return { name: "Bullish marubozu", direction: "bullish", detail: "The candle barely has wicks. It opened low and closed at the high.", meaning: "Buyers were in control from start to finish." };
  }
  if (cp.bodyRatio >= 0.9 && !cp.bull) {
    return { name: "Bearish marubozu", direction: "bearish", detail: "The candle barely has wicks. It opened high and closed at the low.", meaning: "Sellers were in control from start to finish." };
  }
  if (cp.bodyRatio <= 0.12 && cp.lowerRatio >= 0.7) {
    return { name: "Dragonfly doji", direction: "bullish", detail: "The open and close are together at the top, with a long lower wick.", meaning: "The drop was bought back. It still needs a later green candle." };
  }
  if (cp.bodyRatio <= 0.12 && cp.upperRatio >= 0.7) {
    return { name: "Gravestone doji", direction: "bearish", detail: "The open and close are together at the bottom, with a long upper wick.", meaning: "The rally was sold back. It still needs a later red candle." };
  }
  if (cp.lower >= cp.body * 2 && cp.upper <= Math.max(cp.body, cp.range * 0.15) && cp.lowerRatio >= 0.55) {
    return { name: "Hammer", direction: "bullish", detail: "Sellers pushed the price down, then buyers closed it back near the top.", meaning: "Buyers are defending lower prices. A reversal is not confirmed by this candle alone." };
  }
  if (cp.upper >= cp.body * 2 && cp.lower <= Math.max(cp.body, cp.range * 0.15) && cp.upperRatio >= 0.55) {
    return { name: "Shooting star", direction: "bearish", detail: "Buyers pushed the price up, then sellers closed it back near the bottom.", meaning: "Sellers are defending higher prices. A reversal is not confirmed by this candle alone." };
  }
  if (cp.lowerRatio >= 0.6 && c.c >= c.l + cp.range * 0.65) {
    return { name: "Lower-wick rejection", direction: "bullish", detail: "Price was pushed down and then bought back before the close.", meaning: "Buyers are defending lower prices, but one wick is not a full reversal." };
  }
  if (cp.upperRatio >= 0.6 && c.c <= c.h - cp.range * 0.65) {
    return { name: "Upper-wick rejection", direction: "bearish", detail: "Price was pushed up and then sold back before the close.", meaning: "Sellers are defending higher prices, but one wick is not a full reversal." };
  }
  if (cp.bodyRatio <= 0.1) {
    return { name: "Doji", direction: "neutral", detail: "The open and close are almost the same.", meaning: "Buyers and sellers finished in a tie." };
  }
  if (cp.bodyRatio <= 0.3 && cp.upper > cp.body && cp.lower > cp.body) {
    return { name: "Spinning top", direction: "neutral", detail: "A small body with wicks on both sides.", meaning: "The candle shows indecision." };
  }
  return null;
}

function character(rows: Candle[]): Hit | null {
  const c = rows.at(-1);
  if (!c) return null;
  const cp = parts(c);
  if (cp.range <= 0) return null;
  const ranges = rows.slice(-11, -1).map((row) => parts(row).range).filter((n) => n > 0);
  const avg = ranges.length ? ranges.reduce((s, n) => s + n, 0) / ranges.length : null;
  if (cp.bodyRatio >= 0.7 && cp.bull) return { name: "Strong bullish body", direction: "bullish", detail: "The candle closed near its high with a large body.", meaning: "Buyers controlled most of this candle." };
  if (cp.bodyRatio >= 0.7 && !cp.bull) return { name: "Strong bearish body", direction: "bearish", detail: "The candle closed near its low with a large body.", meaning: "Sellers controlled most of this candle." };
  if (avg != null && cp.range > avg * 1.6) return { name: "Expansion candle", direction: cp.bull ? "bullish" : "bearish", detail: "This candle is much wider than the recent ones.", meaning: "The move got larger than the recent noise." };
  if (cp.upperRatio >= 0.5) return { name: "Long upper wick", direction: "bearish", detail: "Price went up and gave back a lot of it.", meaning: "Higher prices were rejected." };
  if (cp.lowerRatio >= 0.5) return { name: "Long lower wick", direction: "bullish", detail: "Price went down and recovered a lot of it.", meaning: "Lower prices were rejected." };
  if (avg != null && cp.range < avg * 0.6) return { name: "Narrow-range candle", direction: "neutral", detail: "This candle is much smaller than the recent ones.", meaning: "Price is compressing. A direction is not chosen yet." };
  if (cp.bodyRatio <= 0.35) return { name: "Small body", direction: "neutral", detail: "The open and close are close together.", meaning: "This candle does not show a clear winner." };
  return null;
}

function relVolume(rows: Candle[]) {
  const last = rows.at(-1)?.v ?? 0;
  const prev = rows.slice(-21, -1).map((c) => c.v ?? 0).filter((n) => n > 0);
  if (!prev.length || last <= 0) return null;
  return last / (prev.reduce((s, n) => s + n, 0) / prev.length);
}

function readRows(label: TimeframeRead["label"], timeframe: CandleFeature["timeframe"], minutes: number, candles: Candle[], spot: number | null, nowSec: number, start: number | null): { read: TimeframeRead; feature: CandleFeature | null; up: string[]; down: string[] } {
  const series = aggregate(candles, minutes, spot, nowSec);
  const span = minutes * 60;
  const closed = series.filter((c) => c.t + span <= nowSec);
  const live = series.find((c) => c.t + span > nowSec) ?? null;
  const tech = readTech(closed.length >= 8 ? closed : series, spot, []);
  const confirmedHit = named(closed) ?? character(closed);
  const liveRows = live ? [...closed, live] : closed;
  const liveHit = live ? named(liveRows) ?? character(liveRows) : null;
  const formingOnly = liveHit != null && liveHit.name !== confirmedHit?.name;
  const hit = formingOnly ? liveHit : confirmedHit;
  const status: TimeframeRead["status"] = !hit ? "NONE" : formingOnly ? "FORMING" : "CONFIRMED";
  const used = status === "FORMING" ? liveRows : closed;
  const last = used.at(-1);
  const ratio = last ? parts(last) : null;
  const rel = relVolume(used);
  const ema9 = ema(used.map((c) => c.c), 9).at(-1) ?? null;
  const ema21 = ema(used.map((c) => c.c), 21).at(-1) ?? null;
  const px = last?.c ?? spot;
  const above9 = px != null && ema9 != null && px > ema9;
  const above21 = px != null && ema21 != null && px > ema21;
  const aboveVwap = px != null && tech.vwap != null && px > tech.vwap;
  const look = closed.slice(-20);
  const avgRange = look.length ? look.reduce((s, c) => s + Math.max(0, c.h - c.l), 0) / look.length : 0;
  const support = look.length ? Math.min(...look.map((c) => c.l)) : null;
  const resistance = look.length ? Math.max(...look.map((c) => c.h)) : null;
  const nearSupport = last != null && support != null && last.l <= support + avgRange * 0.35;
  const nearResistance = last != null && resistance != null && last.h >= resistance - avgRange * 0.35;
  const aligned = hit?.direction === "bullish"
    ? above9 || aboveVwap || tech.structureSide === "up" || nearSupport
    : hit?.direction === "bearish"
      ? (!above9 && ema9 != null) || (tech.vwap != null && px != null && px < tech.vwap) || tech.structureSide === "down" || nearResistance
      : false;
  const volumeOk = rel != null && rel >= 1.2 && status === "CONFIRMED";
  const strength: TimeframeRead["strength"] = !hit ? "NONE" : status === "CONFIRMED" && volumeOk && aligned ? "STRONG" : status === "CONFIRMED" && (volumeOk || aligned) ? "MODERATE" : "WEAK";
  const up: string[] = [];
  const down: string[] = [];
  if (hit?.direction === "bullish") up.push(`${status === "CONFIRMED" ? "Confirmed" : "Forming"} ${label.toLowerCase()} ${hit.name.toLowerCase()}`);
  if (hit?.direction === "bearish") down.push(`${status === "CONFIRMED" ? "Confirmed" : "Forming"} ${label.toLowerCase()} ${hit.name.toLowerCase()}`);
  if (volumeOk && hit?.direction === "bullish") up.push("Buying volume is above the recent average");
  if (volumeOk && hit?.direction === "bearish") down.push("Selling volume is above the recent average");
  if (tech.structureSide === "down") down.push(`${label.toLowerCase()} structure still leans down`);
  if (tech.structureSide === "up") up.push(`${label.toLowerCase()} structure still leans up`);
  if (px != null && tech.vwap != null && px < tech.vwap) down.push(`${label} price is below VWAP`);
  if (aboveVwap) up.push(`${label} price is above VWAP`);
  const target = px != null && start != null ? px - start : null;
  const detail = [
    hit?.detail ?? "The latest closed candles do not show a meaningful directional pattern.",
    status === "FORMING" ? "The live candle has not closed, so this can disappear." : "",
    volumeOk && rel != null ? `Volume was ${rel.toFixed(1)}× the recent average.` : "",
    above9 ? "Price is above EMA 9." : ema9 != null ? "Price is below EMA 9." : "",
    nearSupport && hit?.direction === "bullish" ? "It showed up near a recent low." : "",
    nearResistance && hit?.direction === "bearish" ? "It showed up near a recent high." : "",
    target != null ? `BTC is ${Math.abs(target) < 0.5 ? "on" : `${target > 0 ? "above" : "below"}`} the Coinbase window open.` : "",
  ].filter(Boolean).join(" ");
  const feature: CandleFeature | null = hit && last && ratio ? {
    timestamp: last.t,
    timeframe,
    pattern: hit.name,
    direction: hit.direction,
    status: status === "FORMING" ? "forming" : "confirmed",
    bodyRatio: ratio.bodyRatio,
    upperWickRatio: ratio.upperRatio,
    lowerWickRatio: ratio.lowerRatio,
    relativeVolume: rel,
    trendContext: tech.trend,
    vwapContext: tech.vwap == null || px == null ? "unknown" : px > tech.vwap ? "above" : px < tech.vwap ? "below" : "on",
    emaContext: ema9 == null || ema21 == null || px == null ? "unknown" : above9 && above21 ? "above both" : !above9 && !above21 ? "below both" : "between",
    structureContext: tech.structure,
  } : null;
  return {
    read: {
      label,
      mark: !hit || hit.direction === "neutral" ? hit ? "MIXED" : "QUIET" : hit.direction === "bullish" ? "BULLISH" : "BEARISH",
      name: hit?.name ?? "No strong pattern",
      status,
      strength,
      detail,
      meaning: hit?.meaning ?? "Current candles do not show a meaningful directional pattern.",
    },
    feature,
    up,
    down,
  };
}

function overall(reads: TimeframeRead[]) {
  const bulls = reads.filter((r) => r.mark === "BULLISH").length;
  const bears = reads.filter((r) => r.mark === "BEARISH").length;
  const strongBull = reads.some((r) => r.mark === "BULLISH" && r.strength === "STRONG");
  const strongBear = reads.some((r) => r.mark === "BEARISH" && r.strength === "STRONG");
  const m1 = reads.find((r) => r.label === "1 MINUTE");
  const m15 = reads.find((r) => r.label === "15 MINUTE");
  if (m1?.mark === "BULLISH" && m15?.mark === "BEARISH") return "SHORT-TERM RECOVERY INSIDE A BROADER BEARISH STRUCTURE";
  if (m1?.mark === "BEARISH" && m15?.mark === "BULLISH") return "SHORT-TERM DIP INSIDE A BROADER BULLISH STRUCTURE";
  if (bulls === 3 && strongBull) return "STRONG BULLISH";
  if (bears === 3 && strongBear) return "STRONG BEARISH";
  if (bulls >= 2 && bears === 0) return strongBull ? "BULLISH" : "SLIGHT BULLISH";
  if (bears >= 2 && bulls === 0) return strongBear ? "BEARISH" : "SLIGHT BEARISH";
  if (bulls > bears) return "SLIGHT BULLISH";
  if (bears > bulls) return "SLIGHT BEARISH";
  return "MIXED";
}

export function analyzeCandles(input: { candles: Candle[]; spot: number | null; nowSec: number; start: number | null; secsLeft: number | null }): CandleSignal {
  if (!input.candles.length) return NONE;
  const specs = [
    ["1 MINUTE", "1m", 1],
    ["5 MINUTE", "5m", 5],
    ["15 MINUTE", "15m", 15],
  ] as const;
  const partsRead = specs.map(([label, timeframe, minutes]) => readRows(label, timeframe, minutes, input.candles, input.spot, input.nowSec, input.start));
  const reads = partsRead.map((row) => row.read);
  const features = partsRead.flatMap((row) => row.feature ? [row.feature] : []);
  const supportsUp = [...new Set(partsRead.flatMap((row) => row.up))].slice(0, 4);
  const supportsDown = [...new Set(partsRead.flatMap((row) => row.down))].slice(0, 4);
  const confirmed = features.filter((f) => f.status === "confirmed" && f.direction !== "neutral");
  const forming = features.filter((f) => f.status === "forming" && f.direction !== "neutral");
  const bull = confirmed.filter((f) => f.direction === "bullish").length + forming.filter((f) => f.direction === "bullish").length * 0.35;
  const bear = confirmed.filter((f) => f.direction === "bearish").length + forming.filter((f) => f.direction === "bearish").length * 0.35;
  const direction: CandleDirection = bull > bear + 0.4 ? "bullish" : bear > bull + 0.4 ? "bearish" : "neutral";
  const agreement = new Set(reads.map((r) => r.mark).filter((m) => m === "BULLISH" || m === "BEARISH")).size <= 1 ? "aligned" : "mixed";
  const volumeConfirmed = features.some((f) => f.status === "confirmed" && f.relativeVolume != null && f.relativeVolume >= 1.2 && f.direction === direction);
  const trendConfirmed = features.some((f) => f.status === "confirmed" && f.direction === direction && ((direction === "bullish" && f.trendContext.includes("UP")) || (direction === "bearish" && f.trendContext.includes("DOWN"))));
  const structureConfirmed = features.some((f) => f.status === "confirmed" && f.direction === direction && ((direction === "bullish" && f.structureContext.startsWith("Bullish")) || (direction === "bearish" && f.structureContext.startsWith("Bearish"))));
  const context = [volumeConfirmed, trendConfirmed, structureConfirmed].filter(Boolean).length;
  const strength = direction === "neutral" ? "none" : confirmed.length === 0 ? "weak" : context >= 2 && agreement === "aligned" ? "strong" : context >= 1 ? "moderate" : "weak";
  void input.secsLeft;
  return {
    direction,
    strength,
    timeframeAgreement: agreement,
    confirmedPatterns: confirmed.map((f) => `${f.timeframe} ${f.pattern}`),
    formingPatterns: forming.map((f) => `${f.timeframe} ${f.pattern}`),
    volumeConfirmed,
    trendConfirmed,
    structureConfirmed,
    overall: overall(reads),
    reads,
    supportsUp,
    supportsDown,
    features,
  };
}

export type CandleObservation = {
  start: number;
  recordedAt: number;
  direction: CandleDirection;
  strength: CandleSignal["strength"];
  timeframeAgreement: CandleSignal["timeframeAgreement"];
  features: CandleFeature[];
  startPx: number;
  outcome: "up" | "down" | null;
  settledPx: number | null;
};

export function candleProbabilityDelta(_signal: CandleSignal | null | undefined) {
  return 0;
}

const LIBRARY: Record<string, { note: string; steps: number[] }> = {
  "Three white soldiers": { note: "After three strong green candles, BTC often keeps rising, but the next candles are usually smaller.", steps: [0.35, 0.25, 0.2, 0.15] },
  "Three black crows": { note: "After three strong red candles, BTC often keeps falling, but the next candles are usually smaller.", steps: [-0.35, -0.25, -0.2, -0.15] },
  "Morning star": { note: "A morning star often leads to a bounce toward the top of the first red candle.", steps: [0.3, 0.45, 0.25, 0.2] },
  "Evening star": { note: "An evening star often leads to a slide toward the low of the first green candle.", steps: [-0.3, -0.45, -0.25, -0.2] },
  "Bullish engulfing": { note: "BTC often tries to stay above the engulfed red candle and drift higher. Losing that red candle's low cancels the idea.", steps: [0.2, 0.4, 0.3, 0.45] },
  "Bearish engulfing": { note: "BTC often tries to stay below the engulfed green candle and drift lower. Getting back above that green candle's high cancels the idea.", steps: [-0.2, -0.4, -0.3, -0.45] },
  "Piercing line": { note: "A piercing line often gets a short follow-through up, not a straight rally.", steps: [0.15, 0.3, 0.1, 0.25] },
  "Dark cloud cover": { note: "Dark cloud cover often gets a short follow-through down, not a straight crash.", steps: [-0.15, -0.3, -0.1, -0.25] },
  "Bullish harami": { note: "A harami is a pause. The usual next step is a small drift, not a breakout, until a later candle leaves the range.", steps: [0.05, 0.12, 0.08, 0.1] },
  "Bearish harami": { note: "A harami is a pause. The usual next step is a small drift, not a breakdown, until a later candle leaves the range.", steps: [-0.05, -0.12, -0.08, -0.1] },
  "Tweezer bottom": { note: "Matching lows often produce a bounce back toward the middle of the two candles.", steps: [0.2, 0.35, 0.15, 0.25] },
  "Tweezer top": { note: "Matching highs often produce a drop back toward the middle of the two candles.", steps: [-0.2, -0.35, -0.15, -0.25] },
  "Bullish outside bar": { note: "An outside bar often continues in the direction of its close for one or two candles, then slows.", steps: [0.25, 0.2, 0.1, 0.15] },
  "Bearish outside bar": { note: "An outside bar often continues in the direction of its close for one or two candles, then slows.", steps: [-0.25, -0.2, -0.1, -0.15] },
  "Inside bar": { note: "An inside bar has no direction yet. The sketch stays flat until price leaves the previous candle.", steps: [0.02, -0.02, 0.02, -0.02] },
  "Hammer": { note: "A hammer often bounces, but only if the next candle holds above the hammer's close.", steps: [0.2, 0.35, 0.15, 0.25] },
  "Shooting star": { note: "A shooting star often fades, but only if the next candle stays under the star's close.", steps: [-0.2, -0.35, -0.15, -0.25] },
  "Lower-wick rejection": { note: "A long lower wick often gets a partial bounce, smaller than the wick itself.", steps: [0.15, 0.25, 0.1, 0.15] },
  "Upper-wick rejection": { note: "A long upper wick often gets a partial fade, smaller than the wick itself.", steps: [-0.15, -0.25, -0.1, -0.15] },
  "Bullish marubozu": { note: "A full green body often continues briefly, then the next candle is smaller.", steps: [0.3, 0.2, 0.12, 0.1] },
  "Bearish marubozu": { note: "A full red body often continues briefly, then the next candle is smaller.", steps: [-0.3, -0.2, -0.12, -0.1] },
  "Dragonfly doji": { note: "A dragonfly is a warning of buying, not a completed rally. The sketch only lifts a little.", steps: [0.08, 0.15, 0.05, 0.1] },
  "Gravestone doji": { note: "A gravestone is a warning of selling, not a completed drop. The sketch only fades a little.", steps: [-0.08, -0.15, -0.05, -0.1] },
  "Doji": { note: "A doji is a tie. The usual next candles stay near the same price.", steps: [0.03, -0.03, 0.02, -0.02] },
  "Spinning top": { note: "A spinning top is indecision. The usual next candles chop sideways.", steps: [0.04, -0.05, 0.03, -0.03] },
  "Strong bullish body": { note: "A strong green body often gets one more push, then slows if volume does not stay high.", steps: [0.22, 0.16, 0.08, 0.1] },
  "Strong bearish body": { note: "A strong red body often gets one more push down, then slows if volume does not stay high.", steps: [-0.22, -0.16, -0.08, -0.1] },
  "Expansion candle": { note: "A sudden wide candle often cools off. The next candles are usually smaller than the expansion.", steps: [0.1, 0.05, -0.04, 0.04] },
  "Long upper wick": { note: "A long upper wick often means the high gets tested less, and price leans back down.", steps: [-0.12, -0.18, -0.08, -0.1] },
  "Long lower wick": { note: "A long lower wick often means the low gets defended, and price leans back up.", steps: [0.12, 0.18, 0.08, 0.1] },
  "Narrow-range candle": { note: "A narrow candle is compression. Direction is not chosen, so the sketch stays tight.", steps: [0.03, -0.02, 0.02, -0.02] },
  "Small body": { note: "A small body does not pick a side. The next candles usually stay nearby.", steps: [0.02, -0.02, 0.02, -0.01] },
};

export type CandleProjection = {
  pattern: string;
  timeframe: string;
  status: string;
  call: "UP" | "DOWN" | "FLAT";
  note: string;
  past: Candle[];
  future: Candle[];
};

export function projectCandles(signal: CandleSignal, candles: Candle[], spot: number | null, nowSec: number, minutes: 1 | 15 = 1): CandleProjection | null {
  if (spot == null || spot <= 0) return null;
  const series = aggregate(candles, minutes, spot, nowSec);
  const past = series.slice(-8);
  if (past.length < 2) return null;
  const tf = minutes === 15 ? "15m" : "1m";
  const ranked = signal.features
    .filter((feature) => feature.timeframe === tf)
    .map((feature) => ({ feature, rank: (feature.status === "confirmed" ? 4 : 1) + (feature.direction === "neutral" ? 0 : 2) }))
    .sort((a, b) => b.rank - a.rank)[0]?.feature;
  const pattern = ranked?.pattern ?? "Small body";
  const book = LIBRARY[pattern] ?? LIBRARY["Small body"]!;
  const last = past[past.length - 1]!;
  const range = Math.max(minutes === 15 ? 20 : 8, ...past.slice(-5).map((c) => c.h - c.l));
  const steps = book.steps.length >= 5 ? book.steps.slice(0, 5) : [...book.steps, (book.steps.at(-1) ?? 0) * 0.65];
  const future: Candle[] = [];
  let px = spot;
  const sign = pattern === "Expansion candle" && ranked?.direction === "bearish" ? -1 : 1;
  const bar = minutes * 60;
  steps.forEach((step, i) => {
    const close = px + step * range * sign;
    const wick = range * 0.15;
    future.push({ t: Math.floor(last.t) + (i + 1) * bar, o: px, c: close, h: Math.max(px, close) + wick, l: Math.min(px, close) - wick, v: 0 });
    px = close;
  });
  const end = future[future.length - 1]?.c ?? spot;
  const call = end > spot + range * 0.12 ? "UP" : end < spot - range * 0.12 ? "DOWN" : "FLAT";
  const status = ranked?.status === "forming" ? "FORMING" : ranked ? "CONFIRMED" : "NONE";
  const horizon = minutes === 1 ? "next 5 one-minute candles" : "next 5 fifteen-minute candles";
  const missing = ranked ? "" : ` No named ${tf} pattern is on the board, so these 5 candles stay nearly flat.`;
  return {
    pattern,
    timeframe: tf,
    status,
    call,
    note: `${book.note}${missing} Sketch of the ${horizon}. Not a promise, and it does not change the percent.`,
    past,
    future,
  };
}

export function captureCandleLog(rows: CandleObservation[], input: { now: number; start: number; signal: CandleSignal; price: number | null; startPx: number | null }): CandleObservation[] {
  const age = input.now - input.start * 1000;
  if (age < 30_000 || age >= 60_000 || rows.some((row) => row.start === input.start)) return rows;
  if (input.price == null || input.startPx == null || input.price <= 0 || input.startPx <= 0) return rows;
  const row: CandleObservation = {
    start: input.start,
    recordedAt: input.now,
    direction: input.signal.direction,
    strength: input.signal.strength,
    timeframeAgreement: input.signal.timeframeAgreement,
    features: input.signal.features,
    startPx: input.startPx,
    outcome: null,
    settledPx: null,
  };
  return [row, ...rows].slice(0, 1000);
}

export function settleCandleLog(rows: CandleObservation[], candles: Candle[], now: number): CandleObservation[] {
  let changed = false;
  const closes = new Map(candles.filter((c) => (c.t + 60) * 1000 <= now).map((c) => [c.t, c.c]));
  const next = rows.map((row) => {
    if (row.outcome != null || now < (row.start + 900) * 1000) return row;
    const close = closes.get(row.start + 840);
    if (close == null) return row;
    changed = true;
    const outcome: CandleObservation["outcome"] = close > row.startPx ? "up" : "down";
    return { ...row, settledPx: close, outcome };
  });
  return changed ? next : rows;
}

const CANDLE_STORE = "btc-candle-log-v1";

export type PatternScore = { correct: number; scored: number };

export function loadCandleLog(): CandleObservation[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const rows: unknown = JSON.parse(localStorage.getItem(CANDLE_STORE) ?? "[]");
    return Array.isArray(rows) ? rows as CandleObservation[] : [];
  } catch {
    return [];
  }
}

export function saveCandleLog(rows: CandleObservation[]) {
  try { localStorage.setItem(CANDLE_STORE, JSON.stringify(rows)); }
  catch { /* keep the live read if storage is blocked */ }
}

export function patternScores(rows: CandleObservation[]): Record<string, PatternScore> {
  const scores: Record<string, PatternScore> = {};
  for (const row of rows) {
    if (row.outcome == null) continue;
    const seen = new Set<string>();
    for (const feature of row.features ?? []) {
      if (feature.status !== "confirmed" || feature.direction === "neutral" || seen.has(feature.pattern)) continue;
      seen.add(feature.pattern);
      const score = scores[feature.pattern] ?? { correct: 0, scored: 0 };
      score.scored += 1;
      const right = (feature.direction === "bullish" && row.outcome === "up") || (feature.direction === "bearish" && row.outcome === "down");
      if (right) score.correct += 1;
      scores[feature.pattern] = score;
    }
  }
  return scores;
}

export function scoreLine(scores: Record<string, PatternScore>, name: string) {
  const score = scores[name];
  if (!score || score.scored === 0) return "Saved record: none yet";
  return `Saved record: ${score.correct} right of ${score.scored} (${Math.round((score.correct / score.scored) * 100)}%)`;
}
