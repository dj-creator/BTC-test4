import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { startCoinbaseFeed, useLive } from "@/lib/btc/live";
import { getAltMinutes, getSnapshot } from "@/lib/btc/snapshot";
import { pathPlan, type Horizon } from "@/lib/btc/path";
import { analyzeCandles, captureCandleLog, loadCandleLog, patternScores, saveCandleLog, settleCandleLog, type PatternScore } from "@/lib/btc/candles";
import { CandleRead, ProjectedOutcome } from "@/components/btc/candle-read";
import { FlipWatch } from "@/components/btc/flip-watch";
import type { Candle, MarketQuote, Snapshot } from "@/lib/btc/types";

function money(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

function signed(n: number | null) {
  if (n == null || Number.isNaN(n)) return "—";
  const abs = Math.abs(n).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (Math.abs(n) < 0.005) return "$0.00";
  return `${n > 0 ? "+" : "−"}${abs}`;
}

function windowStartSec(now = Date.now()) {
  return Math.floor(now / 1000 / 900) * 900;
}

export function DeskNav({ here }: { here: "desk" | "plan" | "defs" | "book" }) {
  const item = (to: "/" | "/plan" | "/defs" | "/book", id: "desk" | "plan" | "defs" | "book", label: string) => (
    <Link to={to} className={`px-3 py-1 text-xs tracking-widest ${here === id ? "bg-fg text-bg" : "text-muted"}`}>
      {label}
    </Link>
  );
  return (
    <nav className="flex w-fit border border-line">
      {item("/", "desk", "LIVE DESK")}
      {item("/plan", "plan", "ESTIMATES")}
      {item("/defs", "defs", "DEFINITIONS")}
      {item("/book", "book", "BOOK")}
    </nav>
  );
}

function Card({ row, note, chance }: { row: Horizon | null; note: string; chance: string }) {
  const tone = row?.call === "UP" ? "text-up" : row?.call === "DOWN" ? "text-down" : "text-muted";
  return (
    <article className="border border-line bg-surface p-4">
      <p className="text-[11px] tracking-[0.18em] text-muted">{row?.label ?? "ESTIMATE"}</p>
      <p className={`mt-3 text-center font-mono text-5xl ${tone}`}>{row?.call ?? "—"}</p>
      <p className="text-center text-xs tracking-widest text-muted">{chance}</p>
      <p className="text-center font-mono text-3xl">{row?.pUp == null ? "—" : `${Math.round(row.pUp * 100)}%`}</p>
      <dl className="mt-4 space-y-1 font-mono text-sm">
        <div className="flex justify-between"><dt className="text-muted">Expected price</dt><dd>{money(row?.expected)}</dd></div>
        <div className="flex justify-between"><dt className="text-muted">Expected change</dt><dd className={tone}>{signed(row?.change ?? null)}</dd></div>
        <div className="flex justify-between"><dt className="text-muted">Usual band</dt><dd>{row ? `${money(row.low)} – ${money(row.high)}` : "—"}</dd></div>
      </dl>
      <p className="mt-3 text-sm text-muted">{note}</p>
    </article>
  );
}

function cents(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n) || n <= 0) return "—";
  return `${Math.round(n * 100)}¢`;
}

