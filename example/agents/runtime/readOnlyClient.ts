import { createPublicClient, custom, type PublicClient } from "viem";

// Guard the transport, not just client methods: viem actions and request() use the same path.
// This is an API boundary, not a sandbox for participant-authored Node programs.
//
// JP: `decide(obs, ctx)` に渡される `ctx.publicClient` はここで作られる「読み取り専用」ラッパー。
// CLAUDE.md にある通り「ctx.publicClient は読取専用、walletClient は公開しない」（issue #85）の
// 実装がこれ。ポイントは viem の個別メソッド（getBalance 等）だけを塞ぐのではなく、
// **transport の request() 自体**をガードしていること — viem の全アクションは最終的に
// この request() を通るので、ここを塞げば呼び出し方に関わらず抜け道が無い。
// 許可するのは `eth_*`/`net_*`/`web3_*` の読み取り系のみで、送金・署名系
// （`eth_sendTransaction` 等）は明示的に拒否する。取引は必ず戦略の return 値か
// `ctx.submit()` 経由にする、という設計（CLAUDE.md「取引は戻り値かctx.submit()に集約」）を
// 強制するための境界であって、悪意ある参加者コードからの完全なサンドボックスではない点に注意。
export function readOnlyClient(client: PublicClient): PublicClient {
  return createPublicClient({
    chain: client.chain,
    batch: client.batch,
    transport: custom(
      {
        request(args) {
          if (
            !/^(eth_|net_|web3_)/.test(args.method) ||
            /^(eth_send|eth_sign|eth_accounts$)/.test(args.method)
          ) {
            throw new Error(
              `strategy RPC is read-only: ${args.method}; send actions through ctx.submit()`,
            );
          }
          return client.request(args);
        },
      },
      { retryCount: 0 },
    ),
  });
}
