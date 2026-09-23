// Baseline "random trading". Kept deterministic since it serves as a yardstick for discrimination:
// the RNG source is derived from the market (SEED) and agent id -> same SEED = same yardstick (before/after is reproducible).
// JP: 「ランダムに取引するだけ」の対照群agent。noopとの違いは、noopが完全に何もしないのに対し
// こちらは実際に売買を行う（ただし方向もサイズも乱数任せ）ので、「取引すること自体」と
// 「良い判断をすること」の効果を切り分ける基準になる。決定論的な乱数（SEED×agentId由来）
// なので、同じSEEDで走らせれば毎回同じ行動列を再現できる（run前後の比較に使えるようにするため）。
// 「WETHしか触らない基準線」だとWBTC乖離イベントで常に「何もしなかった」ように見えてしまうため、
// `marketViews()` で有効な全base（WETH/WBTC等）から乱数で1つ選ぶようになっている点に注意。
import type { AgentAction, AgentObservation } from "@eris/sdk";
import { Rng } from "@eris/sdk/rng.js";
import { balanceOf } from "../lib/affordable.js";
import { marketViews } from "../lib/markets.js";

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const seed = Number(process.env.SEED ?? process.env.ERIS_FLOW_SEED ?? 1);
const agentId = process.env.ERIS_AGENT_ID ?? "random";
const rng = new Rng((seed ^ hashStr(agentId)) >>> 0);

export function decide(obs: AgentObservation): AgentAction | null {
  if (rng.next() < 0.35) {
    return { type: "noop", reason: "random skip" };
  }
  // Draw the market too, not just the direction. A yardstick that only ever touches WETH is not a
  // yardstick for a multi-asset field: it would score as "did nothing" on every WBTC dislocation
  // the real strategies were busy trading (ADR 0013).
  const views = marketViews(obs).filter((v) => v.venues.length > 0);
  if (views.length === 0) return { type: "noop", reason: "no venue" };
  const view = views[rng.int(0, views.length - 1)];
  const tokenIn = rng.next() < 0.5 ? view.base : "USDC";
  // A random slice of the balance, up to half of it. The yardstick used to draw against the rule
  // cap; with no cap left, "how much" has to come from somewhere, and the wallet is the honest
  // denominator for an agent whose whole point is to make no decisions.
  const held = balanceOf(obs, tokenIn);
  const amountIn = (held * BigInt(1 + rng.int(0, 50))) / 100n;
  if (amountIn <= 0n) return { type: "noop", reason: "nothing to trade with" };
  const action: Record<string, unknown> = {
    type: "swap",
    tokenIn,
    amountIn: amountIn.toString(),
    maxPriorityFeePerGasWei: obs.limits.defaultPriorityFeePerGasWei,
    slippageBps: 75,
  };
  // `base` only belongs on a non-WETH swap (ADR 0013): the WETH market is the untagged default.
  if (view.base !== "WETH") action.base = view.base;
  return action as unknown as AgentAction;
}
