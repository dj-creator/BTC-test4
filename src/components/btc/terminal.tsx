import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { startCoinbaseFeed, useBook, useFlow, useLive, priceAgo, type BookView, type FlowTrade, type LiqPrint } from "@/lib/btc/live";
import { outlookNow } from "@/lib/btc/outlook";
import { readPulse, type Lean } from "@/lib/btc/pulse";
import { readWhales } from "@/lib/btc/intel";
import { getAltSettled, getSnapshot } from "@/lib/btc/snapshot";
import { startRadar, useRadar, type RadarReading } from "@/lib/btc/radar";
import type { Candle, SettledWindow, Snapshot } from "@/lib/btc/types";
import { PriceChart } from "./chart";
import { DeskNav } from "./plan";

import { captureForecast, settleForecasts, evaluationSummary, parseForecasts, type ForecastRecord } from "@/lib/btc/evaluation";
import { analyzeCandles, captureCandleLog, loadCandleLog, saveCandleLog, settleCandleLog, type CandleSignal } from "@/lib/btc/candles";
import { aggregate, atr, readTech, secondCandles, tickCandles, tickNudge } from "@/lib/btc/ta";
import { loadEntries, noteEntry, readEntry, saveEntries, trackEntries } from "@/lib/btc/entry";
import { capturePaper, loadPaper, savePaper, settlePaper } from "@/lib/btc/paper";

const STORE = "btc-window-frozen-v2";

type Frozen = ForecastRecord;

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

