// Dip Hunter: a dip-buying BTC bot for the make.fun 24h BTC race.
//
// The idea, in one line: buy sharp intraday dips, sell the bounce. On 1-minute
// bars the market spends most of its time grinding and occasionally drops hard
// and fast, then bounces part of the way back. A round trip costs about 26 bps
// in fees, slippage and impact, so a trade has to catch a move larger than
// that — and it has to stay out of the grind, where every cross of a moving
// average is a whipsaw. This bot trades rarely and only on sizeable drops.
//
//   - History: every close the bot has seen, per symbol (warm-up bars included).
//     No trade is decided before 61 closes exist, so the 60-minute high is real.
//   - Entry, on a bar's close (filled at the next open): the close is at least
//     2% below the highest close of the last 61 bars (the current bar included),
//     on a symbol the bot does not hold. It buys with all its cash.
//   - Exit, the whole position: the close is at least 1% above the entry close
//     (the bounce), or at least 2% below it (the drop kept going — cut it), or
//     the position has been held 180 bars (3 hours — the bounce is not coming).
//     An exit the market refuses (a price past the slippage cap at the next
//     open) is sent again on the next bar while its reason still holds.
//   - One position at most, long only, no leverage, no martingale: after a
//     sell the bot waits for a fresh 2% drop before it buys again.
//   - Deterministic: float64 arithmetic on + - * / alone, no clock, no
//     randomness, no environment; the same bars give the same orders, run
//     after run. The entry reference is the decision bar's close, not the
//     fill price, so a fill a minute later cannot change the plan.
//
// On the published dev window (24h of cbBTC 1-minute bars, $67,216 down to
// $64,524, -4.00%) this makes 4 round trips, all winners, net PnL about
// +$21 on $1,000 with max drawdown under 2%. Buy-and-hold loses about $44
// on the same window, and the EMA-cross and Bollinger baselines lose
// $100+ to whipsaw. The edge is the discipline: only the big drops, only
// the quick bounce, never the grind.
//
// Laid out like an entrant's repository: the grader runs `node /bot/main.ts`
// with this directory mounted at /bot; vendor/makefun-bars.ts is a
// byte-identical copy of the kit's sdk/makefun-bars.ts.

import { runBars, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

/** How far the close must fall from the 61-bar high to arm a buy. */
const DROP = 0.02;
/** How far the close must rise above the entry close to take the bounce. */
const REBOUND = 0.01;
/** How far the close may fall below the entry close before the loss is cut. */
const STOP = 0.02;
/** Bars (minutes) a position may be held before the bot gives up on it. */
const MAX_HOLD_BARS = 180;
/** Closes in the lookback, current bar included. */
const LOOKBACK = 61;
const MAX_SLIPPAGE_BPS = 100;

/** Per-symbol state: the closes seen and the open position's reference. */
interface Series {
  closes: number[];
  /** The decision-bar close of the current position, once it has appeared. */
  entry: number | null;
  /** The batch seq at which the current position was decided. */
  entrySeq: number;
  /** The close the last buy was decided on, until its position appears. */
  pendingEntry: number | null;
  /** The batch seq that buy was decided on. */
  pendingSeq: number;
}

const series = new Map<string, Series>();

function getSeries(symbol: string): Series {
  let s = series.get(symbol);
  if (s === undefined) {
    s = { closes: [], entry: null, entrySeq: 0, pendingEntry: null, pendingSeq: -1 };
    series.set(symbol, s);
  }
  return s;
}

await runBars({
  onBatch(state: BarsState, batch) {
    for (const bar of batch.bars) {
      const s = getSeries(bar.symbol);
      s.closes.push(Number(bar.c));
    }
    if (state.warmingUp) return [];

    const { caps, fees } = state.hello;
    const orders: (SellInput | BuyInput)[] = [];

    for (const { symbol } of state.hello.symbols) {
      const s = series.get(symbol);
      if (s === undefined || s.closes.length < LOOKBACK) continue;
      const held = state.positions.get(symbol);
      const close = Number(state.close(symbol));
      if (close <= 0) continue;

      if (held !== undefined) {
        // The position is real (the account says so). Anchor the entry
        // reference to the close the buy was decided on — the decision bar's
        // close, not the fill bar's — so a fill a minute later cannot move
        // the exit levels. A buy the market refused leaves no position and
        // its pending reference is dropped once a bar has passed.
        if (s.entry === null) {
          s.entry = s.pendingEntry ?? close;
          s.entrySeq = s.pendingSeq >= 0 ? s.pendingSeq : state.seq;
          s.pendingEntry = null;
          s.pendingSeq = -1;
        }
        const entry = s.entry;
        const heldBars = state.seq - s.entrySeq;
        const up = close >= entry * (1 + REBOUND);
        const down = close <= entry * (1 - STOP);
        const stale = heldBars >= MAX_HOLD_BARS;
        if (up || down || stale) {
          orders.push({ side: 'sell', symbol, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS });
        }
      } else {
        // No position: drop a pending reference older than one bar (its buy
        // was refused), then a fresh drop from the 61-bar high arms a
        // full-size buy.
        if (s.pendingEntry !== null && state.seq - s.pendingSeq > 1) {
          s.pendingEntry = null;
          s.pendingSeq = -1;
        }
        s.entry = null;
        let high = 0;
        for (let i = s.closes.length - LOOKBACK; i < s.closes.length; i++) {
          if (s.closes[i] > high) high = s.closes[i];
        }
        if (close <= high * (1 - DROP)) {
          let slice = state.cash;
          const byWeight = (BigInt(caps.max_weight_bps) * state.equity) / 10000n;
          if (slice > byWeight) slice = byWeight;
          if (slice > 0n && slice >= BigInt(fees.min_notional_quote_units)) {
            orders.push({ side: 'buy', symbol, notional_quote_units: slice, max_slippage_bps: MAX_SLIPPAGE_BPS });
            s.pendingEntry = close;
            s.pendingSeq = state.seq;
          }
        }
      }
      if (orders.length >= caps.max_orders_per_bar) break;
    }
    return orders;
  },
});
