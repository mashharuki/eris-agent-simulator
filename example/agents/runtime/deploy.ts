/**
 * deploy.ts: helper to deploy participant contracts (ADR 0015 §1).
 *
 * Deploying venues is the environment's job (deployer/). This is a helper for a participant
 * to stand up their own contract with their own key, like the flash-arb executor. The forge
 * artifact (out/<Name>.sol/<Name>.json) is read via sdk's readForgeArtifact (default out/ at the
 * repo root; override with ERIS_FORGE_OUT when the layout differs, e.g. a submission bundle).
 */
/**
 * JP: 参加者が「エージェントが作る市場」（ADR 0022。docs/guide/agent-markets.md 参照）などで
 * 自分自身のコントラクト（罠を仕掛ける市場・救済用ロジック等）を deploy したいときのヘルパ。
 * venue（Uniswap/Aave/GMX等）のデプロイは環境側（deployer/）の仕事であり、これはそれとは別に
 * 参加者が自分の秘密鍵でコントラクトを立てるためのもの。`out/<コントラクト名>.sol/<名前>.json`
 * という forge のビルド成果物（ABI + bytecode）を読み込んで deployContract する薄いラッパ。
 */
import type { Address, Chain, Hex, PublicClient, WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readForgeArtifact } from "@eris/sdk/forge.js";

// Deploy a contract with your own key and return the deployed address (waits for the receipt).
export async function deployArtifact(opts: {
  publicClient: PublicClient;
  walletClient: WalletClient;
  chain: Chain;
  privateKey: Hex;
  name: string;
  args?: unknown[];
  priorityFeeWei?: bigint;
}): Promise<Address> {
  const account = privateKeyToAccount(opts.privateKey);
  const { abi, bytecode } = readForgeArtifact(opts.name);
  const block = await opts.publicClient.getBlock();
  const baseFee = block.baseFeePerGas ?? 0n;
  const tip = opts.priorityFeeWei ?? 1_000_000_000n;
  const hash = await opts.walletClient.deployContract({
    abi,
    bytecode,
    args: (opts.args ?? []) as never,
    account,
    chain: opts.chain,
    maxFeePerGas: baseFee * 2n + tip,
    maxPriorityFeePerGas: tip,
  });
  const receipt = await opts.publicClient.waitForTransactionReceipt({ hash });
  if (!receipt.contractAddress)
    throw new Error(`deploy of ${opts.name} failed (no contractAddress)`);
  return receipt.contractAddress;
}
