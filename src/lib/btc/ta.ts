import type { Candle } from "./types";

export type Side = "up" | "down" | "flat";
export type Trend = "STRONG UP" | "UP" | "MIXED" | "DOWN" | "STRONG DOWN";

export function ema(values: number[], length: number) {
  if (values.length < length) return values.map(() => null as number | null);
  const k = 2 / (length + 1);
  const out: Array<number | null> = Array(values.length).fill(null);
  let seed = 0;
  for (let i = 0; i < length; i += 1) seed += values[i] ?? 0;
  let prev = seed / length;
  out[length - 1] = prev;
  for (let i = length; i < values.length; i += 1) {
    prev = (values[i] ?? prev) * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function aggregate(candles: Candle[], minutes: number, spot: number | null, nowSec: number) {
  const size = minutes * 60;
  const map = new Map<number, Candle>();
  for (const c of candles) {
    if (c.t + 60 > nowSec && c.t !== Math.floor(nowSec / 60) * 60) continue;
    const t = Math.floor(c.t / size) * size;
    const cur = map.get(t);
    if (!cur) map.set(t, { ...c, t, v: c.v ?? 0 });
    else {
      cur.h = Math.max(cur.h, c.h);
      cur.l = Math.min(cur.l, c.l);
      cur.c = c.c;
      cur.v = (cur.v ?? 0) + (c.v ?? 0);
    }
  }
  const rows = [...map.values()].sort((a, b) => a.t - b.t).slice(-120);
  if (spot == null || rows.length === 0) return rows;
  const bucket = Math.floor(nowSec / size) * size;
  const last = rows[rows.length - 1]!;
  if (last.t === bucket) {
    last.c = spot;
    last.h = Math.max(last.h, spot);
    last.l = Math.min(last.l, spot);
  } else if (bucket > last.t) {
    rows.push({ t: bucket, o: last.c, h: Math.max(last.c, spot), l: Math.min(last.c, spot), c: spot, v: 0 });
  }
  return rows.slice(-120);
}

export function secondCandles(
  samples: { t: number; px: number; origin?: string }[],
  trades: { t: number; btc: number }[],
  nowMs: number,
  spot: number | null,
) {
  const ticks = samples.filter((row) => row.origin !== "candle" && row.px > 0 && row.t > 0);
  const end = Math.floor(nowMs / 1000);
  if (!ticks.length && (spot == null || spot <= 0)) return [];
  const first = ticks.length ? Math.floor(ticks[0]!.t / 1000) : end;
  const from = Math.max(first, end - 179);
  const map = new Map<number, Candle>();
  for (const row of ticks) {
    const sec = Math.floor(row.t / 1000);
    if (sec < from || sec > end) continue;
    const cur = map.get(sec);
    if (!cur) map.set(sec, { t: sec, o: row.px, h: row.px, l: row.px, c: row.px, v: 0 });
    else {
      cur.h = Math.max(cur.h, row.px);
      cur.l = Math.min(cur.l, row.px);
      cur.c = row.px;
    }
  }
  for (const trade of trades) {
    const sec = Math.floor(trade.t / 1000);
    const cur = map.get(sec);
    if (cur && trade.btc > 0) cur.v = (cur.v ?? 0) + trade.btc;
  }
  let carry = spot;
  for (let i = ticks.length - 1; i >= 0; i -= 1) {
    if (Math.floor(ticks[i]!.t / 1000) < from) {
      carry = ticks[i]!.px;
      break;
    }
  }
  if (carry == null || carry <= 0) carry = map.get(from)?.o ?? spot;
  if (carry == null || carry <= 0) return [];
  const rows: Candle[] = [];
  for (let sec = from; sec <= end; sec += 1) {
    const cur = map.get(sec);
    if (!cur) rows.push({ t: sec, o: carry, h: carry, l: carry, c: carry, v: 0 });
    else {
      rows.push(cur);
      carry = cur.c;
    }
  }
  const last = rows[rows.length - 1];
  if (last && spot != null && spot > 0) {
    last.c = spot;
    last.h = Math.max(last.h, spot);
    last.l = Math.min(last.l, spot);
  }
  return rows;
}

export function tickCandles(trades: { t: number; px: number; btc?: number }[], size: number, keep = 120) {
  const rows = trades.filter((row) => row.px > 0 && row.t > 0);
  const start = Math.max(0, rows.length - size * keep);
  const out: Candle[] = [];
  for (let i = start; i < rows.length; i += size) {
    const chunk = rows.slice(i, Math.min(rows.length, i + size));
    if (!chunk.length) break;
    let h = chunk[0]!.px;
    let l = h;
    let v = 0;
    for (const row of chunk) {
      h = Math.max(h, row.px);
      l = Math.min(l, row.px);
      v += row.btc ?? 0;
    }
    out.push({
      t: Math.floor(chunk[chunk.length - 1]!.t / 1000) + out.length / 1000,
      o: chunk[0]!.px,
      h,
      l,
      c: chunk[chunk.length - 1]!.px,
      v,
    });
  }
  return out;
}

export function tickNudge(trades: { t: number; px: number; btc?: number }[]) {
  const full = trades.filter((row) => row.px > 0 && row.t > 0);
  if (full.length < 60) return { nudge: 0, note: "Tick tape is still collecting. The percent is not using it yet." };
  const tens = tickCandles(full.slice(0, Math.floor(full.length / 10) * 10), 10, 8).slice(-6);
  if (tens.length < 4) return { nudge: 0, note: null };
  const ups = tens.filter((c) => c.c > c.o).length;
  const downs = tens.filter((c) => c.c < c.o).length;
  let score = (ups - downs) / tens.length;
  let note = `10-tick tape is ${score > 0.15 ? "up" : score < -0.15 ? "down" : "flat"} on the last ${tens.length} finished bars.`;
  if (full.length >= 200) {
    const last = tickCandles(full.slice(0, Math.floor(full.length / 100) * 100), 100, 3).at(-1);
    if (last && last.c !== last.o) {
      const agrees = (score > 0 && last.c > last.o) || (score < 0 && last.c < last.o);
      if (!agrees && Math.abs(score) > 0.15) {
        score *= 0.35;
        note += " 100-tick context disagrees, so this only nudges the percent a little.";
      } else if (agrees) note += " 100-tick context agrees.";
    }
  }
  return { nudge: Math.max(-0.03, Math.min(0.03, score * 0.03)), note };
}

export function atr(candles: Candle[], length = 14) {
  if (candles.length < length + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i += 1) {
    const c = candles[i]!;
    const prev = candles[i - 1]!.c;
    trs.push(Math.max(c.h - c.l, Math.abs(c.h - prev), Math.abs(c.l - prev)));
  }
  const slice = trs.slice(-length);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

export function vwapOf(candles: Candle[]) {
  let pv = 0;
  let vol = 0;
  const line: Array<number | null> = [];
  for (const c of candles) {
    const v = c.v ?? 0;
    const typical = (c.h + c.l + c.c) / 3;
    if (v > 0) {
      pv += typical * v;
      vol += v;
    }
    line.push(vol > 0 ? pv / vol : null);
  }
  return { line, value: vol > 0 ? pv / vol : null, hasVolume: vol > 0 };
}

function slope(series: Array<number | null>) {
  const a = series.at(-4);
  const b = series.at(-1);
  if (a == null || b == null) return null;
  return b - a;
}

export function swings(candles: Candle[], floor: number) {
  const pts: { i: number; kind: "high" | "low"; px: number }[] = [];
  for (let i = 3; i < candles.length - 3; i += 1) {
    const c = candles[i]!;
    const highs = candles.slice(i - 3, i + 4).map((row) => row.h);
    const lows = candles.slice(i - 3, i + 4).map((row) => row.l);
    if (c.h === Math.max(...highs)) pts.push({ i, kind: "high", px: c.h });
    if (c.l === Math.min(...lows)) pts.push({ i, kind: "low", px: c.l });
  }
  const kept: typeof pts = [];
  for (const pt of pts) {
    const prev = [...kept].reverse().find((row) => row.kind === pt.kind);
    if (prev && Math.abs(pt.px - prev.px) < floor) continue;
    kept.push(pt);
  }
  return kept.slice(-6);
}

export type TechRead = {
  ema9: Array<number | null>;
  ema21: Array<number | null>;
  vwapLine: Array<number | null>;
  vwap: number | null;
  trend: Trend | "UNKNOWN";
  structure: string;
  structureSide: Side;
  volumeText: string;
  volumeSide: Side;
  relVolume: number | null;
  momentum: string;
  momentumSide: Side;
  volClass: "LOW" | "NORMAL" | "HIGH" | "EXTREME" | "UNKNOWN";
  atr: number | null;
};

export function readTech(candles: Candle[], spot: number | null, moves: { ms: number; delta: number | null }[]): TechRead {
  const closes = candles.map((c) => c.c);
  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const vwap = vwapOf(candles);
  const last9 = ema9.at(-1) ?? null;
  const last21 = ema21.at(-1) ?? null;
  const s9 = slope(ema9);
  const s21 = slope(ema21);
  let trend: TechRead["trend"] = "UNKNOWN";
  if (spot != null && last9 != null && last21 != null && vwap.value != null) {
    const above = [spot > last9, spot > last21, last9 > last21, spot > vwap.value, (s9 ?? 0) > 0].filter(Boolean).length;
    trend = above >= 5 ? "STRONG UP" : above >= 4 ? "UP" : above <= 0 ? "STRONG DOWN" : above <= 1 ? "DOWN" : "MIXED";
  }
  const range = atr(candles) ?? 0;
  const pts = swings(candles, Math.max(range * 0.35, 12));
  const highs = pts.filter((p) => p.kind === "high").slice(-2);
  const lows = pts.filter((p) => p.kind === "low").slice(-2);
  let structure = "Not enough swing points yet.";
  let structureSide: Side = "flat";
  if (highs.length === 2 && lows.length === 2) {
    const hh = highs[1]!.px > highs[0]!.px;
    const hl = lows[1]!.px > lows[0]!.px;
    const lh = highs[1]!.px < highs[0]!.px;
    const ll = lows[1]!.px < lows[0]!.px;
    if (hh && hl) {
      structure = "Bullish structure — BTC is making higher highs and higher lows.";
      structureSide = "up";
    } else if (lh && ll) {
      structure = "Bearish structure — BTC is making lower highs and lower lows.";
      structureSide = "down";
    } else {
      structure = "Choppy — BTC is crossing the same range without a clean direction.";
    }
  }
  const vols = candles.map((c) => c.v ?? 0);
  const recent = vols.slice(-20, -1).filter((n) => n > 0);
  const avg = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : null;
  const cur = vols.at(-1) ?? 0;
  const rel = avg && avg > 0 ? cur / avg : null;
  const upCandle = candles.length ? candles[candles.length - 1]!.c >= candles[candles.length - 1]!.o : true;
  let volumeText = "Volume is unavailable for this candle.";
  let volumeSide: Side = "flat";
  if (rel != null) {
    if (rel >= 1.3 && !upCandle) {
      volumeText = `SELLING PRESSURE INCREASING. Current volume is ${rel.toFixed(1)}× recent average and BTC is declining.`;
      volumeSide = "down";
    } else if (rel >= 1.3 && upCandle) {
      volumeText = `BUYING PRESSURE INCREASING. Current volume is ${rel.toFixed(1)}× recent average and BTC is rising.`;
      volumeSide = "up";
    } else if (rel < 0.8 && upCandle) {
      volumeText = "WEAK MOVE. BTC is moving higher, but volume is below average.";
    } else if (rel < 0.8 && !upCandle) {
      volumeText = "WEAK MOVE. BTC is moving lower, but volume is below average.";
    } else {
      volumeText = `Volume is about ${rel.toFixed(1)}× the recent average.`;
    }
  }
  const d10 = moves.find((m) => m.ms === 10_000)?.delta ?? null;
  const d30 = moves.find((m) => m.ms === 30_000)?.delta ?? null;
  const d60 = moves.find((m) => m.ms === 60_000)?.delta ?? null;
  const d300 = moves.find((m) => m.ms === 300_000)?.delta ?? null;
  const short = d30 ?? d10;
  const longer = d60;
  let momentum = "QUIET";
  let momentumSide: Side = "flat";
  if (short != null && longer != null && (Math.abs(short) > 8 || Math.abs(longer) > 12)) {
    const up = short > 0 && longer > 0;
    const down = short < 0 && longer < 0;
    const speeding = Math.abs(short) > Math.abs(longer) / 4;
    if (up) {
      momentum = speeding ? "UP — ACCELERATING" : "UP — SLOWING";
      momentumSide = "up";
    } else if (down) {
      momentum = speeding ? "DOWN — ACCELERATING" : "DOWN — SLOWING";
      momentumSide = "down";
    } else momentum = "MIXED";
  }
  if (d300 != null && momentumSide !== "flat" && Math.sign(d300) !== 0 && Math.sign(d300) !== (momentumSide === "up" ? 1 : -1) && Math.abs(d300) > 25) {
    momentum = `${momentum} · 5m disagrees`;
  }
  const atrNow = atr(candles);
  const step = candles.length > 2 ? candles.at(-1)!.t - candles.at(-2)!.t : 60;
  const minuteAtr = atrNow == null ? null : atrNow * Math.sqrt(60 / Math.max(step, 1));
  const volClass: TechRead["volClass"] = minuteAtr == null ? "UNKNOWN" : minuteAtr > 180 ? "EXTREME" : minuteAtr > 90 ? "HIGH" : minuteAtr < 25 ? "LOW" : "NORMAL";
  return { ema9, ema21, vwapLine: vwap.line, vwap: vwap.value, trend, structure, structureSide, volumeText, volumeSide, relVolume: rel, momentum, momentumSide, volClass, atr: atrNow };
}