function KalshiCompare({ market, bookAt, now, win, end }: { market: MarketQuote | null; bookAt: number | null; now: number; win: number; end: Horizon | null }) {
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState<{ t: number; yes: number }[]>([]);
  const live = market != null && market.openTime <= now && market.closeTime > now && Math.abs(market.closeTime / 1000 - win - 900) < 1;
  const fresh = bookAt != null && now - bookAt >= -2000 && now - bookAt <= 30_000;
  const quote = live && fresh ? market : null;
  const yes = quote?.yesBid != null && quote.yesAsk != null && quote.yesBid > 0 && quote.yesAsk > 0
    ? (quote.yesBid + quote.yesAsk) / 2
    : quote?.yesAsk != null && quote.yesAsk > 0
      ? quote.yesAsk
      : null;
  useEffect(() => {
    if (yes == null) return;
    setPath((prev) => {
      const last = prev[prev.length - 1];
      if (last && Math.abs(last.yes - yes) < 0.004 && now - last.t < 20_000) return prev;
      return [...prev, { t: now, yes }].filter((row) => row.t >= now - 15 * 60_000).slice(-40);
    });
  }, [yes, now]);
  const ago = path.find((row) => row.t <= now - 5 * 60_000)?.yes ?? path[0]?.yes ?? null;
  const delta = yes != null && ago != null ? yes - ago : null;
  const bot = end?.call === "UP" ? "YES" : end?.call === "DOWN" ? "NO" : "WAIT";
  const botTone = bot === "YES" ? "text-up" : bot === "NO" ? "text-down" : "text-muted";
  const kalshiUp = yes != null && yes >= 0.5;
  const agree = yes == null || bot === "WAIT" ? null : (bot === "YES") === kalshiUp;
  const no = yes == null ? null : 1 - yes;
  return (
    <article className="flex h-full flex-col border border-line bg-surface p-4">
      <p className="text-[11px] tracking-[0.18em] text-muted">SPOT MODEL / KALSHI</p>
      <p className="text-[11px] text-muted">Same window. Different settlement. Kalshi uses the BRTI average, not the Coinbase print.</p>
      {yes == null ? (
        <p className="mt-3 text-sm text-warn">Kalshi quote is not fresh for this window.</p>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs text-muted">OUR BOT</p>
            <p className={`font-mono text-2xl ${botTone}`}>{bot}</p>
            <p className="font-mono text-sm text-muted">{end?.pUp == null ? "—" : `${Math.round(end.pUp * 100)}% above open`}</p>
          </div>
          <div>
            <p className="text-xs text-muted">KALSHI</p>
            <p className={`font-mono text-lg ${kalshiUp ? "text-up" : "text-down"}`}>YES {cents(yes)} / {Math.round(yes * 100)}%</p>
            <p className={`font-mono text-lg ${!kalshiUp ? "text-down" : "text-up"}`}>NO {cents(no)} / {Math.round((no ?? 0) * 100)}%</p>
            <p className="text-sm">{kalshiUp ? "Market lean: UP" : "Market lean: DOWN"}</p>
          </div>
        </div>
      )}
      {agree == null ? null : <p className={`mt-3 text-sm ${agree ? "text-up" : "text-warn"}`}>{agree ? "Same directional lean, different settlement targets." : "Different leans. Spot close and BRTI settlement are different targets."}</p>}
      {delta != null ? <p className={`mt-1 font-mono text-xs ${delta > 0 ? "text-up" : delta < 0 ? "text-down" : "text-muted"}`}>YES moved {delta > 0 ? "+" : ""}{Math.round(delta * 100)}¢ over the saved samples.</p> : null}
      <KalshiSpark points={path} />
      <button type="button" className="mt-2 text-left text-xs tracking-widest text-accent" onClick={() => setOpen((v) => !v)}>{open ? "HIDE MARKET DETAILS" : "MARKET DETAILS"}</button>
      {open && quote ? (
        <p className="mt-2 font-mono text-xs text-muted">
          Best buyer {cents(quote.yesBid)} · Best seller {cents(quote.yesAsk)} · Spread {quote.yesBid != null && quote.yesAsk != null ? `${Math.round((quote.yesAsk - quote.yesBid) * 100)}¢` : "—"}
        </p>
      ) : null}
    </article>
  );
}

