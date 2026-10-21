<!--
---
id: day122
slug: photon-flicker-link

title: "Photon Flicker Link"

subtitle_ja: "光で短文を送り、カメラとグラフで通信を観察"
subtitle_en: "Send short text through light and observe the camera signal"

description_ja: "画面の明滅をカメラで読み取り、最大8バイトの文字列へ復元する教材。モノクロ・青赤2色・RGB並列変調、時系列グラフ、ライブ復号、ローカル動画の解析に対応します。"
description_en: "A local optical communication lesson with binary monochrome, blue/red and parallel RGB signaling, camera traces, live decoding, CRC-8 and offline video analysis, for up to 8 UTF-8 bytes."

category_ja:
  - プライバシー
  - 光学監視
category_en:
  - Privacy
  - Optical Surveillance

difficulty: 2

tags:
  - optical-channel
  - visible-light-communication
  - air-gap
  - camera
  - signal-processing

repo_url: "https://github.com/ipusiron/photon-flicker-link"
demo_url: "https://ipusiron.github.io/photon-flicker-link/"

hub: true
---
-->

# Photon Flicker Link - Send short text through light and visualize the channel

![GitHub Repo stars](https://img.shields.io/github/stars/ipusiron/photon-flicker-link?style=social)
![GitHub forks](https://img.shields.io/github/forks/ipusiron/photon-flicker-link?style=social)
![GitHub last commit](https://img.shields.io/github/last-commit/ipusiron/photon-flicker-link)
![GitHub license](https://img.shields.io/github/license/ipusiron/photon-flicker-link)
[![GitHub Pages](https://img.shields.io/badge/demo-GitHub%20Pages-blue?logo=github)](https://ipusiron.github.io/photon-flicker-link/)

**Day122 - 200 Security Tools Built with Generative AI**

This educational tool reads screen flicker with a camera and reconstructs short text. A camera view, brightness or color traces, and live decoded characters show how communication succeeds or fails.

English | [日本語](README.md)

## 🌐 Live demo

👉 **[Open Photon Flicker Link](https://ipusiron.github.io/photon-flicker-link/?lang=en)**

No installation is required. Defaults are binary monochrome, 2 symbol/s, low contrast, and a maximum of 8 UTF-8 bytes.

## 📸 Screenshots

> ![Text input and active signal area](assets/en/send.png)
>
> *Sending LIGHT in monochrome. Transmission finishes after one packet.*

> ![Camera region and signal traces](assets/en/receive.png)
>
> *A synthetic video arrives through a virtual camera, with LI decoded so far. This is not a physical camera photograph.*

> ![LIGHT result with a passing CRC](assets/en/result.png)
>
> *Offline video decoding recovers LIGHT and passes CRC, end-marker and UTF-8 checks.*

> ![Lesson comparing flicker and QR density](assets/en/lesson.png)
>
> *Eight lessons include tables and links to primary sources.*

## 📖 How to use

Flashing light can trigger photosensitive seizures (PSE) or discomfort. Consider people nearby and stop if you feel unwell. Low speed and low contrast do not guarantee safety. The author does not encourage misuse.

1. Open the demo on two devices and select Monochrome on both. Adjust brightness while watching the receiver and avoid reflections.
2. Choose Receive only on the receiver, press Test camera, and allow camera access. Check the camera name, resolution, sampled fps and video. Enable Show video preview if it is off.
3. If there are multiple cameras, choose one under Camera to use. You can switch during testing. Use Refresh list if a connected camera is missing.
4. Press Start reception on the receiver. Keep the devices still, with the measurement rectangle entirely inside the sender's signal area.
5. Choose Send only on the sender and start with `A`. After ③ → ② → ① → Start, transmission begins. The defaults take 3 seconds of preparation plus 51 seconds of transmission. Start reception first and finish transmission within the 120-second reception limit.
6. Watch the live characters and trace. Check CRC, end marker and UTF-8 at the end. Treat text from failed checks as unverified.
7. Use Stop to interrupt, or Clear display to remove the result and measurements.

Selecting Receive only does not start the camera or signal display. Press Start reception and grant permission to begin video, the trace and live decoding. Turning Show video preview off hides only the preview. On wide screens, rectangle controls sit to the right of the video; on narrow screens, they follow the video, live text and trace.

Camera testing checks frame capture without decoding. Stop test, hiding the tab, or the 120-second limit releases the camera. Start reception during testing uses the same camera and starts a new reception time limit. Switching cameras during reception releases the old camera and restarts synchronization and decoding. Camera names and the selected device are not saved.

Camera lists and names may be incomplete before permission is granted. An empty list alone does not prove that no camera is connected. Testing distinguishes permission denial, no camera, a camera that cannot be opened, and an unavailable selected device. Successful frame capture does not guarantee optical communication.

For color, select Color on both devices and receive the calibration at the beginning. Faster rates, color, two-color, high contrast, and transmission with reduced motion enabled require a confirmation dialog. There is no full-screen mode or automatic retransmission. Hiding the tab stops the session without automatic resumption.

To inspect a recording on one device, choose Offline decoding and select a video of this tool's transmission. The file must be browser-playable, such as MP4 or WebM, no larger than 128 MiB and no longer than 120 seconds. Character agreement and error rate appear only when you supply the expected text. This is not a general video-to-text extractor. The tool has no recording function.

## ✨ Features and result interpretation

| Item | Behavior |
|---|---|
| Roles | Send only, Receive only, Offline decoding |
| Cameras | List and refresh, device selection, video/resolution/fps test; switching releases the previous camera |
| Monochrome | Dark–bright = 0; bright–dark = 1. One bit per two-symbol pair |
| Two colors | Blue–red = 0; red–blue = 1. One bit per pair, comparing linearized R/(R+B) |
| Color | Complementary pairs per RGB channel, totaling 3 bits/pair; baseline and RGB calibration |
| Measurement rectangle | Drag or use four sliders; changes restart synchronization |
| Trace | Linearized brightness, red/blue ratio or calibrated RGB; pair decision positions; distinct line styles |
| Confidence | Pair contrast and noise margin, not a probability of correctness |
| `?` | A character containing low-confidence or missing symbols |
| CRC-8 | Checks transmission errors; no encryption, sender authentication or error correction |
| Agreement | Offline with known text only: matching Unicode characters at the same positions divided by the longer character count |
| Environment | Sampling fps, rVFC/rAF, resolution, API reports for exposure/WB locking, estimated period |

Exposure requests apply manual mode before exposure time; white balance (WB) is requested separately. Analysis continues if controls are unsupported or rejected, with the state shown on screen. The preamble acquires synchronization; subsequent pairs compare their two halves. This handles shared gain changes but cannot remove every effect of automatic camera adjustment.

### Version 2: synchronization and correction

Reload the page on both devices. V2 is incompatible with legacy transmissions and recordings. The default 2 symbol/s still means two physical display updates per second. Each bit takes two symbols: 8 bytes take 107 seconds in monochrome or blue/red, or 47 seconds in RGB color, plus the separate three-second countdown.

- Repeated values: dark–bright or blue–red means 0; the reverse means 1. Every pair has a midpoint transition, used to update timing from recent observations.
- Brightness changes: compare the two halves of each pair. Pairs that fail contrast and noise requirements, including a six-noise-span check, become erasures.
- Short errors and gaps: extended Hamming(8,4) protects length. Two RS parity bytes protect payload and CRC, correcting one erroneous byte or up to two bytes with known missing positions.
- Failed reception: continue searching for a new preamble within the original 120-second session limit. The sender never repeats automatically. Restart reception too if a new transmission would exceed the remaining session time.

Correction counts and CRC are shown separately. Live text is provisional and can change after final correction. Errors beyond coding capacity are not always detectable, and CRC-8 can miss errors. See the [wire format and receiver details](docs/protocol-v2.md). The legacy synthetic comparison remains a regression test, not a V2 or physical success rate.

### When reception is unstable

Make the rectangle slightly smaller than the flickering area and keep it entirely inside that area. If the signal occupies only part of the rectangle, background colors dilute the measured average. Drag a corner to resize, inside to move, or from outside to draw a new rectangle. The outline follows the gesture; releasing applies the sampling region and restarts synchronization. Sliders provide the same adjustment.

Monochrome measures a brightness difference, so dimming the sender too far reduces that difference. At the other extreme, a white, clipped signal area loses brightness and color information. Alongside the rectangle controls, the tool shows the proportions of near-white pixels, near-black pixels and pixels with any channel near maximum, plus signal range over the last two seconds. Adjust gradually while watching the receiver. These measurements guide adjustment; they do not confirm communication.

If brightness decisions are unstable, select Two colors (blue / red) on both devices. The R/(R+B) ratio cancels a gain applied equally to red and blue. The preamble estimates the two ratio levels and timing. This is a different decoder from monochrome with colored output. Clipping, dark-image noise, changing background light and automatic color adjustments can still cause failure. CRC requirements remain unchanged. Two-color mode has the same rate as monochrome.

On iPhone, the brightness control changes the entire screen. True Tone, Night Shift and auto-brightness can also alter the display. For comparison experiments, record these settings and consider temporarily disabling them to hold conditions steady. See [Apple's instructions](https://support.apple.com/en-us/109351). The tool does not lock device screen brightness. Manual camera exposure and WB are requested only when the browser reports support.

The owner reports that V2 reaches Decoding but does not succeed in either monochrome or blue/red. No physical reception samples have been collected, so the cause remains unidentified. iPhone hardware, Vivaldi, multiple physical cameras, distance, ambient light and actual exposure/WB locking remain awaiting owner testing (本人確認待ち).

Above the graph, remaining reception time, sampled frame count and the stop reason are shown. Measurement stops on success or at 120 seconds, keeping the last graph. Sending again does not restart the receiver. Press Restart reception before sending again.

To investigate a failure, open Diagnose reception failure below the graph and choose Save reception diagnostic. It saves sample times, mean RGB and decoder events locally as JSON, excluding images, audio, camera names, device IDs and video filenames. Transmitted text may be recoverable from samples, so use test text such as `A` before sharing. Save before retrying: starting a new transmission or reception, clearing the display or reloading discards the diagnostic.

## 🔬 Transfer limits and data density

Camera frame rate limits transfer speed. Multiple frames are needed per symbol, and this tool rejects synchronization below 2 frames/symbol. At 30 fps, at most 15 symbol/s is a necessary condition, not a sufficient one. Exposure time, missing frames, display phase, distance, ambient light and automatic exposure/WB can impose stricter limits.

Reading whole-screen flicker as one temporal channel with a camera gives a design range of a few to tens of bits per second in monochrome. This implementation offers 2/4/8 symbol/s: 1–4 coded bit/s in monochrome or two-color mode and 3–12 coded bit/s in color, including complementary halves. These are not limits on fast photodiodes or methods that decode rolling-shutter stripes.

The following values are calculated for the maximum 8-byte payload. `mono` means monochrome; `bicolor` means blue/red; `color` means parallel RGB. Payload throughput is 64 bits divided by total duration, including preamble, coded length, CRC, error correction, complementary halves, end marker and color calibration. These are not physical measurements. The three-second countdown is excluded from this table.

| Mode | symbol/s | Coded rate (bit/s) | Duration for 8 bytes (s) | Payload throughput (bit/s) |
|---|---:|---:|---:|---:|
| mono | 2 | 1 | 107 | 0.6 |
| mono | 4 | 2 | 53.5 | 1.2 |
| mono | 8 | 4 | 26.75 | 2.39 |
| bicolor | 2 | 1 | 107 | 0.6 |
| bicolor | 4 | 2 | 53.5 | 1.2 |
| bicolor | 8 | 4 | 26.75 | 2.39 |
| color | 2 | 3 | 47 | 1.36 |
| color | 4 | 6 | 23.5 | 2.72 |
| color | 8 | 12 | 11.75 | 5.45 |

Color calibration means a short message does not simply take one third of the monochrome duration. Four-level PAM remains in pure-function comparisons only and is not exposed in the UI. The [legacy synthetic comparison](docs/measurements.json) does not measure physical success rates.

Space offers another way to increase density. V2 monochrome carries 1 bit per two-symbol pair and parallel RGB carries 3, while QR Version 1-L holds up to 17 bytes = 136 bits in one image in byte mode. QR uses finder patterns, alignment patterns from Version 2 onward, and Reed-Solomon correction. The approximate L/M/Q/H values of 7/15/25/30% concern codewords, not guaranteed recovery of the same image area. Two-dimensional density is useful for practical screen transfers. See DENSO WAVE's [capacity reference](https://www.qrcode.com/en/about/version.html) and [error correction explanation](https://www.qrcode.com/en/about/error_correction.html).

## 🔄 Comparison with other air-gap channels

Each study uses different transmitters, receivers and conditions. Distances depend on laboratory conditions, line of sight and specific equipment; they are not performance claims for this tool. `B/s` means bytes per second; `bit/s` means bits per second. Mitigations are examples of restricting a channel, not guarantees of prevention.

| Method | Channel and receiver | Reported throughput | Reported distance | Example restriction and source |
|---|---|---|---|---|
| Photon Flicker Link | Screen → camera | mono 1–4 bit/s; color 3–12 bit/s (including redundancy) | Awaiting owner testing | Block light; manage screen/camera placement. Calculated implementation rates |
| LED-it-GO | HDD LED → photodiode / camera | 4000 bit/s / 15–120 bit/s | Optical sensor: 3–5 m indoors, 20 m outdoors at night. Camera: 8 m | Cover LEDs; block line of sight. [Paper](https://arxiv.org/abs/1702.06715) |
| Acoustic (Day120 / ggwave reference) | Speaker → microphone | ggwave: 8–16 B/s. Day120: 1.25–11.08 B/s (calculated for 256 bytes) | ggwave: about 1 m, developer report. Day120: unmeasured | Manage acoustic paths and microphones. [ggwave](https://github.com/ggerganov/ggwave#details), [Day120](https://github.com/ipusiron/airborne-tone-link) |
| MAGNETO / ODINI | CPU magnetic field → phone magnetometer / dedicated sensor | 0.2–5 bit/s / 40 bit/s | 0–12 cm / 100–150 cm | Manage distance and magnetic sensors. [MAGNETO paper](https://arxiv.org/abs/1802.02317); ODINI values are quoted via its table, original paper not checked |
| BitWhisper | Heat → another PC's temperature sensor | 1–8 bit/hour | 0–40 cm, bidirectional | Manage device spacing and temperature changes. [Paper](https://arxiv.org/abs/1503.07919) |
| AirHopper | Video card → phone FM receiver | 13–60 B/s | 1–7 m | Electromagnetic shielding and receiver management. [Research institution](https://cyber.bgu.ac.il/how-leak-sensitive-data-isolated-computer-air-gap-near-mobile-phone-airhopper/) |
| PowerHammer | Power-line current variation → current probe | Line-level: about 1000 bit/s; phase-level: about 10 bit/s | Depends on the electrical tap location | Monitor/filter the power-line channel. [Paper](https://arxiv.org/abs/1804.04014) |

Surveillance cameras can also serve as optical receivers: [aIR-Jumper](https://arxiv.org/abs/1709.05742) studies infrared communication with security cameras. Visible light can cross transparent glass, subject to reflections, tint and coatings. This differs from short-range thermal communication in placement and response time; heat-transfer behavior cannot be reduced to one universal rule.

Line of sight (LOS) and suitable optics can allow distant observation. LED-it-GO's 20 m outdoor night result uses an optical sensor and must be distinguished from its camera result. Light is less directly affected by acoustic noise, but sunlight, 100/120 Hz lighting flicker, reflections and other emitters add optical noise.

## 🎯 Use cases

Ways of using this tool in particular

- In an information-science class, compare `A` (1 byte, 51 s), `LIGHT` (5 bytes, 83 s), and `日本` (6 bytes, 91 s) to explore how UTF-8 byte count differs from character count. These are calculated monochrome durations at 2 symbol/s, excluding the three-second countdown.
- In a communication-design lesson, compare 107 seconds for 8 monochrome bytes with 47 seconds in color to separate parallel-channel gains from calibration costs. Physical success also depends on color separation and ambient light.
- A video-production practitioner can move the measurement region within the emitter or include some background, then observe pair contrast and confidence. Camera RGB values are relative; this is not a lux meter or colorimeter.
- A puzzle designer can send `LIGHT` and show its reconstruction. A receiver that knows the format can recover it, so this does not protect a secret password.

General learning and creative uses

- At home or in an electronics workshop, participants can divide reception, device positioning and stopping between them, transferring a short message across devices. Obtain the agreement of people nearby and account for flicker sensitivity.
- For preliminary research, receive the same short message under different distances, lighting and devices, and separately record conditions and CRC results. The tool does not automatically save video or results.
- Combine Day120's acoustic channel and Day041's audio-band observations to study how reception conditions differ by medium. Day041 does not measure light signals.

## 🔗 Books and related tools

Use this tool as a practical environment for observing communication paths discussed in the Air-Gap Bridge books. It accompanies these chapter topics without quoting the book text:

- [『エアギャップ・ブリッジ 隔離環境のデータ出力技法』](https://akademeia.info/?page_id=53554) (Japanese-language book): Chapter 2, 「エアギャップとは何か」 (What is an air gap?)
- [『エアギャップ・ブリッジ 隔離環境のデータ入力技法』](https://akademeia.info/?page_id=53563) (Japanese-language book): Chapter 9, 「将来展望」 (Future outlook)
- [Day120 Airborne Tone Link](https://ipusiron.github.io/airborne-tone-link/): short text over sound
- [Day041 Mic Gain Logger](https://ipusiron.github.io/mic-gain-logger/): audio bands and input levels

Lessons also introduce [LED-it-GO](https://arxiv.org/abs/1702.06715), [xLED](https://arxiv.org/abs/1706.01140), [CTRL-ALT-LED](https://arxiv.org/abs/1907.05851) and [aIR-Jumper](https://arxiv.org/abs/1709.05742). They share the principle of encoding data in light but differ in emitter size, wavelength, switching speed and ease of reception. This tool does not control those devices.

## 🔒 Data handling and safeguards

Video frames are processed in a canvas without recording. The selected video's blob URL is released on stop or completion. Text and graph samples remain only in page memory until Clear display or page closure. Only language and theme are stored in localStorage.

Choosing Save reception diagnostic downloads a JSON file containing measurements and decoder events. Nothing is uploaded automatically. A downloaded file remains on the device after the page is cleared.

Analysis makes no external requests. CSP retains `connect-src 'none'`, with `media-src 'self' blob:` for local videos. There are no inline scripts, style attributes or external libraries. Loading the public page and deliberately opening external links are separate network activities.

There is no encryption: a receiver that knows the format can recover the content. A covert channel tries to hide the existence or medium of communication; it does not guarantee content secrecy. This tool's slow flicker is not necessarily inconspicuous.

GitHub Pages does not allow arbitrary HTTP response headers. X-Frame-Options and CSP frame-ancestors cannot be applied through meta tags.

## 🧪 Tests and verification scope

Run with Node.js 22 or later, without installing dependencies:

```sh
npm test
```

Tests cover conversions, CRC, known answers, synchronization, clock skew, color calibration, uncertainty, interruption, dictionaries, CSP, contrast, README values and images. GitHub Actions runs syntax checks and the same tests on push and pull_request.

With an existing Python Playwright and FFmpeg installation, `python -X utf8 test/browser.py` checks HTTP/file UI, virtual cameras, video decoding, rAF, hidden-tab stops and denied permission. Add `--screenshots` to capture README images, or `--url https://ipusiron.github.io/photon-flicker-link/` to check the public page.

Virtual-camera and video tests recover `LIGHT` in monochrome and color; rAF also passes CRC. The [verification record](docs/verification.md) gives measurements and limitations. **Physical two-device tests, distance, ambient light, device variation, and effective exposure/WB locking are awaiting owner testing (本人確認待ち).**

## 📁 Directory structure

```text
photon-flicker-link/          # Project
├── .gitattributes           # Text endings and binary PNG rules
├── .gitignore               # Local working data exclusions
├── .github/                 # GitHub configuration
│   └── workflows/           # Automated checks
│       └── test.yml         # Node 22 CI
├── index.html               # Single-page interface and CSP
├── style.css                # Themes and responsive layout
├── codec-core.js            # Pure encoding, calibration and decoding
├── reliable-codec.js        # V2 paired signaling, correction and clock tracking
├── camera-io.js             # Camera/video lifecycle and sampling
├── screen-tx.js             # Finite screen transmission
├── app.js                   # DOM, traces and roles
├── messages.js              # Bilingual text and eight lessons
├── package.json             # Dependency-free test configuration
├── README.md                # Japanese documentation
├── README.en.md             # English documentation
├── CLAUDE.md                # Development rules
├── LICENSE                  # MIT License
├── assets/                  # Japanese screenshots
│   ├── send.png             # Active transmission
│   ├── receive.png          # Camera and trace
│   ├── result.png           # Decoded result
│   ├── lesson.png           # Lesson
│   └── en/                  # English screenshots
│       ├── send.png         # Active transmission
│       ├── receive.png      # Camera and trace
│       ├── result.png       # Decoded result
│       └── lesson.png       # Lesson
├── docs/                    # Verification material
│   ├── measurements.json    # Synthetic comparison
│   ├── protocol-v2.md       # V2 wire format and decision rules
│   └── verification.md      # Results and physical-test checklist
└── test/                    # Automated verification
    ├── codec.test.js        # Pure functions and synthetic conditions
    ├── reliable.test.js     # V2 known answers, gaps, clocks and gain changes
    ├── io.test.js           # IO lifecycle and interruption
    ├── structure.test.js    # HTML, CSP, dictionaries and contrast
    ├── readme.test.js       # Values, metadata, images and structure
    └── browser.py           # Browser and virtual-camera checks
```

## 💻 Requirements

A browser with JavaScript and Canvas is required. The sending, lesson and offline-decoding UI works when opening `index.html` directly. Use HTTPS or localhost for camera access and grant browser permission. For local HTTP, run `python -m http.server 8000 --bind 127.0.0.1`.

The tool uses video-frame timestamps with rVFC when available, otherwise rAF sampling. rAF timestamps and fps are estimates and do not guarantee rVFC precision. Camera, codec and exposure/WB support depend on the device. UI checks and every transmitted color from Start through automatic completion are verified in Chromium and Firefox; video/virtual-camera reception checks use Chromium. Physical Safari testing has not been performed.

## 📄 License

- Source: MIT License; see [LICENSE](LICENSE).
- Runtime and npm development dependencies: none.
- Screenshots: this tool's interface with synthetic inputs.

## 🛠️ About this tool

This tool is part of the 200 Security Tools Built with Generative AI project. The project creates and publishes security-related tools over 100 days with AI assistance.

[Project information and other tools](https://akademeia.info/?page_id=44607)
