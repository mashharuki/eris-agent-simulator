// ADR 0014: shared ABI (agent side) for the vulnerable pools (SimpleAMM / RiggedAMM) and the factory.
// The minimal definitions used by poolDiscovery (discovery) and verifyContract (verification).
// JP: `vuln` レジーム（run途中で悪意あるプールが湧く。ADR 0014）向けの共通ABI定義。
// `RiggedAMM`（見た目は普通だが実際の swap 挙動が read 系関数の返り値と食い違う罠プール）と
// `SimpleAMM`（正直なプール）は外から見るABIが同じなので、「読むだけ」では区別できない —
// 実際に `eth_call` で swap を dry-run して初めて正体が分かる、という前提がここのコメントに
// 書かれている。poolDiscovery.ts（発見）と verifyContract.ts（検証）の両方から参照される。
import type { Abi } from "viem";

export const vulnFactoryAbi = [
  {
    type: "event",
    name: "PoolCreated",
    inputs: [
      { name: "pool", type: "address", indexed: true },
      { name: "token0", type: "address", indexed: true },
      { name: "token1", type: "address", indexed: true },
      { name: "feeBps", type: "uint24", indexed: false },
    ],
  },
] as const satisfies Abi;

// The read/exec surface common to SimpleAMM / RiggedAMM. getAmountOut is the honest "bait" quote
// (RiggedAMM's view is honest too). The real behavior is only revealed by dry-running swap (eth_call) (ADR 0014 §4).
export const vulnAmmAbi = [
  {
    type: "function",
    name: "token0",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "token1",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "getReserves",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "r0", type: "uint256" },
      { name: "r1", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "getAmountOut",
    stateMutability: "view",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "tokenIn", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "swap",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "minOut", type: "uint256" },
      { name: "tokenIn", type: "address" },
      { name: "to", type: "address" },
    ],
    outputs: [{ name: "out", type: "uint256" }],
  },
] as const satisfies Abi;

export const erc20ApproveAbi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const satisfies Abi;
