# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

eris-competition-poc は Anvil で Arbitrum をフォークする DeFi トレード競争シミュレータ。

人間向けの詳細ガイドは `docs/guide/*.md`（英語）にあり、このファイルは重複を避けて **人間が読むドキュメントに
無い non-obvious な invariant・fail-fast 条件・実測値・インシデント経緯**を中心に書く。まず読むべきガイド:
[architecture](docs/guide/architecture.md) / [repository-layout](docs/guide/repository-layout.md) /
[writing-agents](docs/guide/writing-agents.md) / [configuration](docs/guide/configuration.md) /
[backtest](docs/guide/backtest.md) / [scoring](docs/guide/scoring.md)。ADR は `docs/adr/`。

## パッケージ構成（core/sdk/example 3 workspace + dashboard。ADR 0015）

```
sdk/       @eris/sdk — 契約レイヤ（types / action(zod) / chain / markets / protocols / observationFor / SimConfig）
core/      環境デーモン + 採点（realtime coordinator / anvil / flow / stress / vuln / cli）。参加者は触らない
example/   参加者テンプレート。example/agents/ がコピー・提出の単位
dashboard/ 任意の web UI（runs/<id>/ を読むだけで run には依存しない）
deployer/  venue デプロイ（自己完結サブパッケージ。workspace 外）
```

依存方向は **`example → sdk ← core`** のみ（`npm run check:boundaries` が検査）。詳細は
[repository-layout.md](docs/guide/repository-layout.md)。旧 `src/` / `examples/` は撤去済み。旧 LLM
自己改善機構（src/llm）と未参照戦略の `_archive/` も削除済み（復元は `git checkout 4a65a8f -- _archive`）。

## エージェントの書き方（1 agent = 1 ディレクトリ。ADR 0015 §2-4）

`example/agents/<id>/` に次のいずれか 1 枚を置き、ロスターに id を足すだけで agent が増える（詳細は
[writing-agents.md](docs/guide/writing-agents.md)、自己改善は [llm-agents.md](docs/guide/llm-agents.md)）:

| 中身 | 種別 | 動き方 |
|------|------|--------|
| `agent.ts`（`decide(obs, ctx)` export） | ルール戦略 | runtime/bot.ts が read→decide→send のループで駆動 |
| `agent.ts`（`run(ctx)` export） | 自走型 | bot.ts はループせず ctx を渡して委譲（例 liquidator） |
| `agent.ts` + `prompt.md`（frontmatter: **`kind: improve`** 必須） | **自己改善型**（ADR 0018） | decide を毎ブロック駆動しつつ、LLM が取引経路の**外**で戦略コードを書き換える |

`runtime/` と `lib/` は予約名。**プロンプト型（毎判断 LLM）は ADR 0018 で廃止**（実測 1/64 の行動回数。
`ERIS_AGENT_MODE` / `ERIS_PROMPT_*` は fail-fast）。

**`prompt.md` は同じ名前で意味が逆になっている**（ADR 0018 Amendment 1）。旧 prompt.md は「この
observation でどう動くか」、今の prompt.md は「いつ・何を根拠に・どう直すか」。両形式とも frontmatter
のキー（name/description）が同じなので、区別できるのは **`kind: improve` だけ**。マーカーの無い
prompt.md は起動時に fail-fast（黙って読むと取引指示が「改訂方針」として system prompt に入る）。
`improve.md` だけのディレクトリも fail-fast。docs/guide/llm-agents.md にも同じ警告あり — **重複して
書いているのは、この罠を踏むと壊れ方が静かだから**。

改訂プロンプトは **その run で有効な venue の action 名を列挙する**（`ACTION_TYPES_BY_PROTOCOL`、単一の
出典は `sdk/src/action.ts`）。渡さないと **一度も swap したことのない戦略は `swap` の存在を知りようがない**
（実測: USDC-only 配布で `lp-provider` が 18/18 シナリオ無取引 = `docs/scoring-metric-measurements.md` §5.8）。

