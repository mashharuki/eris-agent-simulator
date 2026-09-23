// noop: a do-nothing baseline.
// JP: 何もしない基準線（baseline）。他戦略の実測値と比較するための対照群として使う
// （例: CLAUDE.md 各所で「noop 0 に対して venue-arb −136」のように比較されている数字の基準）。
// β（保有資産の値動きによる損益）はそのまま乗るので、netPnlUsdcが0になるとは限らない —
// 「何もしない」であって「損益が0」ではない。
import type { AgentAction } from "@eris/sdk";

export function decide(): AgentAction {
  return { type: "noop", reason: "baseline" };
}
