// The two settings the environment manifest has to apply *before* anything else loads.
//
// `sdk/src/constants.ts` decides at import time whether to overlay the bundled deployer's addresses
// (`ERIS_LOCAL_DEPLOY`), and the config reads the chain id from `CHAIN_ID`. A coordinator-spawned
// agent inherits both from the environment it was spawned with. A self-hosted agent (ADR 0021) is
// started by hand with `ERIS_MANIFEST=<manifest.json>` and inherits neither, so the guide's own
// command failed preflight twice -- first on the chain id, then on seven contracts holding no code
// (issue #84 X3). Both values are in the manifest; nothing read them.
//
// Kept in its own module with no imports beyond node:fs, so bot.ts can call it before its dynamic
// import of the runtime, and so it can be tested without starting an agent.
//
// JP: manifest.json（`npm run manifest` が出力する、鍵を含まない環境情報）から chainId と
// localDeploy の2つだけを取り出し、process.env にまだ無ければセットするだけの小さな関数。
// bot.ts に呼ばれる「前座」の中身がこれ。node:fs 以外を import しない設計にしているのは、
// これ自体が sdk を巻き込まないようにするため（sdk を import した時点でアドレス確定が
// 走ってしまうので、それより前に実行し終える必要がある）。
import { existsSync, readFileSync } from "node:fs";

/**
 * Apply the manifest's chain id and local-deploy flag to `env`, without overriding what is already
 * set: env wins, so a coordinator-spawned run is unchanged byte for byte, and an operator can still
 * point a self-hosted agent somewhere else deliberately.
 *
 * Silent on a missing or unreadable file: botMain.ts refuses those with the message it always had,
 * and a prelude that threw first would replace a clear error with a stack trace.
 */
export function applyManifestEnv(
  path: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!path || !existsSync(path)) return;
  let chain: { chainId?: unknown; localDeploy?: unknown } | undefined;
  try {
    chain = (JSON.parse(readFileSync(path, "utf8")) as { chain?: typeof chain })
      .chain;
  } catch {
    return;
  }
  if (!chain) return;
  if (
    env.CHAIN_ID === undefined &&
    typeof chain.chainId === "number" &&
    Number.isInteger(chain.chainId)
  )
    env.CHAIN_ID = String(chain.chainId);
  if (
    env.ERIS_LOCAL_DEPLOY === undefined &&
    typeof chain.localDeploy === "boolean"
  )
    env.ERIS_LOCAL_DEPLOY = chain.localDeploy ? "1" : "0";
}
