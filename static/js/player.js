/**
 * High-Performance Synchronized Video Player Controller for DuoCinema
 * Specially optimized for massive 15GB-16GB 1080p/4K high-bitrate videos:
 * - Adaptive rate-based drift smoothing (no-stutter catchup)
 * - Smart Buffer Lock (prevents desync during buffer stalls)
 * - Sub-second seeking & progressive buffer visualization
 */

class PlayerController {
    constructor(wsSendCallback) {
        this.wsSend = wsSendCallback;
        this.video = document.getElementById("sharedVideo");
        this.videoWrapper = document.getElementById("videoWrapper");
        this.playerControls = document.getElementById("playerControls");
        this.progressBarContainer = document.getElementById("progressBarContainer");
        this.progressPlayed = document.getElementById("progressPlayed");
        this.progressBuffered = document.getElementById("progressBuffered");
        this.progressHoverTime = document.getElementById("progressHoverTime");
        
        this.btnPlayPause = document.getElementById("btnPlayPause");
        this.playPauseIcon = document.getElementById("playPauseIcon");
        this.btnRewind = document.getElementById("btnRewind");
        this.btnForward = document.getElementById("btnForward");
        this.currentTimeDisplay = document.getElementById("currentTimeDisplay");
        this.durationDisplay = document.getElementById("durationDisplay");
        this.btnMuteMovie = document.getElementById("btnMuteMovie");
        this.volumeIcon = document.getElementById("volumeIcon");
        this.movieVolume = document.getElementById("movieVolume");
        this.playbackSpeed = document.getElementById("playbackSpeed");
        this.btnFullscreen = document.getElementById("btnFullscreen");
        this.btnSyncNow = document.getElementById("btnSyncNow");

        this.syncIndicator = document.getElementById("syncIndicator");

        this.isRemoteUpdate = false;
        this.isSeeking = false;
        this.isBuffering = false;
        this.partnerBuffering = false;
        this.controlsTimeout = null;
        this.heartbeatInterval = null;
        this.basePlaybackRate = 1.0;
        this.isSmoothCatchingUp = false;

        this.initBufferIndicator();
        this.bindEvents();
        this.bindKeyboardShortcuts();
        this.startHeartbeat();
    }

    initBufferIndicator() {
        // Create an overlay badge for HD buffering status
        this.bufferBadge = document.createElement("div");
        this.bufferBadge.className = "buffer-badge";
        this.bufferBadge.innerHTML = `<span class="spinner">⏳</span> <span class="buffer-text">Buffering HD Stream...</span>`;
        this.bufferBadge.style.display = "none";
        if (this.videoWrapper) {
            this.videoWrapper.appendChild(this.bufferBadge);
        }
    }

