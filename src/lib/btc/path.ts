import { completedCandles, normalCdf, realizedSigma } from "./model";
import type { Candle } from "./types";

export type PathCall = "UP" | "DOWN" | "FLAT";

export type Horizon = {
  label: string;
  minutes: number;
  call: PathCall | null;
  expected: number | null;
  change: number | null;
  low: number | null;
  high: number | null;
  pUp: number | null;
};

function driftPerMin(candles: Candle[]) {
  const rows = candles.slice(-16);
  if (rows.length < 16) return 0;
  for (let i = 1; i < rows.length; i += 1) {
    if (rows[i]!.t - rows[i - 1]!.t !== 60) return 0;
  }
  const rets = rows.slice(1).map((c, i) => Math.log(c.c / rows[i]!.c));
  return rets.reduce((a, b) => a + b, 0) / rets.length;
}

function horizon(spot: number, minutes: number, drift: number, perMin: number, line: number | null): Horizon {
  const mu = drift * minutes;
  const sd = perMin * Math.sqrt(minutes);
  const expected = spot * Math.exp(mu);
  const low = spot * Math.exp(mu - sd);
  const high = spot * Math.exp(mu + sd);
  const change = expected - spot;
  const pUp = line == null ? normalCdf(mu / sd) : normalCdf(Math.log(spot / line) / sd + (mu / sd));
  const call: PathCall = line == null ? (change > 8 ? "UP" : change < -8 ? "DOWN" : "FLAT") : pUp >= 0.58 ? "UP" : pUp <= 0.42 ? "DOWN" : "FLAT";
  return { label: "", minutes, call, expected, change, low, high, pUp };
}

export function pathPlan(input: { candles: Candle[]; spot: number | null; start: number | null; now: number; windowEndSec: number }) {
  const done = completedCandles(input.candles, input.now);
  const sigma = realizedSigma(done);
  if (input.spot == null || !sigma) {
    return { ready: false as const, five: null, end: null, minutesLeft: null };
  }
  const drift = driftPerMin(done);
  const leftMin = Math.max((input.windowEndSec * 1000 - input.now) / 60_000, 1 / 60);
  const five = { ...horizon(input.spot, 5, drift, sigma.perMin, null), label: "NEXT 5 MINUTES" };
  const end = { ...horizon(input.spot, leftMin, drift, sigma.perMin, input.start), label: "WINDOW END" };
  return { ready: true as const, five, end, minutesLeft: leftMin };
}
