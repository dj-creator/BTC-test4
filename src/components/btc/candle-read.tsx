import { useState } from "react";
import type { CandleSignal, PatternScore } from "@/lib/btc/candles";
import { projectCandles, scoreLine } from "@/lib/btc/candles";
import type { Candle } from "@/lib/btc/types";

function tone(mark: string) {
  if (mark === "BULLISH") return "text-up";
  if (mark === "BEARISH") return "text-down";
  if (mark === "MIXED") return "text-warn";
  return "text-muted";
}

export function CandleRead({ signal, scores }: { signal: CandleSignal; scores: Record<string, PatternScore> }) {
  return (
    <article className="border border-line bg-surface p-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[11px] tracking-[0.18em] text-muted">RECENT CANDLE ANALYSIS</p>
        <p className="text-[11px] tracking-widest text-up">LIVE</p>
      </div>
      <p className="mt-3 text-[11px] tracking-[0.16em] text-muted">CANDLE READ</p>
      <ul className="mt-1 space-y-1 font-mono text-sm">
        {signal.reads.map((row) => (
          <li key={row.label} className="flex justify-between gap-3">
            <span className="text-muted">{row.label.replace(" MINUTE", "M")}</span>
            <span className={tone(row.mark)}>{row.mark}</span>
          </li>
        ))}
      </ul>
      <p className={`mt-2 text-sm ${signal.overall.includes("BULL") && !signal.overall.includes("BEAR") ? "text-up" : signal.overall.includes("BEAR") && !signal.overall.includes("BULL") ? "text-down" : "text-warn"}`}>
        Overall: {signal.overall}
      </p>
      <div className="mt-3 space-y-3">
        {signal.reads.map((row) => (
          <div key={row.label} className="border-t border-line pt-2">
            <p className="text-[11px] tracking-widest text-muted">{row.label}</p>
            <p className="mt-1 flex items-baseline justify-between gap-3 text-sm">
              <span className={tone(row.mark)}>{row.name}</span>
              <span className="font-mono text-[11px] text-muted">{row.status === "NONE" ? "—" : row.status}</span>
            </p>
            <p className="font-mono text-[11px] text-muted">{row.name === "No strong pattern" ? "Saved record: not a directional pattern" : scoreLine(scores, row.name)}</p>
            {row.strength !== "NONE" ? <p className="text-[11px] tracking-widest text-muted">Strength: {row.strength}</p> : null}
            <p className="mt-1 text-sm">{row.detail}</p>
            <p className="mt-1 text-sm text-muted">Interpretation: {row.meaning}</p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] tracking-[0.16em] text-muted">WHY?</p>
      <p className="mt-1 text-[11px] tracking-widest text-up">SUPPORTS UP</p>
      <ul className="text-sm">{signal.supportsUp.length ? signal.supportsUp.map((line) => <li key={line}>• {line}</li>) : <li className="text-muted">No clear bullish candle evidence.</li>}</ul>
      <p className="mt-2 text-[11px] tracking-widest text-down">SUPPORTS DOWN</p>
      <ul className="text-sm">{signal.supportsDown.length ? signal.supportsDown.map((line) => <li key={line}>• {line}</li>) : <li className="text-muted">No clear bearish candle evidence.</li>}</ul>
      <p className="mt-2 text-[11px] text-muted">Confirmed patterns count more than forming ones. A saved hit means that pattern’s direction matched the later 15-minute Coinbase close. It does not change the percent.</p>
    </article>
  );
}

function Sketch({ past, future }: { past: Candle[]; future: Candle[] }) {
  const rows = [...past, ...future];
  const prices = rows.flatMap((c) => [c.h, c.l]);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = Math.max(1, max - min);
  const w = 560;
  const h = 180;
  const step = w / rows.length;
  const y = (px: number) => 12 + ((max - px) / span) * (h - 24);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="mt-2 h-44 w-full">
      {rows.map((c, i) => {
        const up = c.c >= c.o;
        const color = i >= past.length ? (up ? "#7eb6ff" : "#c084fc") : up ? "var(--color-up)" : "var(--color-down)";
        const x = i * step + step * 0.2;
        const bar = step * 0.6;
        return (
          <g key={`${c.t}-${i}`}>
            <line x1={x + bar / 2} x2={x + bar / 2} y1={y(c.h)} y2={y(c.l)} stroke={color} strokeWidth={1.4} strokeDasharray={i >= past.length ? "2 2" : undefined} />
            <rect x={x} y={Math.min(y(c.o), y(c.c))} width={bar} height={Math.max(2, Math.abs(y(c.o) - y(c.c)))} fill={i >= past.length ? "none" : color} stroke={color} />
          </g>
        );
      })}
    </svg>
  );
}

export function ProjectedOutcome({
  signal,
  candles,
  spot,
  nowSec,
  scores,
}: {
  signal: CandleSignal;
  candles: Candle[];
  spot: number | null;
  nowSec: number;
  scores: Record<string, PatternScore>;
}) {
  const [tf, setTf] = useState<1 | 15>(1);
  const projection = projectCandles(signal, candles, spot, nowSec, tf);
  if (!projection) return <article className="border border-line bg-surface p-3 text-sm text-muted">Need a live price and a few candles before a projected path can be drawn.</article>;
  const tone = projection.call === "UP" ? "text-up" : projection.call === "DOWN" ? "text-down" : "text-muted";
  const end = projection.future.at(-1);
  return (
    <article className="border border-line bg-surface p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] tracking-[0.18em] text-muted">PROJECTED CANDLE OUTCOME</p>
        <div className="flex border border-line">
          {([1, 15] as const).map((n) => (
            <button key={n} type="button" className={`px-2 py-1 text-[11px] tracking-widest ${tf === n ? "bg-fg text-bg" : "text-muted"}`} onClick={() => setTf(n)}>
              {n}M
            </button>
          ))}
        </div>
      </div>
      <p className={`mt-2 font-mono text-3xl ${tone}`}>{projection.call}</p>
      <p className="text-sm">{projection.pattern} · {projection.timeframe.toUpperCase()} · {projection.status}</p>
      <p className="font-mono text-[11px] text-muted">{scoreLine(scores, projection.pattern)}</p>
      <p className="mt-1 font-mono text-xs text-muted">
        After 5 candles: {end ? `$${end.c.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "—"}
      </p>
      <Sketch past={projection.past} future={projection.future} />
      <p className="mt-1 text-[11px] text-muted">Solid candles already happened. Outlined candles are the next 5 {tf === 1 ? "one-minute" : "fifteen-minute"} candles from this timeframe’s pattern.</p>
      <p className="mt-2 text-sm">{projection.note}</p>
    </article>
  );
}
