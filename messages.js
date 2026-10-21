/* Photon Flicker Link - MIT (c) 2026 ipusiron. All interface prose lives here. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PhotonMessages = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const pairs = {
    "subtitle": [
      "画面の明滅をカメラで読み、光を文字に戻す。",
      "Read screen flicker with a camera. Watch light turn back into text."
    ],
    "theme": [
      "明暗を切り替える",
      "Switch light / dark theme"
    ],
    "language": [
      "Englishに切り替える",
      "Switch to Japanese"
    ],
    "help": [
      "ヘルプを開く",
      "Open help"
    ],
    "before": [
      "始める前に",
      "Before you begin"
    ],
    "pse": [
      "点滅は光過敏性発作（PSE）や体調不良を引き起こすことがあります。周りの人にも配慮し、不調を感じたら停止してください。医療機器ではありません。",
      "Flashing light can trigger photosensitive seizures (PSE) or discomfort. Consider people ne" +
      "arby and stop if you feel unwell. This is not a medical device."
    ],
    "setup": [
      "最初は2 symbol/s・低コントラストを使います。受信を先に開始し、四隅の固定マーカーを含む送信パネル全体をカメラに入れます。できるだけ正面から大きく映し、パネル検出を確認してから送信してください。",
      "Start at 2 symbol/s and low contrast. Start reception first. Show the whole panel, including all four fixed corner markers, " +
      "large and as front-on as possible. Confirm panel detection before sending."
    ],
    "privacy": [
      "録画しません。映像はフレームごとに処理し、通信内容や動画を保存・送信しません。保存する設定は言語と明暗だけです。",
      "No recording. Each frame is processed locally; messages and video are neither saved nor up" +
      "loaded. Only language and theme preferences are stored."
    ],
    "ethics": [
      "作者は悪用を勧めません。",
      "The author does not encourage misuse."
    ],
    "mode": [
      "領域",
      "Area"
    ],
    "rate": [
      "送信速度",
      "Transmit rate"
    ],
    "contrast": [
      "送信コントラスト",
      "Transmit contrast"
    ],
    "low": [
      "小さい（灰色、初期値）",
      "Low (gray, default)"
    ],
    "high": [
      "大きい（近黒・近白、注意）",
      "High (near-black / near-white, caution)"
    ],
    "contrastNote": [
      "灰色同士の小さな明暗差でも、カメラが差を十分に取得できれば復号できます。受信映像の下でデータとクロックの判定を確認してください。差が不足する場合は、停止して送信側を「大きい」に変更できます。" +
      "明暗差は増えますが、反射・白飛び・パネル未検出の解消や受信成功を保証しません。",
      "Gray levels can be decoded when the camera measures enough contrast. Check the data and clock indicators below the receiver video. " +
      "If contrast is insufficient, stop and choose High on the sender. This increases contrast but does not guarantee panel detection or successful " +
      "reception, or resolve reflections and clipping."
    ],
    "settingsNote": [
      "送受信の両端を再読み込みして、同じ最新版のパネルを使ってください。受信側はクロック領域から区切りを読みます。送信は1回で終わります。旧形式のパネルとは互換性がありません。",
      "Reload both endpoints to use the same latest panel. The receiver reads bit boundaries from the clock areas. " +
      "Transmission ends after one packet. Earlier panel formats are incompatible."
    ],
    "environment": [
      "この環境",
      "This environment"
    ],
    "fps": [
      "実効フレームレート",
      "Effective frame rate"
    ],
    "callback": [
      "フレーム取得方式",
      "Frame callback"
    ],
    "exposure": [
      "露出モード",
      "Exposure mode"
    ],
    "whiteBalance": [
      "ホワイトバランス",
      "White balance"
    ],
    "resolution": [
      "入力解像度",
      "Input resolution"
    ],
    "clock": [
      "受信した周期",
      "Measured symbol clock"
    ],
    "environmentNote": [
      "受信またはカメラテストの開始後に表示します。カメラの露出とWBは自動変更せず、取得できた状態を示します。rAFのfpsはフレーム進行からの推定値です。",
      "Shown after reception or camera test starts. Exposure and white balance are left unchanged" +
      "; reported settings appear here. rAF fps is estimated from video-frame progression."
    ],
    "role": [
      "役割",
      "Role"
    ],
    "send": [
      "送るだけ",
      "Send only"
    ],
    "receive": [
      "受けるだけ",
      "Receive only"
    ],
    "offline": [
      "オフライン復号",
      "Decode a local video"
    ],
    "sendNote": [
      "別の端末の受信を開始してから押します。③→②→①→開始の3秒後に送信し、停止すると発光面は静止します。",
      "Start reception on the other device first. A three-second ③ → ② → ① → Start countdown prec" +
      "edes transmission. Stop leaves a static panel."
    ],
    "receiveNote": [
      "選ぶだけでは映像も信号も表示しません。「受信開始」を押し、カメラを許可すると解析を始めます。カメラテストは映像とパネル検出だけです。映像取得後240秒または受信成功で停止します。失" +
      "敗後は再送を待ちます。",
      "Selecting this role does not start video or signals. Press Start reception and allow the c" +
      "amera. Camera test checks video and panel detection only. Reception stops on success or 24" +
      "0 seconds after frames arrive. Failed attempts wait for retransmission."
    ],
    "receiveStart": [
      "受信開始",
      "Start reception"
    ],
    "cameraSelect": [
      "使うカメラ",
      "Camera to use"
    ],
    "cameraRefresh": [
      "一覧を更新",
      "Refresh list"
    ],
    "cameraTest": [
      "カメラをテスト",
      "Test camera"
    ],
    "cameraTestStop": [
      "テストを停止",
      "Stop test"
    ],
    "cameraDefault": [
      "自動選択",
      "Automatic selection"
    ],
    "cameraUnnamed": [
      "カメラ {number}（名前は許可後に表示）",
      "Camera {number} (name available after permission)"
    ],
    "cameraMissing": [
      "選択したカメラ（現在の一覧にありません）",
      "Selected camera (not in the current list)"
    ],
    "cameraListHint": [
      "「カメラをテスト」で許可すると、カメラ名と映像を確認できます。",
      "Use Test camera and allow access to check camera names and video."
    ],
    "cameraListLoading": [
      "カメラ一覧を取得しています。",
      "Loading camera list."
    ],
    "cameraListCount": [
      "ブラウザーが公開しているカメラ：{count}台。許可前は一覧や名前が省略される場合があります。",
      "Cameras exposed by the browser: {count}. Some cameras or names may be hidden until permiss" +
      "ion is granted."
    ],
    "cameraListEmpty": [
      "カメラ一覧は空です。接続とブラウザーの権限を確認し、カメラテストを試してください。",
      "The camera list is empty. Check connections and browser permissions, then try Test camera."
    ],
    "deviceListUnavailable": [
      "一覧を取得できません。自動選択でカメラテストを試せます。",
      "The camera list is unavailable. You can still test automatic selection."
    ],
    "cameraNote": [
      "テストでは映像・解像度・fps・パネル検出を確認し、本文は復号しません。映像取得後240秒で停止します。映像表示をオンにして使います。カメラの切り替え時は同期を最初からやり直します" +
      "。",
      "Test checks video, resolution, fps and panel detection without decoding text. It stops 240" +
      " seconds after frames arrive. Enable the video preview. Switching cameras restarts synchro" +
      "nization."
    ],
    "cameraUnchecked": [
      "カメラはまだテストしていません。",
      "Camera not tested yet."
    ],
    "cameraOpening": [
      "カメラを開いています。許可の確認が表示されたら操作してください。",
      "Opening camera. Respond to the permission prompt if one appears."
    ],
    "cameraTesting": [
      "カメラ認識OK・映像を取得中（テスト）",
      "Camera detected; video frames received (test)"
    ],
    "cameraChecked": [
      "映像の取得を確認しました。カメラは停止中です。",
      "Video frames confirmed. The camera is stopped."
    ],
    "cameraReceiving": [
      "選んだカメラから受信中",
      "Receiving from the selected camera"
    ],
    "cameraTestFailed": [
      "カメラテストを完了できませんでした。上のエラー表示を確認してください。",
      "Camera test could not finish. Check the error message above."
    ],
    "cameraDetails": [
      "{name} · {width} × {height} · {fps} fps",
      "{name} · {width} × {height} · {fps} fps"
    ],
    "cameraNotFound": [
      "利用できるカメラが見つかりません。接続し、一覧を更新してください。",
      "No available camera was found. Connect a camera and refresh the list."
    ],
    "cameraInUse": [
      "カメラを開けません。他のアプリでの使用や、OSのカメラ設定を確認してください。",
      "Cannot open the camera. Check other apps using it and the operating system camera settings" +
      "."
    ],
    "cameraSelectionUnavailable": [
      "選んだカメラを利用できません。一覧を更新し、別のカメラを選んでください。",
      "The selected camera is unavailable. Refresh the list and select another camera."
    ],
    "offlineNote": [
      "動画を端末内で再生して解析します。カメラの許可は不要です。",
      "Play and analyze a video locally. No camera permission is needed."
    ],
    "textInput": [
      "送る文字列（UTF-8で最大8バイト）",
      "Text to send (up to 8 UTF-8 bytes)"
    ],
    "byteCount": [
      "{count} / 8バイト",
      "{count} / 8 bytes"
    ],
    "seconds": [
      "送信時間 {seconds}秒 ＋ 開始前3秒",
      "Transmission time: {seconds} s + 3 s countdown"
    ],
    "remaining": [
      "送信終了まで約{seconds}秒",
      "About {seconds} s remaining"
    ],
    "receiveProgress": [
      "受信ビット {count} / {total} · 同期の再探索 {retries}回",
      "Received bits: {count} / {total} · Search restarts: {retries}"
    ],
    "retryProgress": [
      "同期を再探索中（{retries}回）：{reason}",
      "Searching again ({retries}): {reason}"
    ],
    "resynchronizing": [
      "同期信号を待ち直しています",
      "Waiting for a new preamble"
    ],
    "packetRejected": [
      "訂正後もCRCまたはUTF-8の検査を通過しませんでした。",
      "CRC or UTF-8 validation failed after correction."
    ],
    "corrections": [
      "訂正：データ部 {bytes}バイト／ヘッダー {bits}ビット",
      "Corrections: {bytes} data bytes; {bits} header bits"
    ],
    "videoInput": [
      "読み込む動画",
      "Local video file"
    ],
    "fileNote": [
      "最大128MiB・120秒。v3のパネル全体が映るMP4やWebMを選びます。ブラウザーが再生できる形式が対象です。停止時にファイルへの参照を解放します。",
      "Up to 128 MiB and 120 seconds. Choose a browser-playable MP4 or WebM showing the whole v3 " +
      "panel. File references are released on stop."
    ],
    "expected": [
      "送った文字列がわかる場合だけ入力（任意）",
      "Known transmitted text (optional)"
    ],
    "start": [
      "開始",
      "Start"
    ],
    "stop": [
      "停止",
      "Stop"
    ],
    "clear": [
      "表示を消去",
      "Clear display"
    ],
    "transmitter": [
      "光を送る",
      "Transmit light"
    ],
    "txLabel": [
      "送信する明滅の表示面",
      "Optical signal display"
    ],
    "txNote": [
      "左の2領域でデータ、右の2領域でクロックを表します。各組は互いに明暗が逆です。区切りごとに1ビットだけ送り、同じビットが続いてもクロックが変化します。四隅の固定マーカーを含む全体を受信側に映してください。",
      "The left pair carries data; the right pair carries the clock. Each pair uses complementary" +
      " brightness. Only one bit is sent per interval; the clock changes even when data repeats. " +
      "Show the receiver the whole panel, including all four fixed corner markers."
    ],
    "receiver": [
      "カメラから文字へ",
      "From camera to text"
    ],
    "previewLabel": [
      "カメラ映像、探索範囲と検出した送信パネル",
      "Camera view, search region and detected transmission panel"
    ],
    "previewEnabled": [
      "映像を表示する（点滅を含みます）",
      "Show video preview (contains flicker)"
    ],
    "regionTitle": [
      "パネルの探索範囲",
      "Panel search region"
    ],
    "regionCoverage": [
      "四隅の固定マーカーを含む送信パネル全体を、破線の探索範囲に入れてください。",
      "Include the whole transmission panel and all four fixed corner markers inside the dashed search region."
    ],
    "regionNote": [
      "通常は映像全体から自動検出します。破線は探索範囲、色の実線は検出した四隅です。送信側の固定マーカー4個を隠さず映してください。配置を一意に判定できた場合だけ、回転や反転を補正します。" +
      "探索枠の四隅でサイズ変更、枠内で移動、枠外で新しい枠を指定できます。指を離すと同期をやり直します。",
      "The whole image is searched by default. Dashed lines mark the search region; the colored outline follows detected corners. " +
      "Keep all four transmitter markers visible. Rotation or reflection is corrected only when the pose is uniquely identified. " +
      "Drag search-box corners to resize, inside to move, or outside to draw a new box. Release to restart synchronization."
    ],
    "roiX": [
      "左端（%）",
      "Left (%)"
    ],
    "roiY": [
      "上端（%）",
      "Top (%)"
    ],
    "roiW": [
      "幅（%）",
      "Width (%)"
    ],
    "roiH": [
      "高さ（%）",
      "Height (%)"
    ],
    "regionReset": [
      "映像全体に戻す",
      "Search the whole image"
    ],
    "graphTitle": [
      "測定値の時系列",
      "Signal over time"
    ],
    "graphActive": [
      "測定中 · 自動停止まで{seconds}秒 · 採取{frames}フレーム",
      "Measuring · stops in {seconds} s · {frames} sampled frames"
    ],
    "graphStopped": [
      "測定停止：{reason}。グラフは停止時の値です。送信側だけの再送では測定を再開しません。",
      "Measurement stopped: {reason}. The graph shows the saved samples. Sending again does not r" +
      "estart reception."
    ],
    "graphReady": [
      "受信開始後に更新します。受信成功で停止します。上限はカメラ240秒、動画120秒です。",
      "Updates after reception starts and stops on success. Limits: camera 240 seconds; video 120" +
      " seconds."
    ],
    "graphTestOnly": [
      "カメラテスト中はグラフを更新しません。「受信開始」で測定します。",
      "Camera test does not update the graph. Start reception to measure the signal."
    ],
    "receiveAgain": [
      "受信を再開（最大240秒）",
      "Restart reception (up to 240 s)"
    ],
    "diagnosticTitle": [
      "受信失敗の診断",
      "Diagnose reception failure"
    ],
    "diagnosticSave": [
      "受信診断を保存",
      "Save reception diagnostic"
    ],
    "diagnosticNote": [
      "測定時刻・データ差・クロック差・検出品質・判定経過をJSONで端末内に保存します。画像・音声・カメラ名は含みません。測定値から送信内容を復元できる場合があるため、共有時は「A」など" +
      "のテスト文字を使ってください。次の開始・表示消去・再読み込みで消去します。自動送信はしません。",
      "Save sample times, data and clock differences, detection quality and decoder events locall" +
      "y as JSON. No images, audio or camera names are included. Samples may reveal transmitted t" +
      "ext; use test text such as A before sharing. Starting again, clearing or reloading discard" +
      "s the diagnostic. No automatic upload."
    ],
    "graphLabel": [
      "データ差・クロック差・パネル検出品質の時系列",
      "Data difference, clock difference and panel detection quality over time"
    ],
    "graphNote": [
      "横軸は秒です。差は−1〜1を0〜1へ変換して描き、0.5が差ゼロです。品質は0〜1のままです。下の数値は変換前の差です。縦線はビットの判定位置、?は判定できない値です。",
      "Horizontal axis: seconds. Differences from −1 to 1 are mapped to 0 to 1; 0.5 means zero di" +
      "fference. Quality uses 0 to 1 directly. Values below show the original differences. Marks " +
      "indicate bit decisions; ? means undecidable."
    ],
    "monoLegend": [
      "実線：データ差 ／ 破線：クロック差 ／ 点線：検出品質",
      "Solid: data difference / dashed: clock difference / dotted: detection quality"
    ],
    "signalTitle": [
      "パネルの読み取り",
      "Panel reception"
    ],
    "signalHealth": [
      "検出品質 {quality}% · データ差 {data} · クロック差 {clock}",
      "Detection quality {quality}% · Data difference {data} · Clock difference {clock}"
    ],
    "receivePreviewNote": [
      "「受けるだけ」→「受信開始」→カメラを許可、の順で映像と信号を表示します。「カメラをテスト」は映像の確認だけです。",
      "Receive only → Start reception → allow camera: video and signal display begin. Test camera" +
      " previews video without decoding."
    ],
    "testPreviewNote": [
      "カメラテスト中です。信号の解析とライブ復号には「受信開始」を押してください。",
      "Camera test is active. Choose Start reception to analyze the signal and decode live text."
    ],
    "activePreviewNote": [
      "映像を取得して解析中です。映像が表示されても、同期信号を受け取るまでは復号を開始しません。",
      "Frames are being analyzed. Decoding starts only after the preamble is recognized, even whe" +
      "n video is visible."
    ],
    "offlinePreviewNote": [
      "動画を選び「開始」を押すと、映像を再生して信号を解析します。",
      "Choose a video and press Start to play it and analyze the signal."
    ],
    "liveTitle": [
      "受信文字（ブロック検査後）",
      "Received text (after block checks)"
    ],
    "results": [
      "受信結果",
      "Received result"
    ],
    "frameCheck": [
      "ブロック構成 / UTF-8",
      "Block structure / UTF-8"
    ],
    "confidence": [
      "最小確信度",
      "Minimum confidence"
    ],
    "agreement": [
      "文字の一致率 / 誤り率",
      "Character agreement / error rate"
    ],
    "resultNote": [
      "CRCは伝送中の誤りを調べます。暗号化や送信者の証明ではありません。確信度は分類の目安で、正解の確率ではありません。",
      "CRC checks transmission errors. It provides neither encryption nor sender authentication. " +
      "Confidence describes classification margin, not probability of correctness."
    ],
    "diagnostics": [
      "ビットごとの判定",
      "Per-bit decisions"
    ],
    "tradeoff": [
      "4領域の役割",
      "Roles of the four areas"
    ],
    "density": [
      "本文の情報量",
      "Payload information"
    ],
    "conditions": [
      "特徴と条件",
      "Characteristics and conditions"
    ],
    "lessons": [
      "座学",
      "How it works"
    ],
    "helpTitle": [
      "使い方と読み方",
      "Using the tool"
    ],
    "helpBody": [
      "両端を再読み込みします。受信側でカメラを選び、テストでパネル全体の検出を確認してから受信を開始します。送信側はまず「A」を1回送ります。データ1ビットと区切り用クロックを時間順に読" +
      "む方式で、連番QRや色付き二次元コードではありません。",
      "Reload both endpoints. Select and test the receiver camera, check detection of the whole p" +
      "anel, then start reception. Send A once to begin. Data bits and a separate clock are read " +
      "in time order; this is not a sequence of QR or colored two-dimensional codes."
    ],
    "helpFailure": [
      "検出できないときはパネル全体の位置・傾き・反射・ピントを確認します。同期だけして本文を読めないときは、2 symbol/sで固定して再送します。CRC成功だけを受信成功として扱いま" +
      "す。実機での安定性は確認中です。",
      "If detection fails, check the whole panel, tilt, reflections and focus. If only synchroniz" +
      "ation succeeds, hold both devices steady and resend at 2 symbol/s. Only a passing CRC coun" +
      "ts as success. Physical-device reliability is still being evaluated."
    ],
    "close": [
      "閉じる",
      "Close"
    ],
    "pseTitle": [
      "点滅を始める前の確認",
      "Before starting flicker"
    ],
    "confirmNote": [
      "高速・高コントラスト、または「動きを減らす」設定での送信です。周囲を確認し、点滅を開始する場合だけ続行してください。",
      "This uses a faster rate, high contrast, or transmission with reduced motion enabled. Check" +
      " your surroundings and continue only if you intend to start flicker."
    ],
    "cancel": [
      "キャンセル",
      "Cancel"
    ],
    "continue": [
      "点滅を開始",
      "Start flicker"
    ],
    "idle": [
      "待機中",
      "Ready"
    ],
    "preparing": [
      "送信準備中（3秒）",
      "Preparing to send (3 seconds)"
    ],
    "sending": [
      "送信中",
      "Sending"
    ],
    "receiving": [
      "同期信号を待っています",
      "Waiting for the preamble"
    ],
    "decoding": [
      "復号中",
      "Decoding"
    ],
    "sent": [
      "送信終了",
      "Transmission finished"
    ],
    "complete": [
      "受信終了",
      "Reception finished"
    ],
    "stopped": [
      "停止しました",
      "Stopped"
    ],
    "hidden": [
      "タブが非表示になったため停止しました",
      "Stopped because the tab became hidden"
    ],
    "timeout": [
      "受信の制限時間で停止しました",
      "Reception stopped at its time limit"
    ],
    "failed": [
      "開始できませんでした",
      "Could not start"
    ],
    "ok": [
      "成功",
      "Pass"
    ],
    "fail": [
      "不一致",
      "Fail"
    ],
    "unsupported": [
      "非対応 / 情報なし",
      "Unsupported / unavailable"
    ],
    "requested": [
      "要求済み・固定を確認できず",
      "Requested; lock not confirmed"
    ],
    "manual": [
      "手動モードを確認",
      "Manual mode reported"
    ],
    "controlFailed": [
      "固定できず・解析を継続",
      "Lock failed; analysis continues"
    ],
    "notApplicable": [
      "動画では対象外",
      "Not applicable to a file"
    ],
    "invalidSettings": [
      "設定が不正です。",
      "Invalid settings."
    ],
    "invalidText": [
      "文字列を入力してください。",
      "Enter a text string."
    ],
    "invalidUnicode": [
      "不正なUnicode文字が含まれています。",
      "The input contains invalid Unicode."
    ],
    "tooLong": [
      "UTF-8で8バイト以下にしてください。",
      "Use at most 8 UTF-8 bytes."
    ],
    "cameraUnavailable": [
      "カメラを利用できません。HTTPSかlocalhostで開き、カメラの設定を確認してください。",
      "Camera unavailable. Open over HTTPS or localhost and check camera settings."
    ],
    "permission": [
      "カメラの利用が許可されませんでした。ブラウザーの権限を確認してください。",
      "Camera permission was denied. Check browser permissions."
    ],
    "cameraEnded": [
      "カメラが切断されました。",
      "The camera disconnected."
    ],
    "cameraMuted": [
      "カメラ入力が中断されました。",
      "Camera input was interrupted."
    ],
    "fileSize": [
      "0バイトより大きく128MiB以下の動画を選んでください。",
      "Choose a video larger than zero bytes and at most 128 MiB."
    ],
    "selectFile": [
      "動画を選んでください。",
      "Choose a video file."
    ],
    "videoDuration": [
      "120秒以下の動画を選んでください。",
      "Choose a video no longer than 120 seconds."
    ],
    "videoError": [
      "動画を再生できません。別の形式の動画を選んでください。",
      "Cannot play this video. Try another supported format."
    ],
    "sampleError": [
      "映像の読み取りを続けられませんでした。",
      "Video sampling could not continue."
    ],
    "frameStalled": [
      "5秒間、新しいフレームを取得できなかったため停止しました。",
      "Stopped after five seconds without a new frame."
    ],
    "displayStalled": [
      "画面の更新間隔が乱れたため送信を停止しました。負荷を下げて再送してください。",
      "Transmission stopped because display timing became irregular. Reduce device load and try a" +
      "gain."
    ],
    "fpsTooLow": [
      "受信fpsが不足しています。送信速度を下げてください。",
      "Insufficient receiver fps. Lower the transmit rate."
    ],
    "invalidLength": [
      "長さの情報を読めませんでした。送信を最初からやり直してください。",
      "Could not read the length. Restart the transmission."
    ],
    "incompleteFrame": [
      "フレームが途中で終わりました。",
      "The packet ended before all symbols arrived."
    ],
    "noPreamble": [
      "同期信号が見つかりませんでした。パネル検出を確認し、受信開始後に送信してください。",
      "No preamble found. Check panel detection and start reception before transmission."
    ],
    "preamble": [
      "同期信号",
      "Preamble"
    ],
    "data": [
      "データ",
      "Data"
    ],
    "emptyPreview": [
      "開始すると映像を表示します",
      "Press Start to display video"
    ],
    "previewHidden": [
      "映像表示はオフ・フレーム取得は継続",
      "Preview off; frame capture continues"
    ],
    "symbolRow": [
      "ビット番号 / 秒 / 値 / 確信度",
      "Bit index / seconds / value / confidence"
    ],
    "panelWeak": [
      "枠を検出しましたが、データかクロックの差が不足しています。送信前ならこのまま受信を開始できます。送信中なら、ピント・反射・明るさを調整してください。",
      "Border detected, but the data or clock difference is too small. Before transmission, you " +
      "can start reception now. During transmission, adjust focus, reflections and brightness."
    ],
    "tooManyErasures": [
      "訂正できる数を超えたため、このブロックを破棄して次の同期信号を待ちます。",
      "Too many unreadable bytes to correct. Discarding this block and waiting for a new preamble" +
      "."
    ],
    "blockConflict": [
      "同じ識別値のブロックが一致しません。今回の組み立てを破棄して再送を待ちます。",
      "Blocks with the same identity disagree. Discarding this assembly and waiting for retransmi" +
      "ssion."
    ],
    "schemeNote": [
      "方式：独立クロック付きのシリアル光通信。明暗の比較で1ビットずつ送り、複数QRや色付き二次元コードの切り替えは使いません。",
      "Scheme: serial optical communication with a separate clock. Brightness comparisons carry o" +
      "ne bit at a time; no sequence of QR or colored two-dimensional codes is used."
    ],
    "blockProgress": [
      "検査済みブロック {blocks} / {total}",
      "Validated blocks: {blocks} / {total}"
    ],
    "sampleValue": [
      "データ差 {data} · クロック差 {clock} · 品質 {quality}",
      "Data difference {data} · Clock difference {clock} · Quality {quality}"
    ],
    "panelFound": [
      "パネルを検出しています。同期信号とCRCの成功を確認してください。検出品質は正解の確率ではありません。",
      "Panel detected. Check for synchronization and a passing CRC. Detection quality is not the " +
      "probability of correct decoding."
    ],
    "panelMissing": [
      "パネルを検出できません。四隅の固定マーカーを含む全体を大きく映し、反射・ピント・白飛びを確認してください。パネルは1つだけにします。配置を判定できないフレームは復号に使いません。",
      "Panel not detected. Show one whole panel and all four fixed corner markers large in the view. Check reflections, focus and clipping. " +
      "Frames whose pose cannot be identified are not decoded."
    ],
    "dataPanels": [
      "データと反転データ",
      "Data and complement"
    ],
    "clockPanels": [
      "クロックと反転クロック",
      "Clock and complement"
    ],
    "referenceBorder": [
      "固定マーカーと明暗の基準",
      "Fixed markers and brightness references"
    ],
    "dataTradeoff": [
      "同時に映る2領域の明暗差で0/1を読む",
      "Read 0/1 from the simultaneous brightness difference"
    ],
    "clockTradeoff": [
      "ビットの区切り。本文のビットは載せない",
      "Mark bit boundaries; carry no payload bits"
    ],
    "referenceTradeoff": [
      "位置と明暗の基準。本文を格子状に配置しない",
      "Locate and normalize the panel; no payload grid"
    ],
    "openingTimeout": [
      "30秒以内に映像を取得できませんでした。カメラの許可と接続を確認してください。",
      "No video frame arrived within 30 seconds. Check camera permission and connection."
    ],
    "auto": [
      "自動モード",
      "Automatic mode"
    ],
    "clockLost": [
      "クロックを読み続けられませんでした。パネル全体を固定して再送してください。",
      "The clock could not be followed. Hold the whole panel steady and resend."
    ],
    "blockRejected": [
      "ブロックの検査に失敗しました。次の同期信号を待ちます。",
      "Block validation failed. Waiting for a new preamble."
    ],
    "header": [
      "保護されたヘッダー",
      "Protected header"
    ],
    "panelAmbiguous": [
      "パネルの候補が複数あるか、目印の候補が多すぎます。送信パネルを1つだけ映すか、探索範囲を絞ってください。",
      "More than one panel candidate, or too many marker candidates, were found. Show one transmitter or narrow the search region."
    ],
    "stageReady": [
      "映像の取得はまだ始まっていません。「受信開始」または「カメラをテスト」を押してください。",
      "Video has not started. Choose Start reception or Test camera."
    ],
    "stageOpening": [
      "映像の最初のフレームを待っています。",
      "Waiting for the first video frame."
    ],
    "stageMarkers": [
      "四隅の候補：{count} / 4。{stage}",
      "Corner candidates: {count} / 4. {stage}"
    ],
    "stageStopped": [
      "受信停止：{reason}。映像と信号は更新していません。",
      "Reception stopped: {reason}. Video and signal measurements are not updating."
    ],
    "stageCameraTest": [
      "カメラテスト中・文字は復号しません。{stage}",
      "Camera test: text is not decoded. {stage}"
    ],
    "stageTestPanel": [
      "パネルを検出しました。「受信開始」で信号の受信へ進みます。",
      "Panel detected. Choose Start reception to receive its signal."
    ],
    "stageClock": [
      "パネルを検出しました。クロックの明暗差を待っています。送信前の静止表示では正常です。受信を続けたまま送信を開始してください。",
      "Panel detected; waiting for clock contrast. This is normal before transmission. Keep reception active and start the sender."
    ],
    "stagePreamble": [
      "パネルとクロックの明暗差を検出しました。同期列を待っています。まだ本文は確定していません。",
      "Panel and clock contrast detected. Waiting for the preamble; payload text has not been validated yet."
    ],
    "stageHeader": [
      "同期列を取得しました。ヘッダーを受信しています。文字はブロックの検査後に表示します。",
      "Preamble acquired. Receiving the header; text appears after block validation."
    ],
    "stageBits": [
      "このブロックを受信中：{count} / {total}ビット。検査済みブロック：{blocks} / {blockTotal}。",
      "Receiving this block: {count} / {total} bits. Validated blocks: {blocks} / {blockTotal}."
    ],
    "stageDataErasure": [
      "現在のデータ差は不足しています。クロックを維持できる間は、読めないビットを欠落として扱います。",
      "Data contrast is currently insufficient. With a readable clock, undecidable bits are retained as erasures."
    ],
    "stageNextBlock": [
      "ブロック {blocks} / {total}の検査が済みました。次のブロックの同期列を待っています。",
      "Validated {blocks} / {total} blocks. Waiting for the next block's preamble."
    ],
    "liveTestNote": [
      "カメラテストでは文字を復号しません。「受信開始」を押してください。文字が残っている場合は前回の結果です。",
      "Camera test does not decode text. Choose Start reception. Any text still displayed belongs to the previous reception."
    ],
    "liveBlockNote": [
      "CRC検査済みのブロックを表示しています。全文の受信成功は、結果欄のCRCで確認してください。",
      "These blocks passed CRC. Check the result CRC to confirm reception of the whole message."
    ],
    "liveFirstWait": [
      "文字はブロック検査の後に出ます。\n2 symbol/sの例：A → 約40秒、LIGHT → 約52秒\n送信前の準備3秒は別です。上のバーで進行を確認できます。",
      "Text appears after block checks.\nExamples at 2 symbol/s: A → about 40 s; LIGHT → about 52 s\nAdd 3 s for sender preparation. Follow the bar above."
    ],
    "liveTestEmpty": [
      "カメラテストでは文字は表示されません。\n「受信開始」を押すと、信号を測定してブロックを検査します。",
      "Camera test does not display received text.\nChoose Start reception to measure the signal and validate blocks."
    ],
    "meterReady": [
      "受信はまだ始まっていません",
      "Reception has not started"
    ],
    "meterWaiting": [
      "準備中：同期列を待っています",
      "Preparing: waiting for the preamble"
    ],
    "meterTest": [
      "カメラテスト：ビットは受信していません",
      "Camera test: bits are not being received"
    ],
    "meterStopped": [
      "受信を停止しました。現在は同期していません",
      "Reception stopped without a current synchronization"
    ],
    "meterHeader": [
      "ヘッダーの受信位置：{count} / {total}ビット",
      "Header position: {count} / {total} bits"
    ],
    "meterBlock": [
      "このブロックの受信位置：{count} / {total}ビット（ヘッダーを含む）",
      "Block position: {count} / {total} bits, including the header"
    ],
    "meterLast": [
      "停止時の位置 — {label}",
      "Position at stop — {label}"
    ],
    "meterEstimate": [
      "このブロックの検査まで約{seconds}秒。同じ周期で受信が続く場合の目安です。",
      "About {seconds} s until this block is checked, if reception continues at the observed rate."
    ],
    "meterNote": [
      "最初はヘッダー16ビット、長さが判明するとブロック全体を示すバーに変わります。判別不能のビットも受信位置に含みます。バーは時間だけでは進まず、検査を通るまで文字は出ません。",
      "The bar first covers the 16-bit header, then the whole block once its length is known. Undecidable bits still count as received positions. " +
      "Time alone does not advance the bar; text appears only after validation."
    ],
    "signalPanelLabel": [
      "送信パネル",
      "Transmitter panel"
    ],
    "signalDataLabel": [
      "データの明暗差",
      "Data contrast"
    ],
    "signalClockLabel": [
      "クロックの明暗差",
      "Clock contrast"
    ],
    "signalState_unmeasured": [
      "未測定",
      "Not measured"
    ],
    "signalState_missing": [
      "未検出",
      "Not detected"
    ],
    "signalState_found": [
      "検出",
      "Detected"
    ],
    "signalState_sufficient": [
      "差を検出",
      "Contrast detected"
    ],
    "signalState_insufficient": [
      "差が不足",
      "Insufficient contrast"
    ],
    "receiveDisplayHelp": [
      "進捗・明暗差の見方",
      "Reading progress and contrast"
    ],
    "signalReadinessNote": [
      "この判定は現在のフレームの明暗差です。時間順の信号を読めたことやCRC成功とは異なります。送信前の静止パネルでは差がないため、不足の表示は正常です。",
      "These indicators describe contrast in the current frame, not successful temporal decoding or a passing CRC. " +
      "The idle panel has no contrast between each pair, so Insufficient is normal before transmission."
    ],
    "guard": [
      "末尾のクロック",
      "Final clock transitions"
    ]
  };
  const ja = {}, en = {};
  Object.entries(pairs).forEach(([key, value]) => { ja[key] = value[0]; en[key] = value[1]; });
  const lessons = [
    {
      "title": [
        "画面からカメラへ",
        "From screen to camera"
      ],
      "text": [
        "v3は同じ画像内の明暗差で1ビットを読み、別の領域のクロックで区切ります。本文は最大4バイトずつに分け、ヘッダーのHamming符号、データ部のRS符号、CRC-8で各ブロックを検" +
        "査します。最後に全体のCRC-16とUTF-8を確認します。",
        "V3 reads one bit from a brightness difference within an image and uses a separate optical " +
        "clock for boundaries. Payload is split into blocks of at most four bytes. Hamming-protecte" +
        "d headers, RS-coded data and CRC-8 validate each block; CRC-16 and UTF-8 validate the asse" +
        "mbled message."
      ],
      "headers": [
        "順序 / 内容",
        "Order / Content"
      ],
      "rows": [
        [
          "1",
          "各ブロックの同期信号16ビット",
          "1",
          "16-bit preamble per block"
        ],
        [
          "2",
          "形式・ブロック番号・長さのヘッダーを16ビットに符号化",
          "2",
          "Format, block index and length encoded as a 16-bit header"
        ],
        [
          "3",
          "全体CRC-16＋本文最大4バイト＋ブロックCRC-8＋RS冗長2バイト",
          "3",
          "Message CRC-16, up to four payload bytes, block CRC-8 and two RS parity bytes"
        ],
        [
          "4",
          "検査済みブロックを集めて全体を検査。末尾クロック2回で最後のビットを確定",
          "4",
          "Assemble validated blocks and check the message; two final clock transitions commit the la" +
          "st bit"
        ]
      ],
      "sources": [
        [
          "VLC synchronization",
          "https://patents.google.com/patent/US8374201B2/en"
        ]
      ]
    },
    {
      "title": [
        "発光体が替わっても原理は同じ",
        "Different emitters, the same principle"
      ],
      "text": [
        "制御できる光に情報を載せる原理は共通です。画面は面積が大きく受光しやすい一方、小さなLEDではピントや距離の影響が増えます。波長や駆動速度も方式によって異なります。",
        "Each method encodes data in controllable light. A screen offers a larger target; small LED" +
        "s make focus and distance more critical. Wavelength and switching speed also vary by devic" +
        "e."
      ],
      "headers": [
        "先行例 / 発光体",
        "Study / Emitter"
      ],
      "rows": [
        [
          "LED-it-GO",
          "HDDアクセスLED",
          "LED-it-GO",
          "HDD activity LED"
        ],
        [
          "xLED",
          "ルーターやスイッチのLED",
          "xLED",
          "Router and switch status LEDs"
        ],
        [
          "CTRL-ALT-LED",
          "Caps / Num / Scroll LockのLED",
          "CTRL-ALT-LED",
          "Caps / Num / Scroll Lock LEDs"
        ],
        [
          "aIR-Jumper",
          "監視カメラの赤外線LED",
          "aIR-Jumper",
          "Security camera infrared LEDs"
        ]
      ],
      "sources": [
        [
          "LED-it-GO",
          "https://arxiv.org/abs/1702.06715"
        ],
        [
          "xLED",
          "https://arxiv.org/abs/1706.01140"
        ],
        [
          "CTRL-ALT-LED",
          "https://arxiv.org/abs/1907.05851"
        ],
        [
          "aIR-Jumper",
          "https://arxiv.org/abs/1709.05742"
        ]
      ]
    },
    {
      "title": [
        "光の通信路の特徴",
        "What distinguishes an optical channel"
      ],
      "text": [
        "光は見通し（LOS）が必要です。受信機、窓の材質、角度、照明によって届き方は変わります。研究の距離は実験室条件（直視・特定機材・最良条件）で、本ツールの到達距離ではありません。",
        "Light needs a line of sight (LOS). Receivers, glazing, angle and lighting affect reception" +
        ". Research distances describe laboratory conditions and specific equipment, not this tool’" +
        "s range."
      ],
      "headers": [
        "特徴 / 条件",
        "Feature / Condition"
      ],
      "rows": [
        [
          "監視カメラでも受信",
          "aIR-Jumperではカメラが赤外線を受光",
          "Security cameras can receive",
          "aIR-Jumper uses cameras as infrared receivers"
        ],
        [
          "ガラス越し",
          "可視光を通す窓なら経路が残る。音響や近接熱通信とは条件が異なる",
          "Through glass",
          "Visible-light-transmitting windows can preserve the path; acoustic and near-field thermal " +
          "links behave differently"
        ],
        [
          "見通しと望遠",
          "LED-it-GOは光センサーで夜間屋外20m、カメラでは8m",
          "LOS and optics",
          "LED-it-GO: optical sensor at 20 m outdoors at night; camera at 8 m"
        ],
        [
          "音響ノイズに強い",
          "光のノイズは太陽光、照明の100/120Hzフリッカー、他の発光",
          "Unaffected by acoustic noise",
          "Optical noise includes sunlight, 100/120 Hz lighting flicker and other emitters"
        ]
      ],
      "sources": [
        [
          "LED-it-GO",
          "https://arxiv.org/abs/1702.06715"
        ],
        [
          "aIR-Jumper",
          "https://arxiv.org/abs/1709.05742"
        ]
      ]
    },
    {
      "title": [
        "シリアル光通信と二次元コードの違い",
        "Serial light and two-dimensional codes"
      ],
      "text": [
        "複数QRや色付きの独自コードを次々に表示する方式も、画面とカメラで通信できます。本ツールはその方式を採らず、1本のデータ線と1本のクロック線に相当する明滅を読みます。画像ごとの多ビ" +
        "ット符号を復元して連結する処理はありません。",
        "Sequences of QR or custom colored codes can also communicate through a screen and camera. " +
        "This tool instead reads flicker equivalent to one data line and one clock line. It does no" +
        "t decode and concatenate multi-bit image codes."
      ],
      "headers": [
        "方式 / 情報の配置",
        "Scheme / Placement of information"
      ],
      "rows": [
        [
          "本ツール",
          "1区切りで本文1ビット。4領域はデータ・クロックとそれぞれの反転値",
          "This tool",
          "One payload bit per interval; four areas contain data, clock and their complements"
        ],
        [
          "連番QR・色付き二次元コード（対象外）",
          "各画像のセル配列に複数ビットを配置し、複数画像を使って転送",
          "Sequential QR / colored 2D codes (excluded)",
          "Multiple bits occupy a cell array in each image; several images carry the transfer"
        ]
      ],
      "sources": [
        [
          "QR structure",
          "https://www.qrcode.com/en/codes/model12.html"
        ],
        [
          "Input techniques",
          "https://akademeia.info/?page_id=53563"
        ]
      ]
    },
    {
      "title": [
        "同時に比較する理由と限界",
        "Why compare simultaneously, and its limits"
      ],
      "text": [
        "データと反転データを同時に映すと、共通の明るさの変化を差で減らせます。4領域の平均明度も一定です。ただし、白飛び・強い反射・局所的な影・ピンぼけで失われた差は戻せません。自動露出や" +
        "WBは変更せず、観測できる品質を表示します。",
        "Comparing data and its complement in the same image reduces common brightness changes. The" +
        " four areas also keep constant average brightness. Clipping, strong reflections, local sha" +
        "dows and blur can still destroy the difference. Exposure and white balance are left unchan" +
        "ged; observed quality is displayed."
      ],
      "headers": [
        "要因 / 対処と限界",
        "Factor / Response and limits"
      ],
      "rows": [
        [
          "共通の明度変動",
          "データ・クロックを各反転領域と比較し、固定した明暗の基準で正規化",
          "Common brightness changes",
          "Compare each signal with its complement and normalize using fixed brightness references"
        ],
        [
          "白飛び・ぼけ・強い傾き",
          "品質が不足するフレームは使わず、配置や明るさを修正",
          "Clipping, blur or large tilt",
          "Reject inadequate frames and adjust placement or brightness"
        ],
        [
          "カメラ固有の補正",
          "完全な除去は保証しない。実機での確認が必要",
          "Camera-specific processing",
          "Not guaranteed to cancel; physical-device validation is required"
        ]
      ],
      "sources": [
        [
          "Image Capture controls",
          "https://w3c.github.io/mediacapture-image/"
        ],
        [
          "sRGB transfer function",
          "https://www.w3.org/TR/css-color-4/#color-conversion-code"
        ]
      ]
    },
    {
      "title": [
        "ローリングシャッターの縞",
        "Rolling-shutter stripes"
      ],
      "text": [
        "CMOSは行ごとに露光時刻がずれるため、高速な明滅が横縞になることがあります。本ツールは縞を復号せず、パネルの中央帯に並ぶ4領域を測定します。パネルが回転すると撮像素子の同じ行には" +
        "並ばないため、露光時刻の差が残ります。クロックの各状態で複数フレームを確認します。",
        "CMOS rows may expose at different times, making rapid flicker appear as stripes. This tool does not decode those stripes. " +
        "It samples four areas along the panel's central band. A rotated panel does not align them with the same sensor rows, " +
        "so exposure-time differences remain. Each clock state requires multiple frames."
      ],
      "headers": [
        "取得方法 / 時間の単位",
        "Sampling method / Time unit"
      ],
      "rows": [
        [
          "本ツール",
          "パネルの中央帯の4領域を比較。1状態につき少なくとも2フレームが必要",
          "This tool",
          "Compare four areas in the panel's central band. At least two frames per state are required"
        ],
        [
          "縞の解析（対象外）",
          "各行の露光時刻。機種ごとの較正が必要",
          "Stripe analysis (not implemented)",
          "Exposure time per row; device-specific calibration required"
        ]
      ],
      "sources": [
        [
          "rVFC",
          "https://web.dev/articles/requestvideoframecallback-rvfc"
        ],
        [
          "Rolling-shutter OCC (preprint)",
          "https://arxiv.org/abs/2602.08474"
        ]
      ]
    },
    {
      "title": [
        "通信の成立と検知は別の問題",
        "Communication and detection are different questions"
      ],
      "text": [
        "普段は通信に使わない光を情報の経路にするとcovert channelになります。肉眼で文字を読めなくても、方式を知る受信者は復元できます。本ツールは暗号化しません。信号の存在を調" +
        "べることと、内容を復号することも別です。Day041は音の帯域観察との比較に使えます。",
        "Using ordinary light as an unintended information path creates a covert channel. A person " +
        "may not read the text by eye, yet a compatible receiver can recover it. This tool does not" +
        " encrypt. Observing a signal and decoding content are distinct tasks; Day041 offers an aco" +
        "ustic comparison."
      ],
      "headers": [
        "観測 / わかること",
        "Observation / What it establishes"
      ],
      "rows": [
        [
          "グラフの変化",
          "測定した光の変化。通信の証明とは限らない",
          "Graph changes",
          "Measured light variation; not necessarily evidence of communication"
        ],
        [
          "復号＋CRC成功",
          "この形式のフレームを受理。送信者の証明ではない",
          "Decoding + passing CRC",
          "A packet in this format was accepted; no sender authentication"
        ]
      ],
      "sources": [
        [
          "xLED: side channel / covert channel",
          "https://arxiv.org/abs/1706.01140"
        ],
        [
          "Day041 · Mic Gain Logger",
          "https://ipusiron.github.io/mic-gain-logger/"
        ]
      ]
    },
    {
      "title": [
        "エアギャップ・ブリッジへの橋",
        "Continue with Air-Gap Bridge"
      ],
      "text": [
        "本ツールは『エアギャップ・ブリッジ』の考え方を試す実習環境です。関連する章を案内します。各書籍の紹介ページから詳細をご覧ください。",
        "This tool provides a practical environment for ideas discussed in Air-Gap Bridge. The rela" +
        "ted chapters below are in Japanese-language books; follow the book pages for details."
      ],
      "headers": [
        "書籍 / 関連する章",
        "Book / Related chapter"
      ],
      "rows": [
        [
          "隔離環境のデータ入力技法",
          "第9章「将来展望」",
          "Data Input Techniques for Isolated Environments",
          "Chapter 9: Future Prospects"
        ],
        [
          "隔離環境のデータ出力技法",
          "第2章「エアギャップとは何か」",
          "Data Output Techniques for Isolated Environments",
          "Chapter 2: What Is an Air Gap?"
        ]
      ],
      "sources": [
        [
          "Input",
          "https://akademeia.info/?page_id=53563"
        ],
        [
          "Output",
          "https://akademeia.info/?page_id=53554"
        ]
      ]
    }
  ];
  return Object.freeze({ ja: Object.freeze(ja), en: Object.freeze(en), lessons });
}));
