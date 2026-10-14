# 🍿 DuoCinema - Synchronized Movie Watch Party with 2-Way Video Chat ❤️

A dedicated Python & WebRTC application designed for watching movies stored on your laptop together with your partner in real time, with synchronized playback, live 2-way video & audio webcam calls, floating reactions, and chat.

---

## ✨ Features

- **🚀 15GB–16GB Ultra-HD Video Optimized**:
  - **Smart 8MB Range Chunking**: Prevents multi-gigabyte files from blocking TCP sockets; enables instant sub-second seeking anywhere in a 16GB video.
  - **Asynchronous Disk Streaming (`aiofiles`)**: Non-blocking concurrent disk reads ensure zero stutter even when both viewers seek simultaneously.
  - **Adaptive Rate-Based Drift Smoothing**: Automatically micro-tunes playback speed (±5%) for minor time differences without freezing video decoder keyframes.
  - **Smart Buffer Lock**: Coordinates buffer stalls between host and partner so you never desync if one person experiences network buffering.
  - **Immutable Range Caching**: Disk-cached chunks mean rewinds and replays take 0ms with zero extra network load.
- **🎬 Local Video Streaming**: Stream any video stored on your laptop (`.mp4`, `.mkv`, `.webm`, `.mov`, `.m4v`) directly to both screens without needing to upload it to third-party services.
- **⚡ Perfect Playback Synchronization**:
  - Play, pause, seek, and playback speed stay synchronized in real time via WebSockets.
  - Automatic drift compensation ensures you both stay on the exact same frame.
- **📹 Two-Way Video & Audio Calls (WebRTC)**:
  - Real-time peer-to-peer webcam & microphone feed directly embedded alongside the movie.
  - Mic mute/unmute, camera on/off, partner volume control.
  - Picture-in-picture floating webcam: can be docked in the sidebar or dragged anywhere across the movie screen so it never blocks subtitles!
- **💖 Interactive Reactions & Live Chat**:
  - Send floating heart, popcorn, laughter, and kiss particles that fly across both screens simultaneously.
  - Built-in text chat with subtle audio chimes to whisper or comment without speaking over movie audio.
- **📂 Native Windows File Dialog**:
  - Host can click "Select Movie File" to open the standard Windows File Explorer and pick any video in seconds.
- **🌐 Works on Local Wi-Fi or Long Distance (Over the Internet)**:
  - Connect via local IP if you are on the same Wi-Fi.
  - Built-in Cloudflare Tunnel provides an instant, free, secure HTTPS link with QR Code so your girlfriend can join on her phone with camera & mic access with zero configuration!

---

## 🚀 Quick Start Guide

### 1. Launch the Application (Host)
On your Windows laptop:
- Simply double-click **`run.bat`** (or open a terminal in this folder and run:
  ```powershell
  .\.venv\Scripts\python.exe app.py
  ```
- Your default web browser will automatically open to `http://localhost:8000`.

### 2. Choose Your Movie
- Click **"📂 Select Movie File"** in the top navigation or center screen.
- The native Windows File Explorer will appear. Choose any `.mp4`, `.mkv`, or `.webm` movie file on your laptop.
- The movie will immediately load into the theater player!

### 3. Share with Your Partner

Click the **"🔗 Share Link"** button in the top bar:

- **If you are on the same Wi-Fi:**
  - Share the local network address shown in the modal (e.g. `http://192.168.1.12:8000`).
- **If you are watching long-distance (over the Internet):**
  - Double-click **`start_remote_tunnel.bat`**.
  - It will generate a free public HTTPS URL (like `https://random-words.trycloudflare.com`).
  - Send that link to your girlfriend! She can open it in any browser (Chrome, Edge, Safari on iPhone/Mac) without installing anything.
  - *Note: Web browsers require HTTPS for camera/mic access over the internet, which Cloudflare Tunnel provides for free automatically!*

### 4. Start the Video Call
- When she opens the link, both of you can click **"Connect Cam"** to enable your webcams and microphones.
- Hit **Play** on the movie, grab some popcorn, and enjoy your movie night together! 🍿✨

---

## ⌨️ Player Shortcuts

| Key | Action |
|---|---|
| **Space** | Play / Pause |
| **← / →** | Rewind / Fast Forward 10 seconds |
| **F** | Toggle Fullscreen |
| **M** | Mute / Unmute Movie Audio |
| **📌 Button** | Detach FaceCam to float & drag over the movie |

---

## 📁 Project Structure

```
movie_watch_party/
├── app.py                     # FastAPI WebSocket & REST backend
├── streaming.py               # RFC 7233 HTTP 206 Partial Content byte-range streamer
├── config.py                  # Network discovery and WebRTC STUN configuration
├── run.bat                    # 1-click Windows launcher
├── start_remote_tunnel.bat    # 1-click Cloudflare HTTPS tunnel for remote viewing
├── requirements.txt           # Python dependencies
├── templates/
│   └── index.html             # Watch party theater web interface
└── static/
    ├── css/
    │   └── style.css          # Dark cinema styling & animations
    └── js/
        ├── app.js             # Main orchestrator & UI handlers
        ├── player.js          # Synchronized video player controller
        ├── webrtc.js          # Peer-to-peer webcam & audio call manager
        └── chat.js            # Live chat & floating particle reactions
```
