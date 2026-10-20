/**
 * High-Performance Synchronized Video Player Controller for DuoCinema
 * Supports both:
 * 1. Massive 15GB-16GB 1080p/4K Local Movie Files (RFC 7233 Range Streaming & Buffer Lock)
 * 2. Real-Time Synchronized YouTube Video Streaming via YouTube IFrame Player API
 */

class PlayerController {
    constructor(wsSendCallback) {
        this.wsSend = wsSendCallback;
        this.video = document.getElementById("sharedVideo");
        this.videoWrapper = document.getElementById("videoWrapper");
        this.youtubeContainer = document.getElementById("youtubeContainer");
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

        // Media modes: "local" or "youtube"
        this.mediaMode = "local";
        this.ytPlayer = null;
        this.ytReady = false;
        this.pendingYoutube = null;

        this.isRemoteUpdate = false;
        this.isSeeking = false;
        this.isBuffering = false;
        this.partnerBuffering = false;
        this.controlsTimeout = null;
        this.heartbeatInterval = null;
        this.basePlaybackRate = 1.0;
        this.isSmoothCatchingUp = false;

        this.initBufferIndicator();
        this.initYouTubeAPI();
        this.bindEvents();
        this.bindKeyboardShortcuts();
        this.startHeartbeat();
    }

    initBufferIndicator() {
        this.bufferBadge = document.createElement("div");
        this.bufferBadge.className = "buffer-badge";
        this.bufferBadge.innerHTML = `<span class="spinner">⏳</span> <span class="buffer-text">Buffering Stream...</span>`;
        this.bufferBadge.style.display = "none";
        if (this.videoWrapper) {
            this.videoWrapper.appendChild(this.bufferBadge);
        }
    }

    initYouTubeAPI() {
        window.onYouTubeIframeAPIReady = () => {
            console.log("YouTube IFrame API Ready");
            this.ytReady = true;
            if (this.pendingYoutube) {
                const { videoId, startTime, autoPlay } = this.pendingYoutube;
                this.pendingYoutube = null;
                this.loadYoutubeVideo(videoId, startTime, autoPlay);
            }
        };

        if (window.YT && window.YT.Player) {
            this.ytReady = true;
        }
    }

    loadYoutubeVideo(videoId, startTime = 0, autoPlay = false) {
        this.mediaMode = "youtube";

        // Hide and pause local video
        if (this.video) {
            this.video.pause();
            this.video.style.display = "none";
        }
        if (this.youtubeContainer) {
            this.youtubeContainer.style.display = "block";
        }

        // Hide empty state overlay
        const noMovieOverlay = document.getElementById("noMovieOverlay");
        if (noMovieOverlay) noMovieOverlay.style.display = "none";

        if (!this.ytReady || !window.YT || !window.YT.Player) {
            console.log("YouTube API not ready yet, queuing video:", videoId);
            this.pendingYoutube = { videoId, startTime, autoPlay };
            return;
        }

        if (!this.ytPlayer) {
            console.log("Instantiating YT.Player for video:", videoId);
            this.ytPlayer = new YT.Player('youtubePlayer', {
                videoId: videoId,
                playerVars: {
                    autoplay: autoPlay ? 1 : 0,
                    start: Math.floor(startTime),
                    controls: 1,
                    rel: 0,
                    modestbranding: 1,
                    enablejsapi: 1,
                    origin: window.location.origin
                },
                events: {
                    onReady: (event) => {
                        console.log("YouTube Player is ready");
                        if (startTime > 0) {
                            event.target.seekTo(startTime, true);
                        }
                        if (autoPlay) {
                            event.target.playVideo();
                        }
                    },
                    onStateChange: (event) => this.onYouTubeStateChange(event)
                }
            });
        } else {
            console.log("Loading new video into existing YT.Player:", videoId);
            this.isRemoteUpdate = true;
            if (autoPlay) {
                this.ytPlayer.loadVideoById({ videoId: videoId, startSeconds: startTime });
            } else {
                this.ytPlayer.cueVideoById({ videoId: videoId, startSeconds: startTime });
            }
            setTimeout(() => { this.isRemoteUpdate = false; }, 800);
        }

        this.showSyncFlash("YouTube Ready: " + videoId);
    }

