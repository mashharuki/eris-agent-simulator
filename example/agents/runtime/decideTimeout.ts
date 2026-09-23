/**
 * JP: このファイルには「1回の判断あたりの制限時間」と「戦略の起動タイムアウト」という、
 * 意味の異なる2つの上限が定義されている。過去にこの2つを混同して（decide用の5秒をロードにも
 * 流用して）31体中13体が起動時に落ちた事故（issue #100）があるため、CLAUDE.md にも太字で
 * 「上限を取り違えた過去がある」と明記されている、このプロジェクトで最も間違えやすい箇所の一つ。
 *
 * - `DECIDE_TIMEOUT_MS`（5秒）: 規約§2.3。decide() 1回の呼び出しに与えられる時間。
 *   worker thread 上で実行するので、同期の無限ループでも await が返らないケースでも
 *   親スレッド側のこのタイマーで強制的に打ち切れる（同一スレッドの setTimeout では同期
 *   無限ループを止められないので worker thread が必須）
 * - `STRATEGY_STARTUP_TIMEOUT_MS`（60秒）: 戦略モジュール（agent.ts や LLM生成コード）を
 *   新しい worker に読み込む（tsx でコンパイルする）ときだけに使う別の上限。5秒ではなく
 *   coordinator の agents-ready 待機時間と同じ60秒にしてある
 * - `STRATEGY_BACKOFF_AFTER`/`STRATEGY_BACKOFF_MAX_BLOCKS`: 3回連続で判断が失敗（throw/クラッシュ/
 *   タイムアウト）すると、以降は毎ブロック worker を作り直さずバックオフする（1→2→4→…最大64
 *   ブロック）。理由は「毎ブロック throw する戦略が2秒ごとにtsxを起動してCPU1コアを占有し続けた」
 *   実測インシデント（`lp-provider`、issue #93 F-H）
 */
// The per-decision response bound (competition rules §2.3: 5,000 milliseconds).
// StrategyRunner enforces it on the parent event loop and terminates the worker on expiry, so both
// synchronous loops and unresolved awaits cost only that decision. Submissions are committed only
// with an on-time result. The next call reloads the selected strategy; the agent process, revision
// history and state directory continue. Worker-local variables reset; no automatic rollback occurs.
// withDecideTimeout also bounds standalone async executors. It alone cannot interrupt synchronous
// JavaScript; production decisions must run through StrategyRunner.
export const DECIDE_TIMEOUT_MS = 5000;

// The bound on loading the strategy module into a fresh worker. This is a separate number from the
// decision bound on purpose: §2.3 bounds a decision, not a `tsx` compile, and reusing 5,000 ms for
// the module load killed 13 of 31 agents at boot on a loaded host ("strategy worker startup
// exceeded 5000ms" -> exit 1 -> the agent is dead for the epoch, issue #100 / #93 F-J). Sixty
// seconds is the coordinator's own agents-ready bound (`run.agentsReadyTimeoutSec`, PR #97): an
// agent that has not loaded by then has already missed the first block. A module that spins forever
// is still cut off, just not one that merely compiles slowly.
export const STRATEGY_STARTUP_TIMEOUT_MS = 60_000;

// After this many consecutive failed decisions (a throw, a crash, a timeout) the runner stops
// replacing the worker every block. Each failure discards the worker -- callbacks from a failed
// decision must never trade later -- and each replacement is a `tsx` boot, so a strategy that throws
// on every block was a worker spawn every 2 s for the whole run: `lp-provider` at ~100 % of a core
// in every epoch (issue #100 / #93 F-H). The back-off doubles from one block up to
// STRATEGY_BACKOFF_MAX_BLOCKS and resets on the first decision that returns.
export const STRATEGY_BACKOFF_AFTER = 3;
export const STRATEGY_BACKOFF_MAX_BLOCKS = 64;

export class DecideTimeoutError extends Error {
  constructor(round: number) {
    super(
      `decide timeout: no answer within ${DECIDE_TIMEOUT_MS}ms (rules §2.3); block ${round} is no action`,
    );
    this.name = "DecideTimeoutError";
  }
}

// `pending` may be a value rather than a promise: a synchronous decide() returns its action directly,
// and a synchronous throw happens before this is ever called (the caller's try/catch sees it).
export function withDecideTimeout<T>(
  pending: Promise<T> | T,
  round: number,
  timeoutMs = DECIDE_TIMEOUT_MS,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DecideTimeoutError(round)), timeoutMs);
  });
  return Promise.race([Promise.resolve(pending), timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
