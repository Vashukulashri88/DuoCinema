/**
 * Robust WebRTC Video & Audio Call Engine for DuoCinema
 * Handles peer-to-peer webcam & microphone connection with queueing and graceful fallbacks
 */

class WebRTCManager {
    constructor(wsSendCallback) {
        this.wsSend = wsSendCallback;
        this.localStream = null;
        this.remoteStream = null;
        this.peerConnection = null;
        this.isAudioMuted = false;
        this.isVideoMuted = false;
        this.iceCandidateQueue = [];
        this.isMakingOffer = false;
        
        // Ice configuration from window.APP_CONFIG
        this.iceServers = (window.APP_CONFIG && window.APP_CONFIG.iceServers) || [
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:stun1.l.google.com:19302" },
            { urls: "stun:stun.cloudflare.com:3478" }
        ];

        this.initDOMElements();
        this.initControls();
        this.checkSecureContext();
    }

    checkSecureContext() {
        if (!window.isSecureContext && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
            console.warn("Insecure context detected on remote device. getUserMedia requires HTTPS or localhost.");
            this.updateStatus("Needs HTTPS", "warning");
            if (this.partnerStatusText) {
                this.partnerStatusText.innerHTML = "Camera needs HTTPS.<br>Use the Cloudflare Link in 'Share Link'!";
            }
        }
    }

    initDOMElements() {
        this.localVideo = document.getElementById("localVideo");
        this.remoteVideo = document.getElementById("remoteVideo");
        this.localPlaceholder = document.getElementById("localPlaceholder");
        this.remotePlaceholder = document.getElementById("remotePlaceholder");
        this.partnerStatusText = document.getElementById("partnerStatusText");
        this.callStatusBadge = document.getElementById("callStatusBadge");
        
        this.btnToggleMic = document.getElementById("btnToggleMic");
        this.btnToggleCam = document.getElementById("btnToggleCam");
        this.btnStartCall = document.getElementById("btnStartCall");
        this.partnerVolume = document.getElementById("partnerVolume");
    }

    initControls() {
        if (this.btnToggleMic) {
            this.btnToggleMic.addEventListener("click", () => this.toggleMicrophone());
        }
        if (this.btnToggleCam) {
            this.btnToggleCam.addEventListener("click", () => this.toggleCamera());
        }
        if (this.btnStartCall) {
            this.btnStartCall.addEventListener("click", () => this.startCallFlow());
        }
        if (this.partnerVolume) {
            this.partnerVolume.addEventListener("input", (e) => {
                if (this.remoteVideo) {
                    this.remoteVideo.volume = parseFloat(e.target.value);
                }
            });
        }
    }

    async getMediaPermissions() {
        if (this.localStream) return this.localStream;
        
        // Check if mediaDevices is available (requires HTTPS on mobile)
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            console.warn("navigator.mediaDevices.getUserMedia is unavailable in this environment.");
            this.updateStatus("No Cam (Use HTTPS)", "error");
            return null;
        }