`decide` は **worker thread** で実行され、`DECIDE_TIMEOUT_MS`=5秒（呼び出しごと）/
`STRATEGY_STARTUP_TIMEOUT_MS`=60秒（モジュールロード。別上限）。**上限を取り違えた過去がある** —
判断の 5 秒をロードにも使っていた時期、負荷の高いホストで tsx コンパイルがそれを超え
**31 体中 13 体が起動時 exit 1**（issue #100）。失敗 3 回連続で back-off（1→2→4…最大 64 ブロック）——
毎ブロック throw する戦略が 2 秒ごとに tsx を起動して 1 コアを占有していた（`lp-provider`、#93 F-H）。
自動 rollback は無い（旧実装は 18 run 中 0 件発火）。

## 設定（YAML 単一ソース。ADR 0013）

詳細は [configuration.md](docs/guide/configuration.md)。解決順は `--config <path>` > `ERIS_CONFIG` >
`config/local.yaml` > `config/example.yaml`。雛形は `run.localDeploy: true` 既定。

**`limits` セクションは撤廃済み**（docs/guide の一部ページはまだ `limits` に言及しているが古い —
**どの venue にも 1 件あたりの金額上限は無い**）。引き上げではなく撤廃なのは、(a) 「無制限」と書かれた
数値はいずれ誰かが設定するから、(b) その上限が規則であると同時に**参照戦略 19 ファイルのサイズ決定式の
入力**だったから（全員が保有額とも機会の良さとも無関係に同じサイズで張っていた）。今 1 件の取引を縛るのは
**自分の残高**と**相手プールの厚み**だけ。共通ヘルパは `example/agents/lib/affordable.ts` の
`sized(obs, token, bps)`。上限をスケールとして使っていた非 agent 側 2 箇所は既存の量へ移した:
vuln プールの rug 閾値は配布 USDC の割合、Aave フローの目標債務は `flow.aaveBorrowUsdcUnits`。
`npm run manifest` は「上限は無い」と明記する。**CLAUDE.md や測定ドキュメントの実測値は全部旧上限下で
取ったものがあるので数字は変わりうる。**

### `run.resetUnit` / `run.chainMode` の fail-fast 条件（詳細は scoring.md / practice-devnet.md）

- `resetUnit: scenario` を **matrix runner 以外**（`sim:realtime`）で宣言すると起動時 fail-fast
- `chainMode: external`（cheatcode 無し実チェーン）は次の組み合わせで fail-fast:
  treasury 鍵なし / `localDeploy: false` / `economicGas: true` / `stressVictimCount > 0` /
  `prewarmBlocks > 0` / scored token が誰でも mint できる場合
- ローカル ⇄ devnet の切り替えは**チェーン**（`.env.local` + `--chain-mode`）と**アドレス**
  （`sdk/src/constants.local.ts`、`gen:local-constants` で再生成）の**独立した 2 軸**。片方だけ動かすと
  数分後に `Cannot decode zero data ("0x")` で落ちる事故があったので、起動時に `deployment_check` で
  両方の整合を実測して落とす

### GMX の funding は localhost でも動く

以前は**構造的に 0** だった。upstream の hardhat 用マーケット設定は `maxFundingFactorPerSecond` しか
置かず、`fundingFactor` / `fundingIncreaseFactorPerSecond` が 0 のまま（実測 485 ブロックで長短偏り
74,651/54,752 でも全ブロック 0.000）。`deployer/vendor/gmx-localhost.patch` が解消。

- **2 層あって 1 つの変更で両方直る**: `fundingFactor` が 0 なのに加え、読み側（`marketSeries.ts`）は
  `savedFundingFactorPerSecond`（適応 funding 経路の保存値）を読むため `fundingIncreaseFactorPerSecond==0`
  だと MarketUtils が早期 return して永久に 0。適応 funding を有効にすると両方埋まる
- **値を盛らないこと** — 盛ると perp だけ Aave の借入金利と違う時計で回る（LST の APY で一度やった失敗）
- **これ以前に焼いた state dump は旧設定を持つ**ので replay は今も 0 を返す（板が均衡しているのではなく
  「この deploy に funding が無い」）。`npm run gen:state-dump` で焼き直す
- observation にも出る（issue #78）: `protocols.gmx` の `longOiUsd`/`shortOiUsd`/`fundingPerHourBps`/
  `fundingModeled`。読取失敗は 0 ではなく欠落、`fundingModeled: false` が「funding が無い」側の 0。
  **額は取引にならない**（360 ブロックで 100% スキューでも建玉の 0.14bps、AMM 側 30bps に対し 3 桁小さい）——
  符号付きコスト項と偏りシグナルであって carry ではない

