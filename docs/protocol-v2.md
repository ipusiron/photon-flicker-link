# Photon Flicker Link v2 / Paired optical signaling

v2は各値とその反転値を組にして送り、組の中央で同期を更新します。初期値はモノクロ2値・2 symbol/s・最大8バイトです。旧方式は比較用の純関数に残し、公開UIではv2だけを使います。送受信の両端で再読み込みが必要です。

Version 2 sends each value followed by its complement. The receiver tracks the midpoint of each pair. Defaults remain binary monochrome, two physical symbols per second and eight UTF-8 bytes maximum. Legacy coding remains in pure-function regression tests; the UI uses V2 only. Reload both endpoints.

## Wire format

| Order | Content |
|---|---|
| 0, RGB only | Eight physical calibration symbols: baseline, R, G, B, each held for two symbols |
| 1 | Sixteen physical symbols: `1101010011000101`; the complement of the legacy preamble |
| 2 | Eight extended-Hamming length bits, followed by payload bytes, CRC-8 and two RS parity bytes; packed MSB first and sent in complementary pairs |
| 3 | Three paired end bits `101`, producing six physical symbols `100110` |

モノクロと青赤は1組に1ビット、RGB並列は1組に3ビットです。0は低→高（青→赤）、1は高→低（赤→青）です。RGBは3チャネルそれぞれを反転します。RGBの末尾に余ったビットは0で埋め、受信側でも0を確認します。

Monochrome and blue/red carry one bit per pair; parallel RGB carries three. Zero is low–high (blue–red); one is high–low (red–blue). RGB complements all three channels. Any final padding bits are zero and are checked by the receiver.

## Error correction and validation

長さ0〜8を4ビットで表し、拡張Hamming(8,4)へ変換します。パリティ位置は1・2・4・8、データ位置は3・5・6・7です。16種類の符号語を候補にし、`2×誤り数＋欠落数 < 4`を満たす一意な候補だけを採用します。その後、長さが8以下か確認します。8より大きい値を候補から先に除外しません。

Length uses extended Hamming(8,4), with parity at positions 1, 2, 4 and 8. Decode against all 16 codewords, accepting a unique candidate only when `2 × errors + erasures < 4`; then require length ≤ 8. This corrects one wrong header bit or up to three erasures under that bound.

CRC-8/SMBUSは多項式`0x07`、初期値0、MSB先頭、最終XORなしです。対象は「符号化前の長さ1バイト＋本文」です。本文とCRCに2バイトのRS冗長を加えます。GF(256)の既約多項式は`0x11d`、原始元は2です。送信順の符号語を`c[i]`とすると、次の2条件を満たす末尾2バイトを求めます。

CRC-8/SMBUS covers the uncoded length byte followed by the payload. Parameters are polynomial `0x07`, initial value zero, MSB first and no final XOR. Payload and CRC receive two shortened RS parity bytes over GF(256), polynomial `0x11d`, primitive element 2. In transmission order, the codeword satisfies:

```text
XOR c[i] = 0
XOR (alpha^i × c[i]) = 0
```

訂正範囲は1バイトの誤り、または位置がわかる2バイトまでの欠落です。同時に両方を最大数まで訂正できる意味ではありません。1ビットでも不明なバイトは、そのバイト全体を欠落として扱います。長さ、RS、CRC、終了マーカー、UTF-8、RGBの埋め草を確認してから成功にします。

Correction capacity is one erroneous byte or up to two known byte erasures, not both maxima together. A byte containing an unknown bit becomes an erasure. Success requires the length, RS, CRC, end marker, UTF-8 and RGB padding checks. Counts report repaired header bits and repaired payload/CRC/parity bytes separately.

