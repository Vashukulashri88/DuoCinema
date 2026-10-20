import os
import sys
import subprocess
import json
import asyncio
import time
import concurrent.futures
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Dict, Optional, Set

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request, HTTPException, Response
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from config import BASE_DIR, get_local_ip, ICE_SERVERS, SUPPORTED_EXTENSIONS
from streaming import range_stream_response
from tunnel import tunnel_manager

# Thread pool for background tasks
executor = concurrent.futures.ThreadPoolExecutor(max_workers=3)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Attempt to auto-start cloudflared tunnel in background thread
    loop = asyncio.get_event_loop()
    loop.run_in_executor(executor, tunnel_manager.start)
    yield
    tunnel_manager.stop()

app = FastAPI(title="DuoCinema - Movie Watch Party", lifespan=lifespan)

# Directories
STATIC_DIR = BASE_DIR / "static"
TEMPLATES_DIR = BASE_DIR / "templates"

STATIC_DIR.mkdir(parents=True, exist_ok=True)
(STATIC_DIR / "css").mkdir(parents=True, exist_ok=True)
(STATIC_DIR / "js").mkdir(parents=True, exist_ok=True)
TEMPLATES_DIR.mkdir(parents=True, exist_ok=True)

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))

def extract_youtube_id(url: str) -> Optional[str]:
    """Extracts the 11-character YouTube video ID from various link formats."""
    import re
    url = url.strip()
    if len(url) == 11 and re.match(r"^[a-zA-Z0-9_-]{11}$", url):
        return url
    patterns = [
        r"(?:v=|\/v\/|youtu\.be\/|\/embed\/|\/shorts\/)([a-zA-Z0-9_-]{11})",
        r"(?:watch\?.*v=)([a-zA-Z0-9_-]{11})",
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    return None

class WatchPartyState:
    def __init__(self):
        self.media_type: str = "local"  # "local" or "youtube"
        self.video_path: Optional[str] = None
        self.video_name: str = "No media loaded"
        self.video_size_mb: float = 0.0
        self.youtube_id: Optional[str] = None
        self.player_status: str = "paused"  # "playing" or "paused"
        self.current_time: float = 0.0
        self.playback_rate: float = 1.0
        self.last_update_ts: float = time.time()
        self.host_client_id: Optional[str] = None
        
        # Connected clients: client_id -> {"ws": WebSocket, "name": str, "is_host": bool}
        self.clients: Dict[str, dict] = {}

    def get_estimated_time(self) -> float:
        if self.player_status == "playing":
            delta = time.time() - self.last_update_ts
            return self.current_time + (delta * self.playback_rate)
        return self.current_time

    def set_video(self, file_path: str):
        if not os.path.isfile(file_path):
            raise FileNotFoundError("Video file does not exist")
        self.media_type = "local"
        self.youtube_id = None
        self.video_path = str(file_path)
        self.video_name = os.path.basename(file_path)
        self.video_size_mb = round(os.path.getsize(file_path) / (1024 * 1024), 2)
        self.current_time = 0.0
        self.player_status = "paused"
        self.last_update_ts = time.time()

    def set_youtube(self, video_id: str, title: Optional[str] = None):
        self.media_type = "youtube"
        self.youtube_id = video_id
        self.video_name = title or f"YouTube ({video_id})"
        self.video_size_mb = 0.0
        self.current_time = 0.0
        self.player_status = "paused"
        self.last_update_ts = time.time()

state = WatchPartyState()

def open_windows_file_dialog() -> Optional[str]:
    """Runs a Windows native file dialog in an isolated process to avoid Tkinter thread affinity issues."""
    try:
        script_path = BASE_DIR / "file_dialog.py"
        res = subprocess.run(
            [sys.executable, str(script_path)],
            capture_output=True,
            text=True,
            timeout=180
        )
        selected = res.stdout.strip()
        if selected and os.path.isfile(selected):
            return selected
        return None
    except Exception as e:
        print(f"File dialog error: {e}")
        return None

async def broadcast(message: dict, exclude_client_id: Optional[str] = None):
    """Broadcast JSON message to all connected clients."""
    payload = json.dumps(message)
    dead_clients = []
    for cid, client in list(state.clients.items()):
        if exclude_client_id and cid == exclude_client_id:
            continue
        try:
            await client["ws"].send_text(payload)
        except Exception:
            dead_clients.append(cid)
    
    for cid in dead_clients:
        state.clients.pop(cid, None)

@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    return Response(status_code=204)

@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    local_ip = get_local_ip()
    port = 8000
    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={
            "local_ip": local_ip,
            "port": port,
            "tunnel_url": tunnel_manager.public_url or "",
            "ice_servers": json.dumps(ICE_SERVERS),
        }
    )

