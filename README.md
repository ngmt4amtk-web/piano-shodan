# ピアノ初段

42練習・8章と、第9章「曲」の18曲。小2の子と先生が、30分のレッスンで曲の手前の動きを練習するWebアプリです。公開するフォルダは `site/` だけです。

## 起動・生成・試験

```sh
python3 -m http.server 8080 --directory site
python3 build/drills_build.py
python3 build/stamp.py
/Users/ngmt.mtk/Projects/piano-himitsu/tools/venv/bin/python tests/run.py
```

ブラウザで `http://localhost:8080/` を開きます。LilyPondは隣のpiano-himitsuの2.24.4を読むだけで使用します。別の場所では環境変数 `LILYPOND` に実行ファイルを指定できます。

## 決めたこと

- 章→練習→開始の3タップ。第1章の前に導入を足しません。詳しい判断は `DESIGN.md`。
- `shodan/drills.py` と `compile.py` は原本と同一。全96か所、片手版を含め142楽譜を生成します。タイの継続符頭も座標を持ち、反復は演奏順に展開します。
- 片手の単音は「とてもゆるい」で次の音を待ちます。同音の余韻やオクターブ違いでは進みません。和音・両手・メトロノームは先生が判定します。マイク拒否時も先生ボタンで使えます。録音の保存・送信はしません。
- 画面鍵盤でも練習できます。音域変更ボタンを併設。鍵盤の小さい黒鍵は楽器の配置上の例外で、TabとEnterでも弾けます。他の操作は44px以上を基本にします。
- 「できた」でガチャを1回。基本比率はN60・R25・SR8・SSR5・UR2。練習で出せる段だけで割り直します。URで天井のカウントをリセットし、8回目は必ずUR。URは「すきなきょくを1曲」で、先生が閉じます。基本確率の分布試験と、天井による確率の変化は分けています。
- 18曲の先頭は「すなおな心」。地図・かけら・音符勝負・曲当て・60秒モードを引き継ぎました。カード30枚とホーム5マスは外しました。
- 呼び名の初期値は空。保存キーとキャッシュは `piano-shodan-`。静的公開ではAPIへ接続せず端末保存だけで動き、先生の部屋から書き出し・読み込みができます。保存できない時は書き出しを案内し、読めなかった保存も退避します。
- GitHub Pagesでは `site/` の中身を公開先に置きます。相対パスと `.nojekyll` を使用。service worker更新の版は `build/stamp.py` で生成します。

## 出典と確認範囲

課題・記法・音・楽譜・保存・かけら・あそびはpiano-himitsu。章一覧と練習画面の構成は[バイオリン初段](https://ngmt4amtk-web.github.io/violin-shodan/)。単音判定はfuyomi-pianoの `pitch.js` を変更せず使用しています。

曲の楽譜は[Mutopia Project](https://www.mutopiaproject.org/)（Public Domain、元はCollection Litolff）。録音はSalamander Grand Piano、Alexander Holm、[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)。録音の切り出しと再生速度の変更を使用しています。

自動試験は `/piano-shodan/` 配下のChromeで実行し、結果は `tests/results.json`、写真は `tests/shots/` に保存します。実機のiPhone Safari、実際のピアノ・部屋のマイク、消音スイッチ、VoiceOver、生徒とのレッスンは未試験。GitHubへの公開はこの依頼では行っていません。