    onYouTubeStateChange(event) {
        if (this.isRemoteUpdate) return;

        // YT.PlayerState: PLAYING=1, PAUSED=2
        if (event.data === YT.PlayerState.PLAYING) {
            this.updatePlayPauseUI(true);
            const curTime = this.ytPlayer.getCurrentTime();
            this.wsSend({
                type: "player_action",
                action: "play",
                currentTime: curTime
            });
        } else if (event.data === YT.PlayerState.PAUSED) {
            this.updatePlayPauseUI(false);
            const curTime = this.ytPlayer.getCurrentTime();
            this.wsSend({
                type: "player_action",
                action: "pause",
                currentTime: curTime
            });
        }
    }

    bindEvents() {
        if (!this.video) return;

        // Video playback events for local movie
        this.video.addEventListener("play", () => {
            if (this.mediaMode !== "local") return;
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
            if (this.mediaMode !== "local") return;
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
            if (this.mediaMode !== "local") return;
            if (!this.isSeeking) {
                this.updateProgressBar();
            }
            this.updateBuffered();
        });

        this.video.addEventListener("loadedmetadata", () => {
            if (this.mediaMode !== "local") return;
            this.durationDisplay.innerText = this.formatTime(this.video.duration);
            this.showSyncFlash("16GB HD Stream Ready");
        });

        this.video.addEventListener("waiting", () => {
            if (this.mediaMode !== "local") return;
            console.log("Local video buffering...");
            this.isBuffering = true;
            this.showBufferUI("Buffering HD video...", true);
            this.wsSend({
                type: "player_buffer_wait",
                currentTime: this.video.currentTime
            });
        });

        this.video.addEventListener("canplay", () => {
            if (this.mediaMode !== "local") return;
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
            if (this.mediaMode !== "local") return;
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
            const vol = parseFloat(e.target.value);
            this.video.volume = vol;
            this.video.muted = false;
            if (this.ytPlayer && typeof this.ytPlayer.setVolume === "function") {
                this.ytPlayer.setVolume(vol * 100);
                this.ytPlayer.unMute();
            }
            this.updateVolumeIcon();
        });

        this.btnMuteMovie.addEventListener("click", () => {
            this.video.muted = !this.video.muted;
            if (this.ytPlayer && typeof this.ytPlayer.isMuted === "function") {
                if (this.ytPlayer.isMuted()) this.ytPlayer.unMute();
                else this.ytPlayer.mute();
            }
            this.updateVolumeIcon();
        });

        // Speed
        this.playbackSpeed.addEventListener("change", (e) => {
            const rate = parseFloat(e.target.value);
            this.basePlaybackRate = rate;
            this.video.playbackRate = rate;
            if (this.ytPlayer && typeof this.ytPlayer.setPlaybackRate === "function") {
                this.ytPlayer.setPlaybackRate(rate);
            }
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
                let cur = this.getCurrentTime();
                let isPaused = this.isPaused();
                this.wsSend({
                    type: "player_action",
                    action: isPaused ? "pause" : "play",
                    currentTime: cur
                });
            });
        }

