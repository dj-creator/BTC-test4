import { useQuery } from "@tanstack/react-query";
import { getFlipWatch, type FlipHeadline } from "@/lib/btc/snapshot";

function ago(at: number | null) {
  if (at == null) return "";
  const mins = Math.max(0, Math.round((Date.now() - at) / 60_000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 36) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function compact(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  return `$${Math.round(n / 1000)}k`;
}

function tone(kind: FlipHeadline["kind"]) {
  if (kind === "flip") return "text-warn";
  if (kind === "whale") return "text-accent";
  return "text-muted";
}

export function FlipWatch() {
  const query = useQuery({ queryKey: ["flip-watch"], queryFn: () => getFlipWatch(), refetchInterval: 15_000 });
  const rows = query.data?.headlines ?? [];
  const flips = rows.filter((row) => row.kind === "flip" || row.kind === "whale");
  const shown = (flips.length ? flips : rows).slice(0, 6);
  const prints = query.data?.prints ?? [];
  const whales = query.data?.whales ?? [];
  return (
    <article className="flex flex-1 flex-col border border-line bg-surface p-3">
      <p className="text-[11px] tracking-[0.18em] text-muted">FREE FLIP WATCH</p>
      <p className="mt-1 text-sm text-muted">Public headlines, Coinbase prints, and the largest free on-chain transfers. No paid feed. This does not change the percent.</p>
      {query.data?.error ? <p className="mt-2 text-sm text-warn">{query.data.error}</p> : null}
      <p className="mt-3 text-[11px] tracking-widest text-muted">COULD MOVE A WINDOW</p>
      {shown.length === 0 ? <p className="mt-1 text-sm text-muted">{query.isLoading ? "Checking free feeds." : "No free headlines yet."}</p> : (
        <ul className="mt-1 space-y-2">
          {shown.map((row) => (
            <li key={row.url || row.title} className="text-sm">
              <a className="hover:text-accent" href={row.url || undefined} target="_blank" rel="noreferrer">{row.title}</a>
              <p className={`text-[11px] ${tone(row.kind)}`}>{row.kind === "flip" ? "FLIP RISK" : row.kind === "whale" ? "WHALE TALK" : "MARKET"} · {row.source} · {ago(row.at)}</p>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[11px] tracking-widest text-muted">BIGGEST FREE CHAIN TRANSFERS</p>
      <p className="text-[11px] text-muted">Latest block sample and the public mempool batch. Not every transfer on earth.</p>
      {whales.length === 0 ? <p className="mt-1 text-sm text-muted">{query.isLoading ? "Looking for large transfers." : "No transfer over 1 BTC in the free sample right now."}</p> : (
        <ul className="mt-1 space-y-1 font-mono text-xs">
          {whales.map((row) => (
            <li key={row.txid} className="flex items-baseline justify-between gap-3">
              <a className="text-fg hover:text-accent" href={`https://blockstream.info/tx/${row.txid}`} target="_blank" rel="noreferrer">{row.btc.toFixed(2)} BTC{row.usd == null ? "" : ` · ${compact(row.usd)}`}</a>
              <span className="shrink-0 text-muted">{row.where === "block" ? "BLOCK" : "MEMPOOL"} · {ago(row.at)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[11px] tracking-widest text-muted">COINBASE PRINTS OVER $250K</p>
      {prints.length === 0 ? (
        <p className="mt-1 text-sm text-muted">None in the latest 100 public trades.</p>
      ) : (
        <ul className="mt-1 space-y-1 font-mono text-xs">
          {prints.map((row) => (
            <li key={`${row.t}-${row.usd}`} className="flex justify-between gap-3">
              <span className={row.taker === "buy" ? "text-up" : "text-down"}>{row.taker === "buy" ? "TAKER BUY" : "TAKER SELL"} {compact(row.usd)}</span>
              <span className="text-muted">{new Date(row.t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-auto pt-3 text-[11px] text-muted">Headlines refresh about every 90 seconds. Chain transfers and Coinbase prints refresh about every 15 seconds.</p>
    </article>
  );
}
