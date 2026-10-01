import type { PaperTrade } from "@/lib/btc/paper";
import { paperRead } from "@/lib/btc/paper";

function stamp(ms: number) {
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

function cents(n: number) {
  const sign = n > 0.005 ? "+" : n < -0.005 ? "−" : "";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

export function PaperBook({ rows }: { rows: PaperTrade[] }) {
  const read = paperRead(rows);
  const trend = read.trend === "better"
    ? "The newer half of this record is more correct than the older half."
    : read.trend === "worse"
      ? "The newer half is not more correct than the older half."
      : read.trend === "flat"
        ? "The newer half is about the same as the older half."
        : "Not enough cashed-out windows yet to say this record is improving.";
  return (
    <article className="flex flex-1 flex-col border border-line bg-surface p-3">
      <p className="text-[11px] tracking-[0.18em] text-muted">PAPER KALSHI RECORD</p>
      <p className="mt-1 text-sm text-muted">One contract. No real order. Entry is the Kalshi price saved 30–60 seconds into the window. Cash-out is the window end.</p>
      <p className={`mt-2 font-mono text-2xl ${read.pnl > 0.005 ? "text-up" : read.pnl < -0.005 ? "text-down" : "text-muted"}`}>
        {read.done ? cents(read.pnl) : "—"}
      </p>
      <p className="font-mono text-xs text-muted">
        {read.done ? `${read.correct} right of ${read.done} cashed out` : "No cashed-out windows yet"}
        {read.open ? ` · ${read.open} still open` : ""}
      </p>
      <p className="mt-1 text-sm text-muted">{trend} This list does not change the percent.</p>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted">A row is saved only while this page is open between 30 and 60 seconds, and only if the window-end call is YES or NO and Kalshi has a price. Past windows are not filled in.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {rows.slice(0, 16).map((row) => (
            <li key={row.start} className="py-2 font-mono text-xs">
              <p className="text-muted">{new Date(row.start * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} window</p>
              <p>
                Entered {stamp(row.enteredAt)} · {row.call} @ {Math.round(row.entryPx * 100)}¢
              </p>
              {row.result == null || row.exitAt == null || row.pnl == null ? (
                <p className="text-warn">Still open · cash out {stamp((row.start + 900) * 1000)}</p>
              ) : (
                <p className={row.result === "CORRECT" ? "text-up" : "text-down"}>
                  Cashed {stamp(row.exitAt)} · {row.result} · {cents(row.pnl)}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[11px] text-muted">Profit is per one contract if it paid $1 or $0 at the window end. The result uses the Coinbase close versus the Coinbase open, because an official BRTI print is not available. It is not Kalshi settlement and it is not money that moved.</p>
    </article>
  );
}