function KalshiSpark({ points }: { points: { t: number; yes: number }[] }) {
  if (points.length < 2) return <p className="mt-2 text-xs text-muted">Kalshi movement chart fills in as prices are saved.</p>;
  const ys = points.map((p) => p.yes);
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const w = 240;
  const h = 48;
  const d = points.map((p, i) => {
    const x = (i / (points.length - 1)) * w;
    const y = h - ((p.yes - min) / Math.max(max - min, 0.01)) * (h - 4) - 2;
    return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="mt-2 h-12 w-full" role="img" aria-label="Kalshi YES price">
      <path d={d} fill="none" stroke="currentColor" className="text-accent" strokeWidth="1.5" />
    </svg>
  );
}

function tight(n: number) {
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function finishedStamps(now: number, groups: Candle[][]) {
  const limit = Math.floor(now / 1000 / 60) * 60 - 60;
  const have = new Set<number>();
  for (const rows of groups) {
    for (const candle of rows) {
      if (candle.t <= limit && candle.t % 60 === 0) have.add(candle.t);
    }
  }
  let end = limit;
  while (end > limit - 3_600 && !have.has(end)) end -= 60;
  return Array.from({ length: 15 }, (_, i) => end - (14 - i) * 60);
}

function FinishedMinutes({ label, candles, stamps, color }: { label: string; candles: Candle[]; stamps: number[]; color: string }) {
  const byTime = new Map(candles.map((c) => [c.t, c]));
  const rows = stamps.map((t) => byTime.get(t) ?? null);
  const known = rows.filter((c): c is Candle => c != null);
  const up = known.filter((c) => c.c > c.o).length;
  const down = known.filter((c) => c.c < c.o).length;
  const upPct = known.length ? Math.round((up / known.length) * 100) : null;
  const downPct = known.length ? Math.round((down / known.length) * 100) : null;
  const side = upPct == null ? "—" : upPct >= 60 ? "UP DOMINANCE" : (downPct ?? 0) >= 60 ? "DOWN DOMINANCE" : "MIXED";
  const tone = side.startsWith("UP") ? "text-up" : side.startsWith("DOWN") ? "text-down" : "text-warn";
  return (
    <article className="flex h-full flex-col border border-line bg-surface p-4" style={{ borderTopColor: color, borderTopWidth: 2 }}>
      <p className="text-[11px] tracking-[0.16em]" style={{ color }}>LAST 15 FINISHED 1-MINUTE {label} CANDLES</p>
      <p className={`mt-2 min-h-5 font-mono text-sm ${tone}`}>{side}{upPct == null ? "" : ` · ${upPct}% up · ${downPct}% down`}</p>
      <p className="min-h-5 text-sm text-muted">{known.length ? `${up} closed up, ${down} closed down, of 15.` : "Waiting for these 15 minutes."}</p>
      <div className="mt-3">
        <table className="w-full table-fixed border-collapse font-mono text-[11px]">
          <thead className="text-left text-muted">
            <tr className="border-b border-line">
              <th className="w-[18%] px-1 py-1.5 font-normal">Time</th>
              <th className="w-[16%] px-1 py-1.5 font-normal">Open</th>
              <th className="w-[16%] px-1 py-1.5 font-normal">High</th>
              <th className="w-[16%] px-1 py-1.5 font-normal">Low</th>
              <th className="w-[16%] px-1 py-1.5 font-normal">Close</th>
              <th className="w-[18%] px-1 py-1.5 font-normal">Move</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c, i) => {
              const t = stamps[i] ?? 0;
              const when = new Date(t * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
              if (c == null) {
                return (
                  <tr key={t} className="h-6 border-b border-line text-muted">
                    <td className="truncate px-1" style={{ color }}>{when}</td>
                    <td className="px-1">—</td>
                    <td className="px-1">—</td>
                    <td className="px-1">—</td>
                    <td className="px-1">—</td>
                    <td className="truncate px-1">—</td>
                  </tr>
                );
              }
              const upRow = c.c >= c.o;
              const span = c.h - c.l;
              const nearHigh = span > 0 && c.h - c.c <= span * 0.25;
              const nearLow = span > 0 && c.c - c.l <= span * 0.25;
              return (
                <tr key={t} className={`h-6 border-b border-line ${upRow ? "text-up" : "text-down"}`}>
                  <td className="truncate px-1" style={{ color }}>{when}</td>
                  <td className="truncate px-1">{tight(c.o)}</td>
                  <td className="truncate px-1">{tight(c.h)}</td>
                  <td className="truncate px-1">{tight(c.l)}</td>
                  <td className="truncate px-1">{tight(c.c)}</td>
                  <td className="truncate px-1">{upRow ? "up" : "down"}{nearHigh && upRow ? " hi" : ""}{nearLow && !upRow ? " lo" : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </article>
  );
}

export function Plan({ initial }: { initial: Snapshot }) {
  const query = useQuery({ queryKey: ["btc-snapshot"], queryFn: () => getSnapshot(), initialData: initial, refetchInterval: 15_000 });
  const [scores, setScores] = useState<Record<string, PatternScore>>({});
  const [spot, setSpot] = useState<number | null>(initial.spot);
  const alts = useQuery({ queryKey: ["alt-minutes"], queryFn: () => getAltMinutes(), refetchInterval: 20_000 });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => startCoinbaseFeed(), []);
  useEffect(() => useLive.subscribe((s) => setSpot(s.price)), []);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const win = windowStartSec(now);
  const start = query.data.candles.find((c) => c.t === win)?.o ?? null;
  const plan = pathPlan({ candles: query.data.candles, spot, start, now, windowEndSec: win + 900 });
  const candleSignal = useMemo(
    () => analyzeCandles({ candles: query.data.candles, spot, nowSec: Math.floor(now / 1000), start, secsLeft: Math.max(0, win + 900 - now / 1000) }),
    [query.data.candles, spot, now, start, win],
  );
  useEffect(() => {
    const prev = loadCandleLog();
    const next = settleCandleLog(captureCandleLog(prev, {
      now, start: win, signal: candleSignal, price: spot, startPx: start,
    }), query.data.candles, now);
    if (next !== prev) saveCandleLog(next);
    setScores(patternScores(next));
  }, [now, spot, start, win, query.data.candles, candleSignal]);
  return (
    <main className="min-h-screen bg-bg text-fg">
      <div className="page-wrap">
        <DeskNav here="plan" />
        <div className="flex flex-wrap items-end justify-between gap-2">
          <p className="max-w-xl text-sm text-muted">Uncalibrated Coinbase estimates. UP means the model expects a higher price. DOWN means lower. FLAT means too close to call. Not a trade instruction.</p>
          <p className="font-mono text-sm text-muted">Live {money(spot)} · window open {money(start)} · {plan.minutesLeft == null ? "—" : `${Math.round(plan.minutesLeft)} min left`}</p>
        </div>
        {!plan.ready ? <p className="border border-line bg-surface p-4 text-sm">Need a live price and 60 finished minutes before these numbers are shown.</p> : null}
        <section className="grid items-start gap-3 xl:grid-cols-3">
          <Card row={plan.five} chance="CHANCE HIGHER THAN NOW" note="Where the model expects Coinbase BTC in 5 minutes, versus the price right now." />
          <Card row={plan.end} chance="CHANCE FINISH ABOVE THE OPEN" note="Whether the model expects this 15-minute window to finish strictly above its Coinbase open." />
          <KalshiCompare market={query.data.market} bookAt={query.data.bookAt} now={now} win={win} end={plan.end} />
        </section>
        <section className="grid items-stretch gap-3 xl:grid-cols-3">
          <FinishedMinutes label="BTC" candles={query.data.candles} stamps={finishedStamps(now, [query.data.candles, alts.data?.eth ?? [], alts.data?.sol ?? []])} color="#5b8def" />
          <FinishedMinutes label="ETH" candles={alts.data?.eth ?? []} stamps={finishedStamps(now, [query.data.candles, alts.data?.eth ?? [], alts.data?.sol ?? []])} color="#e6c200" />
          <FinishedMinutes label="SOL" candles={alts.data?.sol ?? []} stamps={finishedStamps(now, [query.data.candles, alts.data?.eth ?? [], alts.data?.sol ?? []])} color="#b57bff" />
        </section>
        {alts.data?.error ? <p className="text-sm text-warn">{alts.data.error}</p> : null}
        <section className="grid items-stretch gap-3 xl:grid-cols-2">
          <CandleRead signal={candleSignal} scores={scores} />
          <div className="flex flex-col gap-3">
            <ProjectedOutcome signal={candleSignal} candles={query.data.candles} spot={spot} nowSec={Math.floor(now / 1000)} scores={scores} />
            <FlipWatch />
          </div>
        </section>
      </div>
    </main>
  );
}
