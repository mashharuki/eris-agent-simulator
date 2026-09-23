/**
 * JP: strategyRunner.ts（親スレッド）から起動される **worker thread 側**の実体。
 * `.mjs` のローダー（strategyWorker.mjs）経由で読み込まれ、実際の戦略コード
 * （`agent.ts` の `decide`/`run`、または LLM が生成した executor コード）はここで初めて import
 * ・実行される。
 *
 * 起動時（一度きり）: `data.source.kind` に応じて3通りに分岐 —
 *   - `"module"`: `agent.ts` を import し、`run` を export していれば自走型（`mode: "run"`）、
 *     `decide` を export していればルール戦略（`mode: "decide"`）と判定
 *   - `"executor"`: LLM が生成した関数式のソース文字列を `compileExecutor`（improve.ts）で
 *     `vm` コンパイルして実行可能な関数にする
 *   - `"python"`: ここでは扱わない（PyBridge という別経路）
 *
 * メッセージ受信時（判断のたびに毎回）: 親から `{id, observation}` を受け取り `decide()` を
 * 呼ぶ。ここで渡す `ctx.publicClient` は `readOnlyClient()` でラップした読み取り専用クライアント
 * （walletClient は存在しない）。`ctx.submit()`/`ctx.log()` は実際の送信・ログ書き込みをせず、
 * `postMessage` で親スレッドに投げるだけ — 実際の署名・送信（Sender）やファイル書き込み
 * （agentLog）は親プロセス側の責務で、worker は「判断すること」だけに専念する設計。
 * `active` フラグは、タイムアウトで親側がこの呼び出しを見捨てた**後**に古い `submit`/`log` が
 * 届いても無視するためのガード（「捨てられた判断のコールバックに取引させない」という不変条件）。
 */
import { parentPort, workerData } from "node:worker_threads";
import { pathToFileURL } from "node:url";
import type { AgentContext, AgentModule, DecideFn } from "@eris/sdk/agent.js";
import { makeClients } from "@eris/sdk/chain.js";
import { setLendingSingleton } from "@eris/sdk/protocols/lending.js";
import { DecideTimeoutError } from "./decideTimeout.js";
import { compileExecutor } from "./improve.js";
import { readOnlyClient } from "./readOnlyClient.js";
import type {
  StrategyMetadata,
  StrategyRequest,
  StrategyResponse,
  StrategyWorkerData,
} from "./strategyProtocol.js";

if (!parentPort) throw new Error("strategyWorker must run in a Worker");
const port = parentPort;
const data = workerData as StrategyWorkerData;
const post = (message: StrategyResponse) => port.postMessage(message);
setLendingSingleton(data.context.lending);
const { publicClient } = makeClients(
  data.context.rpcUrl,
  data.context.config.chainId,
  { batch: true },
);
const reads = readOnlyClient(publicClient);
let decide: DecideFn | undefined;
let metadata: StrategyMetadata;
if (data.source.kind === "module") {
  const module = (await import(
    pathToFileURL(data.source.path).href
  )) as AgentModule;
  if (typeof module.run === "function")
    metadata = { mode: "run", config: module.config };
  else if (typeof module.decide === "function") {
    decide = module.decide;
    metadata = { mode: "decide", config: module.config };
  } else
    throw new Error(`${data.source.path} must export decide() or run(ctx)`);
} else if (data.source.kind === "executor") {
  const compiled = compileExecutor(data.source.source);
  if (!compiled.ok) throw new Error(compiled.reason);
  decide = compiled.executor;
  metadata = { mode: "decide" };
} else throw new Error("Python sources must run through PyBridge");

port.on("message", async ({ id, observation }: StrategyRequest) => {
  // Each context has its own lifetime. A timer/async continuation from a completed call must not
  // acquire the next call's id and submit a stale action in that block.
  let active = true;
  const ctx: AgentContext = {
    agentId: data.context.agentId,
    address: data.context.address,
    config: data.context.config,
    publicClient: reads,
    latestObservation: () => observation,
    onObservation() {
      throw new Error(
        "onObservation is for run(ctx) agents; decide receives its observation as an argument",
      );
    },
    submit(action) {
      if (active) post({ type: "submit", id, action });
    },
    log(entry) {
      if (active) post({ type: "log", id, entry });
    },
  };
  try {
    if (!decide)
      throw new Error("run(ctx) modules do not expose a worker decision");
    const action = await decide(observation, ctx);
    post({ type: "result", id, action });
  } catch (error) {
    post({
      type: "error",
      id,
      message: error instanceof Error ? error.message : String(error),
      timeout: error instanceof DecideTimeoutError,
    });
  } finally {
    active = false;
  }
});
post({ type: "ready", metadata });
