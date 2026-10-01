import { priceAgo, type Sample } from "./live";
import type { CandleSignal } from "./candles";
import type { TechRead } from "./ta";
import type { Pulse } from "./pulse";
import type { Candle, MarketQuote } from "./types";

export type EntrySide = "UP" | "DOWN" | "WAIT";
export type EntryStrength = "LOW" | "MODERATE" | "STRONG";

export type EntryView = {
  state: EntrySide;
  direction: "BULLISH" | "BEARISH" | "MIXED";
  strength: EntryStrength;
  support: number;
  oppose: number;
  total: number;
  passed: string[];
  reason: string;
  contract: string | null;
  contractPx: number | null;
  invalidation: string | null;
  insufficient: boolean;
};

export type EntryLog = {
  at: number;
  start: number;
  side: "UP" | "DOWN";
  strength: "MODERATE" | "STRONG";
  contract: number | null;
  spot: number;
  startPx: number | null;
  peak: number;
  worst: number;
  result: "up" | "down" | null;
  settledPx: number | null;
};

const KEY = "btc-entry-v1";

type Mark = "yes" | "no" | "quiet";

function markOf(support: boolean, oppose: boolean): Mark {
  if (support && !oppose) return "yes";
  if (oppose && !support) return "no";
  return "quiet";
}

