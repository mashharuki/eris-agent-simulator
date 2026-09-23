// Raw tx builder for Aave V3 liquidationCall (GitHub #1).
// Pool/tokens are referenced from src/constants.ts (Arbitrum).
// JP: Aaveの清算（liquidationCall）を呼ぶための生calldataを組み立てるだけの薄いヘルパ。
// `liquidator` エージェント（run(ctx)型の自走エージェント。CLAUDE.md でも例示されている代表例）が
// これを使う。清算対象の victim アドレスは `ERIS_LIQUIDATION_VICTIMS` 環境変数で環境側から渡される
// （ADR 0009。市場ストレスイベントで意図的にHFを割らせたポジションのリスト）。
// `debtToCover` に `uint256.max` を渡すと Aave 側が close factor（最大50%等）に自動でクランプ
// してくれるので、正確な返済額を事前に計算する必要が無い、というのがコメントのポイント。
import { encodeFunctionData } from "viem";
import { AAVE } from "@eris/sdk/constants.js";

export type RawTx = { to: string; data: string };

const liquidationAbi = [
  {
    type: "function",
    name: "liquidationCall",
    stateMutability: "nonpayable",
    inputs: [
      { name: "collateralAsset", type: "address" },
      { name: "debtAsset", type: "address" },
      { name: "user", type: "address" },
      { name: "debtToCover", type: "uint256" },
      { name: "receiveAToken", type: "bool" },
    ],
    outputs: [],
  },
] as const;

/**
 * Build one tx for liquidationCall.
 * Passing uint256.max as debtToCover makes Aave clamp it to the close factor (e.g. up to 50%).
 * With receiveAToken=false you receive the underlying asset (WETH), which you can later swap to USDC.
 */
export function buildLiquidationCall(
  collateralAsset: string,
  debtAsset: string,
  user: string,
  debtToCover: bigint,
  receiveAToken = false,
): RawTx {
  return {
    to: AAVE.Pool,
    data: encodeFunctionData({
      abi: liquidationAbi,
      functionName: "liquidationCall",
      args: [
        collateralAsset as `0x${string}`,
        debtAsset as `0x${string}`,
        user as `0x${string}`,
        debtToCover,
        receiveAToken,
      ],
    }),
  };
}