    bindEvents() {
        if (!this.video) return;

        // Video playback events
        this.video.addEventListener("play", () => {
            this.updatePlayPauseUI(true);
            if (!this.isRemoteUpdate && !this.partnerBuffering) {
                this.wsSend({
                    type: "player_action",
                    action: "play",
                    currentTime: this.video.currentTime
                });
            }
        });

        this.video.addEventListener("pause", () => {
            this.updatePlayPauseUI(false);
            if (!this.isRemoteUpdate && !this.isBuffering) {
                this.wsSend({
                    type: "player_action",
                    action: "pause",
                    currentTime: this.video.currentTime
                });
            }
        });

        this.video.addEventListener("timeupdate", () => {
            if (!this.isSeeking) {
                this.updateProgressBar();
            }
            this.updateBuffered();
        });

        this.video.addEventListener("loadedmetadata", () => {
            this.durationDisplay.innerText = this.formatTime(this.video.duration);
            this.showSyncFlash("16GB HD Stream Ready");
        });

        // Smart Buffer Coordination: when 15GB video buffers on network/disk
        this.video.addEventListener("waiting", () => {
            console.log("Local video buffering...");
            this.isBuffering = true;
            this.showBufferUI("Buffering HD video...", true);
            this.wsSend({
                type: "player_buffer_wait",
                currentTime: this.video.currentTime
            });
        });

        this.video.addEventListener("canplay", () => {
            if (this.isBuffering) {
                this.isBuffering = false;
                if (!this.partnerBuffering) {
                    this.showBufferUI("", false);
                }
                this.wsSend({
                    type: "player_buffer_ready",
                    currentTime: this.video.currentTime
                });
            }
        });

        this.video.addEventListener("playing", () => {
            this.isBuffering = false;
            if (!this.partnerBuffering) {
                this.showBufferUI("", false);
            }
        });

        // Controls clicks
        this.btnPlayPause.addEventListener("click", () => this.togglePlayPause());
        this.video.addEventListener("click", () => this.togglePlayPause());

        this.btnRewind.addEventListener("click", () => {
            this.seekRelative(-10);
        });

        this.btnForward.addEventListener("click", () => {
            this.seekRelative(10);
        });

        // Progress bar interaction
        this.progressBarContainer.addEventListener("click", (e) => this.handleProgressClick(e));
        this.progressBarContainer.addEventListener("mousemove", (e) => this.handleProgressHover(e));
        this.progressBarContainer.addEventListener("mouseleave", () => {
            this.progressHoverTime.style.display = "none";
        });

        // Volume
        this.movieVolume.addEventListener("input", (e) => {
            this.video.volume = parseFloat(e.target.value);
            this.video.muted = false;
            this.updateVolumeIcon();
        });

        this.btnMuteMovie.addEventListener("click", () => {
            this.video.muted = !this.video.muted;
            this.updateVolumeIcon();
        });

        // Speed
        this.playbackSpeed.addEventListener("change", (e) => {
            const rate = parseFloat(e.target.value);
            this.basePlaybackRate = rate;
            this.video.playbackRate = rate;
            if (!this.isRemoteUpdate) {
                this.wsSend({
                    type: "player_rate",
                    rate: rate
                });
            }
        });

        // Fullscreen
        this.btnFullscreen.addEventListener("click", () => this.toggleFullscreen());

        // Resync button
        if (this.btnSyncNow) {
            this.btnSyncNow.addEventListener("click", () => {
                this.showSyncFlash("Sync requested");
                this.wsSend({
                    type: "player_action",
                    action: this.video.paused ? "pause" : "play",
                    currentTime: this.video.currentTime
                });
            });
        }

        // Auto hide controls
        this.videoWrapper.addEventListener("mousemove", () => this.resetControlsVisibility());
        this.videoWrapper.addEventListener("mouseleave", () => {
            if (!this.video.paused) {
                this.playerControls.classList.remove("visible");
            }
        });
    }

    bindKeyboardShortcuts() {
        window.addEventListener("keydown", (e) => {
            if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;

            if (e.code === "Space") {
                e.preventDefault();
                this.togglePlayPause();
            } else if (e.code === "ArrowLeft") {
                e.preventDefault();
                this.seekRelative(-10);
            } else if (e.code === "ArrowRight") {
                e.preventDefault();
                this.seekRelative(10);
            } else if (e.code === "KeyF") {
                e.preventDefault();
                this.toggleFullscreen();
            } else if (e.code === "KeyM") {
                e.preventDefault();
                this.video.muted = !this.video.muted;
                this.updateVolumeIcon();
            }
        });
    }

    togglePlayPause() {
        if (this.video.paused) {
            this.video.play().catch(e => console.log("Autoplay policy:", e));
        } else {
            this.video.pause();
        }
    }

    seekRelative(seconds) {
        if (!this.video.duration) return;
        const target = Math.max(0, Math.min(this.video.duration, this.video.currentTime + seconds));
        this.seekTo(target);
    }

    seekTo(targetTime) {
        this.video.currentTime = targetTime;
        this.wsSend({
            type: "player_action",
            action: "seek",
            currentTime: targetTime
        });
    }

    handleProgressClick(e) {
        if (!this.video.duration) return;
        const rect = this.progressBarContainer.getBoundingClientRect();
        const pos = (e.clientX - rect.left) / rect.width;
        const targetTime = pos * this.video.duration;
        this.seekTo(targetTime);
    }