### 背景フローと venue 深度の較正（issue #79。2026-09-07 実測に合わせて再較正）

**2026-09-13 以前の実測値は全部旧較正下**（uninformed 0.9/block・σ1.0・clamp3・GM pool 200 WETH・Aave
seed 9k USDC・SP 50k）。この repo のドキュメント上の実測値は再計測まで読み替える。

- config 側（dump 焼き直し不要）: `flow.uninformedArrivalRate` 0.9→**0.45**、`uninformedSizeSigma`
  1.0→**1.5**（平均は不変、tail が到着半減分の dislocation を肩代わり）、新設
  `uninformedSizeClampMult`（既定 3=互換、レジームは 10）、`flow.gmxMaxSizeUsd` $20k→**$100k**
- deployer 側（`gen:state-dump` 焼き直し必須）: GM pool 200 WETH+600k→**1,500 WETH+4.5M USDC**、
  Aave shared seed 9k USDC+10 WETH→**5M USDC+2,000 WETH**、Stability Pool 50k→**125k eUSD** +
  genesis Trove **350 ETH/350k eUSD**。WETH 予算は wrap 10,000 に対し 3,000+1,500+2,010=6,510 で収まる
- spot 深度（1,000 WETH+3M USDC/venue）と価格アンカー（$3,000/$60,000）は据え置き（深度を倍にして件数
  半減すると dislocation は 1/4 になり calm の 39bps が informed 帯に入ってしまう）
- 初回実測（2026-09-13、calm#101/crash#101）: calm の venue 乖離平均 **40.1bps**（旧較正 39bps と同水準）。
  venue-arb net −136/P −1,105、multi-arb net +23。crash#101 は 15.6%gap+59%liquidityPull が発火・復元、
  crash 後 ~100 ブロック WBTC curve が fair+100〜250bps に居座り `no_arb_persistent_warning` が 11 回

## 実行コマンド

主要コマンドと fail-fast/運用上の注意のみ。**フル CLI リファレンスは各ガイドを参照**
（[backtest.md](docs/guide/backtest.md) / [local-deploy.md](docs/guide/local-deploy.md) /
[dashboard.md](docs/guide/dashboard.md) / [practice-devnet.md](docs/guide/practice-devnet.md)）。

- `npm run anvil` — 別ターミナルで Anvil フォークを起動（ローカルデプロイモードでは不要）
- `npm run build:contracts` — モックオラクル + PriceFeed を forge build（`out/` 未生成なら最低 1 回）
- `npm run gen:local-constants` — `deployer/` の `deployments.json` → `sdk/src/constants.local.ts`
- `npm run gen:state-dump` — 稼働中の deployer anvil から state dump + manifest を `backtest/state/` へ
- `npm run sim:realtime` — 実時間 run を 1 回（`config/local.yaml`。`--seed`/`--blocks`/`--protocols`/
  `--agents` 等で一回上書き）
- `npm run backtest -- --regime <name> --seed <N>` — シナリオ 1 本を再生（`--seed` は必須。regime YAML は
  seed を持たない）
- `npm run backtest -- --scenarios <path>` — シナリオ行列を再生し `matrix.json` + `standings.json` を
  書く（`--resume <dir>` で同じ行列を続行。詳細は backtest.md）。**採点は ADR 0023 の偏差値方式**
  （`core/src/scoring/deviationScore.ts`。失格は無く違反は `flags`）
- **公式レジーム（12 本）**: `calm` / `cex-drift` / `informed-flow` / `whale` / `lending-incident` /
  `crash` / `depeg` / `vuln` / `spike` / `depeg-persist` / `cdp-incident` / `launch`
  （詳細と実測は [backtest.md](docs/guide/backtest.md) / [stress-events.md](docs/guide/stress-events.md)）。
  **`vuln` を公式化するにはフィールド側に `discovery-arb`/`discovery-arb-verify` を入れないと誰も発見
  できず何も測れない**（実測: 無検証 −5,306、検証側 +721、venue-arb −220）
- `npm run explorer` / `npm run dashboard` — ローカル Blockscout（:3100）/ run 可視化（:5173）。
  **チェーンをリセットしたら `npm run explorer:reset`** が必須（indexer が rewind に追従できない）
