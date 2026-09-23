/**
 * arb-bot: a cloneable agent that participates in priority-fee bidding via gap-driven swaps.
 *
 * Env vars:
 *   BID_PROFIT_FRACTION  fraction of expected profit routed to the priority fee (default 0.3)
 *
 * Strategy:
 *   1. gap = fair / pool - 1
 *   2. noop if |gap| < GAP_THRESHOLD
 *   3. swap direction: gap>0 -> USDC->WETH, gap<0 -> WETH->USDC
 *   4. swap size: size-bps proportional like simple-rule (cap extended to 50%)
 *   5. expected profit (USDC) ~= size_usdc * |gap|
 *   6. priority fee = profit(wei) * PROFIT_FRACTION / estimated gas
 *   7. clamp(bid, defaultPriorityFee, maxPriorityFee)
 */
/**
 * JP: 他の裁定戦略が「どのvenueで・どちらの方向に・いくら」を決めるのに対し、この agent は
 * さらに**priority feeの入札額**まで自分で計算する点が特徴的（他の多くの参照戦略は
 * `obs.limits.defaultPriorityFeePerGasWei` をそのまま使うだけ）。期待利益（サイズ×乖離幅）の
 * 一定割合（既定30%）をガス代の入札に回すことで、他agentとの同一ブロック内の優先順位争いに
 * 勝ちやすくする — CLAUDE.mdの「competition signal」（ADR 0011。send.tsの`computeCompetition`）
 * が自分で計算する「直近ブロックの最高入札額」を見て、それを上回る入札をする、という
 * より洗練された戦略への出発点になる（ここでは固定割合だが、自分の戦略ではcompetition signal
 * を参照してより賢く入札額を決めることもできる）。`ctx.log()`で`signals`（gap/profitUsdc/bidGwei
 * 等の中間計算値）を残しているのも良い実践例 — decide型でも`ctx`は受け取れる（第2引数）。
 */
import type { AgentAction, AgentContext, AgentObservation } from "@eris/sdk";

const PROFIT_FRACTION = Number(process.env.BID_PROFIT_FRACTION ?? "0.3");
const GAS_UNITS_ESTIMATE = 180_000n;
const GAP_THRESHOLD = 0.0005;
const SIZE_BPS_MIN = 250;
const SIZE_BPS_MAX = 5000;

if (!Number.isFinite(PROFIT_FRACTION) || PROFIT_FRACTION < 0) {
  process.stderr.write(
    `invalid BID_PROFIT_FRACTION: ${process.env.BID_PROFIT_FRACTION}\n`,
  );
  process.exit(1);
}

export function decide(
  obs: AgentObservation,
  ctx: AgentContext,
): AgentAction | null {
  const round = obs.round;
  const signals: Record<string, number> = {};
  const noop = (reason: string): AgentAction => {
    const action: AgentAction = { type: "noop", reason };
    ctx.log({ round, action, reason, signals });
    return action;
  };
  const fair = obs.fairPriceUsdcPerWeth;
  if (!Number.isFinite(fair) || fair <= 0) return noop("invalid fair");
  // Look at the 3 venues and pick the one with the largest deviation
  const venues: Array<{
    swapType: "swap" | "balancerSwap" | "curveSwap";
    price: number;
  }> = [];
  const uni = obs.protocols?.uniswap?.pool?.priceUsdcPerWeth;
  if (Number.isFinite(uni) && (uni ?? 0) > 0)
    venues.push({ swapType: "swap", price: uni as number });
  const bal = obs.protocols?.balancer?.priceUsdcPerWeth;
  if (Number.isFinite(bal) && (bal ?? 0) > 0)
    venues.push({ swapType: "balancerSwap", price: bal as number });
  const curve = obs.protocols?.curve?.priceUsdcPerWeth;
  if (Number.isFinite(curve) && (curve ?? 0) > 0)
    venues.push({ swapType: "curveSwap", price: curve as number });
  if (venues.length === 0) return noop("no venue");
  let best = venues[0];
  let gap = fair / venues[0].price - 1;
  for (const v of venues) {
    const g = fair / v.price - 1;
    if (Math.abs(g) > Math.abs(gap)) {
      gap = g;
      best = v;
    }
  }
  signals.venuePrice = best.price;
  signals.fair = fair;
  signals.gap = gap;
  signals.gapBps = gap * 10_000;
  if (Math.abs(gap) < GAP_THRESHOLD) return noop("gap too small");

  const tokenIn = gap > 0 ? "USDC" : "WETH";
  // The balance is the capital; SIZE_BPS_MIN..MAX is how much of it this agent puts behind a gap.
  const held = BigInt(
    tokenIn === "WETH" ? obs.balances.wethWei : obs.balances.usdcUnits,
  );
  const sizeBps = Math.min(
    SIZE_BPS_MAX,
    Math.max(SIZE_BPS_MIN, Math.floor(Math.abs(gap) * 200_000)),
  );
  const amountIn = (held * BigInt(sizeBps)) / 10_000n;
  if (amountIn <= 0n) return noop("nothing to trade with");

  const sizeUsdc =
    tokenIn === "USDC"
      ? Number(amountIn) / 1e6
      : (Number(amountIn) / 1e18) * fair;
  const profitUsdc = sizeUsdc * Math.abs(gap);
  const profitGwei = Math.max(0, Math.floor((profitUsdc / fair) * 1e9));
  const profitWei = BigInt(profitGwei) * 1_000_000_000n;
  const fractionScale = 10_000n;
  const fractionNum = BigInt(
    Math.max(0, Math.floor(PROFIT_FRACTION * Number(fractionScale))),
  );
  const bidPerGasWei =
    (profitWei * fractionNum) / fractionScale / GAS_UNITS_ESTIMATE;

  const minBid = BigInt(obs.limits.defaultPriorityFeePerGasWei);
  const maxBid = BigInt(obs.limits.maxPriorityFeePerGasWei);
  const bid =
    bidPerGasWei < minBid
      ? minBid
      : bidPerGasWei > maxBid
        ? maxBid
        : bidPerGasWei;

  signals.sizeUsdc = sizeUsdc;
  signals.profitUsdc = profitUsdc;
  signals.bidGwei = Number(bid / 1_000_000_000n);
  const action: AgentAction = {
    type: best.swapType,
    tokenIn,
    amountIn: amountIn.toString(),
    maxPriorityFeePerGasWei: bid.toString(),
    slippageBps: 75,
  };
  ctx.log({ round, action, signals });
  return action;
}