    handleProgressHover(e) {
        if (!this.video.duration) return;
        const rect = this.progressBarContainer.getBoundingClientRect();
        const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const hoverTime = pos * this.video.duration;
        this.progressHoverTime.innerText = this.formatTime(hoverTime);
        this.progressHoverTime.style.left = `${pos * 100}%`;
        this.progressHoverTime.style.display = "block";
    }

    updateProgressBar() {
        if (!this.video.duration) return;
        const percent = (this.video.currentTime / this.video.duration) * 100;
        this.progressPlayed.style.width = `${percent}%`;
        this.currentTimeDisplay.innerText = this.formatTime(this.video.currentTime);
    }

    updateBuffered() {
        if (!this.video.duration || this.video.buffered.length === 0) return;
        
        // Find buffer range covering current time
        const curTime = this.video.currentTime;
        let activeEnd = 0;
        for (let i = 0; i < this.video.buffered.length; i++) {
            if (this.video.buffered.start(i) <= curTime && curTime <= this.video.buffered.end(i)) {
                activeEnd = this.video.buffered.end(i);
                break;
            }
        }
        if (activeEnd === 0) {
            activeEnd = this.video.buffered.end(this.video.buffered.length - 1);
        }

        const percent = (activeEnd / this.video.duration) * 100;
        this.progressBuffered.style.width = `${percent}%`;

        // Calculate seconds ahead
        const aheadSec = Math.max(0, Math.round(activeEnd - curTime));
        if (aheadSec > 5 && this.syncIndicator) {
            const label = this.syncIndicator.querySelector(".sync-text");
            if (label && !this.syncIndicator.classList.contains("syncing")) {
                label.innerText = `Synced (+${aheadSec}s buf)`;
            }
        }
    }

    updatePlayPauseUI(isPlaying) {
        this.playPauseIcon.innerText = isPlaying ? "⏸️" : "▶️";
        if (isPlaying) {
            this.resetControlsVisibility();
        } else {
            this.playerControls.classList.add("visible");
        }
    }

    updateVolumeIcon() {
        if (this.video.muted || this.video.volume === 0) {
            this.volumeIcon.innerText = "🔇";
        } else if (this.video.volume < 0.5) {
            this.volumeIcon.innerText = "🔉";
        } else {
            this.volumeIcon.innerText = "🔊";
        }
    }

    resetControlsVisibility() {
        this.playerControls.classList.add("visible");
        clearTimeout(this.controlsTimeout);
        if (!this.video.paused) {
            this.controlsTimeout = setTimeout(() => {
                this.playerControls.classList.remove("visible");
            }, 3000);
        }
    }

    toggleFullscreen() {
        if (!document.fullscreenElement) {
            this.videoWrapper.requestFullscreen().catch(err => {
                console.error("Fullscreen error:", err);
            });
        } else {
            document.exitFullscreen();
        }
    }

    formatTime(seconds) {
        if (isNaN(seconds) || seconds < 0) return "00:00";
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        const mStr = String(m).padStart(2, "0");
        const sStr = String(s).padStart(2, "0");
        if (h > 0) {
            return `${h}:${mStr}:${sStr}`;
        }
        return `${mStr}:${sStr}`;
    }

    showSyncFlash(text) {
        if (this.syncIndicator) {
            this.syncIndicator.classList.add("syncing");
            const label = this.syncIndicator.querySelector(".sync-text");
            if (label) label.innerText = text;
            setTimeout(() => {
                this.syncIndicator.classList.remove("syncing");
                if (label) label.innerText = "Connected";
            }, 1800);
        }
    }

    showBufferUI(text, show) {
        if (!this.bufferBadge) return;
        if (show) {
            const span = this.bufferBadge.querySelector(".buffer-text");
            if (span) span.innerText = text;
            this.bufferBadge.style.display = "flex";
        } else {
            this.bufferBadge.style.display = "none";
        }
    }

