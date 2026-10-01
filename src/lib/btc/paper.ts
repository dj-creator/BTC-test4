import type { Candle } from "./types";

export type PaperTrade = {
  start: number;
  enteredAt: number;
  call: "YES" | "NO";
  yesPx: number;
  entryPx: number;
  startPx: number;
  pUp: number | null;
  exitAt: number | null;
  result: "CORRECT" | "WRONG" | null;
  pnl: number | null;
};

const KEY = "btc-paper-kalshi-v1";

export function loadPaper(): PaperTrade[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const rows: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(rows)) return [];
    return rows.filter((row): row is PaperTrade => {
      if (!row || row.start % 900 !== 0) return false;
      if (row.call !== "YES" && row.call !== "NO") return false;
      if (![row.enteredAt, row.yesPx, row.entryPx, row.startPx].every(Number.isFinite)) return false;
      if (row.pUp != null && (!Number.isFinite(row.pUp) || row.pUp < 0 || row.pUp > 1)) return false;
      if (row.yesPx <= 0.01 || row.yesPx >= 0.99 || row.startPx <= 0) return false;
      return row.result == null || row.pnl != null;
    }).slice(0, 200);
  } catch {
    return [];
  }
}

export function savePaper(rows: PaperTrade[]) {
  try { localStorage.setItem(KEY, JSON.stringify(rows.slice(0, 200))); }
  catch { /* keep the live read if storage is blocked */ }
}

export function capturePaper(rows: PaperTrade[], input: {
  now: number;
  start: number;
  call: "YES" | "NO" | "WAIT" | null;
  yesPx: number | null;
  startPx: number | null;
  pUp?: number | null;
}): PaperTrade[] {
  const age = input.now - input.start * 1000;
  const left = input.start * 1000 + 900_000 - input.now;
  if (age < 20_000 || left < 75_000 || rows.some((row) => row.start === input.start)) return rows;
  if (input.call !== "YES" && input.call !== "NO") return rows;
  if (input.yesPx == null || input.startPx == null || input.yesPx <= 0.01 || input.yesPx >= 0.99 || input.startPx <= 0) return rows;
  const entryPx = input.call === "YES" ? input.yesPx : 1 - input.yesPx;
  const row: PaperTrade = {
    start: input.start,
    enteredAt: input.now,
    call: input.call,
    yesPx: input.yesPx,
    entryPx,
    startPx: input.startPx,
    pUp: input.pUp != null && input.pUp >= 0 && input.pUp <= 1 ? input.pUp : null,
    exitAt: null,
    result: null,
    pnl: null,
  };
  return [row, ...rows].slice(0, 200);
}

export function settlePaper(rows: PaperTrade[], candles: Candle[], now: number): PaperTrade[] {
  const closes = new Map(candles.filter((c) => (c.t + 60) * 1000 <= now).map((c) => [c.t, c.c]));
  let changed = false;
  const next = rows.map((row) => {
    if (row.result != null || now < (row.start + 900) * 1000) return row;
    const close = closes.get(row.start + 840);
    if (close == null) return row;
    changed = true;
    const up = close > row.startPx;
    const correct = row.call === "YES" ? up : !up;
    const pnl = correct ? 1 - row.entryPx : -row.entryPx;
    return { ...row, exitAt: (row.start + 900) * 1000, result: correct ? "CORRECT" as const : "WRONG" as const, pnl };
  });
  return changed ? next : rows;
}

export function paperRead(rows: PaperTrade[]) {
  const done = rows.filter((row) => row.result != null && row.pnl != null);
  const correct = done.filter((row) => row.result === "CORRECT").length;
  const pnl = done.reduce((sum, row) => sum + (row.pnl ?? 0), 0);
  const half = Math.floor(done.length / 2);
  const newer = half >= 3 ? done.slice(0, half) : [];
  const older = half >= 3 ? done.slice(half) : [];
  const rate = (list: PaperTrade[]) => list.length ? list.filter((row) => row.result === "CORRECT").length / list.length : null;
  const newerRate = rate(newer);
  const olderRate = rate(older);
  const trend = newerRate == null || olderRate == null ? "short" : newerRate > olderRate + 0.02 ? "better" : newerRate + 0.02 < olderRate ? "worse" : "flat";
  return { done: done.length, correct, pnl, open: rows.filter((row) => row.result == null).length, trend };
}
