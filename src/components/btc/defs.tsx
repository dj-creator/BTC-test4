import { DeskNav } from "./plan";

const groups: { title: string; hint: string; terms: { name: string; plain: string; use: string }[] }[] = [
  {
    title: "THE PICTURE",
    hint: "What one candle is saying.",
    terms: [
      { name: "Candlestick", plain: "One short chunk of time. The fat part is the open and the close. The thin lines are the high and the low. Green finished up. Red finished down.", use: "The estimates page reads these before it names a pattern." },
      { name: "Open, high, low, close", plain: "Open is the first price. High is the top. Low is the bottom. Close is the last price. Most lines are built from the close.", use: "A close near the high is a bullish tell. A close near the low is a bearish tell." },
      { name: "Volume", plain: "How much Bitcoin actually traded. A big jump with almost nobody trading is a weak move.", use: "A pattern with heavier volume counts as stronger context." },
      { name: "Relative volume", plain: "This candle versus the usual amount. 2× means twice as busy. Busy does not pick the direction by itself.", use: "The candle read marks volume as confirmed only after the candle closes." },
    ],
  },
  {
    title: "THE LINES",
    hint: "Blue is fast. Purple is slow. Gray is VWAP.",
    terms: [
      { name: "EMA 9", plain: "The fast average. It hugs the price. Slipping under it means the very short trend just turned down.", use: "Shown in blue on the live chart." },
      { name: "EMA 21", plain: "The slower average. The nearby trend. Back above it can mean a dip is fading. Under it, the dip is still on.", use: "Shown in purple. Blue above purple is a short uptrend." },
      { name: "VWAP", plain: "The average price people paid, with bigger trades counting more. Above it, buyers paid up. Below it, sellers pushed.", use: "Shown in light gray. It explains the picture. It does not move the percent." },
      { name: "SMA", plain: "An average where every price counts the same. An EMA reacts faster. This desk uses EMAs.", use: "Here so the name is not a mystery if you see it somewhere else." },
    ],
  },
  {
    title: "THE PATH",
    hint: "Direction after you ignore one wiggle.",
    terms: [
      { name: "Momentum", plain: "How far price moved over a timer, like 30 seconds or 5 minutes.", use: "A small piece of the percent comes from recent momentum." },
      { name: "Accelerating or slowing", plain: "Is the push getting stronger, or running out? Up and slowing is still up, but weaker.", use: "Used in the plain-English read, not as a sure call." },
      { name: "ATR and volatility", plain: "How many dollars a normal candle covers. It does not say up or down. Wild markets can still reach a far target.", use: "The percent needs this. A quiet hour and a wild hour are not the same bet." },
      { name: "Market structure", plain: "Higher peaks and higher dips are up. Lower peaks and lower dips are down. If the turns do not line up, it is chop.", use: "Support is where dips stopped. Resistance is where rallies stopped. Neither is a magic line." },
    ],
  },
  {
    title: "THE CROWD",
    hint: "Plans versus trades that already happened.",
    terms: [
      { name: "10-tick tape", plain: "One candle is 10 trades, not 10 seconds. The 100-tick tape is the slower check.", use: "If they agree, the percent can move by at most 3 points." },
      { name: "Order book", plain: "People waiting to buy or sell at a chosen price. These are plans. The list can vanish in a second.", use: "More orders on one side is an imbalance. It is not a finished trade." },
      { name: "Aggressive flow", plain: "Someone who trades right now. Buyers who pay the seller’s price push up. Sellers who hit the bid push down.", use: "Large trades show up as big-money direction on the desk." },
      { name: "ETH and SOL tables", plain: "The last 15 finished minutes for two other coins, with the percent that closed up or down.", use: "Dominance is context. It does not change the Bitcoin percent." },
    ],
  },
];

const used = [
  { name: "Window open", text: "The main question is whether price finishes above the Coinbase open." },
  { name: "Time left", text: "A far target with one minute left is harder than the same gap with ten minutes left." },
  { name: "Volatility", text: "The last hour of one-minute candles sets how wide a normal move is." },
  { name: "Momentum", text: "Recent direction adds a small push, not the whole answer." },
  { name: "10-tick tape", text: "Trade-by-trade pressure can nudge the percent a little, and only if the slower tape agrees." },
];

