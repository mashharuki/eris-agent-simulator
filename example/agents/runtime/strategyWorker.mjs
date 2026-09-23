// Node 22 does not natively load TypeScript worker entry points. Register the same loader used by
// bot.ts explicitly, so this also works in submitted bundles without a repository tsconfig.
// JP: strategyWorker.ts（TypeScript）を worker thread として直接 new Worker() することはできない
// （Node は .mjs をそのまま実行できても .ts はできないため）ので、この小さな .mjs が間に入って
// tsx のローダーを登録してから本体（.ts）を動的 import する、という一段のブリッジになっている。
import { register } from "tsx/esm/api";
register();
await import("./strategyWorker.ts");
