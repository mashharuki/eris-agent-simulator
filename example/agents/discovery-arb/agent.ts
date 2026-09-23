// discovery-arb (ADR 0014 §6): discovery + immediate execution (naive).
// Subscribes to the factory's PoolCreated to discover new pools, and when it finds a base cheaper than
// fair it immediately approves+swaps **without verification** (trusts it with minOut=0). It gets skimmed
// by rigged pools (the contrasting failure mode of not doing pre-trade verification).
//
// Subscribes to blocks and emits actions itself: the run(ctx) contract (ADR 0015 §3). Delegates to the shared core.
// JP: このagent.ts自体はほぼ空 — 実際のロジックは全て `lib/discoveryAgent.ts` の
// `runDiscoveryAgent()` に共通化されており、`{verify: false}`（検証しない＝無検証）を渡すだけ。
// discovery-arb-verify との違いはこのフラグ1つだけで、CLAUDE.mdの実測（無検証−5,306 vs 検証+721）
// が示す通り「検証するかどうか」がこの2エージェントの唯一かつ決定的な差。
import type { AgentContext } from "@eris/sdk";
import { runDiscoveryAgent } from "../lib/discoveryAgent.js";

export async function run(ctx: AgentContext): Promise<void> {
  await runDiscoveryAgent(ctx, { verify: false });
}