export function readEntry(input: {
  spot: number | null;
  spotAt: number | null;
  now: number;
  secs: number | null;
  samples: Sample[];
  pulse: Pulse;
  tech: TechRead;
  candle: CandleSignal;
  radar: string;
  market: MarketQuote | null;
  bookAt: number | null;
  flip: "LOW" | "POSSIBLE" | "HIGH" | "UNKNOWN";
}): EntryView {
  const stale = input.spot == null || input.spotAt == null || input.now - input.spotAt > 10_000 || input.now - input.spotAt < -2_000;
  if (stale) {
    return {
      state: "WAIT",
      direction: "MIXED",
      strength: "LOW",
      support: 0,
      oppose: 0,
      total: 7,
      passed: [],
      reason: "WAIT — INSUFFICIENT LIVE DATA",
      contract: null,
      contractPx: null,
      invalidation: null,
      insufficient: true,
    };
  }
  const d10 = input.spot == null ? null : (() => {
    const prior = priceAgo(input.samples, 10_000, input.now);
    return prior ? input.spot - prior.px : null;
  })();
  const d30 = input.pulse.moves.find((row) => row.ms === 30_000)?.delta ?? null;
  const d60 = input.pulse.moves.find((row) => row.ms === 60_000)?.delta ?? null;
  const d300 = input.pulse.moves.find((row) => row.ms === 300_000)?.delta ?? null;
  const confirmed = input.candle.features.filter((row) => row.status === "confirmed");
  const bullCandle = confirmed.some((row) => row.direction === "bullish");
  const bearCandle = confirmed.some((row) => row.direction === "bearish");
  const book = input.pulse.bookLean;
  const whale = input.pulse.alignment.find((row) => row.label === "Large Trades")?.lean ?? "wait";

  const sideMarks = (side: "up" | "down") => {
    const sign = side === "up" ? 1 : -1;
    const withMove = (n: number | null, min: number) => n != null && n * sign >= min;
    const against = (n: number | null, min: number) => n != null && n * sign <= -min;
    const shortUp = [d10, d30, d60].filter((n) => withMove(n, 4)).length;
    const shortDown = [d10, d30, d60].filter((n) => against(n, 4)).length;
    const momentum = markOf(shortUp >= 2 && !against(d300, 20), shortDown >= 2);
    const accel = markOf(
      input.pulse.accel === (side === "up" ? "up" : "down"),
      input.pulse.accel === (side === "up" ? "down" : "up") || input.pulse.accel === "reversal",
    );
    const ema = markOf(
      side === "up" ? input.tech.trend.includes("UP") : input.tech.trend.includes("DOWN"),
      side === "up" ? input.tech.trend.includes("DOWN") : input.tech.trend.includes("UP"),
    );
    const vwap = markOf(
      side === "up" ? input.pulse.vwapSide === "above" : input.pulse.vwapSide === "below",
      side === "up" ? input.pulse.vwapSide === "below" : input.pulse.vwapSide === "above",
    );
    const candle = markOf(side === "up" ? bullCandle && !bearCandle : bearCandle && !bullCandle, side === "up" ? bearCandle && !bullCandle : bullCandle && !bearCandle);
    const flowSupport = (side === "up" ? (input.pulse.buyPct != null && input.pulse.buyPct >= 0.55) || input.tech.volumeSide === "up" : (input.pulse.buyPct != null && input.pulse.buyPct <= 0.45) || input.tech.volumeSide === "down")
      && whale !== (side === "up" ? "no" : "yes")
      && book !== (side === "up" ? "no" : "yes");
    const flowOppose = side === "up"
      ? (input.pulse.buyPct != null && input.pulse.buyPct <= 0.42) || whale === "no" || book === "no"
      : (input.pulse.buyPct != null && input.pulse.buyPct >= 0.58) || whale === "yes" || book === "yes";
    const flow = markOf(flowSupport, flowOppose);
    const radarUp = input.radar === "STRONG UP" || input.radar === "UP";
    const radarDown = input.radar === "STRONG DOWN" || input.radar === "DOWN";
    const breadth = markOf(
      side === "up" ? radarUp || (!radarDown && input.tech.structureSide === "up") : radarDown || (!radarUp && input.tech.structureSide === "down"),
      side === "up" ? radarDown : radarUp,
    );
    const rows: { name: string; mark: Mark }[] = [
      { name: side === "up" ? "Short-term momentum is up" : "Short-term momentum is down", mark: momentum },
      { name: side === "up" ? "Momentum is accelerating up" : "Momentum is accelerating down", mark: accel },
      { name: side === "up" ? "EMA trend is bullish" : "EMA trend is bearish", mark: ema },
      { name: side === "up" ? "BTC is above VWAP" : "BTC is below VWAP", mark: vwap },
      { name: side === "up" ? "A bullish candle has closed" : "A bearish candle has closed", mark: candle },
      { name: side === "up" ? "Buying pressure is increasing" : "Selling pressure is increasing", mark: flow },
      { name: side === "up" ? "Broader market agrees up" : "Broader market agrees down", mark: breadth },
    ];
    return rows;
  };

  const up = sideMarks("up");
  const down = sideMarks("down");
  const upYes = up.filter((row) => row.mark === "yes").length;
  const downYes = down.filter((row) => row.mark === "yes").length;
  const upNo = up.filter((row) => row.mark === "no").length;
  const downNo = down.filter((row) => row.mark === "no").length;
  const bullish = upYes >= 5 && upNo <= 1 && upYes > downYes;
  const bearish = downYes >= 5 && downNo <= 1 && downYes > upYes;
  const direction = bullish ? "BULLISH" : bearish ? "BEARISH" : "MIXED";
  const picked = bullish ? up : bearish ? down : upYes >= downYes ? up : down;
  const support = bullish ? upYes : bearish ? downYes : Math.max(upYes, downYes);
  const oppose = bullish ? upNo : bearish ? downNo : Math.min(upNo, downNo);
  const need = input.pulse.vol === "EXTREME" || input.flip === "POSSIBLE" ? 6 : 5;
  const strength: EntryStrength = support >= 6 ? "STRONG" : support >= 5 ? "MODERATE" : "LOW";
  const bookFresh = input.market != null && input.bookAt != null && input.now - input.bookAt <= 30_000 && input.now - input.bookAt >= -2_000;
  const yesAsk = bookFresh && input.market?.yesAsk != null && input.market.yesAsk > 0 && input.market.yesAsk < 1 ? input.market.yesAsk : null;
  const noAsk = bookFresh && input.market?.noAsk != null && input.market.noAsk > 0 && input.market.noAsk < 1 ? input.market.noAsk : null;
  const yesBid = bookFresh && input.market?.yesBid != null && input.market.yesBid > 0 ? input.market.yesBid : null;
  const spread = yesAsk != null && yesBid != null ? yesAsk - yesBid : null;
  const wanted: "up" | "down" | null = bullish ? "up" : bearish ? "down" : null;
  const price = wanted === "up" ? yesAsk : wanted === "down" ? noAsk : null;
  const contract = price == null ? null : `${Math.round(price * 100)}¢`;
  let block: string | null = null;
  if (wanted) {
    if (!bookFresh || price == null) block = "WAIT — INSUFFICIENT LIVE DATA";
    else if (input.secs == null || input.secs < 75) block = "WAIT — too close to settlement";
    else if (input.pulse.reversal === "HIGH" || input.flip === "HIGH") block = "WAIT — flip danger is high";
    else if (spread != null && spread > 0.1) block = "WAIT — bid/ask spread is too wide";
    else if (price >= 0.78) block = "WAIT — contract already expensive";
    else if (price <= 0.25) block = "WAIT — contract price does not agree";
    else if (support < need || oppose > 1) block = "Waiting for stronger agreement.";
  }
  const state: EntrySide = !wanted || block ? "WAIT" : wanted === "up" ? "UP" : "DOWN";
  const passed = (state === "UP" ? up : state === "DOWN" ? down : []).filter((row) => row.mark === "yes").map((row) => row.name);
  const reason = state === "UP"
    ? "Short-term buying pressure is strengthening."
    : state === "DOWN"
      ? "Short-term selling pressure is strengthening."
      : direction === "MIXED"
        ? "No clear entry yet."
        : `ENTRY: ${block ?? "Waiting for stronger agreement."}`;
  return {
    state,
    direction,
    strength: state === "WAIT" ? (direction === "MIXED" ? "LOW" : strength) : strength,
    support,
    oppose,
    total: 7,
    passed,
    reason,
    contract: wanted ? contract : null,
    contractPx: wanted ? price : null,
    invalidation: state === "UP"
      ? "BTC loses VWAP and momentum turns down."
      : state === "DOWN"
        ? "BTC reclaims VWAP and momentum turns up."
        : null,
    insufficient: block === "WAIT — INSUFFICIENT LIVE DATA",
  };
}

