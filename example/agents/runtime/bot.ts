/**
 * bot.ts: the entry point for every agent type. The runtime itself is botMain.ts; this file is the
 * prelude that has to run before a single sdk module is imported.
 *
 * Why a prelude. `sdk/src/constants.ts` decides at import time whether to overlay the bundled
 * deployer's addresses (`ERIS_LOCAL_DEPLOY`), and the config reads the chain id from `CHAIN_ID`. A
 * coordinator-spawned agent inherits both from the environment. A self-hosted agent (ADR 0021) is
 * started by hand with `ERIS_MANIFEST=<manifest.json>`, and the manifest carries both values --
 * but nothing read them: the guide's own command failed preflight twice, first on the chain id
 * (`configured for 42161` against a manifest that says 31337), then on the addresses (`7 of 7
 * contracts hold no code`, because the fork's Arbitrum table was in use), and both messages spoke
 * operator vocabulary (issue #84 X3). Static imports are hoisted, so the only place the manifest
 * can set those two variables in time is a file that imports nothing of the sdk and loads the
 * runtime dynamically afterwards -- the same shape core/src/cli/sim-realtime.ts has for the
 * coordinator.
 *
 * Env wins over the manifest for both, as it does for the RPC URL and the PriceFeed: a
 * coordinator-spawned run is unchanged, byte for byte.
 */
/**
 * JP: 全エージェント共通の起動エントリポイント。実体（read→decide→send のループ本体）は botMain.ts に
 * あり、このファイルはその「前座（prelude）」に過ぎない。なぜ前座が要るかというと、
 * `sdk/src/constants.ts` は **import された瞬間**（実行される前）に `ERIS_LOCAL_DEPLOY` を見て
 * アドレス一覧をローカルデプロイ用に差し替えるかどうかを決めてしまうから。coordinator が起動した
 * エージェントは env 変数をそのまま受け継ぐので問題ないが、外部参加者が自分の PC で
 * `ERIS_MANIFEST=<manifest.json>` を渡して自前起動する場合（ADR 0021）、manifest の中に chainId /
 * localDeploy が書いてあるのに誰もそれを読んでいなかった（issue #84 X3）。
 * JavaScript の `import` は静的解析でファイル先頭に巻き上げられる（hoisting）ため、
 * 「先に env を書き換えてから sdk を読み込む」を実現するには、sdk を一切 static import しない
 * このファイルで先に `applyManifestEnv()` を呼び、そのあとで `await import("./botMain.js")` と
 * **動的 import** で本体を読み込むしかない。env に既に値がある場合は上書きしない
 * （coordinator 起動時は無変更のまま動く）。
 */
import { applyManifestEnv } from "./manifestEnv.js";

applyManifestEnv(process.env.ERIS_MANIFEST);

// Evaluated only after the env is set (dynamically, since static imports are hoisted).
await import("./botMain.js");