訂正範囲を超える誤りには、別の符号語へ誤訂正する可能性があります。CRC-8にも見逃しがあり、成功表示は完全性や送信者を保証しません。[Reed-Solomonの訂正範囲と誤訂正](https://www.cs.cmu.edu/~guyb/realworld/reedsolomon/reed_solomon_codes.html)を参照してください。

Beyond its correction bound, a decoder can miscorrect to another codeword. CRC-8 also has undetected error patterns; a successful result is not an authenticity guarantee. The linked RS introduction explains correction bounds and miscorrection.

## Clock and brightness handling

プリアンブルの変化位置から周期を推定します。取りこぼしのある変化は、前後フレームの時刻が示す区間内として扱います。従来の振幅差0.025、既知パターンの全区間確認、2 frame/symbol以上の条件は維持します。同期後は組の中央にある変化を観測し、直近8点から周期と次の位置を推定します。初期周期から20%を超える変化や、予測から0.4シンボルを超える位置は採用しません。

Preamble transitions estimate the physical symbol period. A transition across missing frames is bounded by its two observed timestamps. The original 0.025 amplitude floor, full known-pattern check and minimum two frames per physical symbol remain. After acquisition, a rolling fit over eight observed transitions estimates timing. Period changes beyond 20% of the initial period, and midpoint positions beyond 0.4 physical symbols from prediction, are rejected.

各半分の中央56%を平均します。中央が空の場合も、前後に同じ半分の観測値があり、境界から10%の余白がある場合だけ評価します。観測値の不一致は雑音として判定に反映します。半分を丸ごと失った場合は推測で埋めません。

Each half uses its central 56%. An empty central window can use observations bracketing its center only within that same half and with a 10% boundary guard. Disagreement contributes to measured noise. An entirely missing half is not invented.

組の比較には、信号差0.002以上、観測した雑音の6倍以上、正規化後の相対差0.1以上を要求します。モノクロは輝度、青赤はR/(R+B)、RGBは較正した各チャネルで比較します。同じ倍率の明るさ変化には対応しますが、組の途中の急変、白飛び、暗部雑音、反射、動き、非線形な色補正は残ります。

Pair decisions require a sensor difference of at least 0.002, at least six times observed noise, and normalized relative contrast of at least 0.1. Comparisons use luminance, R/(R+B), or calibrated RGB. Shared gain changes are reduced; changes within a pair, clipping, dark noise, reflections, movement and nonlinear color correction remain limitations.

Manchester符号の中間遷移を使う考え方は[LED-it-GO](https://arxiv.org/pdf/1702.06715)でも説明されています。本ツールの画面・カメラ・ブラウザー実装や性能が同研究と同じという意味ではありません。

The use of a Manchester midpoint transition is also described in LED-it-GO. This does not make this browser screen–camera implementation or its performance equivalent to that research.

## Time and recovery

本文長を`L`、1組のビット数を`B`、物理シンボル速度を`R`、較正数を`K`とすると、所要時間は`(K + 22 + 2 × ceil((L + 4) × 8 / B)) / R`秒です。`K`はRGBで8、他は0です。最大長・2 symbol/sで107秒／47秒、カウントダウンは別に3秒です。受信と動画は最大120秒・128MiBです。

For payload length `L`, bits per pair `B`, physical rate `R` and calibration count `K`, duration is `(K + 22 + 2 × ceil((L + 4) × 8 / B)) / R` seconds. `K` is eight for RGB and zero otherwise. Maximum-length defaults take 107 or 47 seconds, plus a separate three-second countdown. Reception and video duration are bounded at 120 seconds; files at 128 MiB.

長さやパケットを受理できない場合は同期探索へ戻ります。120秒の計時は延長しません。送信は1回で終了し、自動再送や自動再開はありません。非表示、停止、権限拒否、切断時の解放処理を維持します。

Rejected headers and packets return to preamble search without extending the 120-second session. Transmission is finite and never repeats or resumes automatically. Hidden-tab, Stop, permission and disconnection cleanup remain in place.

## Validation scope

旧方式の216条件は変更せずに維持しています。v2は3モード、24/30/60fps、2/4/8 symbol/s、時計比0.97/1.025、開始位相3種類の162条件を検査します。弱い雑音、緩やかなゲイン変化、29フレームごとの欠落、RGBの混色行列を含みます。別途、明るさ半減、周期途中の3%変化、1バイト反転、2バイト欠落、訂正不能、再同期を検査します。実測値は[検証記録](verification.md)に記載します。

The original 216 legacy cases remain unchanged. V2 tests cover 162 camera-sampling combinations, with weak noise, gradual gain changes, periodic missing frames and RGB mixing. Additional tests cover gain halving, a 3% period step, byte inversion, two-byte erasure, uncorrectable inputs and reacquisition. These are synthetic conditions. iPhone, Vivaldi and physical two-device reliability remain **本人確認待ち / awaiting owner testing**.
