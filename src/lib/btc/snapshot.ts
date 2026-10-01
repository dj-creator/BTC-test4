import { createServerFn } from "@tanstack/react-start";
import type { Candle, MarketQuote, SettledWindow, Snapshot, StrikeRule } from "./types";

type KalshiMarket = {
  ticker?: string;
  title?: string;
  status?: string;
  floor_strike?: number | null;
  strike_type?: string;
  close_time?: string;
  open_time?: string;
  yes_bid_dollars?: string;
  yes_ask_dollars?: string;
  no_bid_dollars?: string;
  no_ask_dollars?: string;
  volume_fp?: string;
  open_interest_fp?: string;
};

let kalshiCache: { at: number; market: MarketQuote | null; error: string | null } | null = null;
let candleCache: { at: number; candles: Candle[] } | null = null;
let dayCache: { at: number; candles: Candle[] } | null = null;
const settledCache = new Map<string, { at: number; rows: SettledWindow[] }>();

function dollars(v: string | undefined) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function ruleOf(strikeType: string | undefined): StrikeRule {
  if (strikeType === "greater_or_equal") return "greater_or_equal";
  if (strikeType === "greater") return "greater";
  return "unknown";
}

async function fetchKalshi(): Promise<{ market: MarketQuote | null; error: string | null; at: number }> {
  const now = Date.now();
  if (kalshiCache && now - kalshiCache.at < 10_000) {
    return { market: kalshiCache.market, error: kalshiCache.error, at: kalshiCache.at };
  }
  try {
    const res = await fetch(
      "https://api.elections.kalshi.com/trade-api/v2/markets?series_ticker=KXBTC15M&status=open&limit=5",
      { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) throw new Error(`Kalshi ${res.status}`);
    const body = (await res.json()) as { markets?: KalshiMarket[] };
    const markets = body.markets ?? [];
    const open = markets
      .map((m) => ({ m, close: Date.parse(m.close_time ?? ""), openAt: Date.parse(m.open_time ?? "") }))
      .filter((x) => Number.isFinite(x.close) && x.openAt <= now && x.close > now)
      .sort((a, b) => a.close - b.close);
    const picked = open[0]?.m;
    if (!picked) {
      kalshiCache = { at: now, market: null, error: "No open 15-minute market" };
      return { market: null, error: kalshiCache.error, at: now };
    }
    const market: MarketQuote = {
      ticker: picked.ticker ?? "KXBTC15M",
      title: picked.title ?? "BTC price up in next 15 mins?",
      status: picked.status === "active" ? "open" : (picked.status ?? "open"),
      strike: typeof picked.floor_strike === "number" ? picked.floor_strike : null,
      strikeRule: ruleOf(picked.strike_type),
      closeTime: Date.parse(picked.close_time ?? ""),
      openTime: Date.parse(picked.open_time ?? ""),
      yesBid: dollars(picked.yes_bid_dollars),
      yesAsk: dollars(picked.yes_ask_dollars),
      noBid: dollars(picked.no_bid_dollars),
      noAsk: dollars(picked.no_ask_dollars),
      volume: dollars(picked.volume_fp),
      openInterest: dollars(picked.open_interest_fp),
    };
    kalshiCache = { at: now, market, error: null };
    return { market, error: null, at: now };
  } catch (err) {
    const error = err instanceof Error ? err.message : "Kalshi unavailable";
    kalshiCache = { at: now, market: null, error };
    return { market: null, error, at: now };
  }
}

async function fetchGranularity(seconds: number, keep: number, end?: number, product = "BTC-USD"): Promise<Candle[]> {
  const res = await fetch(
    `https://api.exchange.coinbase.com/products/${product}/candles?granularity=${seconds}${end == null ? "" : `&start=${new Date((end - seconds * keep) * 1000).toISOString()}&end=${new Date(end * 1000).toISOString()}`}`,
    { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8000) },
  );
  if (!res.ok) throw new Error(`Candles ${res.status}`);
  const rows = (await res.json()) as number[][];
  return rows
    .map((row) => ({
      t: row[0] ?? 0,
      l: row[1] ?? 0,
      h: row[2] ?? 0,
      o: row[3] ?? 0,
      c: row[4] ?? 0,
      v: row[5] ?? 0,
    }))
    .filter((c) => c.t > 0 && c.c > 0)
    .sort((a, b) => a.t - b.t)
    .slice(-keep);
}

