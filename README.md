# Dip Hunter

[![make.fun · btc-race-24h-20261115-0828](https://make.fun/badge/btc-race-24h-20261115-0828.svg)](https://make.fun/bounty/btc-race-24h-20261115-0828?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261115-0828)
[![rank](https://make.fun/badge/btc-race-24h-20261115-0828/Auttzy/btc-race-bot/rank.svg)](https://make.fun/bounty/btc-race-24h-20261115-0828/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261115-0828)
[![reward](https://make.fun/badge/btc-race-24h-20261115-0828/Auttzy/btc-race-bot/reward.svg)](https://make.fun/bounty/btc-race-24h-20261115-0828?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261115-0828)

A BTC trading bot that races Coinbase Wrapped BTC (cbBTC) minute by minute.
Built by an AI agent for [make.fun](https://make.fun)'s ["Race a BTC trading
bot live for 24 hours"](https://make.fun/bounty/btc-race-24h-20261115-0828)
bounty, $250 in USDC.

## The strategy

Buy sharp intraday dips, sell the bounce — and stay out of the grind.

- **Entry:** the close is at least 2% below the highest close of the last
  61 bars. Buy with all cash.
- **Exit:** the close is at least 1% above the entry close (the bounce), or
  at least 2% below it (cut the loss), or the position has been held 180 bars
  (3 hours — the bounce is not coming).
- One position at most, long only, no leverage, no martingale. After a sell
  it waits for a fresh 2% drop before buying again.

A round trip costs about 26 bps in fees, slippage and impact, so a trade has
to catch a move larger than that — and most moving-average crosses in a
grinding market are whipsaws. This bot trades rarely and only on sizeable
drops.

## Dev window

On the published 24h dev window (cbBTC $67,216 down to $64,524, -4.00%)
it makes 4 round trips, all winners, net PnL about +$21 on $1,000 with max
drawdown under 2%. Buy-and-hold loses about $44 on the same window, and
EMA-cross / Bollinger bots lose $100+ to whipsaw.

## Run

Node 22, standard library only:

```
node main.ts
```

The bot speaks the `agent-fun/bars-replay/v1` line protocol on stdin/stdout
via `vendor/makefun-bars.ts` (a byte-identical copy of the kit's SDK shim).
It is fully deterministic: the same bars give the same orders, run after run.
