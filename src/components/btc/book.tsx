import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DeskNav } from "./plan";
import { getSnapshot } from "@/lib/btc/snapshot";
import { loadPaper, paperRead, savePaper, settlePaper, type PaperTrade } from "@/lib/btc/paper";

function stamp(ms: number) {
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

function cents(n: number) {
  const sign = n > 0.005 ? "+" : n < -0.005 ? "−" : "";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

function price(n: number) {
  return `${Math.round(n * 100)}¢`;
}

export function Book() {
  const query = useQuery({ queryKey: ["btc-snapshot"], queryFn: () => getSnapshot(), refetchInterval: 15_000 });
  const [now, setNow] = useState(() => Date.now());
  const [rows, setRows] = useState<PaperTrade[]>([]);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => {
    const prev = loadPaper();
    const next = settlePaper(prev, query.data?.candles ?? [], now);
    if (next !== prev) savePaper(next);
    setRows((current) => current === next ? current : next);
  }, [now, query.data?.candles]);
  const read = paperRead(rows);
  const hit = read.done ? Math.round((read.correct / read.done) * 100) : null;
  return (
    <main className="min-h-screen bg-bg text-fg">
      <div className="page-wrap">
        <DeskNav here="book" />
        <p className="max-w-3xl text-sm text-muted">Paper Kalshi account for the official desk call. One contract. The bot buys 20 seconds or more into the window, and only when the call is YES or NO and Kalshi has a price. It cashes out when the window ends. Nothing here is a real order.</p>
        <section className="grid gap-3 sm:grid-cols-3">
          <article className="border border-line bg-surface p-4">
            <p className="text-[11px] tracking-[0.18em] text-muted">PAPER PROFIT</p>
            <p className={`mt-2 font-mono text-3xl ${read.pnl > 0.005 ? "text-up" : read.pnl < -0.005 ? "text-down" : "text-muted"}`}>{read.done ? cents(read.pnl) : "—"}</p>
            <p className="text-sm text-muted">Per $1 contract, before any real fee.</p>
          </article>
          <article className="border border-line bg-surface p-4">
            <p className="text-[11px] tracking-[0.18em] text-muted">RECORD</p>
            <p className="mt-2 font-mono text-3xl">{read.done ? `${read.correct} / ${read.done}` : "—"}</p>
            <p className="text-sm text-muted">{hit == null ? "No cashed-out windows yet." : `${hit}% cashed out on the side the bot bought.`}</p>
          </article>
          <article className="border border-line bg-surface p-4">
            <p className="text-[11px] tracking-[0.18em] text-muted">STILL OPEN</p>
            <p className="mt-2 font-mono text-3xl">{read.open}</p>
            <p className="text-sm text-muted">Held until that window ends. The live percent is not changed by this book.</p>
          </article>
        </section>
        <article className="border border-line bg-surface p-4">
          <p className="text-[11px] tracking-[0.18em] text-muted">BUY IN / CASH OUT</p>
          {rows.length === 0 ? (
            <p className="mt-3 text-sm text-muted">No paper trades yet. Leave the live desk open. A row is saved the first time that window’s official call is YES or NO and Kalshi has a price.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full font-mono text-xs">
                <thead className="text-left text-muted">
                  <tr className="border-b border-line">
                    <th className="px-2 py-2 font-normal">Window</th>
                    <th className="px-2 py-2 font-normal">Buy in</th>
                    <th className="px-2 py-2 font-normal">Side</th>
                    <th className="px-2 py-2 font-normal">Paid</th>
                    <th className="px-2 py-2 font-normal">Bot chance</th>
                    <th className="px-2 py-2 font-normal">Cash out</th>
                    <th className="px-2 py-2 font-normal">Result</th>
                    <th className="px-2 py-2 font-normal">Profit</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.start} className="border-b border-line">
                      <td className="px-2 py-2 text-muted">{new Date(row.start * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</td>
                      <td className="px-2 py-2">{stamp(row.enteredAt)}</td>
                      <td className={`px-2 py-2 ${row.call === "YES" ? "text-up" : "text-down"}`}>{row.call}</td>
                      <td className="px-2 py-2">{price(row.entryPx)}</td>
                      <td className="px-2 py-2">{row.pUp == null ? "—" : `${Math.round(row.pUp * 100)}%`}</td>
                      <td className="px-2 py-2">{row.exitAt == null ? "holding" : stamp(row.exitAt)}</td>
                      <td className={`px-2 py-2 ${row.result === "CORRECT" ? "text-up" : row.result === "WRONG" ? "text-down" : "text-muted"}`}>{row.result ?? "OPEN"}</td>
                      <td className={`px-2 py-2 ${row.pnl != null && row.pnl > 0 ? "text-up" : row.pnl != null && row.pnl < 0 ? "text-down" : "text-muted"}`}>{row.pnl == null ? "—" : cents(row.pnl)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-[11px] text-muted">Saved in this browser. Cash-out uses the Coinbase close against the Coinbase open, because an official BRTI print is not available. This is memory for later testing. It is not a claim that the model has improved.</p>
        </article>
      </div>
    </main>
  );
}