- `npm run manifest` — 環境マニフェストを書く（鍵は入らない。個別鍵は `--participant <id>` で stdout のみ）
- `npm run typecheck` / `npm run test` — 型チェック / ユニットテスト（`test` は node:test。単体ファイルは
  `node --import tsx --test test/<name>.test.ts`。lint スクリプトは無い）
- `npm run check:strategy` — 戦略コードの cheatcode 静的検査（入口ゲート）
- `npm run check:boundaries` — workspace 依存方向の検査
- `npm run bundle:agent <id>` — 提出用 zip。**`kind: improve` の prompt.md が無いディレクトリは拒否**
  （規約 §2.5 が全提出 agent に戦略改訂を要求するため。example の教材 agent は prompt.md 無しで OK なので
  起動時ではなく提出物の段で止める）

### 運用上の落とし穴

- **anvil はブロックごとの state を `~/.foundry/anvil/tmp/anvil-state-*/` に ~2 MB ずつ書き、プロセス
  終了後も残る**（360 ブロック run 1 本で ~7 GB）。2026-09-10 に 61 GB 溜まってディスク満杯で run が
  `ENOSPC` で落ちた。run の後は `rm -rf ~/.foundry/anvil/tmp/anvil-state-*`（動いている anvil が無いとき）
- **deployer は同じ anvil に 2 回目の `--keep-fresh` を流すと `insufficient funds` で落ちる**
  （全 venue の seed で deployer アカウントが 100 万 ETH のうち ~99.9 万を使い切るため）。焼き直すときは
  anvil ごと立て直す。`--keep-fresh` が消すのは `deployments.json` だけ
- **deploy 鍵は `MNEMONIC`**（既定は anvil の公開テスト mnemonic。issue #74）。index 0 の deployer は
  Aave の POOL_ADMIN・GMX の CONFIG_KEEPER・LST vault の owner・seed した LP 全部・genesis Trove の余剰
  eUSD を持つ。**参加者が tx を送れるチェーンでこの既定を使ってはいけない**（mnemonic は anvil のバナー
  に出るので「deployer」は全員が持つ鍵になる）。秘密 mnemonic は `deployer/.env` か
  `MNEMONIC="$(cat ~/…)" npm run deploy -- --keep-fresh`。**鍵を変えると全アドレスが動く**ので
  `gen:local-constants` → 必要なら `gen:state-dump` を必ず実行（さもないと GMX が
  `getMarkets returned no data`）。stress（`liquidityPull`/`depeg`/`eusdDepeg`）は deployer から送るので
  `.env.local` に `DEPLOYER_PRIVATE_KEY`（既定 = anvil account 0）
- 評価・採点・可視化系コマンド（`sim` 同期ラウンド / `evaluate` / `gate` / `discrimination` /
  `leaderboard` / `stress-report` / `npm run metrics`）は撤去済み。run 後の解析は `runs/<id>/` の
  `summary.json` / `events.jsonl` / `blocks.csv` / `market.json` を直接読む

## 市場ストレスイベント（`stress.events`。ADR 0009。既定 off）

イベントの種類・機構・較正値の詳細は **[stress-events.md](docs/guide/stress-events.md) が正**（英語、
このファイルより新しく詳しい）。ここには docs/guide に無い invariant だけ残す:

- OU の base price はそのまま進め、その上に SEED 由来の決定論オーバーレイを重ねて effective price を導出。
  effective が PriceFeed・Aave オラクル・GMX・採点へ一貫伝播し、窓外では β≈0（ADR 0007）
- 清算を成立させる seed 由来 victim 群は採点対象外。**victim を建てるには fresh state 必須**（soft-reset
  だと前 run の victim ポジが残留して HF が壊れるため fail-fast）。Aave: `HF0 ≳ LT/(0.97·LTV)` で建て、
  crash magnitude `m > (HF0−1)/HF0` で割る。ローカルでは victim を建てる前に Aave オラクルを初期 fair
  price へ較正する（fork の「オラクル≈実勢≈fair0」が成立しないため）
- stress run は**時間制限を自動無効化**しブロック数で終了する（`ERIS_RUN_SECONDS` が先に切れて crash 窓
  へ到達しない事故を回避）