    handleRemoteAction(message) {
        const { action, currentTime, rate } = message;

        this.isRemoteUpdate = true;

        if (action === "play") {
            if (currentTime !== undefined && Math.abs(this.video.currentTime - currentTime) > 1.2) {
                this.video.currentTime = currentTime;
            }
            this.video.play().catch(e => console.log("Play failed:", e));
            this.showSyncFlash("Playing");
        } else if (action === "pause") {
            if (currentTime !== undefined) {
                this.video.currentTime = currentTime;
            }
            this.video.pause();
            this.showSyncFlash("Paused");
        } else if (action === "seek") {
            if (currentTime !== undefined) {
                this.video.currentTime = currentTime;
                this.showSyncFlash("Seeked: " + this.formatTime(currentTime));
            }
        } else if (rate !== undefined) {
            this.basePlaybackRate = rate;
            this.video.playbackRate = rate;
            if (this.playbackSpeed) this.playbackSpeed.value = rate.toString();
        }

        setTimeout(() => {
            this.isRemoteUpdate = false;
        }, 500);
    }

    /**
     * Optimized 15GB Adaptive Drift Compensation:
     * - If drift is 0.4s - 2.5s: Micro-tunes playback speed (1.05x or 0.95x) to eliminate decoder frame-drop stutters.
     * - If drift is > 2.5s: Performs hard seek.
     */
    handleSyncHeartbeat(targetTime, status) {
        if (targetTime === undefined || isNaN(targetTime)) return;
        const diff = targetTime - this.video.currentTime;
        const absDiff = Math.abs(diff);

        if (absDiff > 2.5) {
            // Large jump: do hard seek
            console.log(`Large drift (${absDiff.toFixed(2)}s). Hard seeking to sync.`);
            this.isRemoteUpdate = true;
            this.video.currentTime = targetTime;
            if (status === "playing" && this.video.paused) {
                this.video.play().catch(e => console.log(e));
            } else if (status === "paused" && !this.video.paused) {
                this.video.pause();
            }
            this.showSyncFlash("Resynced");
            setTimeout(() => {
                this.isRemoteUpdate = false;
            }, 600);
        } else if (absDiff > 0.45 && !this.video.paused) {
            // Small drift in HD video: smooth micro-tuning without freezing frames
            if (diff > 0) {
                // We are behind: speed up slightly by 5%
                this.video.playbackRate = this.basePlaybackRate * 1.05;
                this.isSmoothCatchingUp = true;
            } else {
                // We are ahead: slow down slightly by 5%
                this.video.playbackRate = this.basePlaybackRate * 0.95;
                this.isSmoothCatchingUp = true;
            }
        } else if (this.isSmoothCatchingUp && absDiff <= 0.2) {
            // In lockstep: restore base playback speed
            this.video.playbackRate = this.basePlaybackRate;
            this.isSmoothCatchingUp = false;
        }
    }

    handlePartnerBuffering(isBuffering) {
        this.partnerBuffering = isBuffering;
        if (isBuffering) {
            this.showBufferUI("Partner is buffering 16GB video...", true);
            if (!this.video.paused) {
                this.video.pause();
            }
        } else {
            this.showBufferUI("", false);
            if (this.video.paused && !this.isBuffering) {
                this.video.play().catch(e => console.log(e));
            }
        }
    }

    startHeartbeat() {
        this.heartbeatInterval = setInterval(() => {
            if (!this.video.paused && !this.video.seeking && this.video.duration > 0 && !this.isBuffering) {
                this.wsSend({
                    type: "player_sync_heartbeat",
                    currentTime: this.video.currentTime,
                    status: "playing"
                });
            }
        }, 3500);
    }

    loadNewVideo(filename) {
        const source = document.getElementById("videoSource");
        source.src = `/api/video/stream?t=${Date.now()}`;
        this.video.load();
        this.video.currentTime = 0;
        this.showSyncFlash("HD Ready: " + filename);
    }
}

window.PlayerController = PlayerController;
