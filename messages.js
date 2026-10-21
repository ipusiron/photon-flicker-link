/* Photon Flicker Link - MIT (c) 2026 ipusiron. All interface prose lives here. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PhotonMessages = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const pairs = {
    subtitle: ['画面の明滅をカメラで読み、光を文字に戻す。', 'Read screen flicker with a camera. Watch light turn back into text.'],
    theme: ['明暗を切り替える', 'Switch light / dark theme'], language: ['Englishに切り替える', 'Switch to Japanese'],
    help: ['ヘルプを開く', 'Open help'], before: ['始める前に', 'Before you begin'],
    pse: ['点滅は光過敏性発作（PSE）や体調不良を引き起こすことがあります。周りの人にも配慮し、不調を感じたら停止してください。医療機器ではありません。',
      'Flashing light can trigger photosensitive seizures (PSE) or discomfort. Consider people nearby and stop if ' +
          'you feel unwell. This is not a medical device.'],
    setup: ['最初はモノクロ・低コントラストを使います。受信側を先に開始し、送信面の内側に測定枠を収めて固定します。' +
      '受信映像と明暗の測定値を見ながら明るさを調整してください。暗くしすぎると明暗の差も小さくなります。',
      'Start with monochrome and low contrast. Start reception first and keep the measurement rectangle inside the signal area. ' +
      'Adjust brightness while watching the received video and measurements. Dimming too far also reduces the signal difference.'],
    privacy: ['録画しません。映像はフレームごとに処理し、通信内容や動画を保存・送信しません。保存する設定は言語と明暗だけです。',
      'No recording. Each frame is processed locally; messages and video are neither saved nor uploaded. Only language and theme preferences are stored.'],
    ethics: ['作者は悪用を勧めません。', 'The author does not encourage misuse.'],
    mode: ['光の載せ方', 'Modulation'], mono: ['モノクロ', 'Monochrome'], color: ['カラー（RGB並列）', 'Color (parallel RGB)'],
    bicolor: ['2色（青・赤）', 'Two colors (blue / red)'],
    rate: ['送信速度', 'Transmit rate'], contrast: ['送信コントラスト', 'Transmit contrast'],
    low: ['低い（初期値）', 'Low (default)'], high: ['高い（注意）', 'High (caution)'],
    settingsNote: ['送受信の両方を再読み込みし、同じモードにします。v2は反転した値と組にして送り、組ごとに同期を更新します。送信は1回です。',
      'Reload both devices and select the same mode. Version 2 sends complementary pairs and updates timing per pair. Transmission ends after one packet.'],
    environment: ['この環境', 'This environment'], fps: ['実効フレームレート', 'Effective frame rate'],
    callback: ['フレーム取得方式', 'Frame callback'], exposure: ['露出固定', 'Exposure lock'],
    whiteBalance: ['ホワイトバランス固定', 'White balance lock'], resolution: ['入力解像度', 'Input resolution'],
    clock: ['受信した周期', 'Measured symbol clock'],
    environmentNote: ['値は受信を始めると表示します。固定できないカメラでも解析します。rAFのfpsは推定値です。動画はカメラ設定の対象外です。',
      'Values appear after reception starts. Analysis also works without manual camera controls. rAF fps is an ' +
          'estimate. Camera controls do not apply to files.'],
    role: ['役割', 'Role'], send: ['送るだけ', 'Send only'], receive: ['受けるだけ', 'Receive only'], offline: ['オフライン復号', 'Decode a local video'],
    sendNote: ['別の端末の受信を開始してから押します。③→②→①→開始の3秒後に送信し、停止すると発光面は静止します。',
      'Start reception on the other device first. A three-second ③ → ② → ① → Start countdown precedes transmission. Stop returns the area to gray.'],
    receiveNote: ['「受けるだけ」を選ぶだけでは映像も信号も表示しません。「受信開始」を押し、カメラを許可すると表示・解析を始めます。' +
      '下のカメラテストは映像だけの確認です。受信成功または最大120秒で停止します。失敗後は同期信号を待ちます。',
      'Selecting Receive only does not start video or signal display. Choose Start reception and allow the camera to display and analyze frames. ' +
      'Test camera previews video only. Reception stops on success or at 120 seconds; failed packets return to preamble search.'],
    receiveStart: ['受信開始', 'Start reception'], cameraSelect: ['使うカメラ', 'Camera to use'],
    cameraRefresh: ['一覧を更新', 'Refresh list'], cameraTest: ['カメラをテスト', 'Test camera'],
    cameraTestStop: ['テストを停止', 'Stop test'], cameraDefault: ['自動選択', 'Automatic selection'],
    cameraUnnamed: ['カメラ {number}（名前は許可後に表示）', 'Camera {number} (name available after permission)'],
    cameraMissing: ['選択したカメラ（現在の一覧にありません）', 'Selected camera (not in the current list)'],
    cameraListHint: ['「カメラをテスト」で許可すると、カメラ名と映像を確認できます。',
      'Use Test camera and allow access to check camera names and video.'],
    cameraListLoading: ['カメラ一覧を取得しています。', 'Loading camera list.'],
    cameraListCount: ['ブラウザーが公開しているカメラ：{count}台。許可前は一覧や名前が省略される場合があります。',
      'Cameras exposed by the browser: {count}. Some cameras or names may be hidden until permission is granted.'],
    cameraListEmpty: ['カメラ一覧は空です。接続とブラウザーの権限を確認し、カメラテストを試してください。',
      'The camera list is empty. Check connections and browser permissions, then try Test camera.'],
    deviceListUnavailable: ['一覧を取得できません。自動選択でカメラテストを試せます。',
      'The camera list is unavailable. You can still test automatic selection.'],
    cameraNote: ['テストは映像・解像度・fpsを確認する操作です。復号はせず、最大120秒で停止します。' +
      '映像を見るには下の表示設定をオンにします。受信開始で選んだカメラを使います。使用中の切り替えは前のカメラを停止し、受信では同期もやり直します。',
      'Test checks video, resolution and fps without decoding, for up to 120 seconds. Enable the preview below to see video. ' +
      'Start reception uses the selected camera. Switching stops the previous camera and restarts synchronization during reception.'],
    cameraUnchecked: ['カメラはまだテストしていません。', 'Camera not tested yet.'],
    cameraOpening: ['カメラを開いています。許可の確認が表示されたら操作してください。',
      'Opening camera. Respond to the permission prompt if one appears.'],
    cameraTesting: ['カメラ認識OK・映像を取得中（テスト）', 'Camera detected; video frames received (test)'],
    cameraChecked: ['映像の取得を確認しました。カメラは停止中です。', 'Video frames confirmed. The camera is stopped.'],
    cameraReceiving: ['選んだカメラから受信中', 'Receiving from the selected camera'],
    cameraTestFailed: ['カメラテストを完了できませんでした。上のエラー表示を確認してください。',
      'Camera test could not finish. Check the error message above.'],
    cameraDetails: ['{name} · {width} × {height} · {fps} fps', '{name} · {width} × {height} · {fps} fps'],
    cameraNotFound: ['利用できるカメラが見つかりません。接続し、一覧を更新してください。',
      'No available camera was found. Connect a camera and refresh the list.'],
    cameraInUse: ['カメラを開けません。他のアプリでの使用や、OSのカメラ設定を確認してください。',
      'Cannot open the camera. Check other apps using it and the operating system camera settings.'],
    cameraSelectionUnavailable: ['選んだカメラを利用できません。一覧を更新し、別のカメラを選んでください。',
      'The selected camera is unavailable. Refresh the list and select another camera.'],
    offlineNote: ['動画を端末内で再生して解析します。カメラの許可は不要です。',
      'Play and analyze a video locally. No camera permission is needed.'],
    textInput: ['送る文字列（UTF-8で最大8バイト）', 'Text to send (up to 8 UTF-8 bytes)'],
    byteCount: ['{count} / 8バイト', '{count} / 8 bytes'],
    seconds: ['送信時間 {seconds}秒 ＋ 開始前3秒', 'Transmission time: {seconds} s + 3 s countdown'],
    remaining: ['送信終了まで約{seconds}秒', 'About {seconds} s remaining'],
    receiveProgress: ['データ {count} / {total}組 · 同期の再探索 {retries}回', 'Data: {count} / {total} pairs · Search restarts: {retries}'],
    retryProgress: ['同期を再探索中（{retries}回）：{reason}', 'Searching again ({retries}): {reason}'],
    resynchronizing: ['同期信号を待ち直しています', 'Waiting for a new preamble'],
    packetRejected: ['訂正後もCRC・終了・UTF-8の確認を通過しませんでした。', 'The corrected packet failed CRC, end-marker or UTF-8 validation.'],
    corrections: ['訂正：本文・CRC・冗長部 {bytes}バイト／長さ情報 {bits}ビット',
      'Corrections: {bytes} payload/CRC/parity bytes; {bits} length-header bits'],
    videoInput: ['読み込む動画', 'Local video file'],
    fileNote: ['最大128MiB・120秒。v2の送信動画を使います。ブラウザーが再生できるMP4やWebMを選びます。停止時にファイルへの参照を解放します。',
      'Up to 128 MiB and 120 seconds. Use a version-2 transmission in a browser-playable MP4 or WebM. File references are released on stop.'],
    expected: ['送った文字列がわかる場合だけ入力（任意）', 'Known transmitted text (optional)'],
    start: ['開始', 'Start'], stop: ['停止', 'Stop'], clear: ['表示を消去', 'Clear display'],
    transmitter: ['光を送る', 'Transmit light'], txLabel: ['送信する明滅の表示面', 'Optical signal display'],
    txNote: ['この表示面全体が同じ明度・色になります。文字や枠を受信側の測定範囲に入れないでください。',
      'This entire signal area uses one brightness or color. Keep labels and borders outside the receiver rectangle.'],
    receiver: ['カメラから文字へ', 'From camera to text'],
    previewLabel: ['カメラ映像と測定矩形。ドラッグで矩形を指定できます。', 'Camera view and measurement rectangle. Drag to select a region.'],
    previewEnabled: ['映像を表示する（点滅を含みます）', 'Show video preview (contains flicker)'],
    regionTitle: ['測定枠の調整', 'Measurement rectangle'],
    regionNote: ['送信面の内側をドラッグするか、4つのスライダーで矩形を指定します。変更すると同期をやり直します。',
      'Drag inside the signal area or use the four sliders. Changing the rectangle restarts synchronization.'],
    roiX: ['左端（%）', 'Left (%)'], roiY: ['上端（%）', 'Top (%)'], roiW: ['幅（%）', 'Width (%)'], roiH: ['高さ（%）', 'Height (%)'],
    regionReset: ['中央に戻す', 'Reset to center'], graphTitle: ['測定値の時系列', 'Signal over time'],
    graphLabel: ['輝度・赤青比率・RGBの時系列、組ごとの判定位置', 'Luminance, red/blue ratio or RGB over time and pair decisions'],
    graphNote: ['縦軸は輝度・赤青比率・較正後RGB（0〜1）、横軸は秒です。縦線は組の中央、?は低確信度です。各組の前半と後半の差から判定します。',
      'Vertical: luminance, red/blue ratio or calibrated RGB (0–1). Horizontal: seconds. ' +
      'Marks show pair centers; ? means low confidence. Compare both halves.'],
    monoLegend: ['Y 実線 / 組の中央 縦線', 'Y solid / pair center vertical'],
    colorLegend: ['R 実線 / G 長い破線 / B 点線（較正後の0〜1）', 'R solid / G long dash / B dotted (calibrated 0–1)'],
    bicolorLegend: ['R/(R+B) 実線 / 組の中央 縦線', 'R/(R+B) solid / pair center vertical'],
    signalTitle: ['明暗の確認', 'Brightness check'],
    signalHealth: ['測定枠：白に近い {white}% · 黒に近い {dark}% · いずれかの色が上限付近 {clipped}% · 直近2秒の変動幅 {span}',
      'Region: near white {white}% · near black {dark}% · any channel near maximum {clipped}% · signal range over 2 s: {span}'],
    signalWhite: ['白に近い画素が多く、明暗や色の差が失われる可能性があります。送信画面の明るさを少し下げ、反射と測定枠も確認します。',
      'Many pixels are near white; brightness or color differences may be lost. Lower sender brightness slightly and check reflections and the rectangle.'],
    signalDark: ['黒に近い画素が多くなっています。送信画面を少し明るくし、測定枠に送信面が入っているか確認します。',
      'Many pixels are near black. Raise sender brightness slightly and check that the rectangle is inside the signal area.'],
    signalClipped: ['一部の色が上限付近です。送信画面の明るさを少し下げてください。色の差を失うと2色・カラーでも復元できません。',
      'Some color channels are near maximum. Lower sender brightness slightly. Lost color differences cannot be recovered even in two-color or RGB mode.'],
    signalObserve: ['変動幅は動きや照明でも増えます。カメラ映像の表示だけでは受信成功ではありません。「復号中」・ライブ文字・CRCを確認します。',
      'Motion and lighting can also increase the range. Video alone does not confirm reception. Check Decoding, live text and CRC.'],
    receivePreviewNote: ['「受けるだけ」→「受信開始」→カメラを許可、の順で映像と信号を表示します。「カメラをテスト」は映像の確認だけです。',
      'Receive only → Start reception → allow camera: video and signal display begin. Test camera previews video without decoding.'],
    testPreviewNote: ['カメラテスト中です。信号の解析とライブ復号には「受信開始」を押してください。',
      'Camera test is active. Choose Start reception to analyze the signal and decode live text.'],
    activePreviewNote: ['映像を取得して解析中です。映像が表示されても、同期信号を受け取るまでは復号を開始しません。',
      'Frames are being analyzed. Decoding starts only after the preamble is recognized, even when video is visible.'],
    offlinePreviewNote: ['動画を選び「開始」を押すと、映像を再生して信号を解析します。',
      'Choose a video and press Start to play it and analyze the signal.'],
    liveTitle: ['ライブ復号', 'Live decoding'], results: ['受信結果', 'Received result'], frameCheck: ['終了マーカー / UTF-8', 'End marker / UTF-8'],
    confidence: ['最小確信度', 'Minimum confidence'], agreement: ['文字の一致率 / 誤り率', 'Character agreement / error rate'],
    resultNote: ['CRCは伝送中の誤りを調べます。暗号化や送信者の証明ではありません。確信度は分類の目安で、正解の確率ではありません。',
      'CRC checks transmission errors. It provides neither encryption nor sender authentication. Confidence ' +
          'describes classification margin, not probability of correctness.'],
    diagnostics: ['組ごとの判定', 'Per-pair decisions'], tradeoff: ['3モードの違い', 'Three modulation modes'],
    density: ['1組（2シンボル）の情報量', 'Data per pair (2 symbols)'], conditions: ['特徴と条件', 'Characteristics and conditions'],
    monoTradeoff: ['明→暗が1、暗→明が0。1〜4bit/s（冗長部を含む）', 'Bright–dark = 1; dark–bright = 0. 1–4 bit/s including redundancy'],
    colorTradeoff: ['RGB各チャネルで反転した値を比較。3〜12bit/s（冗長部を含む）＋較正',
      'Compare complementary pairs on each RGB channel. 3–12 bit/s including redundancy, plus calibration'],
    bicolorTradeoff: ['青→赤が0、赤→青が1。赤青比率で比較。1〜4bit/s（冗長部を含む）。白飛びや色補正の影響は残る',
      'Blue–red = 0; red–blue = 1. Compare red/blue ratios. 1–4 bit/s including redundancy. Clipping and color adjustments still matter'],
    lessons: ['座学', 'How it works'], helpTitle: ['使い方と読み方', 'Using the tool'],
    helpBody: ['2台で同じモードを選びます。受信側はカメラテストで映像を確認し、使うカメラを選んでから受信を開始します。' +
      '送信画面を測定枠の内側に収め、短い文字列を1回送ります。1台では動画のオフライン復号を使えます。',
      'Select the same mode on two devices. On the receiver, test the camera, choose the desired camera and start reception. ' +
      'Fill the measurement rectangle with the signal area, then send once. On one device, decode a local video.'],
    helpFailure: ['同期しないときは、画面の位置・反射・ピントを確認します。?が多ければ速度を下げ、カラーからモノクロへ戻します。CRC不一致の文字は未確認として扱います。',
      'If synchronization fails, check alignment, reflections and focus. For many ? symbols, lower the rate or ' +
          'switch to monochrome. Treat text with a failed CRC as unverified.'],
    close: ['閉じる', 'Close'], pseTitle: ['点滅を始める前の確認', 'Before starting flicker'],
    confirmNote: ['カラー・高速・高コントラスト、または「動きを減らす」設定での送信です。周囲を確認し、点滅を開始する場合だけ続行してください。',
      'This uses color, a faster rate, high contrast, or transmission with reduced motion enabled. Check your ' +
          'surroundings and continue only if you intend to start flicker.'],
    cancel: ['キャンセル', 'Cancel'], continue: ['点滅を開始', 'Start flicker'],
    idle: ['待機中', 'Ready'], preparing: ['送信準備中（3秒）', 'Preparing to send (3 seconds)'],
    sending: ['送信中', 'Sending'], receiving: ['同期信号を待っています', 'Waiting for the preamble'],
    decoding: ['復号中', 'Decoding'], sent: ['送信終了', 'Transmission finished'], complete: ['受信終了', 'Reception finished'],
    stopped: ['停止しました', 'Stopped'], hidden: ['タブが非表示になったため停止しました', 'Stopped because the tab became hidden'],
    timeout: ['120秒で自動停止しました', 'Stopped at the 120-second time limit'], failed: ['開始できませんでした', 'Could not start'],
    ok: ['成功', 'Pass'], fail: ['不一致', 'Fail'], unsupported: ['非対応 / 情報なし', 'Unsupported / unavailable'],
    requested: ['要求済み・固定を確認できず', 'Requested; lock not confirmed'], manual: ['手動モードを確認', 'Manual mode reported'],
    controlFailed: ['固定できず・解析を継続', 'Lock failed; analysis continues'], notApplicable: ['動画では対象外', 'Not applicable to a file'],
    invalidSettings: ['設定が不正です。', 'Invalid settings.'], invalidText: ['文字列を入力してください。', 'Enter a text string.'],
    invalidUnicode: ['不正なUnicode文字が含まれています。', 'The input contains invalid Unicode.'],
    tooLong: ['UTF-8で8バイト以下にしてください。', 'Use at most 8 UTF-8 bytes.'],
    cameraUnavailable: ['カメラを利用できません。HTTPSかlocalhostで開き、カメラの設定を確認してください。',
      'Camera unavailable. Open over HTTPS or localhost and check camera settings.'],
    permission: ['カメラの利用が許可されませんでした。ブラウザーの権限を確認してください。',
      'Camera permission was denied. Check browser permissions.'],
    cameraEnded: ['カメラが切断されました。', 'The camera disconnected.'], cameraMuted: ['カメラ入力が中断されました。', 'Camera input was interrupted.'],
    fileSize: ['0バイトより大きく128MiB以下の動画を選んでください。', 'Choose a video larger than zero bytes and at most 128 MiB.'],
    selectFile: ['動画を選んでください。', 'Choose a video file.'],
    videoDuration: ['120秒以下の動画を選んでください。', 'Choose a video no longer than 120 seconds.'],
    videoError: ['動画を再生できません。別の形式の動画を選んでください。', 'Cannot play this video. Try another supported format.'],
    sampleError: ['映像の読み取りを続けられませんでした。', 'Video sampling could not continue.'],
    frameStalled: ['5秒間、新しいフレームを取得できなかったため停止しました。', 'Stopped after five seconds without a new frame.'],
    displayStalled: ['画面更新が間に合わなかったため送信を停止しました。', 'Transmission stopped because display updates missed a symbol.'],
    fpsTooLow: ['受信fpsが不足しています。送信速度を下げてください。', 'Insufficient receiver fps. Lower the transmit rate.'],
    missingCalibration: ['カラーの較正フレームがありません。送信より先に受信を始めてください。',
      'Color calibration is missing. Start reception before transmission.'],
    singularCalibration: ['色を分離できません。位置・照明を確認するか、モノクロに切り替えてください。',
      'Color channels cannot be separated. Check positioning and lighting, or switch to monochrome.'],
    unstableCalibration: ['較正中に色や明るさが変わりました。', 'Color or brightness changed during calibration.'],
    invalidLength: ['長さの情報を読めませんでした。送信を最初からやり直してください。', 'Could not read the length. Restart the transmission.'],
    incompleteFrame: ['フレームが途中で終わりました。', 'The packet ended before all symbols arrived.'],
    noPreamble: ['同期信号が見つかりませんでした。位置とモードを確認してください。', 'No preamble found. Check positioning and modulation.'],
    calibration: ['色較正', 'Color calibration'], preamble: ['同期信号', 'Preamble'], data: ['データ', 'Data'], end: ['終了マーカー', 'End marker'],
    complement: ['反転したデータ', 'Complementary data'],
    emptyPreview: ['開始すると映像を表示します', 'Press Start to display video'],
    previewHidden: ['映像表示はオフ・フレーム取得は継続', 'Preview off; frame capture continues'],
    symbolRow: ['組番号 / 秒 / 値 / 確信度', 'Pair index / seconds / value / confidence']
  };
  const ja = {}, en = {};
  Object.entries(pairs).forEach(([key, value]) => { ja[key] = value[0]; en[key] = value[1]; });
  const lessons = [
    {
      title: ['画面からカメラへ', 'From screen to camera'],
      text: ['文字をUTF-8にし、モノクロでは明度の2段階、2色では青と赤、カラーではRGB各2段階へ変換します。' +
        'v2は反転した値と組にして送り、各組から同期を更新します。長さはHamming符号、本文とCRCはRS符号で保護します。CRCで訂正後を確認します。',
        'UTF-8 bytes become two brightness levels, blue/red symbols, or two levels on each parallel RGB channel. ' +
        'Version 2 updates timing from complementary pairs. Hamming coding protects length; RS protects payload and CRC. CRC checks the corrected result.'],
      headers: ['順序 / 内容', 'Order / Content'],
      rows: [
        ['0 / カラーのみ', 'R/G/B較正（各2シンボル＋基準2）', '0 / Color only', 'R/G/B calibration (two symbols each, plus two baseline symbols)'],
        ['1', 'プリアンブル16シンボル', '1', '16-symbol preamble'],
        ['2', '長さ8ビット符号＋本文0〜8バイト＋CRC-8（0x07）＋RS冗長2バイト。反転した値と組にして送信',
          '2', '8 coded length bits; 0–8 payload bytes; CRC-8 (0x07); 2 RS parity bytes. Sent in complementary pairs'],
        ['3', '終了マーカー6シンボル', '3', '6-symbol end marker']
      ],
      sources: [['VLC synchronization', 'https://patents.google.com/patent/US8374201B2/en']]
    },
    {
      title: ['発光体が替わっても原理は同じ', 'Different emitters, the same principle'],
      text: ['制御できる光に情報を載せる原理は共通です。画面は面積が大きく受光しやすい一方、小さなLEDではピントや距離の影響が増えます。波長や駆動速度も方式によって異なります。',
        'Each method encodes data in controllable light. A screen offers a larger target; small LEDs make focus and ' +
          'distance more critical. Wavelength and switching speed also vary by device.'],
      headers: ['先行例 / 発光体', 'Study / Emitter'],
      rows: [
        ['LED-it-GO', 'HDDアクセスLED', 'LED-it-GO', 'HDD activity LED'],
        ['xLED', 'ルーターやスイッチのLED', 'xLED', 'Router and switch status LEDs'],
        ['CTRL-ALT-LED', 'Caps / Num / Scroll LockのLED', 'CTRL-ALT-LED', 'Caps / Num / Scroll Lock LEDs'],
        ['aIR-Jumper', '監視カメラの赤外線LED', 'aIR-Jumper', 'Security camera infrared LEDs']
      ],
      sources: [['LED-it-GO', 'https://arxiv.org/abs/1702.06715'], ['xLED', 'https://arxiv.org/abs/1706.01140'],
        ['CTRL-ALT-LED', 'https://arxiv.org/abs/1907.05851'], ['aIR-Jumper', 'https://arxiv.org/abs/1709.05742']]
    },
    {
      title: ['光の通信路の特徴', 'What distinguishes an optical channel'],
      text: ['光は見通し（LOS）が必要です。受信機、窓の材質、角度、照明によって届き方は変わります。研究の距離は実験室条件（直視・特定機材・最良条件）で、本ツールの到達距離ではありません。',
        'Light needs a line of sight (LOS). Receivers, glazing, angle and lighting affect reception. Research ' +
          'distances describe laboratory conditions and specific equipment, not this tool’s range.'],
      headers: ['特徴 / 条件', 'Feature / Condition'],
      rows: [
        ['監視カメラでも受信', 'aIR-Jumperではカメラが赤外線を受光', 'Security cameras can receive', 'aIR-Jumper uses cameras as infrared receivers'],
        ['ガラス越し', '可視光を通す窓なら経路が残る。音響や近接熱通信とは条件が異なる',
          'Through glass', 'Visible-light-transmitting windows can preserve the path; acoustic and near-field thermal links behave differently'],
        ['見通しと望遠', 'LED-it-GOは光センサーで夜間屋外20m、カメラでは8m', 'LOS and optics', 'LED-it-GO: optical sensor at 20 m outdoors at night; camera at 8 m'],
        ['音響ノイズに強い', '光のノイズは太陽光、照明の100/120Hzフリッカー、他の発光',
          'Unaffected by acoustic noise', 'Optical noise includes sunlight, 100/120 Hz lighting flicker and other emitters']
      ],
      sources: [['LED-it-GO', 'https://arxiv.org/abs/1702.06715'], ['aIR-Jumper', 'https://arxiv.org/abs/1709.05742']]
    },
    {
      title: ['密度の階段：明滅、色、2次元', 'Density: flicker, color, then two dimensions'],
      text: ['本ツールは時間と色に絞り、復号の途中を見せます。QRは1枚に多くのビットを置き、ファインダーとアライメントで位置を補正します。Reed-SolomonのL/M/Q/Hは符号語の約7/15/25/30%を復元する目安で、画像の同じ面積を必ず復元できる意味ではありません。',
        'This tool exposes decoding in time and color. QR packs many bits into one image, using finder and alignment ' +
          'patterns for positioning. Reed-Solomon levels L/M/Q/H restore roughly 7/15/25/30% of codewords, not a ' +
          'guaranteed equal area of the image.'],
      headers: ['載せ方 / 密度の例', 'Encoding / Example density'],
      rows: [
        ['明滅', 'v2は1 bit/組 → 2 symbol/sで1 bit/s（冗長部を含む）', 'Flicker', 'V2: 1 bit/pair → 1 bit/s at 2 symbol/s, including redundancy'],
        ['青・赤の2色', 'v2は青→赤が0、赤→青が1。各組の中央で色が変化', 'Blue / red', 'V2: blue–red = 0, red–blue = 1; color changes at every pair midpoint'],
        ['RGB並列', 'v2は3 bit/組 → 2 symbol/sで3 bit/s（冗長部を含む）', 'Parallel RGB', 'V2: 3 bits/pair → 3 bit/s at 2 symbol/s, including redundancy'],
        ['QR Version 1-L', '1枚で最大17バイト＝136ビット（バイトモード）', 'QR Version 1-L', 'Up to 17 bytes = 136 bits per image in byte mode']
      ],
      sources: [['QR capacity', 'https://www.qrcode.com/en/about/version.html'],
        ['QR error correction', 'https://www.qrcode.com/en/about/error_correction.html'],
        ['QR positioning', 'https://www.qrcode.com/en/codes/model12.html']]
    },
    {
      title: ['色チャネルが混ざる理由', 'Why color channels mix'],
      text: ['RGBを足しても実効速度が必ず3倍になるわけではありません。各画素をsRGBから線形量へ変換して平均し、単色の増分から3×3行列を測ります。その逆行列で混色を戻します。色を分離できない行列では停止します。',
        'Three RGB channels do not guarantee three times the effective speed. Linearize each sRGB pixel before ' +
          'averaging, measure a 3×3 matrix from primary-color increments, then invert it. Stop if the matrix cannot ' +
          'separate colors.'],
      headers: ['要因 / 観察と対処', 'Factor / Observation and response'],
      rows: [
        ['デモザイク / クロストーク', '1色の光が複数の測定チャネルへ混ざる → 行列較正',
          'Demosaicing / crosstalk', 'One primary appears in several measured channels → matrix calibration'],
        ['AE / AWB', '明度や色の基準が変わる → 固定を試行、非対応なら正規化',
          'AE / AWB', 'Brightness or color reference drifts → request manual controls; otherwise normalize'],
        ['ガンマ', 'sRGBの平均は光の平均と異なる → 各画素を線形化',
          'Gamma', 'Mean sRGB is not mean light intensity → linearize each pixel']
      ],
      sources: [['Image Capture controls', 'https://w3c.github.io/mediacapture-image/'],
        ['sRGB transfer function', 'https://www.w3.org/TR/css-color-4/#color-conversion-code']]
    },
    {
      title: ['ローリングシャッターの縞', 'Rolling-shutter stripes'],
      text: ['CMOSは行ごとに露光時刻がずれるため、高速な光の変化が横縞になることがあります。縞を読む方式なら1フレームに複数シンボルを載せられますが、露光時間と行の周期の較正が必要です。本ツールは矩形の平均だけを読みます。',
        'CMOS rows can expose at different times, turning rapid light changes into horizontal stripes. Reading those ' +
          'stripes can recover multiple symbols per image, but requires exposure and row-timing calibration. This tool ' +
          'reads only a rectangle’s average.'],
      headers: ['取得方法 / 時間の単位', 'Sampling method / Time unit'],
      rows: [
        ['本ツール', '1フレームの矩形平均。送信速度は実効fpsの半分以下', 'This tool', 'One rectangle average per frame; transmit at no more than half the effective fps'],
        ['縞の解析（対象外）', '各行の露光時刻。機種ごとの較正が必要', 'Stripe analysis (not implemented)', 'Exposure time per row; device-specific calibration required']
      ],
      sources: [['rVFC', 'https://web.dev/articles/requestvideoframecallback-rvfc'],
        ['Rolling-shutter OCC (preprint)', 'https://arxiv.org/abs/2602.08474']]
    },
    {
      title: ['通信の成立と検知は別の問題', 'Communication and detection are different questions'],
      text: ['普段は通信に使わない光を情報の経路にするとcovert channelになります。肉眼で文字を読めなくても、方式を知る受信者は復元できます。本ツールは暗号化しません。信号の存在を調べることと、内容を復号することも別です。Day041は音の帯域観察との比較に使えます。',
        'Using ordinary light as an unintended information path creates a covert channel. A person may not read the ' +
          'text by eye, yet a compatible receiver can recover it. This tool does not encrypt. Observing a signal and ' +
          'decoding content are distinct tasks; Day041 offers an acoustic comparison.'],
      headers: ['観測 / わかること', 'Observation / What it establishes'],
      rows: [
        ['グラフの変化', '測定した光の変化。通信の証明とは限らない', 'Graph changes', 'Measured light variation; not necessarily evidence of communication'],
        ['復号＋CRC成功', 'この形式のフレームを受理。送信者の証明ではない', 'Decoding + passing CRC', 'A packet in this format was accepted; no sender authentication']
      ],
      sources: [['xLED: side channel / covert channel', 'https://arxiv.org/abs/1706.01140'],
        ['Day041 · Mic Gain Logger', 'https://ipusiron.github.io/mic-gain-logger/']]
    },
    {
      title: ['エアギャップ・ブリッジへの橋', 'Continue with Air-Gap Bridge'],
      text: ['本ツールは『エアギャップ・ブリッジ』の考え方を試す実習環境です。関連する章を案内します。各書籍の紹介ページから詳細をご覧ください。',
        'This tool provides a practical environment for ideas discussed in Air-Gap Bridge. The related chapters below ' +
          'are in Japanese-language books; follow the book pages for details.'],
      headers: ['書籍 / 関連する章', 'Book / Related chapter'],
      rows: [
        ['隔離環境のデータ入力技法', '第9章「将来展望」', 'Data Input Techniques for Isolated Environments', 'Chapter 9: Future Prospects'],
        ['隔離環境のデータ出力技法', '第2章「エアギャップとは何か」', 'Data Output Techniques for Isolated Environments', 'Chapter 2: What Is an Air Gap?']
      ],
      sources: [['Input', 'https://akademeia.info/?page_id=53563'], ['Output', 'https://akademeia.info/?page_id=53554']]
    }
  ];
  return Object.freeze({ ja: Object.freeze(ja), en: Object.freeze(en), lessons });
}));
