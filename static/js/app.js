/**
 * Main Application Orchestrator for DuoCinema
 */

document.addEventListener("DOMContentLoaded", () => {
    let ws = null;
    let myName = localStorage.getItem("duo_cinema_name") || "";
    let isHost = false; // Assigned deterministically by server
    let myId = null;
    let currentTunnelUrl = (window.APP_CONFIG && window.APP_CONFIG.tunnelUrl) || "";

    // DOM Elements
    const displayUserName = document.getElementById("displayUserName");
    const currentMovieName = document.getElementById("currentMovieName");
    const noMovieOverlay = document.getElementById("noMovieOverlay");
    const btnSelectMovie = document.getElementById("btnSelectMovie");
    const btnSelectMovieEmpty = document.getElementById("btnSelectMovieEmpty");
    const manualPathInput = document.getElementById("manualPathInput");
    const btnLoadPath = document.getElementById("btnLoadPath");
    
    // Share modal elements
    const btnShareModal = document.getElementById("btnShareModal");
    const shareModal = document.getElementById("shareModal");
    const btnCloseShareModal = document.getElementById("btnCloseShareModal");
    const btnCopyLanLink = document.getElementById("btnCopyLanLink");
    const lanLinkInput = document.getElementById("lanLinkInput");
    const tunnelLinkInput = document.getElementById("tunnelLinkInput");
    const btnCopyTunnelLink = document.getElementById("btnCopyTunnelLink");
    const qrContainer = document.getElementById("qrContainer");
    const qrCodeImg = document.getElementById("qrCodeImg");

    // Name modal elements
    const nameModal = document.getElementById("nameModal");
    const userNameInput = document.getElementById("userNameInput");
    const btnSaveName = document.getElementById("btnSaveName");

    // Facecam dock elements
    const btnToggleCamDock = document.getElementById("btnToggleCamDock");
    const callCard = document.getElementById("callCard");
    const videoWrapper = document.getElementById("videoWrapper");

    // WebSocket send helper
    function wsSend(payload) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(payload));
        }
    }

    // Initialize Subsystems
    const webrtc = new WebRTCManager(wsSend);
    const player = new PlayerController(wsSend);
    const chat = new ChatManager(wsSend, () => myName);

    // Initial Name Setup
    if (!myName) {
        // If on localhost, default to Host
        if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
            myName = "Host";
            localStorage.setItem("duo_cinema_name", myName);
            displayUserName.innerText = myName;
            initWebSocket();
        } else {
            nameModal.classList.add("active");
            userNameInput.focus();
        }
    } else {
        displayUserName.innerText = myName;
        initWebSocket();
    }

    if (btnSaveName) {
        btnSaveName.addEventListener("click", () => {
            const entered = userNameInput.value.trim();
            if (entered) {
                myName = entered;
                localStorage.setItem("duo_cinema_name", myName);
                displayUserName.innerText = myName;
                nameModal.classList.remove("active");
                initWebSocket();
            }
        });
        userNameInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") btnSaveName.click();
        });
    }

    // Connect WebSocket
    function initWebSocket() {
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const wsUrl = `${protocol}//${window.location.host}/ws`;

        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            console.log("WebSocket connected!");
            ws.send(JSON.stringify({
                name: myName
            }));
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                handleServerMessage(data);
            } catch (err) {
                console.error("Failed to parse WS message:", err);
            }
        };

        ws.onclose = () => {
            console.warn("WebSocket disconnected. Reconnecting in 2s...");
            setTimeout(initWebSocket, 2000);
        };
    }

    function updateTunnelUI(url) {
        if (!url) return;
        currentTunnelUrl = url;
        if (tunnelLinkInput) tunnelLinkInput.value = url;
        if (qrCodeImg && qrContainer) {
            qrCodeImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(url)}`;
            qrContainer.style.display = "flex";
        }
    }

    // Check tunnel status periodically until ready
    function pollTunnelStatus() {
        if (currentTunnelUrl) {
            updateTunnelUI(currentTunnelUrl);
            return;
        }
        fetch("/api/tunnel/status")
            .then(r => r.json())
            .then(data => {
                if (data.url) {
                    updateTunnelUI(data.url);
                } else {
                    setTimeout(pollTunnelStatus, 2000);
                }
            })
            .catch(() => setTimeout(pollTunnelStatus, 3000));
    }
    pollTunnelStatus();

    function handleServerMessage(msg) {
        const { type } = msg;

        switch (type) {
            case "room_state":
                myId = msg.your_id;
                isHost = msg.is_host;
                if (isHost && !myName.includes("Host") && myName === "Guest") {
                    myName = "Host";
                    displayUserName.innerText = myName;
                }

                if (msg.tunnel_url) {
                    updateTunnelUI(msg.tunnel_url);
                }

                if (msg.video_selected) {
                    updateVideoInfo(msg.video_name, true);
                    player.loadNewVideo(msg.video_name);
                    if (msg.currentTime > 0) {
                        player.video.currentTime = msg.currentTime;
                    }
                    if (msg.player_status === "playing") {
                        player.video.play().catch(e => console.log(e));
                    }
                } else {
                    updateVideoInfo("No movie loaded", false);
                }
                chat.updateUserCount((msg.users && msg.users.length) || 1);
                break;

            case "tunnel_ready":
                updateTunnelUI(msg.url);
                break;

            case "user_joined":
                chat.handleIncomingMessage({
                    sender: "System",
                    text: `✨ ${msg.name} joined the watch party!`,
                    time: ""
                });
                chat.updateUserCount((msg.users && msg.users.length) || 1);

                // Deterministic call initiation: ONLY host creates the offer to avoid glare!
                if (isHost) {
                    console.log("Partner joined. Host initiating WebRTC call in 800ms...");
                    setTimeout(() => {
                        webrtc.startCallFlow();
                    }, 800);
                }
                break;

            case "user_left":
                chat.handleIncomingMessage({
                    sender: "System",
                    text: `👋 ${msg.name} disconnected.`,
                    time: ""
                });
                chat.updateUserCount((msg.users && msg.users.length) || 1);
                if (msg.new_host_id === myId) {
                    isHost = true;
                    console.log("Promoted to Host!");
                }
                break;

            case "video_loaded":
                updateVideoInfo(msg.video_name, true);
                player.loadNewVideo(msg.video_name);
                break;

            case "player_action":
            case "player_rate":
                player.handleRemoteAction(msg);
                break;

            case "player_sync_heartbeat":
                player.handleSyncHeartbeat(msg.currentTime, msg.status);
                break;

            case "player_buffer_wait":
                player.handlePartnerBuffering(true);
                break;

            case "player_buffer_ready":
                player.handlePartnerBuffering(false);
                break;

            case "webrtc_offer":
            case "webrtc_answer":
            case "webrtc_candidate":
                webrtc.handleSignal(msg);
                break;

            case "chat_message":
                chat.handleIncomingMessage(msg);
                break;

            case "reaction":
                chat.spawnReaction(msg.emoji);
                break;
        }
    }

    function updateVideoInfo(title, isLoaded) {
        if (currentMovieName) currentMovieName.innerText = title;
        if (noMovieOverlay) {
            noMovieOverlay.style.display = isLoaded ? "none" : "flex";
        }
    }

    // Trigger Native Windows File Dialog on Host
    async function triggerSelectFileDialog() {
        try {
            const resp = await fetch("/api/select-file-dialog", { method: "POST" });
            const result = await resp.json();
            if (result.success) {
                console.log("Loaded file:", result.name);
            }
        } catch (e) {
            console.error("Error triggering file dialog:", e);
            alert("Could not open file picker dialog. You can manually enter the file path below!");
        }
    }

    if (btnSelectMovie) btnSelectMovie.addEventListener("click", triggerSelectFileDialog);
    if (btnSelectMovieEmpty) btnSelectMovieEmpty.addEventListener("click", triggerSelectFileDialog);

    // Manual Path Loading
    if (btnLoadPath) {
        btnLoadPath.addEventListener("click", async () => {
            const path = manualPathInput.value.trim();
            if (!path) return;
            try {
                const resp = await fetch("/api/set-video-path", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ path })
                });
                const res = await resp.json();
                if (!res.success) {
                    alert(res.detail || "File not found on host machine");
                }
            } catch (e) {
                alert("Error loading file: " + e.message);
            }
        });
    }

    // Share Modal
    if (btnShareModal) {
        btnShareModal.addEventListener("click", () => shareModal.classList.add("active"));
    }
    if (btnCloseShareModal) {
        btnCloseShareModal.addEventListener("click", () => shareModal.classList.remove("active"));
    }
    shareModal.addEventListener("click", (e) => {
        if (e.target === shareModal) shareModal.classList.remove("active");
    });

    if (btnCopyLanLink) {
        btnCopyLanLink.addEventListener("click", () => {
            lanLinkInput.select();
            navigator.clipboard.writeText(lanLinkInput.value);
            btnCopyLanLink.innerText = "Copied! ✓";
            setTimeout(() => btnCopyLanLink.innerText = "Copy", 2000);
        });
    }

    if (btnCopyTunnelLink) {
        btnCopyTunnelLink.addEventListener("click", () => {
            if (tunnelLinkInput.value.startsWith("http")) {
                tunnelLinkInput.select();
                navigator.clipboard.writeText(tunnelLinkInput.value);
                btnCopyTunnelLink.innerText = "Copied! ✓";
                setTimeout(() => btnCopyTunnelLink.innerText = "Copy Link", 2000);
            } else {
                fetch("/api/tunnel/start", { method: "POST" })
                    .then(r => r.json())
                    .then(d => {
                        if (d.url) updateTunnelUI(d.url);
                    });
            }
        });
    }

    // Floating vs Docked Facecam Toggle & Dragging
    let isFloating = false;
    if (btnToggleCamDock) {
        btnToggleCamDock.addEventListener("click", () => {
            isFloating = !isFloating;
            if (isFloating) {
                videoWrapper.appendChild(callCard);
                callCard.classList.add("floating");
                btnToggleCamDock.innerText = "📍";
                btnToggleCamDock.title = "Dock in Sidebar";
            } else {
                const sidebar = document.getElementById("callSidebar");
                sidebar.insertBefore(callCard, sidebar.firstChild);
                callCard.classList.remove("floating");
                callCard.style.top = "";
                callCard.style.left = "";
                callCard.style.right = "";
                btnToggleCamDock.innerText = "📌";
                btnToggleCamDock.title = "Float over video";
            }
        });
    }

    // Drag floating FaceCam card
    let isDragging = false;
    let dragOffsetX = 0;
    let dragOffsetY = 0;

    callCard.addEventListener("mousedown", (e) => {
        if (!isFloating) return;
        if (e.target.closest("button") || e.target.closest("input")) return;
        isDragging = true;
        const rect = callCard.getBoundingClientRect();
        dragOffsetX = e.clientX - rect.left;
        dragOffsetY = e.clientY - rect.top;
    });

    window.addEventListener("mousemove", (e) => {
        if (!isDragging || !isFloating) return;
        const wrapperRect = videoWrapper.getBoundingClientRect();
        let newX = e.clientX - wrapperRect.left - dragOffsetX;
        let newY = e.clientY - wrapperRect.top - dragOffsetY;

        newX = Math.max(10, Math.min(newX, wrapperRect.width - callCard.offsetWidth - 10));
        newY = Math.max(10, Math.min(newY, wrapperRect.height - callCard.offsetHeight - 10));

        callCard.style.left = `${newX}px`;
        callCard.style.top = `${newY}px`;
        callCard.style.right = "auto";
    });

    window.addEventListener("mouseup", () => {
        isDragging = false;
    });
});