export function loadEntries(): EntryLog[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const rows = JSON.parse(localStorage.getItem(KEY) ?? "[]") as EntryLog[];
    return Array.isArray(rows) ? rows.filter((row) => row && (row.side === "UP" || row.side === "DOWN") && Number.isFinite(row.at)) : [];
  } catch {
    return [];
  }
}

export function saveEntries(rows: EntryLog[]) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(rows.slice(0, 400)));
}

export function noteEntry(rows: EntryLog[], input: { at: number; start: number; side: "UP" | "DOWN"; strength: "MODERATE" | "STRONG"; contract: number | null; spot: number; startPx: number | null }) {
  if (rows.some((row) => row.start === input.start && row.side === input.side)) return rows;
  return [{ ...input, peak: 0, worst: 0, result: null, settledPx: null }, ...rows].slice(0, 400);
}

export function trackEntries(rows: EntryLog[], spot: number | null, candles: Candle[], now: number) {
  let changed = false;
  const next = rows.map((row) => {
    const end = (row.start + 900) * 1000;
    let peak = row.peak;
    let worst = row.worst;
    if (spot != null && now < end + 5_000) {
      const move = row.side === "UP" ? spot - row.spot : row.spot - spot;
      peak = Math.max(peak, move);
      worst = Math.min(worst, move);
    }
    let result = row.result;
    let settledPx = row.settledPx;
    if (result == null && now >= end) {
      const windowRows = candles.filter((c) => c.t >= row.start && c.t < row.start + 900).sort((a, b) => a.t - b.t);
      const last = windowRows[windowRows.length - 1];
      const open = row.startPx ?? windowRows[0]?.o ?? null;
      if (last && open != null && last.t + 60 <= now / 1000) {
        settledPx = last.c;
        result = last.c > open ? "up" : "down";
      }
    }
    if (peak === row.peak && worst === row.worst && result === row.result && settledPx === row.settledPx) return row;
    changed = true;
    return { ...row, peak, worst, result, settledPx };
  });
  return changed ? next : rows;
}