async function fetchCandles(): Promise<Candle[]> {
  const now = Date.now();
  if (candleCache && now - candleCache.at < 10_000) return candleCache.candles;
  const recent = await fetchGranularity(60, 300);
  let older = candleCache?.candles ?? [];
  if (older.length === 0 && recent.length) {
    const end = recent[0]!.t;
    const pages = await Promise.allSettled([fetchGranularity(60, 300, end), fetchGranularity(60, 300, end - 18_000)]);
    older = pages.flatMap((page) => page.status === "fulfilled" ? page.value : []);
  }
  const merged = new Map([...older, ...recent].map((c) => [c.t, c]));
  const candles = [...merged.values()].sort((a, b) => a.t - b.t).slice(-900);
  candleCache = { at: now, candles };
  return candles;
}

async function fetchDayCandles(): Promise<Candle[]> {
  const now = Date.now();
  if (dayCache && now - dayCache.at < 60_000) return dayCache.candles;
  const candles = await fetchGranularity(300, 300);
  dayCache = { at: now, candles };
  return candles;
}

async function fetchSettled(series: string): Promise<SettledWindow[]> {
  const now = Date.now();
  const hit = settledCache.get(series);
  if (hit && now - hit.at < 30_000) return hit.rows;
  const res = await fetch(
    `https://api.elections.kalshi.com/trade-api/v2/markets?series_ticker=${series}&status=settled&limit=12`,
    { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8000) },
  );
  if (!res.ok) throw new Error(`Kalshi history ${res.status}`);
  const body = (await res.json()) as {
    markets?: {
      ticker?: string;
      result?: string;
      floor_strike?: number | null;
      expiration_value?: string;
      open_time?: string;
      close_time?: string;
      volume_fp?: string;
    }[];
  };
  const rows = (body.markets ?? [])
    .map((m): SettledWindow => {
      const result = m.result === "yes" || m.result === "no" ? m.result : "unknown";
      const settle = Number(m.expiration_value);
      const volume = Number(m.volume_fp);
      return {
        ticker: m.ticker ?? "",
        openTime: Date.parse(m.open_time ?? ""),
        closeTime: Date.parse(m.close_time ?? ""),
        strike: typeof m.floor_strike === "number" ? m.floor_strike : null,
        settle: Number.isFinite(settle) ? settle : null,
        result,
        volume: Number.isFinite(volume) ? volume : null,
      };
    })
    .filter((row) => row.result !== "unknown" && Number.isFinite(row.closeTime))
    .sort((a, b) => b.closeTime - a.closeTime)
    .slice(0, 10);
  settledCache.set(series, { at: now, rows });
  return rows;
}

