import type {
  AgentContext,
  AgentLogEntry,
  AgentRuntimeConfig,
  DecideFn,
} from "@eris/sdk/agent.js";
import type { AgentObservation } from "@eris/sdk/types.js";
import type { Address } from "viem";

/**
 * JP: このファイルは「親プロセス（strategyRunner.ts）」と「戦略を実行する worker thread
 * （strategyWorker.ts）」の間でやり取りされるメッセージの型定義だけを集めたもの。ロジックは無い。
 * CLAUDE.md の「decide は worker thread で実行され、DECIDE_TIMEOUT_MS=5秒（呼び出しごと）/
 * STRATEGY_STARTUP_TIMEOUT_MS=60秒（モジュールロード）」というアーキテクチャの土台がここ。
 * なぜ worker thread 越しにやり取りするのか: 戦略コード（agent.ts、あるいは LLM が生成した
 * executorTs）を同期的な無限ループから守るため。同一スレッド上の setTimeout ではJSの
 * シングルスレッド性ゆえに同期無限ループを止められないが、worker thread なら親が
 * `worker.terminate()` で強制終了できる。
 *
 * - `StrategySource`: 実行する戦略の実体。`module`=ファイルパスの agent.ts、
 *   `executor`=LLM が生成した関数式のソース文字列そのもの、`python`=Python 戦略（pyBridge 経由）
 * - `StrategyContext`: worker に渡す最小限のコンテキスト（agentId・address・config・RPC URL）。
 *   walletClient のような秘密情報そのものは渡さない — worker 側で改めて安全に組み立てる
 * - `StrategyMetadata.mode`: `agent.ts` が `decide()` を export しているか `run()` を
 *   export しているかの判定結果（CLAUDE.md の「ルール戦略」vs「自走型」の分岐点）
 * - `StrategyRequest`/`StrategyResponse`: 親→worker は「このブロックの observation で判断して」
 *   （StrategyRequest）、worker→親は結果（`result`）・エラー（`error`。`timeout` フラグで
 *   タイムアウトかどうかを区別）・判断中の `submit()` 呼び出し（`submit`）・ログ出力（`log`）の
 *   いずれか。`id` は同時に複数の問い合わせが飛ばないための対応付け用の連番
 */
export type StrategySource =
  | { kind: "python"; path: string }
  | { kind: "module"; path: string }
  | { kind: "executor"; source: string };
export type StrategyContext = Pick<
  AgentContext,
  "agentId" | "address" | "config"
> & {
  rpcUrl: string;
  agentDir?: string;
  lending?: Address;
};
export type StrategyMetadata = {
  mode: "run" | "decide";
  config?: AgentRuntimeConfig;
};
export type StrategyResult = Awaited<ReturnType<DecideFn>>;
export type StrategyRequest = { id: number; observation: AgentObservation };
export type StrategyResponse =
  | { type: "ready"; metadata: StrategyMetadata }
  | { type: "result"; id: number; action: StrategyResult }
  | { type: "error"; id: number; message: string; timeout: boolean }
  | {
      type: "submit";
      id: number;
      action: Parameters<AgentContext["submit"]>[0];
    }
  | { type: "log"; id: number; entry: AgentLogEntry };
export type StrategyWorkerData = {
  source: StrategySource;
  context: StrategyContext;
};
