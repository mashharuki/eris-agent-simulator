[← README](../../README.md)

# Agent-Created Markets (MarketRegistry + permissionless lending; ADR 0022)

Participants can deploy their own contracts and have the environment discover and distribute them to
everyone. Enable with `agentMarkets.enabled: true` (default off — it adds a `getLogs` scan and a block
fetch every block, so a run where nobody deploys should not pay for it). If `run.protocols` includes
`lending`, `agentMarkets.enabled` is required — leaving it `false` fails fast at startup.

## Scoring: the round-trip rule (ADR 0022 §1)

Value left inside a contract the environment cannot evaluate is marked **0 at the epoch's final
block**. Profit that passed back out through a recognized flow is **counted in full**: `deposit
10,000 → withdraw 11,000` counts `+1,000`; only the deposit still sitting inside an unrecognized
contract at the bell is zeroed. This single rule collapses every trap class — honeypot, backdoor,
proxy swap — into one thing: *did you get out in time*. No per-trap defense mechanism is needed.

- This is not "we decided to score it as 0" so much as "it already was 0 and we started saying so."
  The EOA sweep never looked there, and no adapter claims an unrecognized contract's balance — the
  value was already excluded from scoring. `scoring_unpriced_holdings` now reports it explicitly with
  `reason: "unrealizable"` (`unknown-contract:<addr>`), so a stuck position and a real trading loss are
  distinguishable in `summary.json` instead of both reading as "0".
- Counted by the **net of Transfer logs** (`StrandedLedger` in `sdk/src/agentMarkets.ts`), not by
  balance. A pool's 1,000 USDC belongs to its LPs; crediting it to the depositor too would double-count
  the same reserve.

## `MarketRegistry` — the second PriceFeed-shaped contract

`contracts/MarketRegistry.sol` is owner-gated for writes, emits one event per entry, and exposes
`count` / `all` / `isRegistered`. Like `PriceFeed`, it inherits the environment's one-block
distribution lag — so whoever created a market learns about it one block before anyone else, which is
itself the incentive to create one. The dedup key is the pair `(market, extra)`: lending markets all
live at one singleton address, so `extra` (the market id) is what tells them apart.

- **codehash is captured at registration time and never refreshed.** Under the round-trip rule a
  proxy swapped out from under a listed market is just another form of "didn't make it out in time" —
  the environment does not need to police it, and noticing is the skill.
- Registration is **capped per block and paid for by the environment**
  (`agentMarkets.registrationsPerBlock`, default 8). Overflow carries to the next block,
  factory-originated markets first. Writes go through a dedicated **setup key, not the admin key** —
  the admin key already sends an oracle-update tx every block, and a second sender on the same key
  would fight it for the nonce.
- Discovery is **factory logs plus a top-level-CREATE scan** (`to === null`). Internal `CREATE` calls
  are missed — symmetric, and accepted: nothing invisible to every other agent can be used to bait one
  either. ERC-20 detection is a `name`/`symbol`/`decimals` static-call heuristic.

## `SimpleLending.sol` — permissionless lending singleton

A Morpho-Blue-style singleton (`ProtocolId: "lending"`). A market is the tuple `(loanToken,
collateralToken, oracle, irm, lltv)`, and `createMarket` is callable by anyone — this is the one thing
Aave cannot offer here, since opening an Aave reserve goes through `PoolConfigurator` and is
`POOL_ADMIN`-gated; giving agents that would mean handing out admin.

- **The oracle is an arbitrary address, and the creator may control it** — the fake-oracle class ADR
  0014 deferred. A verifier's job is to read `owner()`: `ConfigurableOracle` (has an owner — the trap)
  and `PriceFeedOracle` (no owner, immutable — the honest one) ship side by side, so "can the oracle be
  moved" is a real, checkable signal rather than a tell you have to infer.