        try {
            this.updateStatus("Accessing cam/mic...", "connecting");
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: 640 },
                    height: { ideal: 480 },
                    facingMode: "user"
                },
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });

            this.localStream = stream;
            if (this.localVideo) {
                this.localVideo.srcObject = stream;
                this.localPlaceholder.style.display = "none";
            }
            this.updateStatus("Cam Ready", "ready");

            // If peerConnection already exists, add local tracks
            if (this.peerConnection) {
                stream.getTracks().forEach((track) => {
                    this.peerConnection.addTrack(track, stream);
                });
            }

            return stream;
        } catch (err) {
            console.warn("Could not obtain camera/microphone:", err);
            this.updateStatus("Cam Blocked", "error");
            return null;
        }
    }

    createPeerConnection() {
        if (this.peerConnection) {
            return this.peerConnection;
        }

        console.log("Creating RTCPeerConnection with STUN servers...");
        const pc = new RTCPeerConnection({ iceServers: this.iceServers });

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                this.wsSend({
                    type: "webrtc_candidate",
                    data: event.candidate
                });
            }
        };

        pc.ontrack = (event) => {
            console.log("WebRTC received remote track:", event.track.kind);
            if (!this.remoteStream) {
                this.remoteStream = new MediaStream();
            }
            
            if (event.streams && event.streams[0]) {
                this.remoteStream = event.streams[0];
            } else {
                this.remoteStream.addTrack(event.track);
            }

            if (this.remoteVideo) {
                this.remoteVideo.srcObject = this.remoteStream;
                this.remoteVideo.play().catch(e => console.log("Remote play err:", e));
                this.remotePlaceholder.style.display = "none";
                this.partnerStatusText.innerText = "Connected";
                this.updateStatus("In Call ❤️", "connected");
            }
        };

        pc.onconnectionstatechange = () => {
            console.log("WebRTC Connection state:", pc.connectionState);
            if (pc.connectionState === "connected") {
                this.updateStatus("In Call ❤️", "connected");
                if (this.remotePlaceholder) this.remotePlaceholder.style.display = "none";
            } else if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
                this.updateStatus("Disconnected", "error");
                if (this.remotePlaceholder) this.remotePlaceholder.style.display = "flex";
                if (this.partnerStatusText) this.partnerStatusText.innerText = "Call disconnected";
            }
        };

        // Attach local tracks if available, otherwise prepare recv transceivers so remote stream still renders!
        if (this.localStream) {
            this.localStream.getTracks().forEach((track) => {
                pc.addTrack(track, this.localStream);
            });
        } else {
            pc.addTransceiver("video", { direction: "recvonly" });
            pc.addTransceiver("audio", { direction: "recvonly" });
        }

        this.peerConnection = pc;
        return pc;
    }

    async startCallFlow() {
        if (this.isMakingOffer) return;
        this.isMakingOffer = true;

        await this.getMediaPermissions();
        const pc = this.createPeerConnection();

        try {
            this.updateStatus("Calling...", "connecting");
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            this.wsSend({
                type: "webrtc_offer",
                data: offer
            });
        } catch (err) {
            console.error("Error creating WebRTC offer:", err);
        } finally {
            this.isMakingOffer = false;
        }
    }

    async handleSignal(message) {
        const { type, data, sender_id } = message;

        if (type === "webrtc_offer") {
            console.log("Received WebRTC offer from peer");
            // Answer flow
            await this.getMediaPermissions();
            const pc = this.createPeerConnection();

            try {
                await pc.setRemoteDescription(new RTCSessionDescription(data));
                
                // Flush queued candidates
                await this.flushQueuedCandidates();

                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);

                this.wsSend({
                    type: "webrtc_answer",
                    target: sender_id,
                    data: answer
                });
            } catch (err) {
                console.error("Error answering WebRTC offer:", err);
            }
        } else if (type === "webrtc_answer") {
            console.log("Received WebRTC answer from peer");
            if (this.peerConnection) {
                try {
                    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(data));
                    await this.flushQueuedCandidates();
                } catch (err) {
                    console.error("Error setting remote description from answer:", err);
                }
            }
        } else if (type === "webrtc_candidate") {
            if (data) {
                if (this.peerConnection && this.peerConnection.remoteDescription && this.peerConnection.remoteDescription.type) {
                    try {
                        await this.peerConnection.addIceCandidate(new RTCIceCandidate(data));
                    } catch (err) {
                        console.error("Error adding ICE candidate:", err);
                    }
                } else {
                    // Queue until remote description is set
                    this.iceCandidateQueue.push(data);
                }
            }
        }
    }

    async flushQueuedCandidates() {
        if (!this.peerConnection) return;
        while (this.iceCandidateQueue.length > 0) {
            const cand = this.iceCandidateQueue.shift();
            try {
                await this.peerConnection.addIceCandidate(new RTCIceCandidate(cand));
            } catch (e) {
                console.warn("Error adding queued candidate:", e);
            }
        }
    }

    toggleMicrophone() {
        if (!this.localStream) {
            this.getMediaPermissions().then(() => this.toggleMicrophone());
            return;
        }
        const audioTrack = this.localStream.getAudioTracks()[0];
        if (audioTrack) {
            this.isAudioMuted = !this.isAudioMuted;
            audioTrack.enabled = !this.isAudioMuted;
            
            if (this.btnToggleMic) {
                const label = this.btnToggleMic.querySelector(".btn-label");
                if (this.isAudioMuted) {
                    this.btnToggleMic.classList.remove("active");
                    this.btnToggleMic.classList.add("muted");
                    if (label) label.innerText = "Mic Off";
                } else {
                    this.btnToggleMic.classList.remove("muted");
                    this.btnToggleMic.classList.add("active");
                    if (label) label.innerText = "Mic On";
                }
            }
        }
    }

    toggleCamera() {
        if (!this.localStream) {
            this.getMediaPermissions().then(() => this.toggleCamera());
            return;
        }
        const videoTrack = this.localStream.getVideoTracks()[0];
        if (videoTrack) {
            this.isVideoMuted = !this.isVideoMuted;
            videoTrack.enabled = !this.isVideoMuted;
            
            if (this.btnToggleCam) {
                const label = this.btnToggleCam.querySelector(".btn-label");
                if (this.isVideoMuted) {
                    this.btnToggleCam.classList.remove("active");
                    this.btnToggleCam.classList.add("muted");
                    if (label) label.innerText = "Cam Off";
                } else {
                    this.btnToggleCam.classList.remove("muted");
                    this.btnToggleCam.classList.add("active");
                    if (label) label.innerText = "Cam On";
                }
            }
            if (this.localPlaceholder) {
                this.localPlaceholder.style.display = this.isVideoMuted ? "flex" : "none";
            }
        }
    }

    updateStatus(text, state) {
        if (this.callStatusBadge) {
            this.callStatusBadge.innerText = text;
            this.callStatusBadge.className = `call-badge status-${state}`;
        }
    }
}

window.WebRTCManager = WebRTCManager;