const explains = ["EMA 9 and EMA 21", "VWAP", "Candle pattern names", "ETH and SOL dominance", "Order book and large trades"];

export function Definitions() {
  return (
    <main className="min-h-screen bg-bg text-fg">
      <div className="page-wrap">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <DeskNav here="defs" />
          <p className="max-w-xl text-sm text-muted">The brain behind the desk, in plain words. The percent uses a short list. Everything else explains the picture.</p>
        </div>

        <section className="grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
          <article className="border border-accent/40 bg-surface p-3">
            <p className="text-[11px] tracking-[0.18em] text-accent">WHAT MOVES THE PERCENT</p>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {used.map((item) => (
                <li key={item.name} className="border border-line px-2 py-2">
                  <p className="text-[11px] tracking-widest text-muted">{item.name.toUpperCase()}</p>
                  <p className="mt-1 text-sm leading-snug">{item.text}</p>
                </li>
              ))}
            </ul>
          </article>
          <article className="border border-line bg-surface p-3">
            <p className="text-[11px] tracking-[0.18em] text-warn">EXPLAINS, DOES NOT MOVE IT</p>
            <ul className="mt-3 space-y-2 text-sm">
              {explains.map((item) => <li key={item} className="border border-line px-2 py-1.5">{item}</li>)}
            </ul>
            <p className="mt-3 text-sm text-muted">Candle names are saved so we can learn later if they were right. Until enough windows finish, they stay off the percent. The model is still experimental.</p>
          </article>
        </section>

        <Giveaways />

        <section className="grid items-start gap-3 xl:grid-cols-4">
          {groups.map((group) => (
            <div key={group.title} className="flex flex-col gap-2">
              <div>
                <p className="text-[11px] tracking-[0.18em] text-muted">{group.title}</p>
                <p className="text-sm text-muted">{group.hint}</p>
              </div>
              {group.terms.map((term) => (
                <article key={term.name} className="border border-line bg-surface px-3 py-2">
                  <p className="text-[11px] tracking-[0.16em] text-fg">{term.name.toUpperCase()}</p>
                  <p className="mt-1 text-sm leading-snug">{term.plain}</p>
                  <p className="mt-2 text-[11px] leading-snug text-accent">{term.use}</p>
                </article>
              ))}
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}

function Giveaways() {
  const bull = [
    "Close near the high, not the middle.",
    "Several green closes, each higher than the last.",
    "Price above the blue EMA 9 and the purple EMA 21.",
    "Price above the gray VWAP.",
    "A tall green candle on heavier volume.",
    "A higher low. The dip stops above the last dip.",
  ];
  const bear = [
    "Close near the low.",
    "Several red closes, each lower than the last.",
    "Price under both EMA lines.",
    "Price under VWAP.",
    "A tall red candle on heavier volume.",
    "A lower high. The bounce fails under the last bounce.",
  ];
  return (
    <section className="grid gap-3 lg:grid-cols-2">
      <article className="border border-up/40 bg-surface p-3">
        <p className="text-[11px] tracking-[0.16em] text-up">BULLISH GIVEAWAYS</p>
        <p className="mt-1 text-sm text-muted">Buyers look in charge. One sign is not enough.</p>
        <ul className="mt-2 grid gap-1 sm:grid-cols-2 text-sm">
          {bull.map((line) => <li key={line} className="border border-line px-2 py-1">{line}</li>)}
        </ul>
      </article>
      <article className="border border-down/40 bg-surface p-3">
        <p className="text-[11px] tracking-[0.16em] text-down">BEARISH GIVEAWAYS</p>
        <p className="mt-1 text-sm text-muted">Sellers look in charge. One sign is not enough.</p>
        <ul className="mt-2 grid gap-1 sm:grid-cols-2 text-sm">
          {bear.map((line) => <li key={line} className="border border-line px-2 py-1">{line}</li>)}
        </ul>
      </article>
    </section>
  );
}
