// JP: Uniswap V3の集中流動性（concentrated liquidity）LPを1回だけ建てる、最も単純なLP戦略。
// 現在のtickを中心に±20 tick spacing幅のレンジで、WETH/USDC残高の各1/10を投入する。
// `minted`（プロセス内のモジュールレベル変数）で「もう建てた」を記憶している点に注意 —
// これは decide() が呼ばれるたびに初期化されるものではなく、agent.tsのモジュールとして
// worker threadにロードされた時点から生き続ける状態（ただしLLM改訂やworker再生成が起きると
// リセットされる。`uni.positions.length > 0` というチェーン側の状態も同時に見ているのは
// そのフェイルセーフ）。手数料収益狙いの最も基本形で、レンジを外れた場合の対応（リバランス等）
// は一切していない。
import type { AgentAction, AgentObservation } from "@eris/sdk";

let minted = false;

export function decide(obs: AgentObservation): AgentAction | null {
  const uni = obs.protocols.uniswap;
  if (!uni) return { type: "noop", reason: "uniswap unavailable" };
  if (minted || uni.positions.length > 0) {
    return { type: "noop", reason: "LP already opened" };
  }

  const spacing = uni.pool.tickSpacing;
  const center = Math.floor(uni.pool.tick / spacing) * spacing;
  minted = true;
  return {
    type: "mintLiquidity",
    tickLower: center - spacing * 20,
    tickUpper: center + spacing * 20,
    // A tenth of the wallet on each side. There is no LP size cap any more, so the fraction is
    // this agent's own statement of how much inventory it is willing to tie up in a range.
    amountWethDesired: (BigInt(obs.balances.wethWei) / 10n).toString(),
    amountUsdcDesired: (BigInt(obs.balances.usdcUnits) / 10n).toString(),
    maxPriorityFeePerGasWei: obs.limits.defaultPriorityFeePerGasWei,
    slippageBps: 100,
  };
}
