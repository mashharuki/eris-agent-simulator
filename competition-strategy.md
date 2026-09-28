# コンペで高得点を狙うための戦略メモ

このセッションでの作業（CLAUDE.mdの精読・圧縮、`example/agents/`全エージェントへの日本語解説追加、
ローカル環境の完全動作確認、spot-runスキルの復元）を踏まえた、得点を伸ばすための実践的な指針。
出典は原則としてリポジトリの`CLAUDE.md`（実測値・ADR番号付き）と、今回JP解説を入れた
`example/agents/*/agent.ts`。

---

## 1. 採点の仕組みを前提に置く（ADR 0023、規約§4.4）

- **P = V_K − V_0**（1シナリオ＝1エポックの価値変化。境界は5ブロック中央値マーク）
- **T = 50 + 10 × (P − μ) / σ**（その回次に参加した全員の中での相対評価。ベンチマーク除外、
  破産しても負のまま、床も凍結もない）
- **Score = w_s で加重平均**したT（w_sは回次に対して線形に1→1.5。**後半の回次ほど配点が重い**）
- タイブレークは「Tの標準偏差の小ささ」→「最悪エポック」→「提出時刻」
- **失格は無い**。ただしfee cap違反・未ログtx等は`flags`として記録される

ここから導かれる方針:
1. **絶対額ではなく「場を上回れるか」が全て**。自分だけ良い数字を出しても、その回次の全員が
   同じように良ければT=50付近に収束する。他agentが苦手とする局面（後述のレジーム別対応）で
   相対的に勝つことに価値がある。
2. **後半の回次ほど重み1.5倍**。自己改善（prompt.md）が効いてくるのは経験を積んだ後の回次な
   ので、自己改善型は構造的に後半で報われやすい設計になっている——裏を返せば、序盤で大きく
   崩れると重みの軽いうちに損切りされるだけで済むが、後半に同じ崩れ方をすると打撃が大きい。
3. **タイブレークが「安定性」を見る**。1レジームで大勝ちして他レジームで爆死する戦略は、
   平均Scoreでは良くてもタイブレークで不利になる。**全レジームで大負けしないこと**が
   「1レジームだけ最適化する」より価値を持つ。

---

## 2. 今回のローカル検証で分かったこと

- 環境構築上の問題（PATH未設定、GMXがARM64でローカルコンパイル不可）は解消済み。GMX抜き
  6 venue（uniswap/balancer/aave/curve/lst/liquity）で`config/local.yaml`は正常動作を確認
  （`violations: []`、`failedReads: 0`、全agent `stderrTail`空）
- ただし**24ブロックの短いsmokeテストでは`multi-arb`/`lst-carry`/`flash-arb`が0取引**だった。
  これは壊れているのではなく「機会が来る前にrunが終わった」だけの可能性が高い——本番は
  12分×複数エポックなので、この結論は**もっと長いbacktestで検証し直す必要がある**（§4参照）。
- `venue-arb`（自己改善あり）より`venue-arb-frozen`（改善なし）の方が今回のsmokeでは好成績
  だったが、これは24ブロックのノイズであって自己改善が無効という結論には使えない。

---

## 3. 得点を伸ばすための具体策（優先度順）

### 3.1 全12公式レジームで「大負けしないか」を先に測る

CLAUDE.mdの公式レジーム: `calm` / `cex-drift` / `informed-flow` / `whale` / `lending-incident` /
`crash` / `depeg` / `vuln` / `spike` / `depeg-persist` / `cdp-incident` / `launch`。

自分の戦略が**calmでしか鍛えられていない**まま提出するのが最も危険。特に:
- `crash`/`spike`/`depeg-persist`は「戻ると信じて持ち続ける」が構造的に負ける設計（意図的）
- `lending-incident`/`cdp-incident`は清算・償還・借り手防御のスキルが無いと一方的に食われる
- `vuln`は`discovery-arb`系以外は新規プールを見つけられず何も測れない（無検証は−5,306、
  検証側+721の実測差がCLAUDE.mdにある）

→ `npm run backtest -- --scenarios config/scenarios/public.yaml` で全レジームを回し、
どのレジームでTが低いかを`market.json`/`summary.json`で確認する。

### 3.2 自己改善（prompt.md）は「frozen対照」と必ず比較してから信じる

- ロスターに`ERIS_AGENT_FROZEN: "1"`の対照を並べる（ADR 0018 §5が要求する比較）
- `venue-arb/prompt.md`にある「Symptom → evidence → fix」の規律を自分のprompt.mdにも適用する:
  - 閾値をいじりたくなるが実は**fee bleed**（マージン不足）や**執行順位**（bid不足）の問題、
    ということが多い。表の分類に従って「何が本当の原因か」を先に切り分ける
  - **over-correction**（負けた直後に閾値を締めすぎて、run全体を支える大きな機会まで逃す）が
    測定済みの失敗モード。「up=触るな」「市場のせいの損はPnLとholding基準を見比べる」
    「量が少なすぎるだけの区間は様子見」の3パターンは明示的に`executorTs: null`にする
- `reviseEveryBlocks`は自分で決めて自分で払う（規約§2.5）。頻度を上げすぎるとLLM呼び出し
  コストが嵩み、下げすぎると改善の機会を逃す——backtestで感度を見る