@app.get("/api/status")
async def get_status():
    return {
        "local_ip": get_local_ip(),
        "tunnel_url": tunnel_manager.public_url,
        "media_type": state.media_type,
        "youtube_id": state.youtube_id,
        "video_selected": (state.media_type == "local" and state.video_path is not None) or (state.media_type == "youtube" and state.youtube_id is not None),
        "video_name": state.video_name,
        "video_size_mb": state.video_size_mb,
        "player_status": state.player_status,
        "current_time": state.get_estimated_time(),
        "playback_rate": state.playback_rate,
        "host_id": state.host_client_id,
        "connected_users": [
            {"id": cid, "name": c["name"], "is_host": (cid == state.host_client_id)}
            for cid, c in state.clients.items()
        ]
    }

@app.post("/api/set-youtube-url")
async def set_youtube_url(payload: dict):
    url = payload.get("url", "").strip()
    if not url:
        raise HTTPException(status_code=400, detail="No YouTube URL provided")
    
    video_id = extract_youtube_id(url)
    if not video_id:
        raise HTTPException(status_code=400, detail="Invalid YouTube URL or Video ID")
    
    title = payload.get("title") or f"YouTube ({video_id})"
    state.set_youtube(video_id, title)
    
    await broadcast({
        "type": "media_mode_changed",
        "media_type": "youtube",
        "youtube_id": video_id,
        "video_name": state.video_name,
        "currentTime": 0.0
    })
    return {"success": True, "video_id": video_id, "title": state.video_name}

@app.post("/api/tunnel/start")
async def start_tunnel_endpoint():
    loop = asyncio.get_event_loop()
    url = await loop.run_in_executor(executor, tunnel_manager.start)
    if url:
        await broadcast({"type": "tunnel_ready", "url": url})
        return {"success": True, "url": url}
    return {"success": False, "message": "Failed to create Cloudflare tunnel"}

@app.get("/api/tunnel/status")
async def tunnel_status_endpoint():
    return {"url": tunnel_manager.public_url, "running": tunnel_manager.is_running}

@app.post("/api/select-file-dialog")
async def select_file_dialog():
    """Triggers the native Windows File Picker dialog on the host PC."""
    loop = asyncio.get_event_loop()
    selected = await loop.run_in_executor(executor, open_windows_file_dialog)
    if selected and os.path.exists(selected):
        state.set_video(selected)
        await broadcast({
            "type": "media_mode_changed",
            "media_type": "local",
            "video_name": state.video_name,
            "video_size_mb": state.video_size_mb,
            "currentTime": 0.0
        })
        return {"success": True, "path": selected, "name": state.video_name}
    return {"success": False, "message": "No file chosen"}

@app.post("/api/set-video-path")
async def set_video_path(payload: dict):
    path = payload.get("path")
    if not path or not os.path.exists(path):
        raise HTTPException(status_code=400, detail="File path does not exist on host")
    state.set_video(path)
    await broadcast({
        "type": "media_mode_changed",
        "media_type": "local",
        "video_name": state.video_name,
        "video_size_mb": state.video_size_mb,
        "currentTime": 0.0
    })
    return {"success": True, "name": state.video_name}

