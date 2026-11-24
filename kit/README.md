# セロガキ 自動制作キット

1本 = `episodes/seroXX.json`(台本・場面・サムネ)+ `captions/seroXX.txt`(キャプション)。コードは毎回書かない。

## 作り方(作業環境で)
```
python3 tts.py episodes/seroXX.json work/seroXX/voice            # 青山龍星の声 + タイミング
node render.js episodes/seroXX.json work/seroXX/voice work/seroXX/video.mp4 --thumb work/seroXX/thumb.png
python3 mix.py work/seroXX/video.mp4 work/seroXX/voice work/seroXX/final.mp4   # BGM・-14LUFS
node render.js ... x --still 秒 out.png                              # 1コマ確認
```
必要なもの: voicevox_core 0.16(wheel)・voicevox_onnxruntime 1.17.3・open_jtalk辞書・15.vvm(VV_DIR)、node + @napi-rs/canvas、ffmpeg、Noto Sans CJK JP。

## 型(01〜04で決まったもの)
- 黒背景、左=灰色のドパガキ(スマホは青く光る)、右=光るセロガキ(アンバー)
- 上: 問い + 2つのカウンター / 下: 声と同じ字幕、キーワードだけ色(ドパ=blue、セロ=amber)
- 長さ25〜32秒。最初の行は必ず問いかけ、最後は「今日できる1つの行動」
- 場面の種類: compare(比較)/ stat(大きな数字+棒人間)/ bars(棒グラフ)/ chart(折れ線・しきい値の線)/ week(1週間の積み上げ)/ crowd(研究の人数)/ tips
- **中央(場面)に文章を出さない。字幕と同じ内容を中央に文字で出すのは禁止。** 中央はグラフ・図・棒人間のアニメーションで見せ、文字は数字・単位・グラフの軸ラベル・出典だけにする(2026-11-24 本人の指示)
- tips(今日からできること)は文章になるので使わない。行動は棒人間の演技で見せる
- グラフの形が論文の実数でない場合は、出典の横に「〜をもとにしたイメージ」と書く。根拠のない割合や数字を図で作らない
- compare の演技: phone_bed, phone_lie, sleep, awake, phone_stand, phone_sofa, curtain_sun, sun_stretch, walk, read, drink, slump, cheer
- 声: 青山龍星ノーマル(style 13)、speed 1.12。BGMは自作で声より約8dB下、声で下がる
- サムネ: 上に極太の見出し(2行まで)、真ん中に比較の絵、下にサブ見出し

## ネタのルール
- 研究は必ず一次情報(論文・大学の発表)で数字を確認する。追試で再現されなかった研究は使わない(例: スマホが机にあるだけで集中力が落ちる Ward 2017 → 再現失敗の報告あり、不採用)
- 観察研究は「関係」と書き、キャプションに注意書きを入れる
- 医療っぽい断言はしない。メンタル系は「つらい時は医療機関へ」を添える
- キャプション: 問い → 研究(誰が・何人・何年・雑誌)→ なぜ → 今日からできること → 保存の呼びかけ → 注意書き → 出典 → VOICEVOX:青山龍星 → ハッシュタグ10個
- 過去回は topics.md に記録し、同じネタを続けない

## 投稿
完成したら本人の確認(OK)を待ってから投稿する。Instagram・TikTokへは Buffer 経由で予約投稿。