## LST venue（issue #38。既定 off・**ローカルデプロイ専用**）

詳細は [protocols-and-actions.md](docs/guide/protocols-and-actions.md)。**採点は realizable 値**
（issue #40 axiom 3 / ADR 0022 Amendment 1で確定。以前は par=face value だったが、
「額面で評価すると攻撃が捏造された価値として記録される」ため変更）。face value は `markedValueUsdc`
として診断用に残る。**USDC 建て採点では LST 保有戦略は構造的に β で不利**（実測: noop 0 >
lst-carry −203 > lst-carry-wide −233、一方で WETH を持たない venue-arb は +115。`alphaUsdc` は free
inventory の β しか除去せず LST ポジションは live mark のため）。ETH 建て採点（DAT 型）が follow-on。

## CDP stablecoin venue（Liquity V1 フォーク = eUSD。issue #39。既定 off・**ローカルデプロイ専用**）

Liquity V1 の core は**無改変**。ours なのは 2 つだけ:
- `LiquityPriceFeedAdapter` — Liquity は wiring 後に ownership を renounce しオラクルアドレスが永久固定
  になるため、run ごとに新しい PriceFeed を admin key で差し替える
- `LiquityRedemptionHelper` — **部分償還のヒントは実行時価格に依存する**（`_redeemCollateralFromTrove`
  が執行価格から NICR を再計算しヒントと不一致なら partial を cancel）。環境が agent より先にオラクルを
  書くので、オフチェーン計算のヒントは構造的に必ず陳腐化する（初回 live run で全償還が
  `Unable to redeem any amount` で revert して判明）。`fetchPrice()` で価格確定と同一 tx 内でヒント計算

- **eUSD は市場価格 stable としてレジストリに昇格**（issue #27 (b)）。spot eUSD 残高は scorer の spot
  sweep が値付け、liquity アダプタは値付けない（二重計上回避）。ICR<100% の Trove は 0 で clamp
- Recovery Mode は**公式レジームの較正では到達不能**（genesis Trove 300% が TCR を支配）。到達させるのは
  victim cohort（`config/regimes/cdp-recovery.yaml`、公式セット外）
- 参照 agent 3 体: `redemption-arb` / `trove-manager` / `sp-underwriter`。借り手の防御が効くかは
  **借りた eUSD を使ったかどうか**で決まる（実測: 200% 保持組は無傷、125% で全額 post した組は清算され
  −13,140）

## エージェントが作る市場（ADR 0022。既定 off・**ローカルデプロイ専用**）

詳細は新設 [agent-markets.md](docs/guide/agent-markets.md) が正（機構・MarketRegistry・SimpleLending・
ガス予算・owner ガード実測・参照 agent 6 体など。以前はこの CLAUDE.md が一次資料だったがそちらへ移した）。
**採点はラウンドトリップ規則**（ADR 0022 §1）だけは覚えておく: エポック最終ブロックで環境が評価できない
コントラクト内の残存価値は 0、通り抜けた利益は満額計上。あらゆる罠クラスが「時間内に抜け出せなかった」
1 つに潰れるので、honeypot にも proxy 差し替えにも個別の防御機構が要らない。

## 新規トークンの上場（`launch` レジーム。issue #29。**ローカルデプロイ + `agentMarkets.enabled` 必須**）

機構と較正は [stress-events.md](docs/guide/stress-events.md) の `tokenLaunch` 節が正。**評価は ADR 0022
公理 2**: 鐘の時点のトークン残高は全員 0（`erc20-unaccounted`）、通り抜けた USDC だけが数える。**環境側の
teardown は無い**（プールは snapshot revert で消え、残りは採点外の flow wallet）。実測（seed 101,
2026-09-12）は PR #29 本文参照。**main の anvil backlog burst（PR #81 で修正中）がある環境では最初の
~200 ブロックが 1 秒で流れて窓ごと飛ぶ** — `launch` に限らず `windowFrac` を持つ全イベントが同じ目に遭う。

## 市場価格 stable（issue #27）

