// JP: Uniswap単体の価格とfair priceの乖離だけを見る、最小構成の裁定戦略（my-arbと似ているが
// venue横断はせずUniswap一本のみ、かつ`canFund`のような資金チェックも省いた最も素朴な版）。
// `obs.protocols.uniswap!`（non-null assertion）を使っているのは、Uniswapが常に有効な前提で
// 書かれた教材用コードだから — 実戦ではUniswapが無効な run で落ちるので、本番の戦略には
// 向かない書き方である点に注意。サイズは乖離幅（gap）に比例させ、最小250bps〜最大2500bpsの
// 範囲でクランプしている。
import type { AgentAction, AgentObservation } from "@eris/sdk";

export function decide(obs: AgentObservation): AgentAction | null {
  const pool = obs.protocols.uniswap!.pool.priceUsdcPerWeth;
  const fair = obs.fairPriceUsdcPerWeth;
  const gap = fair / pool - 1;
  if (Math.abs(gap) < 0.0015) {
    return { type: "noop", reason: "gap too small" };
  }
  const tokenIn = gap > 0 ? "USDC" : "WETH";
  // Size against the balance: nothing else bounds an order, so how much of the stack to commit is
  // the strategy's call.
  const held = BigInt(
    tokenIn === "WETH" ? obs.balances.wethWei : obs.balances.usdcUnits,
  );
  const sizeBps = Math.min(
    2500,
    Math.max(250, Math.floor(Math.abs(gap) * 200_000)),
  );
  const amountIn = (held * BigInt(sizeBps)) / 10_000n;
  if (amountIn <= 0n) return { type: "noop", reason: "nothing to trade with" };
  return {
    type: "swap",
    tokenIn,
    amountIn: amountIn.toString(),
    maxPriorityFeePerGasWei: obs.limits.defaultPriorityFeePerGasWei,
    slippageBps: 50,
  };
}
