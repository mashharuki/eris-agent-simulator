// Sizing a swap you can actually pay for.
//
// Every bundled arbitrage agent used to pick its direction purely from the price gap and its size
// purely from `obs.limits` (a cap that no longer exists), with no reference to what the wallet held. Under the competition's
// USDC-only funding (`funding.wethWei: "0"`, so that nobody starts exposed to price drift) that
// meant an agent seeing a rich pool proposed selling WETH it did not have. The runtime rejected the
// action, the agent proposed it again the next block, and the run ended with the agent having never
// traded -- measured at 359 rejections out of 359 decisions for venue-arb in `calm`, and clean-arb,
// stat-arb and adaptive-arb reporting exactly 0.00 PnL for the same reason (issue #54).
//
// Two rules come out of that, and both belong here rather than in each agent:
//
//   1. Never propose a leg you cannot fund. A rejected action is indistinguishable in the score from
//      a strategy that chose not to trade, so the failure is silent.
//   2. When there is a choice of venue, choose among the ones you can fund. An agent holding only
//      USDC can still arbitrage -- it buys the cheap venue rather than selling the rich one.
//
// JP: CLAUDE.md の「発注上限は無い」節で触れられている共通ヘルパ本体。昔は `obs.limits` に
// 環境が配る固定の発注上限があり、みんなそれを見てサイズを決めていた（＝全員が保有額とも
// 相場の良し悪しとも無関係に同じサイズで張っていた）。今はその上限自体が撤廃されたので、
// **「自分の残高のうち何%を1回の注文に使うか」を各エージェントが自分で決める**必要があり、
// この決定を毎回書かずに済むようにしたのが `sized(obs, token, bps)`。
//   - `balanceOf`: token種別ごとに正しいフィールド（USDC/WETH/その他base/stable）から残高を読む
//   - `affordable`: 欲しい量と実際の残高の小さい方を返す。ダスト（1 USDC/0.001 WETH未満）なら
//     0を返す — 0は「他のレグを選ぶか何もしない」の合図であって「とりあえず送って
//     runtimeに弾かせる」の代わりではない
//   - `sized`: 残高の bps（basis points、1万分の1単位）を指定してサイズを決める。例えば
//     `sized(obs, "USDC", 500)` は USDC残高の5%を使う、という意味
//   - `canFund`: そもそも最低額を持っているかどうかの事前チェック
import type { AgentObservation } from "@eris/sdk";

// Dust floor. Below this a leg is not worth a transaction: the gas and the fee eat it, and the
// swap may not even clear the venue's minimum.
const MIN_USDC_UNITS = 1_000_000n; // 1 USDC (6 decimals)
const MIN_WETH_WEI = 1_000_000_000_000_000n; // 0.001 WETH

export function minimumFor(tokenIn: string): bigint {
  return tokenIn === "USDC" ? MIN_USDC_UNITS : MIN_WETH_WEI;
}

// What the wallet holds of the token a swap would spend. Non-WETH bases come from balances.bases
// when the run has them (ADR 0013); stables other than USDC come from balances.stables, which since
// issue #27 keeps them apart instead of summing them into usdcUnits. An unknown symbol reads as
// zero, which is the safe direction -- it makes the agent skip rather than propose something
// unfundable.
export function balanceOf(obs: AgentObservation, tokenIn: string): bigint {
  if (tokenIn === "USDC") return BigInt(obs.balances.usdcUnits);
  if (tokenIn === "WETH") return BigInt(obs.balances.wethWei);
  const stable = obs.balances.stables?.[tokenIn];
  if (stable) return BigInt(stable.balance);
  const bases = (obs.balances as unknown as { bases?: Record<string, string> })
    .bases;
  const raw = obs.baseBalances?.[tokenIn] ?? bases?.[tokenIn];
  return raw === undefined ? 0n : BigInt(raw);
}

// The amount actually spendable: what the wallet holds, capped at what the caller wanted.
//
// There used to be a third term here -- the rules' per-round cap -- and every agent leaned on it
// for sizing. The competition has no order-size cap any more, so the balance is the only bound the
// environment supplies and how much of it to commit is the strategy's own decision. `sized()` below
// is where an agent states that decision explicitly rather than inheriting it from a rule.
//
// Returns 0n when the leg is not worth doing, which callers should treat as "pick another leg or
// do nothing" -- never as "send it anyway and let the runtime reject it".
export function affordable(
  obs: AgentObservation,
  tokenIn: string,
  desired: bigint,
): bigint {
  const held = balanceOf(obs, tokenIn);
  const spendable = desired < held ? desired : held;
  return spendable >= minimumFor(tokenIn) ? spendable : 0n;
}

/**
 * How much of a holding to put behind one order, in basis points of the balance.
 *
 * This is the replacement for reading a cap out of `obs.limits`, and the difference matters: the
 * cap was a fixed number the environment handed to everyone, so every agent traded the same size
 * regardless of how much it held or how good the opportunity was. A fraction of the balance
 * compounds with the agent's own results and shrinks when it loses, which is what sizing is for.
 *
 * Returns 0n below the dust floor, same as `affordable`.
 */
export function sized(
  obs: AgentObservation,
  tokenIn: string,
  fractionBps: number,
): bigint {
  const bps = BigInt(Math.max(0, Math.min(10_000, Math.round(fractionBps))));
  return affordable(obs, tokenIn, (balanceOf(obs, tokenIn) * bps) / 10_000n);
}

export function canFund(obs: AgentObservation, tokenIn: string): boolean {
  return balanceOf(obs, tokenIn) >= minimumFor(tokenIn);
}