**「stable = $1」はコードがそう書いていたから**だった（`chain.ts` が active stable を `usdcUnits` 1 本に
潰し、`valuation.ts` が `kind==="stable"` を無条件に 1 と値付け。デペグした stable も par で採点されて
いた）。3 段階で外した: ①観測に内訳を出す（`balances.stables[symbol].priceUsdc`/`marketQuoted`。
`marketQuoted: false` の `priceUsdc: 1` を「ペグが保たれている」と読んではいけない）②`usdcUnits` を
native USDC だけに narrow（評価は `inventory.valueUsdc`）③market から値付け（`sdk/src/stables.ts`、
両側 executable probe の幾何平均 `sqrt(sell×buy)`。quote が返らなければ par に落として `par-fallback`
で報告）。**USDC は numéraire で $1 固定**。market を持つ stable（eUSD/DAI）は funding で配らない
（買って初めて持てるのがこの regime の要）。**α でも live mark**（固定参照で評価すると測りたいものが
打ち消される）。

## アーキテクチャ（環境とエージェント実行の分離。ADR 0006 / ADR 0015）

図と全体像は [architecture.md](docs/guide/architecture.md) が正。ここには docs/guide に無い運用上の
invariant だけ残す:

- **fair price はオンチェーン配布**。書込 tx は次ブロック着弾なので情報は 1 ブロック遅れる（全員等しく
  作用。仕様）。**全 base の開始 fair は setup で feed に載せる**（issue #94）——以前は WBTC が最初の
  oracle tx（最初の境界の 1 ブロック後）まで載っておらず、V_0 が全員 WBTC 分（バスケットで 24k）短くて
  noop の `netPnlUsdc` が 0 にならなかった
- **エポックの時計は場が揃うまで待つ**（issue #94 / #91 F5）。interval mining 前に全 agent の
  `runtime_start` を `run.agentsReadyTimeoutSec`（既定 60 秒）まで待つ。実測 docker 32 体で
  `runtime_start` は +86〜99 秒なので、その検証では上げる。外部参加者は待たない
- **採点は run 後再構成**（`reconstruct.ts`）。resetFork で歴史が消えるため**次 run の前に必ず再構成を
  終える**（anvil の保持深度 ~1,050 ブロックに注意）
- **ルール執行は事後検出**（`postRunCheck.ts`）。入口側は `npm run check:strategy`

## エージェント行動ログ

各 agent は `ctx.log` で `runs/<runId>/agents/<agentId>.jsonl` に毎ラウンドの判断（`reason`/`signals`/
`state`）を残す。`runtime/send.ts` が同じファイルに mempool 活動（submitted/submit_failed/rejected）を
自己申告で追記（coordinator が submitted を数えられなくなる穴を塞ぐ。ADR 0006 §5）。自己改善型は
`ERIS_IMPROVE_LOG_CALLS: "1"` で LLM との生の対話を `agents/<agentId>.llm.jsonl` に残せる（opt-in）。

## spot EC2 で重い run を回す（ローカル逼迫の回避。spot skills）

ローカルの CPU/メモリが逼迫するときは、**golden AMI の spot EC2** に run を投げる。ローカルデプロイ前提
（fork 不要）で自己完結し、外部依存は LLM(ollama) egress のみ。全 protocol を deploy 済みの anvil state
を AMI に焼いてあり、launch 時は `anvil --load-state` で全 5 venue を ~10 秒復元 → install/deploy なしで
run（起動 ~3 分・full venue + LLM が安定 green）。SSH 一本で結果を手元に回収（S3/IAM ロール不要）。AWS は
`eris` profile（account `075096050160`）固定。スクリプトは user-global の spot skills
（`~/.claude/skills/spot-{run,bake,ops}/scripts/`）に同梱。poc repo ルートで叩く（`$PWD` を poc とみなす。
別パスは `ERIS_POC_DIR`）。設計と学びは memory `spot-ec2-runner`。
**注: ADR 0015 の workspace 化で npm install の対象・パス前提が変わったため、次回 spot 利用時は AMI の
焼き直し（`/spot-bake`）が必要。**

- **`/spot-run`** — golden AMI で run を回し結果を回収（日常ドライバ）。`ERIS_SPOT_AMI=latest` で最新
  AMI 自動解決
- **`/spot-bake`** — 新しい golden AMI を焼く（poc 依存追加 / deployer・constants 変更時）。~35 分
- **`/spot-ops`** — 初回セットアップ（鍵 + SG + IAM）/ 状態確認 / 掃除
