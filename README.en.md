<!--
---
id: day122
slug: photon-flicker-link

title: "Photon Flicker Link"

subtitle_ja: "光で短文を送り、カメラとグラフで通信を観察"
subtitle_en: "Send short text through light and observe the camera signal"

description_ja: "画面の明滅をカメラで読み取り、最大8バイトの文字列へ復元する教材。モノクロ・RGB並列変調、時系列グラフ、ライブ復号、ローカル動画の解析に対応します。"
description_en: "A local optical communication lesson with binary monochrome and RGB signaling, camera traces, live decoding, CRC-8 and offline video analysis, for up to 8 UTF-8 bytes."

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

1. Open the demo on two devices and select Monochrome on both. Lower screen brightness and avoid reflections.
2. Choose Receive only on the receiver, press Test camera, and allow camera access. Check the camera name, resolution, sampled fps and video. Enable Show video preview if it is off.
3. If there are multiple cameras, choose one under Camera to use. You can switch during testing. Use Refresh list if a connected camera is missing.
4. Press Start reception on the receiver. Keep the devices still, with the measurement rectangle entirely inside the sender's signal area.
5. Choose Send only on the sender and start with `A`. It takes 23 seconds at the defaults. Start reception first and finish transmission within the 60-second reception limit.
6. Watch the live characters and trace. Check CRC, end marker and UTF-8 at the end. Treat text from failed checks as unverified.
7. Use Stop to interrupt, or Clear display to remove the result and measurements.

Camera testing checks frame capture without decoding. Stop test, hiding the tab, or the 60-second limit releases the camera. Start reception during testing uses the same camera and starts a new reception time limit. Switching cameras during reception releases the old camera and restarts synchronization and decoding. Camera names and the selected device are not saved.

Camera lists and names may be incomplete before permission is granted. An empty list alone does not prove that no camera is connected. Testing distinguishes permission denial, no camera, a camera that cannot be opened, and an unavailable selected device. Successful frame capture does not guarantee optical communication.

For color, select Color on both devices and receive the calibration at the beginning. Faster rates, color, high contrast, and transmission with reduced motion enabled require a confirmation dialog. There is no full-screen mode or automatic retransmission. Hiding the tab stops the session without automatic resumption.

To inspect a recording on one device, choose Offline decoding and select a video of this tool's transmission. The file must be browser-playable, such as MP4 or WebM, no larger than 128 MiB and no longer than 60 seconds. Character agreement and error rate appear only when you supply the expected text. This is not a general video-to-text extractor. The tool has no recording function.

## ✨ Features and result interpretation

| Item | Behavior |
|---|---|
| Roles | Send only, Receive only, Offline decoding |
| Cameras | List and refresh, device selection, video/resolution/fps test; switching releases the previous camera |
| Monochrome | Two brightness levels carrying 1 bit/symbol |
| Color | Two levels per RGB channel, totaling 3 bits/symbol; baseline and RGB calibration |
| Measurement rectangle | Drag or use four sliders; changes restart synchronization |
| Trace | Linearized brightness or calibrated RGB; thresholds and decision positions; distinct line styles |
| Confidence | Classification margin, not a probability of correctness |
| `?` | A character containing low-confidence or missing symbols |
| CRC-8 | Checks transmission errors; no encryption, sender authentication or error correction |
| Agreement | Offline with known text only: matching Unicode characters at the same positions divided by the longer character count |
| Environment | Sampling fps, rVFC/rAF, resolution, API reports for exposure/WB locking, estimated period |

Exposure requests apply manual mode before exposure time; white balance (WB) is requested separately. Analysis continues if controls are unsupported or rejected, with the state shown on screen. Preamble amplitude normalization handles some brightness changes but cannot remove every effect of automatic camera adjustment.

## 🔬 Transfer limits and data density

Camera frame rate limits transfer speed. Multiple frames are needed per symbol, and this tool rejects synchronization below 2 frames/symbol. At 30 fps, at most 15 symbol/s is a necessary condition, not a sufficient one. Exposure time, missing frames, display phase, distance, ambient light and automatic exposure/WB can impose stricter limits.

Reading whole-screen flicker as one temporal channel with a camera gives a design range of a few to tens of bits per second in monochrome. This implementation offers 2/4/8 symbol/s: 2–8 bit/s raw in monochrome and 6–24 bit/s in color. These are not limits on fast photodiodes or methods that decode rolling-shutter stripes.

The following values are calculated for the maximum 8-byte payload. `mono` means monochrome; `color` means parallel RGB. Payload throughput is 64 bits divided by total duration, including preamble, length, CRC, end marker and color calibration. These are not physical measurements.

| Mode | symbol/s | Raw rate (bit/s) | Duration for 8 bytes (s) | Payload throughput (bit/s) |
|---|---:|---:|---:|---:|
| mono | 2 | 2 | 51 | 1.25 |
| mono | 4 | 4 | 25.5 | 2.51 |
| mono | 8 | 8 | 12.75 | 5.02 |
| color | 2 | 6 | 28.5 | 2.25 |
| color | 4 | 12 | 14.25 | 4.49 |
| color | 8 | 24 | 7.125 | 8.98 |

Color calibration means a short message does not simply take one third of the monochrome duration. Four-level PAM remains in pure-function comparisons only and is not exposed in the UI. The [synthetic comparison](docs/measurements.json) does not measure physical success rates.

Space offers another way to increase density. Monochrome carries 1 bit per symbol and parallel RGB carries 3, while QR Version 1-L holds up to 17 bytes = 136 bits in one image in byte mode. QR uses finder patterns, alignment patterns from Version 2 onward, and Reed-Solomon correction. The approximate L/M/Q/H values of 7/15/25/30% concern codewords, not guaranteed recovery of the same image area. Two-dimensional density is useful for practical screen transfers. See DENSO WAVE's [capacity reference](https://www.qrcode.com/en/about/version.html) and [error correction explanation](https://www.qrcode.com/en/about/error_correction.html).

## 🔄 Comparison with other air-gap channels

Each study uses different transmitters, receivers and conditions. Distances depend on laboratory conditions, line of sight and specific equipment; they are not performance claims for this tool. `B/s` means bytes per second; `bit/s` means bits per second. Mitigations are examples of restricting a channel, not guarantees of prevention.

| Method | Channel and receiver | Reported throughput | Reported distance | Example restriction and source |
|---|---|---|---|---|
| Photon Flicker Link | Screen → camera | mono 2–8 bit/s; color 6–24 bit/s (raw) | Awaiting owner testing | Block light; manage screen/camera placement. Calculated implementation rates |
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

- In an information-science class, compare `A` (1 byte, 23 s), `LIGHT` (5 bytes, 39 s), and `日本` (6 bytes, 43 s) to explore how UTF-8 byte count differs from character count. These are calculated monochrome durations at 2 symbol/s.
- In a communication-design lesson, compare 51 seconds for 8 monochrome bytes with 28.5 seconds in color to separate parallel-channel gains from calibration costs. Physical success also depends on color separation and ambient light.
- A video-production practitioner can move the measurement region within the emitter or include some background, then observe thresholds and confidence. Camera RGB values are relative; this is not a lux meter or colorimeter.
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
│   └── verification.md      # Results and physical-test checklist
└── test/                    # Automated verification
    ├── codec.test.js        # Pure functions and synthetic conditions
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