        // Auto hide controls
        this.videoWrapper.addEventListener("mousemove", () => this.resetControlsVisibility());
        this.videoWrapper.addEventListener("mouseleave", () => {
            if (!this.isPaused()) {
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
                if (this.ytPlayer && typeof this.ytPlayer.isMuted === "function") {
                    if (this.ytPlayer.isMuted()) this.ytPlayer.unMute();
                    else this.ytPlayer.mute();
                }
                this.updateVolumeIcon();
            }
        });
    }

    getCurrentTime() {
        if (this.mediaMode === "youtube" && this.ytPlayer && typeof this.ytPlayer.getCurrentTime === "function") {
            return this.ytPlayer.getCurrentTime();
        }
        return this.video.currentTime || 0;
    }

    isPaused() {
        if (this.mediaMode === "youtube" && this.ytPlayer && typeof this.ytPlayer.getPlayerState === "function") {
            return this.ytPlayer.getPlayerState() !== YT.PlayerState.PLAYING;
        }
        return this.video.paused;
    }

    togglePlayPause() {
        if (this.mediaMode === "youtube" && this.ytPlayer && typeof this.ytPlayer.getPlayerState === "function") {
            const state = this.ytPlayer.getPlayerState();
            if (state === YT.PlayerState.PLAYING) {
                this.ytPlayer.pauseVideo();
            } else {
                this.ytPlayer.playVideo();
            }
            return;
        }

        if (this.video.paused) {
            this.video.play().catch(e => console.log("Autoplay policy:", e));
        } else {
            this.video.pause();
        }
    }

    seekRelative(seconds) {
        if (this.mediaMode === "youtube" && this.ytPlayer && typeof this.ytPlayer.getCurrentTime === "function") {
            const dur = this.ytPlayer.getDuration() || 999999;
            const target = Math.max(0, Math.min(dur, this.ytPlayer.getCurrentTime() + seconds));
            this.ytPlayer.seekTo(target, true);
            this.wsSend({
                type: "player_action",
                action: "seek",
                currentTime: target
            });
            return;
        }

        if (!this.video.duration) return;
        const target = Math.max(0, Math.min(this.video.duration, this.video.currentTime + seconds));
        this.seekTo(target);
    }

    seekTo(targetTime) {
        if (this.mediaMode === "youtube" && this.ytPlayer && typeof this.ytPlayer.seekTo === "function") {
            this.ytPlayer.seekTo(targetTime, true);
            this.wsSend({
                type: "player_action",
                action: "seek",
                currentTime: targetTime
            });
            return;
        }

        this.video.currentTime = targetTime;
        this.wsSend({
            type: "player_action",
            action: "seek",
            currentTime: targetTime
        });
    }

    handleProgressClick(e) {
        if (this.mediaMode === "youtube" && this.ytPlayer && typeof this.ytPlayer.getDuration === "function") {
            const dur = this.ytPlayer.getDuration();
            if (dur > 0) {
                const rect = this.progressBarContainer.getBoundingClientRect();
                const pos = (e.clientX - rect.left) / rect.width;
                this.seekTo(pos * dur);
            }
            return;
        }

        if (!this.video.duration) return;
        const rect = this.progressBarContainer.getBoundingClientRect();
        const pos = (e.clientX - rect.left) / rect.width;
        const targetTime = pos * this.video.duration;
        this.seekTo(targetTime);
    }

    handleProgressHover(e) {
        let dur = this.video.duration;
        if (this.mediaMode === "youtube" && this.ytPlayer && typeof this.ytPlayer.getDuration === "function") {
            dur = this.ytPlayer.getDuration();
        }
        if (!dur) return;

        const rect = this.progressBarContainer.getBoundingClientRect();
        const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const hoverTime = pos * dur;
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
        let isMuted = this.video.muted || this.video.volume === 0;
        let vol = this.video.volume;
        if (this.mediaMode === "youtube" && this.ytPlayer && typeof this.ytPlayer.isMuted === "function") {
            isMuted = this.ytPlayer.isMuted();
            vol = (this.ytPlayer.getVolume() || 100) / 100;
        }

        if (isMuted || vol === 0) {
            this.volumeIcon.innerText = "🔇";
        } else if (vol < 0.5) {
            this.volumeIcon.innerText = "🔉";
        } else {
            this.volumeIcon.innerText = "🔊";
        }
    }

    resetControlsVisibility() {
        this.playerControls.classList.add("visible");
        clearTimeout(this.controlsTimeout);
        if (!this.isPaused()) {
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

        if (this.mediaMode === "youtube" && this.ytPlayer && typeof this.ytPlayer.getPlayerState === "function") {
            if (action === "play") {
                if (currentTime !== undefined && Math.abs(this.ytPlayer.getCurrentTime() - currentTime) > 1.2) {
                    this.ytPlayer.seekTo(currentTime, true);
                }
                this.ytPlayer.playVideo();
                this.showSyncFlash("Playing YouTube");
            } else if (action === "pause") {
                if (currentTime !== undefined) {
                    this.ytPlayer.seekTo(currentTime, true);
                }
                this.ytPlayer.pauseVideo();
                this.showSyncFlash("Paused YouTube");
            } else if (action === "seek") {
                if (currentTime !== undefined) {
                    this.ytPlayer.seekTo(currentTime, true);
                    this.showSyncFlash("Seeked: " + this.formatTime(currentTime));
                }
            }
            setTimeout(() => { this.isRemoteUpdate = false; }, 600);
            return;
        }

        // Local video playback action
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

    handleSyncHeartbeat(targetTime, status) {
        if (targetTime === undefined || isNaN(targetTime)) return;

        // YouTube drift sync
        if (this.mediaMode === "youtube" && this.ytPlayer && typeof this.ytPlayer.getCurrentTime === "function") {
            const curTime = this.ytPlayer.getCurrentTime();
            const diff = targetTime - curTime;
            if (Math.abs(diff) > 2.0) {
                console.log(`YouTube drift (${diff.toFixed(2)}s). Resyncing...`);
                this.isRemoteUpdate = true;
                this.ytPlayer.seekTo(targetTime, true);
                if (status === "playing") this.ytPlayer.playVideo();
                else if (status === "paused") this.ytPlayer.pauseVideo();
                this.showSyncFlash("Resynced YouTube");
                setTimeout(() => { this.isRemoteUpdate = false; }, 600);
            }
            return;
        }

        // Local HD video drift compensation
        const diff = targetTime - this.video.currentTime;
        const absDiff = Math.abs(diff);

        if (absDiff > 2.5) {
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
            if (diff > 0) {
                this.video.playbackRate = this.basePlaybackRate * 1.05;
                this.isSmoothCatchingUp = true;
            } else {
                this.video.playbackRate = this.basePlaybackRate * 0.95;
                this.isSmoothCatchingUp = true;
            }
        } else if (this.isSmoothCatchingUp && absDiff <= 0.2) {
            this.video.playbackRate = this.basePlaybackRate;
            this.isSmoothCatchingUp = false;
        }
    }

    handlePartnerBuffering(isBuffering) {
        this.partnerBuffering = isBuffering;
        if (isBuffering) {
            this.showBufferUI("Partner is buffering...", true);
            if (!this.isPaused()) {
                this.togglePlayPause();
            }
        } else {
            this.showBufferUI("", false);
            if (this.isPaused() && !this.isBuffering) {
                this.togglePlayPause();
            }
        }
    }

    startHeartbeat() {
        this.heartbeatInterval = setInterval(() => {
            if (this.mediaMode === "youtube" && this.ytPlayer && typeof this.ytPlayer.getPlayerState === "function") {
                const s = this.ytPlayer.getPlayerState();
                if (s === YT.PlayerState.PLAYING) {
                    this.wsSend({
                        type: "player_sync_heartbeat",
                        currentTime: this.ytPlayer.getCurrentTime(),
                        status: "playing"
                    });
                }
                return;
            }

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
        this.mediaMode = "local";
        if (this.ytPlayer && typeof this.ytPlayer.pauseVideo === "function") {
            try { this.ytPlayer.pauseVideo(); } catch (e) {}
        }
        if (this.youtubeContainer) {
            this.youtubeContainer.style.display = "none";
        }
        if (this.video) {
            this.video.style.display = "block";
            const source = document.getElementById("videoSource");
            source.src = `/api/video/stream?t=${Date.now()}`;
            this.video.load();
            this.video.currentTime = 0;
        }
        this.showSyncFlash("HD Ready: " + filename);
    }
}

window.PlayerController = PlayerController;
