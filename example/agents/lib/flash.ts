// Flash-loan helper (GitHub #2). Raw tx builder for Aave V3 Pool.flashLoanSimple.
// The receiver (FlashArb) runs the arb in executeOperation and repays amount+premium.
// JP: Aaveのフラッシュローン（`flashLoanSimple`）を呼ぶ生calldataを組み立てるだけの薄いヘルパ。
// 実際の裁定ロジックは、参加者が自分でdeployする受け手コントラクト（`FlashArb`、
// `executeOperation`内で実行）側に書く。呼び出し元は `flash-arb` エージェント。
// 自分の資金を全く使わずに大きな裁定を1トランザクション内で完結できるのが利点だが、
// 借りた分+premium(手数料)を同一tx内で返済できなければ全体がrevertする。
import { encodeFunctionData } from "viem";
import { AAVE } from "@eris/sdk/constants.js";

export type RawTx = { to: string; data: string };

const flashAbi = [
  {
    type: "function",
    name: "flashLoanSimple",
    stateMutability: "nonpayable",
    inputs: [
      { name: "receiverAddress", type: "address" },
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "params", type: "bytes" },
      { name: "referralCode", type: "uint16" },
    ],
    outputs: [],
  },
] as const;

export function buildFlashLoanSimple(
  receiver: string,
  asset: string,
  amount: bigint,
  params: `0x${string}` = "0x",
  referralCode = 0,
): RawTx {
  return {
    to: AAVE.Pool,
    data: encodeFunctionData({
      abi: flashAbi,
      functionName: "flashLoanSimple",
      args: [
        receiver as `0x${string}`,
        asset as `0x${string}`,
        amount,
        params,
        referralCode,
      ],
    }),
  };
}