function compact(n: number) {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${Math.round(n / 1000)}k`;
  return `$${Math.round(n)}`;
}

function windowStartSec(now = Date.now()) {
  return Math.floor(now / 1000 / 900) * 900;
}

function startPrice(candles: Candle[], start: number) {
  const exact = candles.find((c) => c.t === start);
  if (exact) return exact.o;
  const inside = candles.find((c) => c.t >= start && c.t < start + 60);
  return inside?.o ?? null;
}

function withLiveCandle(candles: Candle[], px: number | null, nowSec: number) {
  const from = windowStartSec(nowSec * 1000);
  const pool = candles.filter((c) => c.t >= from && c.t < from + 900);
  if (px == null || pool.length === 0) return pool;
  const bucket = Math.floor(nowSec / 60) * 60;
  const last = pool[pool.length - 1];
  if (!last) return pool;
  if (last.t === bucket) {
    const next = pool.slice();
    next[next.length - 1] = { ...last, c: px, h: Math.max(last.h, px), l: Math.min(last.l, px) };
    return next;
  }
  if (bucket > last.t && bucket < from + 900) return [...pool, { t: bucket, o: last.c, h: Math.max(last.c, px), l: Math.min(last.c, px), c: px, v: 0 }];
  return pool;
}

function leanMark(lean: Lean) {
  if (lean === "yes") return "▲ YES";
  if (lean === "no") return "▼ NO";
  return "— WAIT";
}

function leanClass(lean: Lean | "warn") {
  if (lean === "yes") return "text-up";
  if (lean === "no") return "text-down";
  if (lean === "warn") return "text-warn";
  return "text-muted";
}

function loadFrozen(): Frozen[] {
  try {
    return parseForecasts(localStorage.getItem(STORE));
  } catch {
    return [];
  }
}

function saveFrozen(rows: Frozen[]) {
  try { localStorage.setItem(STORE, JSON.stringify(rows)); return true; }
  catch { return false; }
}

export function Terminal({ initial }: { initial: Snapshot }) {
  const query = useQuery({
    queryKey: ["btc-snapshot"],
    queryFn: () => getSnapshot(),
    initialData: initial,
    refetchInterval: 10_000,
  });
  const [spot, setSpot] = useState<number | null>(initial.spot);
  const [spotAt, setSpotAt] = useState<number | null>(initial.spotAt);
  const [storageOk, setStorageOk] = useState(true);
  const [flow, setFlow] = useState<{ trades: FlowTrade[]; liqs: LiqPrint[]; book: BookView }>({
    trades: [],
    liqs: [],
    book: { status: "connecting", bidNear: 0, askNear: 0, imbalance: null, spread: null, updatedAt: null },
  });
  const [win, setWin] = useState(() => windowStartSec(initial.fetchedAt));
  const [now, setNow] = useState<number | null>(null);
  const [frozen, setFrozen] = useState<Frozen[]>([]);
  const [core, setCore] = useState(false);
  const [tvInterval, setTvInterval] = useState("off");
  const [tf, setTf] = useState<1 | 5 | 15 | "1s" | "10t" | "100t">("10t");
  const [showEma, setShowEma] = useState(true);
  const [showVwap, setShowVwap] = useState(true);
  const candles = query.data.candles;
  const dayCandles = query.data.dayCandles ?? [];
  const start = startPrice(candles, win);
  const currentMarket = query.data.market;
  const marketMatches = currentMarket != null && currentMarket.openTime <= (now ?? initial.fetchedAt) && currentMarket.closeTime > (now ?? initial.fetchedAt) && Math.abs(currentMarket.closeTime / 1000 - win - 900) < 1;

  useEffect(() => startCoinbaseFeed(), []);
  useEffect(() => startRadar(), []);
  useEffect(() => setFrozen(loadFrozen()), []);
  useEffect(() => {
    if (!candles.length) return;
    useLive.getState().seedHistory(candles.filter((c) => (c.t + 60) * 1000 <= Date.now()).slice(-20).map((c) => ({ t: c.t * 1000 + 59_000, px: c.c })));
  }, [candles]);
  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => {
      const live = useLive.getState();
      const book = useBook.getState();
      const useStream = (live.tickAt ?? 0) >= (query.data.spotAt ?? 0);
      setSpot(useStream ? live.price : query.data.spot);
      setSpotAt(useStream ? live.tickAt : query.data.spotAt);
      setFlow({
        trades: useFlow.getState().trades,
        liqs: useFlow.getState().liqs,
        book: {
          status: book.status,
          bidNear: book.bidNear,
          askNear: book.askNear,
          imbalance: book.imbalance,
          spread: book.spread,
          updatedAt: book.updatedAt,
        },
      });
      setNow(Date.now());
      const next = windowStartSec();
      setWin((prev) => (prev === next ? prev : next));
    }, 1000);
    return () => window.clearInterval(id);
  }, [query.data.spot, query.data.spotAt]);

  useEffect(() => {
    if (query.data.spotAt != null && (useLive.getState().tickAt ?? 0) < query.data.spotAt) {
      setSpot(query.data.spot);
      setSpotAt(query.data.spotAt);
    }
  }, [query.data.spot, query.data.spotAt]);

  const clock = now ?? 0;
  const candleSignal = useMemo(
    () => analyzeCandles({ candles, spot, nowSec: Math.floor((clock || Date.now()) / 1000), start, secsLeft: clock ? Math.max(0, win + 900 - clock / 1000) : null }),
    [candles, spot, start, win, clock],
  );
  const radar = useRadar((s) => s.reading);
  const pulse = useMemo(
    () => readPulse({ price: spot, samples: useLive.getState().samples, trades: flow.trades, liqs: flow.liqs, book: flow.book, start, now: clock || Date.now() }),
    [spot, flow, start, clock],
  );
  const view = useMemo(() => {
    return outlookNow({
      candles,
      spot,
      start,
      windowStart: win,
      spotAt,
      now: clock || Date.now(),
    });
  }, [candles, spot, spotAt, start, win, clock]);
  const whales = useMemo(() => readWhales(flow.trades, flow.liqs, clock || Date.now()), [flow, clock]);

  useEffect(() => {
    if (now == null) return;
    setFrozen((prev) => settleForecasts(captureForecast(prev, {
      now, start: win, pUp: view.model.paused ? null : view.model.pUp, price: spot, startPx: start,
    }), candles, now));
  }, [now, spot, start, view.model.paused, view.model.pUp, win, candles]);

  useEffect(() => { if (frozen.length) setStorageOk(saveFrozen(frozen)); }, [frozen]);
  useEffect(() => {
    if (now == null) return;
    const prev = loadCandleLog();
    const next = settleCandleLog(captureCandleLog(prev, {
      now, start: win, signal: candleSignal, price: spot, startPx: start,
    }), candles, now);
    if (next !== prev) saveCandleLog(next);
  }, [now, spot, start, win, candles, candleSignal]);

  const signal = view.outlook.signal;
  const lean: Lean = signal === "up" ? "yes" : signal === "down" ? "no" : "wait";
  const pct = view.outlook.confidence == null ? null : Math.round(view.outlook.confidence * 100);
  const move = spot != null && start != null ? spot - start : null;
  const left = now == null ? null : Math.max(0, (win + 900) * 1000 - now);
  const windowCandles = withLiveCandle(candles, spot, Math.floor((now ?? Date.now()) / 1000));
  useEffect(() => {
    if (now == null) return;
    const market = marketMatches ? currentMarket : null;
    const bookFresh = query.data.bookAt != null && now - query.data.bookAt <= 30_000;
    const yesAsk = bookFresh && market?.yesAsk != null && market.yesAsk > 0 && market.yesAsk < 1 ? market.yesAsk : null;
    const yesBid = bookFresh && market?.yesBid != null && market.yesBid > 0 && market.yesBid < 1 ? market.yesBid : null;
    const yesPx = yesAsk != null && yesBid != null ? (yesAsk + yesBid) / 2 : yesAsk;
    const call = lean === "yes" ? "YES" : lean === "no" ? "NO" : "WAIT";
    const prev = loadPaper();
    const next = settlePaper(capturePaper(prev, {
      now,
      start: win,
      call,
      yesPx,
      startPx: start,
      pUp: view.model.pUp,
    }), candles, now);
    if (next !== prev) savePaper(next);
  }, [now, win, lean, start, candles, marketMatches, currentMarket, query.data.bookAt, view.model.pUp]);
  const secs = left == null ? null : left / 1000;
  const sigma = view.model.paused ? null : view.model.sigmaDollar;
  const typical = sigma != null && secs != null ? sigma * Math.sqrt(Math.max(secs, 1) / 900) : null;
  const room = move == null ? null : Math.abs(move);
  const fallingTowardLine = move != null && pulse.moves.find((row) => row.ms === 30_000)?.delta != null && Math.sign(move) !== 0 && Math.sign(pulse.moves.find((row) => row.ms === 30_000)?.delta ?? 0) !== Math.sign(move);
  let flipLevel: "LOW" | "POSSIBLE" | "HIGH" | "UNKNOWN" = "UNKNOWN";
  if (room != null && typical != null && secs != null) {
    const tight = room < Math.max(typical * 1.3, 12);
    const safe = room > Math.max(typical * 2.2, 25);
    flipLevel = tight && fallingTowardLine ? "HIGH" : tight || (fallingTowardLine && secs < 180) ? "POSSIBLE" : safe ? "LOW" : "POSSIBLE";
  }
  const flip = {
    level: flipLevel,
    zone: start != null && typical != null ? ([start - typical, start + typical] as [number, number]) : null,
    typical,
  };
  const nowSec = Math.floor((now ?? Date.now()) / 1000);
  const chartCandles = tf === "1s"
    ? secondCandles(useLive.getState().samples, flow.trades, now ?? Date.now(), spot)
    : tf === "10t" || tf === "100t"
      ? tickCandles(flow.trades, tf === "100t" ? 100 : 10)
      : aggregate(candles, tf, spot, nowSec);
  const tick = tickNudge(flow.trades);
  const tech = readTech(chartCandles, spot, pulse.moves);
  const entryTech = readTech(aggregate(candles, 1, spot, nowSec), spot, pulse.moves);
  const kalshiTarget = marketMatches ? currentMarket?.strike ?? null : null;
  const d30 = pulse.moves.find((row) => row.ms === 30_000)?.delta ?? null;
  const d300 = pulse.moves.find((row) => row.ms === 300_000)?.delta ?? null;
  const whaleLean = pulse.alignment.find((row) => row.label === "Large Trades")?.lean ?? "wait";
  const bookLean = pulse.alignment.find((row) => row.label === "Order Book")?.lean ?? "wait";
  const downCase: string[] = [];
  const upCase: string[] = [];
  if (move != null && move < -0.005) downCase.push(`BTC is ${money(Math.abs(move))} below the Coinbase window open.`);
  if (move != null && move > 0.005) upCase.push(`BTC is ${money(move)} above the Coinbase window open.`);
  if (spot != null && tech.vwap != null && spot < tech.vwap) downCase.push("Price is below VWAP.");
  if (spot != null && tech.vwap != null && spot > tech.vwap) upCase.push("Price is above VWAP.");
  if (d30 != null && d30 < -8) downCase.push("30-second momentum is negative.");
  if (d30 != null && d30 > 8) upCase.push("30-second momentum is positive.");
  if (whaleLean === "no") downCase.push("Recent large-trade flow favors sellers.");
  if (whaleLean === "yes") upCase.push("Recent large-trade flow favors buyers.");
  if (d300 != null && d300 > 8) upCase.push("Five-minute BTC movement remains positive.");
  if (d300 != null && d300 < -8) downCase.push("Five-minute BTC movement is negative.");
  if (tick.nudge > 0.005) upCase.push("The 10-tick tape is pointing up.");
  if (tick.nudge < -0.005) downCase.push("The 10-tick tape is pointing down.");
  if (radar.bias === "UP" || radar.bias === "STRONG UP") upCase.push("Most watched major coins are moving up.");
  if (radar.bias === "DOWN" || radar.bias === "STRONG DOWN") downCase.push("Most watched major coins are moving down.");
  const gapKalshi = spot != null && kalshiTarget != null ? spot - kalshiTarget : null;
  const reach = gapKalshi != null && typical != null ? Math.abs(gapKalshi) <= typical : null;
  const minuteAtr = atr(aggregate(candles, 1, spot, nowSec));
  const sigma15 = sigma ?? (minuteAtr != null ? minuteAtr * Math.sqrt(15) : null);
  const flipPct = flipChance(move, secs, sigma15, d30);

  return (
    <main className="min-h-screen bg-bg text-fg">
      <div className="page-wrap desk-wrap">
        <Guide />
        <DeskNav here="desk" />
        <LiveTape />

        <section className="grid items-start gap-4 lg:grid-cols-10">
          <div className="flex flex-col gap-4 lg:col-span-7">
          <article className="relative overflow-hidden border border-line bg-surface p-4">
            <p className="px-1 text-[11px] tracking-[0.18em] text-muted">LIVE CHART</p>
            <div className="flex flex-wrap gap-2 px-1 text-[11px] tracking-widest">
              <button type="button" className={tf === "10t" ? "text-fg" : "text-muted"} onClick={() => setTf("10t")}>10T</button>
              <button type="button" className={tf === "100t" ? "text-fg" : "text-muted"} onClick={() => setTf("100t")}>100T</button>
              <button type="button" className={tf === "1s" ? "text-fg" : "text-muted"} onClick={() => setTf("1s")}>1S</button>
              {([1, 5, 15] as const).map((n) => (
                <button key={n} type="button" className={tf === n ? "text-fg" : "text-muted"} onClick={() => setTf(n)}>{n}M</button>
              ))}
              <button type="button" className={showEma ? "text-[#7eb6ff]" : "text-muted"} onClick={() => setShowEma((v) => !v)}>EMA 9</button>
              <button type="button" className={showEma ? "text-[#c084fc]" : "text-muted"} onClick={() => setShowEma((v) => !v)}>EMA 21</button>
              <button type="button" className={showVwap ? "text-fg" : "text-muted"} onClick={() => setShowVwap((v) => !v)}>VWAP</button>
            </div>
            <p className="px-1 font-mono text-xs text-muted">Coinbase window open {money(start)} · Kalshi target {money(kalshiTarget)}</p>
            <div className="flex gap-2">
              <div className="min-w-0 flex-1">
                <PriceChart candles={chartCandles} start={start} current={spot} kalshi={kalshiTarget} ema9={tech.ema9} ema21={tech.ema21} vwap={tech.vwapLine} showEma={showEma} showVwap={showVwap} band={flip.zone} tall seconds={tf === "1s"} />
              </div>
              <ul className="hidden w-28 shrink-0 space-y-2 pt-6 font-mono text-[11px] leading-tight sm:block">
                <li className="text-[#7eb6ff]">EMA 9<br /><span className="text-muted">fast average</span></li>
                <li className="text-[#c084fc]">EMA 21<br /><span className="text-muted">slow average</span></li>
                <li className="text-[#d7d2c8]">VWAP<br /><span className="text-muted">paid-price line</span></li>
                <li className="text-accent">COINBASE OPEN<br /><span className="text-muted">dashed</span></li>
                <li className="text-warn">KALSHI TARGET<br /><span className="text-muted">dashed</span></li>
                <li className="text-up">NOW<br /><span className="text-muted">live price</span></li>
              </ul>
            </div>
            <ul className="flex flex-wrap gap-x-3 gap-y-1 px-1 font-mono text-[11px] sm:hidden">
              <li className="text-[#7eb6ff]">EMA 9 fast</li>
              <li className="text-[#c084fc]">EMA 21 slow</li>
              <li className="text-[#d7d2c8]">VWAP</li>
              <li className="text-accent">OPEN dashed</li>
              <li className="text-warn">KALSHI dashed</li>
              <li className="text-up">NOW</li>
            </ul>
            {tf === "1s" ? <p className="px-1 text-[11px] text-muted">1-second candles come from live Coinbase trades since this page opened. Seconds with no trade stay flat.</p> : null}
            {tf === "10t" || tf === "100t" ? <p className="px-1 text-[11px] text-muted">{tf === "10t" ? "Main tape. One candle is 10 trades." : "Smoother tape. One candle is 100 trades. Used only to check the 10-tick direction."} {tick.note}</p> : null}
            <p className="mt-2 px-1 text-xs text-muted">Coinbase spot-close forecast. Kalshi settles from the final 60-second BRTI average; Coinbase can disagree. {marketMatches && currentMarket.strike != null ? `Official target ${money(currentMarket.strike)} · ${currentMarket.strikeRule === "greater_or_equal" ? "at or above" : currentMarket.strikeRule === "greater" ? "strictly above" : "check market rules"}.` : "Official target unavailable."}</p>
            <button type="button" className="mt-2 px-1 text-xs tracking-widest text-accent" onClick={() => setTvInterval(tvInterval === "off" ? "1" : "off")}>
              {tvInterval === "off" ? "SHOW TRADINGVIEW" : "HIDE TRADINGVIEW"}
            </button>
            {tvInterval !== "off" ? (
              <iframe
                title="TradingView BTC"
                className="mt-2 h-[420px] w-full"
                src={`https://s.tradingview.com/widgetembed/?symbol=COINBASE%3ABTCUSD&interval=${tvInterval === "today" ? "5" : tvInterval}&theme=dark&style=1&hideideas=1`}
              />
            ) : null}
          </article>
          <section className="grid gap-3 sm:grid-cols-2">
            <EntryRadar
              spot={spot}
              spotAt={spotAt}
              start={start}
              now={now ?? Date.now()}
              secs={secs}
              windowStart={win}
              candles={candles}
              samples={useLive.getState().samples}
              pulse={pulse}
              tech={entryTech}
              candle={candleSignal}
              radar={radar.bias}
              market={marketMatches ? currentMarket : null}
              bookAt={query.data.bookAt}
              flip={flip.level}
            />
            <article className="border border-line bg-surface p-4">
              <p className="text-[11px] tracking-[0.18em] text-muted">SIGNALS <Hint text="These lights explain the picture. They are not added up to make the percentage." /></p>
              <ul className="mt-2 space-y-1 text-sm">
                {pulse.alignment.map((row) => {
                  const named = plainSignal(row.label);
                  return (
                    <li key={row.label} className="flex items-start justify-between gap-3">
                      <span>
                        <span className="block">{named.name}</span>
                        {named.term ? <span className="block text-[11px] leading-tight text-muted">{named.term}</span> : null}
                      </span>
                      <span className={leanClass(row.lean)}>{row.lean === "yes" ? "↑ UP" : row.lean === "no" ? "↓ DOWN" : "→ QUIET"}</span>
                    </li>
                  );
                })}
              </ul>
            </article>
          </section>
          </div>
          <div className="flex flex-col gap-4 lg:col-span-3">
          <article className={`border bg-surface/80 p-4 ${lean === "yes" ? "border-up/40" : lean === "no" ? "border-down/40" : "border-line"}`}>
            <p className="text-[11px] tracking-[0.18em] text-muted">PREDICTION</p>
            <p className="mt-2 text-sm">Will BTC finish above the start line?</p>
            <p className={`mt-3 text-center font-mono text-5xl ${leanClass(lean)}`}>{lean === "yes" ? "YES" : lean === "no" ? "NO" : "WAIT"}</p>
            <p className="text-center text-xs tracking-widest text-muted">MODEL ESTIMATE · UP</p>
            <p className="text-center font-mono text-3xl">{pct == null ? "—" : `${pct}%`}</p>
            <p className="mt-2 text-center text-xs text-warn">EXPERIMENTAL · UNCALIBRATED</p>
            <p className="mt-1 text-center text-[11px] leading-snug text-muted">This is the model estimate for Coinbase finishing above its window open. Radar, candle patterns, order flow, and Kalshi prices are excluded from the probability.</p>
            <TimerRing leftMs={left} />
            {view.model.paused ? <p role="status" className="mt-2 text-sm text-warn">Estimate paused: {view.model.reason}</p> : null}
            {secs != null && secs <= 60 ? <p className="mt-2 border border-warn p-2 text-sm text-warn">SETTLEMENT MINUTE · Spot forecast only. Official BRTI running average unavailable.</p> : <p className="mt-2 text-center text-xs text-muted">Settlement minute in {secs == null ? "—" : `${Math.max(0, Math.ceil(secs - 60))}s`}</p>}
            <p className="mt-2 text-xs text-muted">60 completed one-minute returns · {view.model.volLabel}</p>
            <p className={`mt-3 text-center font-mono text-sm ${move != null && move > 0.005 ? "text-up" : move != null && move < -0.005 ? "text-down" : "text-muted"}`}>
              {move == null
                ? "Waiting for the start line"
                : Math.abs(move) < 0.005
                  ? "$0.00 ON THE LINE"
                  : `${signed(move)} ${move > 0 ? "ABOVE" : "BELOW"} THE LINE`}
            </p>
            <p className="mt-2 text-xs tracking-widest text-muted">WHY THE MODEL LEANS {lean === "yes" ? "UP" : lean === "no" ? "DOWN" : "WAIT"}</p>
            <p className="text-[11px] text-muted">These points match the numbers above. They are not a calibrated probability.</p>
            <p className="mt-1 text-xs tracking-widest text-muted">WHAT SUPPORTS {lean === "yes" ? "UP" : "DOWN"}</p>
            <ul className="text-sm">
              {(lean === "yes" ? upCase : downCase).slice(0, 4).map((line) => <li key={line}>{line}</li>)}
              {(lean === "yes" ? upCase : downCase).length === 0 ? <li>Not enough aligned evidence yet.</li> : null}
            </ul>
            <p className="mt-2 text-xs tracking-widest text-muted">WHAT ARGUES AGAINST IT</p>
            <ul className="text-sm">
              {(lean === "yes" ? downCase : upCase).slice(0, 3).map((line) => <li key={line}>{line}</li>)}
              {(lean === "yes" ? downCase : upCase).length === 0 ? <li>No clear opposing signal yet.</li> : null}
            </ul>
          </article>
          <article className="border border-line bg-surface p-4">
            <p className="text-[11px] tracking-[0.18em] text-muted">WHAT IS HAPPENING RIGHT NOW?</p>
            <ul className="mt-2 space-y-1 text-sm">
              <MoveLine label="Past 30 Seconds" delta={pulse.moves.find((row) => row.ms === 30_000)?.delta ?? null} />
              <MoveLine label="Past 1 Minute" delta={pulse.moves.find((row) => row.ms === 60_000)?.delta ?? null} />
              <MoveLine label="Past 5 Minutes" delta={pulse.moves.find((row) => row.ms === 300_000)?.delta ?? null} />
              <li className={move != null && move > 0.005 ? "text-up" : move != null && move < -0.005 ? "text-down" : "text-muted"}>
                {move == null ? "Start line not ready." : Math.abs(move) < 0.005 ? "It is on the start line." : move > 0 ? `It is ${money(move)} above the start line.` : `It is ${money(Math.abs(move))} below the start line.`}
              </li>
              <li className={flip.level === "HIGH" || flip.level === "POSSIBLE" ? "text-warn" : "text-muted"}>
                {flip.level === "HIGH" || flip.level === "POSSIBLE" ? "The result could flip if the current push continues." : "A flip does not look close right now."}
              </li>
              <li className="text-muted">{whales.events.length ? "A few trades were much larger than normal." : "No unusually large trades just happened."}</li>
            </ul>
            <p className="mt-3 text-sm">SYSTEM READ — {lean === "wait" ? "Signals are mixed. Waiting is safer than pretending we know." : flip.level === "HIGH" ? "The current side is in danger of flipping." : "The call can still change before the timer ends."}</p>
          </article>
          </div>
        </section>

        <section className="grid items-stretch gap-4 lg:grid-cols-3">
          <FlipChance pct={flipPct} move={move} secs={secs} typical={sigma15 != null && secs != null ? sigma15 * Math.sqrt(Math.max(secs, 1) / 900) : null} signal={candleSignal} />
          <MarketRadar />
          <MarketRead tech={tech} radarBias={radar.bias} bookLean={bookLean} whaleLean={whaleLean} move={move} flip={flip.level} spot={spot} />
        </section>

        <TargetBoard spot={spot} start={start} kalshiTarget={kalshiTarget} secs={secs} typical={typical} reach={reach} gapKalshi={gapKalshi} />

        <FastMoves />

        <PriorMarkets rows={query.data.history ?? []} move={move} />

        <article className="border border-line bg-surface p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[11px] tracking-[0.18em] text-muted">BIG MONEY DIRECTION</p>
              <p className="text-[11px] text-muted">Large-Trade / Whale Flow</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full border border-line font-mono text-lg text-accent" aria-hidden="true">$</span>
              <span className={`coin ${whales.label === "sellers" ? "coin-sell" : whales.label === "buyers" ? "coin-buy" : "coin-quiet"}`} aria-hidden="true">
                <span className="coin-face coin-front" />
                <span className="coin-face coin-back" />
              </span>
              <svg viewBox="0 0 64 32" className={`h-8 w-14 ${whales.label === "buyers" ? "text-up" : whales.label === "sellers" ? "text-down" : "text-muted"}`} aria-hidden="true">
                <ellipse cx="26" cy="18" rx="16" ry="8" fill="currentColor" />
                <path fill="currentColor" d="M40 14c8 0 16 3 20 8-8 0-14-2-20-6z" />
                <path fill="currentColor" d="M8 16c-4 2-6 6-6 6 4 0 8-2 10-5z" />
                <circle cx="16" cy="16" r="1.3" fill="#07080b" />
              </svg>
            </div>
          </div>
          {whales.events.length === 0 ? (
            <p className="mt-3 text-sm text-muted">Quiet. No unusually large trades detected recently.</p>
          ) : (
            <ul className="mt-3 space-y-1 text-sm">
              {whales.events.map((event) => (
                <li key={event.id} className="flex justify-between font-mono text-xs">
                  <span className={event.kind === "market-buy" || event.kind === "short-liq" ? "text-up" : "text-down"}>{event.note}</span>
                  <span>{compact(event.usd)}</span>
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className="border border-line bg-surface p-4">
          <p className="text-[11px] tracking-[0.18em] text-muted">TODAY</p>
          <DayStats candles={dayCandles} price={spot} windowStart={win} />
          <PriceChart candles={dayCandles.slice(-48)} start={null} current={spot} shadeFrom={win} />
        </article>

        <Recent frozen={frozen} />
        {!storageOk ? <p role="status" className="text-sm text-warn">Browser storage is unavailable. Predictions remain in memory only.</p> : null}
        <p className="text-xs text-muted">Spot age {spotAt == null || now == null ? "unknown" : `${Math.max(0, Math.floor((now - spotAt) / 1000))}s`} · Kalshi book age {query.data.bookAt == null || now == null ? "unknown" : `${Math.max(0, Math.floor((now - query.data.bookAt) / 1000))}s`} · Last snapshot {new Date(query.data.fetchedAt).toISOString()}</p>

        <button type="button" className="border border-line px-3 py-2 text-left text-xs tracking-widest" onClick={() => setCore((v) => !v)}>
          {core ? "HIDE ADVANCED DETAILS" : "ADVANCED DETAILS"}
        </button>
        {core ? (
          <div className="space-y-3">
            <article className="border border-line bg-surface p-4 font-mono text-xs text-muted">
              <p>VWAP side: {pulse.vwapSide}</p>
              <p>Order book: {pulse.bookText} {flow.book.spread == null ? "" : `spread ${money(flow.book.spread)}`}</p>
              <p>Near bid {compact(flow.book.bidNear)} · near ask {compact(flow.book.askNear)}</p>
              <p>Momentum: {pulse.accelText}</p>
              <p>Internal regime: {pulse.regime} · vol {pulse.vol} · reversal {pulse.reversal}</p>
              <p>Window high {money(windowCandles.reduce((m, c) => Math.max(m, c.h), 0) || null)} · low {money(windowCandles.reduce((m, c) => Math.min(m, c.l), Number.POSITIVE_INFINITY) || null)}</p>
              <p>Polymarket is hidden. It is not verified against this 15-minute window, so a missing price is not shown as 0%.</p>
            </article>
            <ModelCore frozen={frozen} />
          </div>
        ) : null}
        <footer className="flex flex-wrap justify-between gap-3 py-4 text-xs text-muted"><span>No orders are placed. Fees and slippage are not optional.</span><a className="text-accent" href="https://kalshi.com/markets/kxbtc15m" target="_blank" rel="noreferrer">View on Kalshi</a></footer>
      </div>
    </main>
  );
}

function PriorMarkets({ rows, move }: { rows: SettledWindow[]; move: number | null }) {
  const [coin, setCoin] = useState<"BTC" | "ETH" | "SOL">("BTC");
  const alts = useQuery({
    queryKey: ["alt-settled"],
    queryFn: () => getAltSettled(),
    enabled: coin !== "BTC",
    staleTime: 30_000,
  });
  const shown = coin === "BTC" ? rows : coin === "ETH" ? alts.data?.eth ?? [] : alts.data?.sol ?? [];
  const waiting = coin !== "BTC" && alts.isLoading;
  return (
    <section className="border border-line bg-surface p-4">
      <SettledBody rows={shown} move={coin === "BTC" ? move : null} coin={coin} waiting={waiting} />
      <div className="mt-3 flex w-fit border border-line">
        {(["BTC", "ETH", "SOL"] as const).map((name) => (
          <button key={name} type="button" className={`px-3 py-1 text-xs tracking-widest ${coin === name ? "bg-fg text-bg" : "text-muted"}`} onClick={() => setCoin(name)}>
            {name}
          </button>
        ))}
      </div>
    </section>
  );
}

function SettledBody({ rows, move, coin, waiting }: { rows: SettledWindow[]; move: number | null; coin: "BTC" | "ETH" | "SOL"; waiting: boolean }) {
  const yes = rows.filter((row) => row.result === "yes").length;
  const no = rows.filter((row) => row.result === "no").length;
  let streak = 0;
  const first = rows[0]?.result;
  if (first === "yes" || first === "no") {
    for (const row of rows) {
      if (row.result !== first) break;
      streak += 1;
    }
  }
  const deltas = rows
    .map((row) => (row.settle != null && row.strike != null ? row.settle - row.strike : null))
    .filter((n): n is number => n != null);
  const avg = deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : null;
  const absAvg = deltas.length ? deltas.reduce((a, b) => a + Math.abs(b), 0) / deltas.length : null;
  const basis = rows.find((row) => row.strike != null)?.strike ?? 0;
  const bias: Lean | "wait" = yes >= no + 2 ? "yes" : no >= yes + 2 ? "no" : "wait";
  const last = rows[0];
  const lastSide = last?.result === "yes" ? "yes" : last?.result === "no" ? "no" : null;
  const liveSide = move == null || Math.abs(move) < 8 ? null : move > 0 ? "yes" : "no";
  const follow =
    lastSide == null || liveSide == null ? "Not enough yet to say if this window is following the last one." : liveSide === lastSide ? "This window is still on the same side as the last settled market." : "This window has flipped versus the last settled market.";
  return (
    <>
      <p className="text-[11px] tracking-[0.18em] text-muted">LAST 10 SETTLED 15-MINUTE {coin} MARKETS</p>
      <p className="mt-1 text-sm text-muted">Kalshi windows that already closed. YES means {coin} finished at or above that window’s start line.</p>
      {waiting ? <p className="mt-2 text-sm text-muted">Loading {coin} windows.</p> : rows.length === 0 ? (
        <p className="mt-2 text-sm text-warn">Settled {coin} markets are unavailable right now.</p>
      ) : (
        <>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <div className="border border-line bg-surface-2 px-3 py-2">
              <p className="text-[11px] tracking-widest text-muted">LAST 10</p>
              <p className="font-mono text-lg">
                <span className="text-up">{yes} YES</span>
                <span className="text-muted"> · </span>
                <span className="text-down">{no} NO</span>
              </p>
            </div>
            <div className="border border-line bg-surface-2 px-3 py-2">
              <p className="text-[11px] tracking-widest text-muted">STREAK</p>
              <p className={`font-mono text-lg ${first === "yes" ? "text-up" : first === "no" ? "text-down" : "text-muted"}`}>
                {streak > 1 ? `${streak} ${first === "yes" ? "UP" : "DOWN"}` : "NO STREAK"}
              </p>
            </div>
            <div className="border border-line bg-surface-2 px-3 py-2">
              <p className="text-[11px] tracking-widest text-muted">AVERAGE FINISH</p>
              <p className={`font-mono text-lg ${avg != null && avg > 0 ? "text-up" : avg != null && avg < 0 ? "text-down" : "text-muted"}`}>{signed(avg)}</p>
            </div>
          </div>
          <ul className="mt-3 space-y-1 text-sm">
            <li className="flex justify-between gap-3">
              <span>Ten-window bias</span>
              <span className={leanClass(bias)}>{bias === "yes" ? "UP" : bias === "no" ? "DOWN" : "MIXED"}</span>
            </li>
            <li className="flex justify-between gap-3">
              <span>How decisive</span>
              <span className={absAvg != null && basis > 0 && absAvg < basis * 0.0004 ? "text-warn" : "text-muted"}>
                {absAvg == null ? "—" : basis > 0 && absAvg < basis * 0.0004 ? "TIGHT / CHOPPY" : `TYPICAL ${money(absAvg)}`}
              </span>
            </li>
            {coin === "BTC" ? <li className="text-muted">{follow}</li> : null}
            {streak >= 3 ? (
              <li className="text-warn">Three or more windows closed the same way. Streaks break. Do not treat this as a lock.</li>
            ) : null}
          </ul>
          <ul className="mt-3 divide-y divide-line">
            {rows.map((row) => {
              const delta = row.settle != null && row.strike != null ? row.settle - row.strike : null;
              const when = Number.isFinite(row.closeTime)
                ? new Date(row.closeTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
                : "—";
              return (
                <li key={row.ticker || row.closeTime} className="flex items-center justify-between gap-3 py-2 font-mono text-xs">
                  <span className="text-muted">{when}</span>
                  <span className={row.result === "yes" ? "text-up" : "text-down"}>{row.result === "yes" ? "YES" : "NO"}</span>
                  <span className="hidden text-muted sm:inline">{money(row.strike)} → {money(row.settle)}</span>
                  <span className={delta != null && delta > 0 ? "text-up" : delta != null && delta < 0 ? "text-down" : "text-muted"}>{signed(delta)}</span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </>
  );
}

function EntryRadar({
  spot, spotAt, start, now, secs, windowStart, candles, samples, pulse, tech, candle, radar, market, bookAt, flip,
}: {
  spot: number | null;
  spotAt: number | null;
  start: number | null;
  now: number;
  secs: number | null;
  windowStart: number;
  candles: Candle[];
  samples: ReturnType<typeof useLive.getState>["samples"];
  pulse: ReturnType<typeof readPulse>;
  tech: ReturnType<typeof readTech>;
  candle: CandleSignal;
  radar: string;
  market: import("@/lib/btc/types").MarketQuote | null;
  bookAt: number | null;
  flip: "LOW" | "POSSIBLE" | "HIGH" | "UNKNOWN";
}) {
  const view = readEntry({ spot, spotAt, now, secs, samples, pulse, tech, candle, radar, market, bookAt, flip });
  const [flash, setFlash] = useState<"UP" | "DOWN" | null>(null);
  const prev = useRef(view.state);
  useEffect(() => {
    if ((view.state === "UP" || view.state === "DOWN") && prev.current !== view.state) {
      setFlash(view.state);
      const id = window.setTimeout(() => setFlash(null), 1200);
      prev.current = view.state;
      return () => window.clearTimeout(id);
    }
    prev.current = view.state;
  }, [view.state]);
  useEffect(() => {
    const prevRows = loadEntries();
    const tracked = trackEntries(prevRows, spot, candles, now);
    const next = view.state === "UP" || view.state === "DOWN"
      ? noteEntry(tracked, {
          at: now,
          start: windowStart,
          side: view.state,
          strength: view.strength === "STRONG" ? "STRONG" : "MODERATE",
          contract: view.contractPx,
          spot: spot ?? 0,
          startPx: start,
        })
      : tracked;
    if (next !== prevRows) saveEntries(next);
  }, [view.state, view.strength, view.contractPx, spot, start, windowStart, now, candles]);
  const tone = view.state === "UP" ? "text-up" : view.state === "DOWN" ? "text-down" : "text-muted";
  const edge = view.state === "UP" ? "border-up/50" : view.state === "DOWN" ? "border-down/50" : "border-line";
  return (
    <article className={`border bg-surface p-4 ${edge} ${flash === "UP" ? "entry-flash-up" : flash === "DOWN" ? "entry-flash-down" : ""}`}>
      <p className="text-[11px] tracking-[0.18em] text-muted">ENTRY RADAR</p>
      <p className={`mt-2 font-mono text-2xl ${tone}`}>{view.state === "UP" ? "🟢 UP ENTRY" : view.state === "DOWN" ? "🔴 DOWN ENTRY" : "⚪ WAIT"}</p>
      <p className="mt-1 min-h-10 text-sm">{view.reason}</p>
      <p className="mt-2 text-sm">Direction: {view.direction}</p>
      <p className="font-mono text-sm">CONFIRMATION {view.support}/{view.total}</p>
      <p className="text-sm text-muted">SETUP STRENGTH {view.strength}</p>
      {view.state !== "WAIT" ? (
        <ul className="mt-2 space-y-1 text-sm">
          {view.passed.map((line) => <li key={line}>✓ {line}</li>)}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-muted">{view.direction === "MIXED" ? "Waiting for stronger agreement." : "Direction is not the same as a good entry."}</p>
      )}
      {view.contract ? <p className="mt-2 font-mono text-sm">Kalshi {view.state === "DOWN" || view.direction === "BEARISH" ? "DOWN" : "UP"}: {view.contract}</p> : null}
      {view.invalidation ? <p className="mt-2 text-sm text-muted">INVALIDATION: {view.invalidation}</p> : null}
      <p className="mt-2 text-[11px] text-muted">Agreement is not a probability. Experimental and uncalibrated.</p>
    </article>
  );
}

function plainDoing(regime: string, vol: string) {
  if (regime === "UNKNOWN" || vol === "UNKNOWN") return { title: "COLLECTING HISTORY", lean: "wait" as const, why: "Not enough recent prices to describe this interval." };
  if (vol === "HIGH" || vol === "EXTREME") return { title: "MOVING FAST", lean: "warn" as const, why: "BTC is moving more than usual." };
  if (regime.includes("UP")) return { title: "MOVING UP", lean: "yes" as const, why: "BTC has been climbing." };
  if (regime.includes("DOWN")) return { title: "MOVING DOWN", lean: "no" as const, why: "BTC has been falling." };
  if (regime.includes("QUIET")) return { title: "VERY QUIET", lean: "wait" as const, why: "BTC is barely moving." };
  if (regime.includes("RANGE") || regime.includes("CHOP")) return { title: "MOVING SIDEWAYS", lean: "wait" as const, why: "BTC is not picking a clear direction." };
  return { title: "CHANGING / MIXED", lean: "warn" as const, why: "BTC is changing direction and the signals do not fully agree yet." };
}

function flipChance(move: number | null, secs: number | null, sigma15: number | null, drift30: number | null) {
  if (move == null || secs == null || sigma15 == null || sigma15 <= 0) return null;
  const remaining = Math.max(sigma15 * Math.sqrt(Math.max(secs, 1) / 900), 1);
  const drift = Math.max(-remaining, Math.min(remaining, (drift30 ?? 0) * Math.min(secs / 30, 8) * 0.15));
  const z = (-move - drift) / remaining;
  const p = 0.5 * (1 + erf(z / Math.SQRT2));
  return Math.round(Math.min(0.99, Math.max(0.01, p)) * 100);
}

function erf(x: number) {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-ax * ax);
  return sign * y;
}

function FlipChance({ pct, move, secs, typical, signal }: { pct: number | null; move: number | null; secs: number | null; typical: number | null; signal: CandleSignal }) {
  const [open, setOpen] = useState(false);
  const side = move == null ? null : move > 0.5 ? "below" : move < -0.5 ? "above" : "either side of";
  const left = secs == null ? "—" : `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, "0")}`;
  const tone = pct == null ? "text-muted" : pct >= 45 ? "text-warn" : pct >= 25 ? "text-fg" : "text-muted";
  const wanted = side === "below" ? "bearish" : side === "above" ? "bullish" : "neutral";
  return (
    <article className="relative flex h-full min-w-0 flex-col border border-line bg-surface p-4">
      <p className="text-[11px] tracking-[0.18em] text-muted">FLIP POTENTIAL</p>
      <p className={`mt-2 font-mono text-4xl tabular-nums ${tone}`}>{pct == null ? "—" : `${pct}%`}</p>
      <p className="mt-1 min-h-10 text-sm">Chance the window finishes {side ?? "on the other side of"} the Coinbase open.</p>
      <p className="mt-2 min-h-8 font-mono text-xs tabular-nums text-muted">
        {move == null ? "Start line not ready." : `${signed(move)} from the open`} · {left} left
      </p>
      <p className="font-mono text-xs tabular-nums text-muted">Usual move left {typical == null ? "—" : `±${money(typical)}`}</p>
      <ul className="mt-3 space-y-1 text-sm">
        {(signal.reads.length ? signal.reads : [{ label: "1 MINUTE", name: "No strong pattern", mark: "QUIET", status: "NONE" }]).map((row) => (
          <li key={row.label} className="flex items-baseline justify-between gap-2">
            <span className="text-[11px] tracking-widest text-muted">{row.label.replace(" MINUTE", "M")}</span>
            <span className={`truncate text-right ${row.mark === "BULLISH" ? "text-up" : row.mark === "BEARISH" ? "text-down" : "text-muted"}`}>{row.name}</span>
          </li>
        ))}
      </ul>
      <button type="button" className="mt-auto pt-3 text-left text-xs tracking-widest text-accent" onClick={() => setOpen(true)}>WHY THIS CALL</button>
      {open ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 p-3 sm:items-center" onClick={() => setOpen(false)}>
          <div className="max-h-[80vh] w-full max-w-md overflow-y-auto border border-line bg-surface p-4" onClick={(event) => event.stopPropagation()} role="dialog" aria-label="Why this flip call">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] tracking-[0.18em] text-muted">WHY THIS CALL</p>
              <button type="button" className="text-xs tracking-widest text-muted" onClick={() => setOpen(false)}>CLOSE</button>
            </div>
            <p className="mt-3 border border-line bg-bg px-3 py-2 text-sm">
              The {pct == null ? "number is not ready" : `${pct}%`} comes from the gap to the open, the time left, the 30-second push, and how wide a usual move is. {move == null ? "The start line is not ready." : `Price is ${money(Math.abs(move))} ${move > 0 ? "above" : "below"} the open with ${left} left.`} A usual remaining move is {typical == null ? "not ready" : `±${money(typical)}`}. Candles do not change this percent.
            </p>
            {signal.reads.map((row) => {
              const helps = wanted === "bearish" ? row.mark === "BEARISH" : wanted === "bullish" ? row.mark === "BULLISH" : false;
              const hurts = wanted === "bearish" ? row.mark === "BULLISH" : wanted === "bullish" ? row.mark === "BEARISH" : false;
              return (
                <div key={row.label} className="mt-2 border border-line bg-bg px-3 py-2 text-sm">
                  <p className="text-[11px] tracking-widest text-muted">{row.label} · {row.status}</p>
                  <p className={row.mark === "BULLISH" ? "text-up" : row.mark === "BEARISH" ? "text-down" : "text-muted"}>{row.name}</p>
                  <p className="mt-1">{row.detail}</p>
                  <p className="mt-1 text-muted">{row.meaning}</p>
                  <p className={`mt-1 ${helps ? "text-up" : hurts ? "text-down" : "text-muted"}`}>
                    {helps ? "This candle supports a flip." : hurts ? "This candle argues against a flip." : "This candle does not pick the flip."}
                    {row.status === "FORMING" ? " It has not closed, so it can disappear." : ""}
                  </p>
                </div>
              );
            })}
            <p className="mt-3 text-[11px] text-muted">{signal.overall}. Confirmed candles count more than forming ones. This is context, not a saved hit rate.</p>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function MarketRadar() {
  const reading = useRadar((s) => s.reading);
  const tone =
    reading.bias === "STRONG UP" || reading.bias === "UP"
      ? "text-up"
      : reading.bias === "STRONG DOWN" || reading.bias === "DOWN"
        ? "text-down"
        : "text-muted";
  const known = reading.coins.filter((c) => c.m1 != null || c.s30 != null).length;
  return (
    <section className="flex h-full min-w-0 flex-col border border-line bg-surface p-4">
      <p className="text-[11px] tracking-[0.18em] text-muted">CRYPTO MARKET RADAR</p>
      <p className="text-[11px] text-muted">Cross-Asset Market Breadth</p>
      <p className={`mt-2 font-mono text-3xl ${tone}`}>{reading.ready ? reading.bias : "WAITING"}</p>
      <p className="mt-1 min-h-10 text-sm">{radarVoice(reading.ready, reading.bias, reading.stance)}</p>
      <ul className="mt-3 flex flex-1 flex-col justify-between gap-2 font-mono text-sm">
        {reading.coins.map((coin) => (
          <li key={coin.symbol} className="flex items-baseline justify-between gap-3">
            <span className={coin.side === "up" ? "text-up" : coin.side === "down" ? "text-down" : "text-muted"}>
              {coin.symbol} {coin.side === "up" ? "↑" : coin.side === "down" ? "↓" : "→"}
            </span>
            <span className={`tabular-nums ${coin.side === "up" ? "text-up" : coin.side === "down" ? "text-down" : "text-muted"}`}>{pctMove(coin.m1)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 min-h-8 text-xs text-muted">
        {reading.ready ? `${reading.upCount} of ${known} major markets moving up` : "Collecting 30-second, 1-minute, and 5-minute moves."} · {reading.stance}
      </p>
    </section>
  );
}

function pctMove(v: number | null) {
  if (v == null || Number.isNaN(v)) return "—";
  const n = v * 100;
  if (Math.abs(n) < 0.005) return "0.00%";
  return `${n > 0 ? "+" : "−"}${Math.abs(n).toFixed(2)}%`;
}

function radarVoice(ready: boolean, bias: string, stance: string) {
  if (!ready) return "Still listening. One quiet minute is not a vote yet.";
  if (stance === "DISAGREEING WITH BTC") return "Bitcoin is walking one way. The rest of the room is not following.";
  if (bias === "STRONG UP") return "The room is climbing with Bitcoin. That is a loud agreement.";
  if (bias === "STRONG DOWN") return "The room is falling with Bitcoin. That is a loud agreement.";
  if (bias === "UP") return "More coins are up than down. The room is leaning with the buyers.";
  if (bias === "DOWN") return "More coins are down than up. The room is leaning with the sellers.";
  return "Nobody owns the room. These coins are not picking the same side.";
}

function MoveLine({ label, delta }: { label: string; delta: number | null }) {
  const flat = delta != null && Math.abs(delta) < 0.5;
  const tone = delta == null || flat ? "text-muted" : delta > 0 ? "text-up" : "text-down";
  return (
    <li className={`flex justify-between gap-3 font-mono ${tone}`}>
      <span>{label}</span>
      <span>{delta == null ? "—" : signed(delta)}</span>
    </li>
  );
}

function plainSignal(label: string): { name: string; term: string | null } {
  if (label === "Price") return { name: "Price direction", term: null };
  if (label === "Momentum") return { name: "SPEEDING UP / SLOWING DOWN", term: "Multi-Horizon Momentum & Acceleration" };
  if (label === "Buyers") return { name: "BUYERS VS SELLERS", term: "Aggressive Order-Flow Imbalance" };
  if (label === "Order Book") return { name: "WAITING ORDERS", term: "Order-Book Imbalance" };
  if (label === "Large Trades") return { name: "BIG MONEY DIRECTION", term: "Large-Trade / Whale Flow" };
  if (label === "Reversal") return { name: "FLIP DANGER", term: "Conditional Reversal / Flip Risk" };
  return { name: label, term: null };
}

function Hint({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-block align-middle">
      <button type="button" className="ml-1 text-xs text-accent" onClick={() => setOpen((v) => !v)}>
        ?
      </button>
      {open ? <span className="absolute left-0 z-10 mt-1 w-64 border border-line bg-surface-2 p-2 text-xs font-sans normal-case tracking-normal text-muted">{text}</span> : null}
    </span>
  );
}

function Guide() {
  return (
    <section className="border border-line bg-surface px-3 py-2 text-sm">
      <p className="text-[11px] tracking-[0.18em] text-muted">QUICK GUIDE</p>
      <p><span className="text-up">Green</span> means up / YES. <span className="text-down">Red</span> means down / NO. <span className="text-warn">Yellow</span> means mixed. <span className="text-muted">Gray</span> means quiet or not enough.</p>
      <p className="text-muted">YES = finish above the start price. NO = finish at or below it. WAIT = no clear model lean.</p>
    </section>
  );
}

function LiveTape() {
  const price = useLive((s) => s.price);
  const flash = useLive((s) => s.flash);
  const samples = useLive((s) => s.samples);
  const tickAt = useLive((s) => s.tickAt);
  const status = useLive((s) => s.status);
  const trades = useFlow((s) => s.trades);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);
  const age = tickAt ? Math.max(0, (now - tickAt) / 1000) : null;
  const stale = status !== "live" || (age != null && age > 5);
  const recent = trades.reduce((sum, trade) => (trade.t >= now - 20_000 ? sum + trade.usd : sum), 0);
  const prior = trades.reduce((sum, trade) => (trade.t >= now - 40_000 && trade.t < now - 20_000 ? sum + trade.usd : sum), 0);
  const volDir = prior <= 0 && recent <= 0 ? "flat" : recent > prior * 1.08 ? "up" : recent < prior * 0.92 ? "down" : "flat";
  const volDelta = prior > 0 ? ((recent - prior) / prior) * 100 : null;
  const bits = [
    ["1s", 1_000],
    ["5s", 5_000],
    ["15s", 15_000],
    ["30s", 30_000],
    ["1m", 60_000],
  ] as const;
  return (
    <header className="border border-line bg-surface px-3 py-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-[11px] tracking-[0.22em] text-muted">BTC // LIVE</p>
          <p className={`mt-1 font-mono text-4xl tabular-nums sm:text-5xl ${flash === "up" ? "tick-up text-up" : flash === "down" ? "tick-down text-down" : ""}`}>{money(price)}</p>
        </div>
        <div className="flex items-end gap-3">
          <div className="flex items-center gap-2 border border-line bg-surface-2 px-2 py-1.5">
            <span className="vol-stage">
              <span className={`vol-arrow ${volDir} ${volDir === "up" ? "text-up" : volDir === "down" ? "text-down" : "text-muted"}`} aria-hidden>
                <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                  <path d="M11 3.5 L17 12 H13.2 V18.5 H8.8 V12 H5 Z" fill="currentColor" />
                </svg>
              </span>
            </span>
            <span className="text-right font-mono text-xs leading-tight">
              <span className="block tracking-widest text-muted">VOLUME 20s</span>
              <span className={volDir === "up" ? "text-up" : volDir === "down" ? "text-down" : "text-muted"}>
                {compact(recent)} {volDelta == null ? "" : `${volDelta > 0 ? "+" : ""}${Math.round(volDelta)}%`}
              </span>
            </span>
          </div>
          <p className={`text-right font-mono text-xs ${stale ? "text-warn" : "text-up"}`}>
            {stale ? "TEMPORARILY DELAYED" : "LIVE"}
            <span className="mt-1 block text-muted">{age == null ? "linking" : `${age.toFixed(1)} sec ago`}</span>
          </p>
        </div>
      </div>
      <div className="mt-2 flex gap-3 overflow-x-auto font-mono text-xs tabular-nums">
        {bits.map(([label, ms]) => {
          const prior = priceAgo(samples, ms, now);
          const delta = price != null && prior ? price - prior.px : null;
          const up = delta != null && delta > 0.5;
          const down = delta != null && delta < -0.5;
          return (
            <span key={label} className={`shrink-0 ${up ? "text-up" : down ? "text-down" : "text-muted"}`}>
              {label} {signed(delta)}
            </span>
          );
        })}
      </div>
    </header>
  );
}

function sideMark(side: "up" | "down" | "flat" | Lean) {
  if (side === "up" || side === "yes") return "↑ UP";
  if (side === "down" || side === "no") return "↓ DOWN";
  return "→ QUIET";
}

function TargetBoard({ spot, start, kalshiTarget, secs, typical, reach, gapKalshi }: { spot: number | null; start: number | null; kalshiTarget: number | null; secs: number | null; typical: number | null; reach: boolean | null; gapKalshi: number | null }) {
  const cb = spot != null && start != null ? spot - start : null;
  const left = secs == null ? "—" : `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, "0")}`;
  return (
    <article className="border border-line bg-surface p-4">
      <p className="text-[11px] tracking-[0.18em] text-muted">TARGET STATUS</p>
      <p className="text-[11px] text-muted">Coinbase window open and Kalshi target are different numbers.</p>
      <div className="mt-2 grid gap-1 font-mono text-sm sm:grid-cols-2">
        <p>Coinbase BTC: {money(spot)}</p>
        <p>BRTI: <span className="text-warn">UNAVAILABLE</span></p>
        <p>Coinbase open: {money(start)}</p>
        <p>Kalshi target: {money(kalshiTarget)}</p>
        <p className={cb != null && cb < 0 ? "text-down" : cb != null && cb > 0 ? "text-up" : ""}>Coinbase vs open: {signed(cb)}</p>
        <p className={gapKalshi != null && gapKalshi < 0 ? "text-down" : gapKalshi != null && gapKalshi > 0 ? "text-up" : ""}>Coinbase vs Kalshi target: {signed(gapKalshi)}</p>
      </div>
      <p className="mt-2 text-sm">
        {gapKalshi == null || secs == null
          ? "Kalshi target is not loaded for this window, so reach is not calculated."
          : `BTC is ${money(Math.abs(gapKalshi))} ${gapKalshi >= 0 ? "above" : "below"} the Kalshi target with ${left} remaining. A typical Coinbase move over this much time is ${typical == null ? "not ready" : money(typical)}. ${reach == null ? "" : reach ? "The target is still within a usual move." : "Crossing it would take a larger-than-usual move."}`}
      </p>
      <p className="mt-1 text-[11px] text-muted">BRTI vs Kalshi target is not shown until an official BRTI print exists. No number is invented.</p>
    </article>
  );
}

function MarketRead({ tech, radarBias, bookLean, whaleLean, move, flip, spot }: { tech: ReturnType<typeof readTech>; radarBias: string; bookLean: Lean; whaleLean: Lean; move: number | null; flip: string; spot: number | null }) {
  const vwapSide: "up" | "down" | "flat" = spot == null || tech.vwap == null ? "flat" : spot > tech.vwap ? "up" : spot < tech.vwap ? "down" : "flat";
  const rows: { name: string; mark: string; side: "up" | "down" | "flat" }[] = [
    { name: "Trend", mark: tech.trend, side: tech.trend.includes("UP") ? "up" : tech.trend.includes("DOWN") ? "down" : "flat" },
    { name: "Momentum", mark: tech.momentum, side: tech.momentumSide },
    { name: "Structure", mark: tech.structureSide === "up" ? "↑ UP" : tech.structureSide === "down" ? "↓ DOWN" : "→ MIXED", side: tech.structureSide },
    { name: "Volume", mark: tech.volumeSide === "up" ? "↑ BUYERS" : tech.volumeSide === "down" ? "↓ SELLERS" : "→ QUIET", side: tech.volumeSide },
    { name: "VWAP", mark: tech.vwap == null ? "UNAVAILABLE" : vwapSide === "up" ? "↑ ABOVE" : vwapSide === "down" ? "↓ BELOW" : "→ ON", side: vwapSide },
    { name: "Volatility", mark: tech.volClass, side: "flat" },
    { name: "Big money", mark: sideMark(whaleLean), side: whaleLean === "yes" ? "up" : whaleLean === "no" ? "down" : "flat" },
    { name: "Order book", mark: sideMark(bookLean), side: bookLean === "yes" ? "up" : bookLean === "no" ? "down" : "flat" },
    { name: "Crypto breadth", mark: radarBias, side: radarBias.includes("UP") ? "up" : radarBias.includes("DOWN") ? "down" : "flat" },
    { name: "Flip danger", mark: flip, side: "flat" },
    { name: "Target position", mark: move == null ? "—" : move > 0.5 ? "↑ ABOVE OPEN" : move < -0.5 ? "↓ BELOW OPEN" : "→ ON OPEN", side: move == null ? "flat" : move > 0.5 ? "up" : move < -0.5 ? "down" : "flat" },
  ];
  const bull = rows.filter((r) => r.side === "up").length;
  const bear = rows.filter((r) => r.side === "down").length;
  const neutral = rows.length - bull - bear;
  const conflict = tech.momentumSide === "up" && (whaleLean === "no" || tech.volumeSide !== "up");
  return (
    <article className="h-full min-w-0 border border-line bg-surface p-4">
      <p className="text-[11px] tracking-[0.18em] text-muted">MARKET READ</p>
      <p className="text-[11px] text-muted">Agreement is not a probability.</p>
      <ul className="mt-2 space-y-1 font-mono text-sm">
        {rows.map((row) => (
          <li key={row.name} className="flex min-h-5 items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-muted">{row.name}</span>
            <span className={`shrink-0 tabular-nums ${row.side === "up" ? "text-up" : row.side === "down" ? "text-down" : "text-muted"}`}>{row.mark}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-sm">{bull} bullish / {bear} bearish / {neutral} neutral</p>
      {conflict ? <p className="mt-2 text-sm text-warn">MIXED SIGNAL. Short-term price is rising, but large-trade flow or volume is not confirming it.</p> : null}
    </article>
  );
}

function FastMoves() {
  const price = useLive((s) => s.price);
  const samples = useLive((s) => s.samples);
  const rows = [
    ["1 SEC", 1_000],
    ["3 SEC", 3_000],
    ["5 SEC", 5_000],
    ["10 SEC", 10_000],
    ["15 SEC", 15_000],
    ["30 SEC", 30_000],
    ["1 MIN", 60_000],
    ["5 MIN", 300_000],
    ["15 MIN", 900_000],
  ] as const;
  return (
    <section className="border border-line bg-surface p-4">
      <p className="text-[11px] tracking-[0.18em] text-muted">BTC LIVE MOVEMENT</p>
      <div className="mt-2 grid grid-cols-2 gap-2 font-mono text-sm sm:grid-cols-4">
        {rows.map(([label, ms]) => {
          const prior = priceAgo(samples, ms);
          const delta = price != null && prior ? price - prior.px : null;
          return (
            <p key={label} className="flex justify-between gap-2">
              <span className="text-muted">{label}</span>
              <span className={delta != null && delta > 0.5 ? "text-up" : delta != null && delta < -0.5 ? "text-down" : "text-muted"}>{signed(delta)}</span>
            </p>
          );
        })}
      </div>
    </section>
  );
}

function TimerRing({ leftMs }: { leftMs: number | null }) {
  const total = 900;
  const secs = leftMs == null ? null : Math.max(0, Math.floor(leftMs / 1000));
  const label = secs == null ? "--:--" : `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
  const r = 54;
  const c = 2 * Math.PI * r;
  const dash = secs == null ? c : (secs / total) * c;
  const tone = secs == null ? "text-accent" : secs <= 30 ? "text-down" : secs <= 120 ? "text-warn" : secs <= 300 ? "text-fg" : "text-accent";
  return (
    <div className="mx-auto mt-4 w-40 text-center">
      <svg viewBox="0 0 140 140" className="mx-auto h-40 w-40">
        <circle cx="70" cy="70" r={r} fill="none" stroke="currentColor" className="text-line" strokeWidth="3" />
        <circle
          cx="70"
          cy="70"
          r={r}
          fill="none"
          stroke="currentColor"
          className={tone}
          strokeWidth="4"
          strokeDasharray={`${dash} ${c}`}
          strokeLinecap="round"
          transform="rotate(-90 70 70)"
        />
        <text x="70" y="66" textAnchor="middle" className="fill-fg" fontSize="22" fontFamily="ui-monospace, monospace">
          {label}
        </text>
        <text x="70" y="86" textAnchor="middle" className="fill-muted" fontSize="8" letterSpacing="2">
          TIME LEFT
        </text>
      </svg>
    </div>
  );
}

function Stat({ k, v, tone }: { k: string; v: string; tone?: number | null }) {
  const cls = tone == null ? "" : tone > 0.5 ? "text-up" : tone < -0.5 ? "text-down" : "";
  return (
    <p>
      <span className="block text-[10px] tracking-widest text-muted">{k}</span>
      <span className={cls}>{v}</span>
    </p>
  );
}

function Row({ k, v, tone }: { k: string; v: string; tone?: number | null }) {
  const cls = tone == null ? "" : tone > 0.5 ? "text-up" : tone < -0.5 ? "text-down" : "";
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{k}</dt>
      <dd className={cls}>{v}</dd>
    </div>
  );
}

function Bar({ label, pct, tone }: { label: string; pct: number | null; tone: "yes" | "no" }) {
  const width = pct == null ? 0 : Math.round(pct * 100);
  return (
    <p className="mt-2 font-mono text-xs">
      <span className="text-muted">{label} {pct == null ? "—" : `${width}%`}</span>
      <span className="mt-1 block h-1.5 bg-surface-2">
        <span className={`block h-full ${tone === "yes" ? "bg-up" : "bg-down"}`} style={{ width: `${width}%` }} />
      </span>
    </p>
  );
}

function DayStats({ candles, price, windowStart }: { candles: Candle[]; price: number | null; windowStart: number }) {
  const today = candles.filter((c) => c.t >= windowStart - 20 * 3600);
  const open = today[0]?.o ?? candles[0]?.o ?? null;
  const high = today.reduce((m, c) => Math.max(m, c.h), 0);
  const low = today.reduce((m, c) => (m === 0 ? c.l : Math.min(m, c.l)), 0);
  const change = price != null && open != null ? price - open : null;
  return (
    <p className="mb-2 font-mono text-xs text-muted">
      OPEN {money(open)} · HIGH {money(high || null)} · LOW {money(low || null)} ·{" "}
      <span className={change != null && change > 0 ? "text-up" : change != null && change < 0 ? "text-down" : ""}>
        DAY {signed(change)} {open && change != null ? `(${((change / open) * 100).toFixed(2)}%)` : ""}
      </span>
    </p>
  );
}

function Recent({ frozen }: { frozen: Frozen[] }) {
  const rows = frozen.filter((row) => row.result).slice(0, 8);
  return (
    <article className="border border-line bg-surface p-4">
      <p className="text-[11px] tracking-[0.18em] text-muted">FROZEN SPOT FORECAST RESULTS</p>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-muted">No settled live predictions yet. Past candles are not rewritten into fake saved calls.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {rows.map((row) => (
            <li key={row.start} className={`border-l-2 py-2 pl-3 font-mono text-xs ${row.result === "CORRECT" ? "border-up" : row.result === "WRONG" ? "border-down" : "border-line"}`}>
              <p>{new Date(row.start * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</p>
              <p className={row.call === "YES" ? "text-up" : row.call === "NO" ? "text-down" : "text-muted"}>BOT {row.call} {row.pUp == null ? "" : `${Math.round((row.call === "NO" ? 1 - row.pUp : row.pUp) * 100)}%`}</p>
              <p>BTC {signed(row.settledPx != null ? row.settledPx - row.startPx : null)}</p>
              <p>{row.result === "CORRECT" ? "CORRECT" : row.result === "WRONG" ? "WRONG" : "SKIPPED"}</p>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[11px] text-muted">Calls freeze at T+30–60s while this tab is open. Late visits are skipped. Coinbase close results are not Kalshi settlements; WAIT counts in probability scoring.</p>
    </article>
  );
}

function ModelCore({ frozen }: { frozen: Frozen[] }) {
  const stats = evaluationSummary(frozen);
  return (
    <article className="border border-line bg-surface p-4 text-sm">
      <p className="text-xs tracking-widest text-muted">MODEL METHOD & CALIBRATION</p>
      <p className="mt-2 text-warn">EXPERIMENTAL · UNCALIBRATED · spot-close-v3-baseline</p>
      <p className="mt-2 text-muted">The estimate uses the normal CDF of log(spot / Coinbase window open), divided by the volatility of the last 60 completed one-minute returns × √minutes remaining. It assumes zero expected drift and normally distributed future log returns. The model does not add hand-set momentum drift, analog matches, or probability compression.</p>
      <p className="mt-2 text-muted">This simpler version is not proven more accurate. Candle patterns, radar, order flow, and Kalshi quotes stay visible as context but do not alter the probability. Official Kalshi settlement needs BRTI observations and is not estimated here.</p>
      <p className="mt-2 font-mono text-xs">{stats.count} completed · {stats.directional} directional · {stats.waits} WAIT · {stats.directional ? `${stats.correct}/${stats.directional} correct (${Math.round(stats.correct / stats.directional * 100)}%)` : "Accuracy: collecting predictions"}</p>
      <p className="mt-2 font-mono text-xs">Brier {stats.brier == null ? "—" : stats.brier.toFixed(3)} · 50/50 baseline 0.250 · Brier skill {stats.brierSkill == null ? "—" : `${(stats.brierSkill * 100).toFixed(1)}%`} · Log loss {stats.logLoss == null ? "—" : stats.logLoss.toFixed(3)}</p>
      {stats.count > 0 ? <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr><th>P(up) bucket</th><th>n</th><th>Mean forecast</th><th>Realized up</th></tr></thead><tbody>{stats.buckets.filter((b) => b.count > 0).map((b) => <tr key={b.label}><td className="py-2">{b.label}</td><td>{b.count}</td><td>{Math.round(b.predicted! * 100)}%</td><td>{Math.round(b.observed! * 100)}%</td></tr>)}</tbody></table></div> : <p className="mt-2 text-muted">No completed v3 forecasts yet. Older model records are excluded.</p>}
      <p className="mt-2 text-xs text-muted">Brier skill compares with the 50/50 forecast; positive means lower Brier loss in this sample, not proof of future edge. Records are local to this browser and only captured at T+30–60s while the tab is open, so sample size and selection bias matter. No profitability claim is made.</p>
    </article>
  );
}