async function fetchSpot(): Promise<number | null> {
  const res = await fetch("https://api.coinbase.com/v2/prices/BTC-USD/spot", {
    headers: { accept: "application/json" }, signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Spot ${res.status}`);
  const body = (await res.json()) as { data?: { amount?: string } };
  const n = Number(body.data?.amount);
  return Number.isFinite(n) ? n : null;
}

export const getSnapshot = createServerFn({ method: "GET" }).handler(async (): Promise<Snapshot> => {
  const fetchedAt = Date.now();
  const [spotResult, kalshi, candleResult, dayResult, history] = await Promise.all([
    fetchSpot().then(
      (spot) => ({ spot, error: null as string | null }),
      (err: unknown) => ({ spot: null, error: err instanceof Error ? err.message : "Spot unavailable" }),
    ),
    fetchKalshi(),
    fetchCandles().then(
      (candles) => ({ candles, error: null as string | null }),
      () => ({ candles: [] as Candle[], error: "Candles unavailable" }),
    ),
    fetchDayCandles().then(
      (candles) => candles,
      () => [] as Candle[],
    ),
    fetchSettled("KXBTC15M").then(
      (rows) => rows,
      () => [] as SettledWindow[],
    ),
  ]);
  return {
    fetchedAt,
    spot: spotResult.spot,
    spotAt: spotResult.spot == null ? null : fetchedAt,
    spotSource: "Coinbase BTC/USD",
    bookAt: kalshi.market ? kalshi.at : null,
    kalshiOk: kalshi.error == null && kalshi.market != null,
    kalshiError: kalshi.error ?? spotResult.error ?? candleResult.error,
    market: kalshi.market,
    candles: candleResult.candles,
    dayCandles: dayResult,
    history,
  };
});

let altCache: { at: number; eth: Candle[]; sol: Candle[]; error: string | null } | null = null;

export const getAltMinutes = createServerFn({ method: "GET" }).handler(async () => {
  const now = Date.now();
  if (altCache && now - altCache.at < 20_000) return { eth: altCache.eth, sol: altCache.sol, error: altCache.error };
  const [eth, sol] = await Promise.allSettled([
    fetchGranularity(60, 40, undefined, "ETH-USD"),
    fetchGranularity(60, 40, undefined, "SOL-USD"),
  ]);
  const rows = {
    eth: eth.status === "fulfilled" ? eth.value : [],
    sol: sol.status === "fulfilled" ? sol.value : [],
    error: eth.status === "rejected" && sol.status === "rejected" ? "ETH and SOL candles are unavailable" : null,
  };
  altCache = { at: now, ...rows };
  return rows;
});

export const getAltSettled = createServerFn({ method: "GET" }).handler(async () => {
  const [eth, sol] = await Promise.all([
    fetchSettled("KXETH15M").then((rows) => rows, () => [] as SettledWindow[]),
    fetchSettled("KXSOL15M").then((rows) => rows, () => [] as SettledWindow[]),
  ]);
  return { eth, sol };
});

export type FlipHeadline = { title: string; url: string; source: string; at: number | null; kind: "flip" | "whale" | "market" };
export type FlipPrint = { t: number; usd: number; taker: "buy" | "sell"; px: number };
export type ChainWhale = { txid: string; btc: number; usd: number | null; at: number | null; where: "block" | "mempool" };

const FLIP_WORDS = ["etf", "sec", "fed", "fomc", "cpi", "inflation", "rate cut", "rate hike", "hack", "exploit", "liquidat", "ban", "lawsuit", "court", "tariff", "war", "approval", "reject", "outflow", "inflow", "halt", "outage", "crash"];
const WHALE_WORDS = ["whale", "billion", "wallet", "transfer", "moved", "otc", "accumul"];

let newsCache: { at: number; headlines: FlipHeadline[]; error: string | null } | null = null;
let chainCache: { at: number; prints: FlipPrint[]; whales: ChainWhale[]; error: string | null } | null = null;

function rssText(chunk: string, tag: string) {
  const match = chunk.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  if (!match) return "";
  return match[1]
    .replace(/^<!\[CDATA\[/, "")
    .replace(/\]\]>$/, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&/g, "&")
    .replace(/"/g, "\"")
    .replace(/&#39;|'/g, "'")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .trim();
}

function kindOf(title: string): FlipHeadline["kind"] {
  const text = title.toLowerCase();
  if (WHALE_WORDS.some((word) => text.includes(word))) return "whale";
  if (FLIP_WORDS.some((word) => text.includes(word))) return "flip";
  return "market";
}

async function readFeed(url: string, source: string): Promise<FlipHeadline[]> {
  const res = await fetch(url, { headers: { accept: "application/rss+xml, application/xml, text/xml", "user-agent": "btc-window" }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`${source} ${res.status}`);
  const xml = await res.text();
  return xml.split("<item>").slice(1, 10).map((chunk) => {
    const at = Date.parse(rssText(chunk, "pubDate"));
    return {
      title: rssText(chunk, "title"),
      url: rssText(chunk, "link"),
      source,
      at: Number.isFinite(at) ? at : null,
      kind: kindOf(rssText(chunk, "title")),
    };
  }).filter((row) => row.title);
}

async function readPrints(): Promise<FlipPrint[]> {
  const res = await fetch("https://api.exchange.coinbase.com/products/BTC-USD/trades?limit=100", {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Trades ${res.status}`);
  const rows = (await res.json()) as { time?: string; price?: string; size?: string; side?: string }[];
  return rows.flatMap((row) => {
    const px = Number(row.price);
    const btc = Number(row.size);
    const usd = px * btc;
    if (!Number.isFinite(usd) || usd < 250_000) return [];
    const t = Date.parse(row.time ?? "");
    return [{ t: Number.isFinite(t) ? t : Date.now(), usd, px, taker: row.side === "sell" ? "buy" as const : "sell" as const }];
  }).slice(0, 6);
}

async function readChain(spot: number | null): Promise<ChainWhale[]> {
  const found: ChainWhale[] = [];
  const tipRes = await fetch("https://blockstream.info/api/blocks/tip/hash", { signal: AbortSignal.timeout(8000) });
  if (tipRes.ok) {
    const tip = (await tipRes.text()).trim();
    const blockRes = await fetch(`https://blockstream.info/api/block/${tip}/txs/0`, { signal: AbortSignal.timeout(8000) });
    if (blockRes.ok) {
      const txs = (await blockRes.json()) as { txid?: string; status?: { block_time?: number }; vout?: { value?: number }[] }[];
      for (const tx of txs) {
        const btc = (tx.vout ?? []).reduce((sum, out) => sum + (out.value ?? 0), 0) / 1e8;
        if (!tx.txid || btc < 1) continue;
        found.push({ txid: tx.txid, btc, usd: spot == null ? null : btc * spot, at: tx.status?.block_time ? tx.status.block_time * 1000 : null, where: "block" });
      }
    }
  }
  const memRes = await fetch("https://blockchain.info/unconfirmed-transactions?format=json", { signal: AbortSignal.timeout(8000) });
  if (memRes.ok) {
    const body = (await memRes.json()) as { txs?: { hash?: string; time?: number; out?: { value?: number }[] }[] };
    for (const tx of body.txs ?? []) {
      const btc = (tx.out ?? []).reduce((sum, out) => sum + (out.value ?? 0), 0) / 1e8;
      if (!tx.hash || btc < 1) continue;
      found.push({ txid: tx.hash, btc, usd: spot == null ? null : btc * spot, at: tx.time ? tx.time * 1000 : null, where: "mempool" });
    }
  }
  const seen = new Set<string>();
  return found.filter((row) => seen.has(row.txid) ? false : (seen.add(row.txid), true)).sort((a, b) => b.btc - a.btc).slice(0, 6);
}

export const getFlipWatch = createServerFn({ method: "GET" }).handler(async () => {
  const now = Date.now();
  let headlines = newsCache?.headlines ?? [];
  let newsError = newsCache?.error ?? null;
  if (!newsCache || now - newsCache.at >= 90_000) {
    const [desk, graph, block] = await Promise.allSettled([
      readFeed("https://www.coindesk.com/arc/outboundfeeds/rss/?outputType=xml", "CoinDesk"),
      readFeed("https://cointelegraph.com/rss/tag/bitcoin", "Cointelegraph"),
      readFeed("https://www.theblock.co/rss.xml", "The Block"),
    ]);
    headlines = [desk, graph, block].flatMap((result) => result.status === "fulfilled" ? result.value : [])
      .sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
      .filter((row, index, all) => all.findIndex((other) => other.title === row.title) === index)
      .slice(0, 8);
    newsError = headlines.length ? null : "Free headlines are unavailable right now.";
    newsCache = { at: now, headlines, error: newsError };
  }
  let prints = chainCache?.prints ?? [];
  let whales = chainCache?.whales ?? [];
  let chainError = chainCache?.error ?? null;
  if (!chainCache || now - chainCache.at >= 15_000) {
    const spot = await fetchSpot().catch(() => null);
    const [printResult, whaleResult] = await Promise.allSettled([readPrints(), readChain(spot)]);
    prints = printResult.status === "fulfilled" ? printResult.value : prints;
    whales = whaleResult.status === "fulfilled" ? whaleResult.value : whales;
    chainError = printResult.status === "rejected" && whaleResult.status === "rejected" ? "Free whale feeds are unavailable right now." : null;
    chainCache = { at: now, prints, whales, error: chainError };
  }
  return { headlines, prints, whales, error: newsError && chainError ? "Free news and whale feeds are unavailable right now." : null };
});
