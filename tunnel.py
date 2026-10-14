import os
import re
import subprocess
import threading
import time
from typing import Optional

class TunnelManager:
    def __init__(self, port: int = 8000):
        self.port = port
        self.process: Optional[subprocess.Popen] = None
        self.public_url: Optional[str] = None
        self.is_running = False
        self._thread: Optional[threading.Thread] = None

    def start(self) -> Optional[str]:
        if self.is_running and self.public_url:
            return self.public_url

        cloudflared_path = os.path.join(os.path.dirname(__file__), "cloudflared.exe")
        if not os.path.exists(cloudflared_path):
            return None

        cmd = [cloudflared_path, "tunnel", "--url", f"http://127.0.0.1:{self.port}"]
        
        self.process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1
        )
        self.is_running = True

        # Wait up to 15 seconds to extract the URL
        url_pattern = re.compile(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com")
        start_time = time.time()
        
        for line in self.process.stdout:
            match = url_pattern.search(line)
            if match:
                self.public_url = match.group(0)
                break
            if time.time() - start_time > 20:
                break

        # Background thread to keep draining stdout so pipe doesn't block
        def drain():
            while self.is_running and self.process and self.process.poll() is None:
                try:
                    self.process.stdout.readline()
                except Exception:
                    break
        
        self._thread = threading.Thread(target=drain, daemon=True)
        self._thread.start()

        return self.public_url

    def stop(self):
        self.is_running = False
        if self.process:
            try:
                self.process.terminate()
            except Exception:
                pass
            self.process = None
        self.public_url = None

tunnel_manager = TunnelManager()