- Scoring uses the **recoverable amount** (`backedFraction`): the supply side's share of remaining
  loan-token plus collateral marked at the **environment's** price; the borrow side is `max(0,
  collateral − debt)`, floored at 0 — walking away from underwater collateral is a legitimate move,
  the same clamp Liquity applies below 100% ICR. **The market's own oracle decides liquidation only,
  never the mark.**
- **Interest is decorative.** 3%/year over a 12-minute epoch is 0.00007% — the bait that actually works
  is leverage (a high LLTV) and the liquidation bonus, and the victims of a lending trap are borrowers
  or liquidators, not suppliers. The bundled IRM says as much rather than pretending otherwise.

## Actions and deployment

`createPool` (Uniswap-owned; goes through the NPM's `createAndInitializePoolIfNecessary`) and
`createLendingMarket` + `lendingSupply` / `lendingWithdraw` / `lendingSupplyCollateral` /
`lendingWithdrawCollateral` / `lendingBorrow` / `lendingRepay` / `lendingLiquidate` (lending-owned).
**Deployment is a `rawTx` with `to` omitted**, routed through the runtime so it shares nonce
management, the per-run tx-count cap and the gas budget with ordinary trades — self-signing would put
two senders on the same key. Helper: `example/agents/lib/deployContract.ts`.

Approvals are **exact-amount** (`exactApproveTx`), not infinite — a contract that drains an unlimited
approval is inside the rules, so the reference runtime should not itself be the hole. The observation
surfaces unconsumed allowance against registry entries.

## Gas budget (T0: 30,000,000)

Both **per-tx** and **per-agent-per-block** are capped at 30,000,000 gas (lowered from 90M on
2026-09-06). Rules §2.6 does not bound the *number* of transactions, so a single call into expensive
code you wrote yourself could starve a block — not just for other participants, but for the
environment's own oracle-update transaction. One number is read from three places: the gateway parses
the RLP for the gas limit and **rejects at the door (403)**, the runtime self-limits, and a post-run
pass flags overruns from `blocks.csv`'s `gasUsed` column.

## Owner guards are measured, not assumed

`core/src/realtime/ownerGuards.ts` simulates a privileged write from a role-less address via
`eth_call` for every registered contract; **anything that doesn't revert is a hole**, and a run with
`agentMarkets` on fails at startup if even one remains. This actually caught two:
`MockAggregator.setAnswer` and `MockOracleProvider.setPrice` were both permissionless — meaning every
Aave borrower's liquidation and every GMX position's mark could have been moved by anyone. (The owner
slot is `immutable`, so slot 0 stays `_answer` and an `economicGas` direct-storage write is unaffected.)

## The environment never touches agent-created markets

`noArb` only reads the state of enabled adapters (`MARKET_LEGS`), so agent-created markets are
structurally out of its reach — `test/agentCreatedMarkets.test.ts` asserts this boundary holds. The
consequence: **whoever sets a trap can only harvest it from other agents**, never from the environment.

## Reference agents (6)

| agent | role |
|---|---|
| `market-launcher` | Honest creator — lists with an immutable oracle, withdraws before the bell |
| `market-taker` | User — reads `oracleOwner` before entering |
| `trap-launcher` | Creates a 90% LLTV market on an oracle it controls, then borrows out what was supplied |
| `vault-keeper` | Honest but buggy — deploys `LeakyVault` (a `rescue()` nobody gated) and puts USDC in it |
| `exploit-hunter` | Recovers selectors from another agent's `unknown` bytecode and drains it atomically through `Exploiter` |
| `discovery-arb` / `discovery-arb-verify` | Extended to also pull markets from the registry |

`exploit-hunter` targets **honest-but-buggy** contracts like `vault-keeper`'s, not `trap-launcher`'s
adversarial one. Measured: `hunter +9,999.9` / `vault-keeper −10,000.2` — the entire 10,000 USDC
deposit transferred (sum ≈ gas).

Regime: `config/regimes/agent-markets.yaml` — **outside the official set**, a venue-validation regime
like `lst.yaml` / `liquity.yaml`. Whether this venue joins the official 12 regimes is a decision for
after a live run (see `CLAUDE.md`'s official-regime list).