### 3.3 サイジングは自分の責任（発注上限は撤廃済み）

- `example/agents/lib/affordable.ts`の`sized(obs, token, bps)`を使い、**残高の何%を張るか**を
  乖離幅やz-scoreに連動させる（`venue-arb`/`adaptive-arb`/`stat-arb`のパターン）
- **資金チェック（`canFund`）を必ず入れる**。issue #54の実測: これを忘れたagentは
  「持っていないWETHを売ろうとして359/359回reject」＝PnL 0.00 で終わった。壊れ方が静かなので
  気づきにくい
- ダスト floor 未満のサイズは`noop`にする（提案してrejectされるのはスコア上「何もしない」と
  同じだが、無駄なtxログとgasを消費する）

### 3.4 competition signal（ADR 0011）で入札を最適化する

固定feeで送るagent（`venue-arb`等）は「入札しすぎて手数料負け」か「入札不足でフロントラン
される」の両極端になりがち。`adaptive-arb`/`max-profit-arb`のパターン——
`obs.competition.maxCompetitorPriorityFeeWei`を見て**勝つのに必要な最小限**だけ上乗せし、
`profit × CEIL_FRACTION`で入札上限もかける——を検討する。`recentRevertRate`が高い（フロント
ランされている）ときはマージンを引き上げる、というフィードバックも有効。

### 3.5 WETH以外のbase（WBTC等）も見る

`marketViews()`（`lib/markets.ts`）で正規化された全base×全venueを走査する設計にする。
WETHだけを見る戦略は、WBTC側で起きる乖離イベントを**構造的に見逃す**（ADR 0013）。
`multi-arb`/`adaptive-arb`/`stat-arb`は既にこの対応をしている参照実装。

### 3.6 2レグdelta-neutral裁定は方向性リスクを持たない

`clean-arb`のパターン（安いvenueで買い→高いvenueで売る、を同一bundleで完結）は、
片道だけの単発（`multi-arb`のフォールバック）と違い**方向性のβを一切持たない**。
レジームを問わず安定してα（規約が測る対象そのもの）を狙えるので、多くのレジームで
「大負けしない」土台になりやすい。単発フォールバックは実測でWBTC投入イベント時に
-1,490〜-1,650 USDCの損失を出しており、コスト無視の単発は避けるべきという教訓がある。

### 3.7 出口管理（ラウンドトリップ規則を意識する）

LST/Liquity/agent-markets/新規上場トークンは共通して「**run終了までに脱出できるか**」が
価値の有無を決める（ADR 0022公理2）。`market-taker`/`vault-keeper`/`launch-sniper`が使う
`blocksRemaining <= EXIT_BLOCKS`で早めに手仕舞いするパターンを、該当venueに触る自分の戦略にも
必ず入れる。「機会が良く見える」ことは「脱出できる余裕があるか」より優先してはいけない。

### 3.8 毎判断で理由をログする

`ctx.log({ reason, signals })`を`noop`のときも含めて毎回返す。理由の無い`null`やnoopは
「何も見ていない」のと区別がつかず（実測: 351回連続で理由なしnoopを返した事故がissue #101に
記録されている）、自己改善のevidence（`digestMarketHistory`/`digestTrades`）にも載らない。

### 3.9 GMXが絡む戦略（`basis-arb`等）はspot EC2で検証する

このマシン（Raspberry Pi / aarch64）ではsolcのARM64ネイティブビルドが存在せず、GMXの巨大な
コントラクト群をローカルでコンパイルできない。GMX関連の検証は復元済みの`/spot-run`
（x86_64インスタンス）側で行う。`/spot-bake`でgolden AMIを焼き直してから使うこと。

---

## 4. 提出前チェックリスト

- [ ] `npm run check:strategy` が通る（cheatcode静的検査）
- [ ] `npm run typecheck` / `npm run test` が通る
- [ ] `npm run bundle:agent <id>` が通る（`kind: improve`のprompt.md同梱必須。規約§2.5）
- [ ] 全12公式レジーム×複数seedで`backtest --scenarios`を回し、大負けするレジームが無いか確認
- [ ] `ERIS_AGENT_FROZEN`対照との比較で、自己改善が実際にプラスに効いているかを確認
      （効いていない/悪化しているなら無理に使わない判断もあり）
- [ ] `prompt.md`に「Symptom → evidence → fix」形式の改訂方針を書き、閾値いじり一辺倒に
      逃げない規律を明記している
- [ ] 資金チェック（`canFund`）とダスト floor 処理が入っている
- [ ] WETH以外のbase（有効なら）も見る設計になっている
- [ ] 出口が必要なvenueで`blocksRemaining`を見た手仕舞いロジックがある
- [ ] GMXを使う戦略はspot EC2で最低1回はgreenを確認している

---

## 参考

- 各エージェントの実装解説（日本語）: `example/agents/<id>/agent.ts`内のコメント
  （venue-arb, clean-arb, multi-arb, adaptive-arb, stat-arb, max-profit-arb, market-taker,
  vault-keeper, launch-sniper/confirm 等、全34エージェント対応済み）
- 採点の詳細: `docs/guide/scoring.md`
- レジーム別の実測較正値: `CLAUDE.md`「公式レジーム」節、`docs/scoring-metric-measurements.md`
- バックテストの回し方: `docs/guide/backtest.md`