@app.get("/api/video/stream")
async def stream_video(request: Request):
    if not state.video_path or not os.path.exists(state.video_path):
        raise HTTPException(status_code=404, detail="No video loaded on the host yet")
    return range_stream_response(request, state.video_path)

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    client_id = f"user_{int(time.time() * 1000) % 100000}"
    client_name = "Guest"

    try:
        # Initial greeting & receive client info
        init_data = await websocket.receive_text()
        parsed = json.loads(init_data)
        client_name = parsed.get("name", f"User {client_id[-4:]}")

        # Deterministic Host allocation: first connected client is host
        if state.host_client_id is None:
            state.host_client_id = client_id
            is_host = True
        else:
            is_host = False

        state.clients[client_id] = {
            "ws": websocket,
            "name": client_name,
            "is_host": is_host
        }

        # Send current room state to newly joined client
        await websocket.send_text(json.dumps({
            "type": "room_state",
            "your_id": client_id,
            "is_host": is_host,
            "host_id": state.host_client_id,
            "tunnel_url": tunnel_manager.public_url,
            "media_type": state.media_type,
            "youtube_id": state.youtube_id,
            "video_name": state.video_name,
            "video_selected": (state.media_type == "local" and state.video_path is not None) or (state.media_type == "youtube" and state.youtube_id is not None),
            "player_status": state.player_status,
            "currentTime": state.get_estimated_time(),
            "playback_rate": state.playback_rate,
            "users": [
                {"id": cid, "name": c["name"], "is_host": (cid == state.host_client_id)}
                for cid, c in state.clients.items()
            ]
        }))

        # Notify other clients of user joined
        await broadcast({
            "type": "user_joined",
            "id": client_id,
            "name": client_name,
            "is_host": is_host,
            "users": [
                {"id": cid, "name": c["name"], "is_host": (cid == state.host_client_id)}
                for cid, c in state.clients.items()
            ]
        }, exclude_client_id=client_id)

        # Message processing loop
        while True:
            data = await websocket.receive_text()
            msg = json.loads(data)
            msg_type = msg.get("type")

            if msg_type == "player_action":
                action = msg.get("action")
                current_time = float(msg.get("currentTime", 0.0))
                state.current_time = current_time
                state.last_update_ts = time.time()
                
                if action == "play":
                    state.player_status = "playing"
                elif action == "pause":
                    state.player_status = "paused"
                
                await broadcast({
                    "type": "player_action",
                    "action": action,
                    "currentTime": current_time,
                    "sender": client_name
                }, exclude_client_id=client_id)

            elif msg_type == "player_sync_heartbeat":
                c_time = float(msg.get("currentTime", 0.0))
                p_status = msg.get("status", state.player_status)
                state.current_time = c_time
                state.player_status = p_status
                state.last_update_ts = time.time()
                
                await broadcast({
                    "type": "player_sync_heartbeat",
                    "currentTime": c_time,
                    "status": p_status
                }, exclude_client_id=client_id)

            elif msg_type == "player_rate":
                rate = float(msg.get("rate", 1.0))
                state.playback_rate = rate
                await broadcast({
                    "type": "player_rate",
                    "rate": rate,
                    "sender": client_name
                }, exclude_client_id=client_id)

            elif msg_type in ("player_buffer_wait", "player_buffer_ready"):
                await broadcast({
                    "type": msg_type,
                    "currentTime": msg.get("currentTime", state.current_time),
                    "sender": client_name
                }, exclude_client_id=client_id)

            elif msg_type in ("webrtc_offer", "webrtc_answer", "webrtc_candidate", "webrtc_ready"):
                # Forward WebRTC signaling to peer
                target_id = msg.get("target")
                if target_id and target_id in state.clients:
                    await state.clients[target_id]["ws"].send_text(json.dumps({
                        "type": msg_type,
                        "sender_id": client_id,
                        "data": msg.get("data")
                    }))
                else:
                    await broadcast({
                        "type": msg_type,
                        "sender_id": client_id,
                        "data": msg.get("data")
                    }, exclude_client_id=client_id)

            elif msg_type == "chat_message":
                text = msg.get("text", "").strip()
                if text:
                    await broadcast({
                        "type": "chat_message",
                        "sender": client_name,
                        "sender_id": client_id,
                        "text": text,
                        "time": time.strftime("%H:%M")
                    })

            elif msg_type == "reaction":
                emoji = msg.get("emoji", "❤️")
                await broadcast({
                    "type": "reaction",
                    "emoji": emoji,
                    "sender": client_name
                })

    except WebSocketDisconnect:
        was_host = (client_id == state.host_client_id)
        state.clients.pop(client_id, None)
        
        if was_host:
            # Reassign host to next available client
            if state.clients:
                state.host_client_id = next(iter(state.clients))
            else:
                state.host_client_id = None

        await broadcast({
            "type": "user_left",
            "id": client_id,
            "name": client_name,
            "new_host_id": state.host_client_id,
            "users": [
                {"id": cid, "name": c["name"], "is_host": (cid == state.host_client_id)}
                for cid, c in state.clients.items()
            ]
        })
    except Exception as e:
        print(f"WebSocket error for {client_id}: {e}")
        state.clients.pop(client_id, None)

if __name__ == "__main__":
    import uvicorn
    local_ip = get_local_ip()
    print("=" * 65)
    print("🎬 DuoCinema - Movie Watch Party with Video Call")
    print("=" * 65)
    print(f"👉 Local Host URL:           http://localhost:8000")
    print(f"👉 Local Wi-Fi URL:          http://{local_ip}:8000")
    print("=" * 65)
    print("Starting server...")
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=False)
