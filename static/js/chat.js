/**
 * Live Room Chat & Floating Reaction Particles for DuoCinema
 */

class ChatManager {
    constructor(wsSendCallback, getMyNameCallback) {
        this.wsSend = wsSendCallback;
        this.getMyName = getMyNameCallback;
        
        this.chatMessages = document.getElementById("chatMessages");
        this.chatForm = document.getElementById("chatForm");
        this.chatInput = document.getElementById("chatInput");
        this.reactionContainer = document.getElementById("reactionContainer");
        this.userCountBadge = document.getElementById("userCountBadge");

        this.initSoundFX();
        this.bindEvents();
    }

    initSoundFX() {
        // Synthesizes cute gentle notification audio via Web Audio API (zero audio files needed!)
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.audioCtx = new AudioContext();
        } catch (e) {
            this.audioCtx = null;
        }
    }

    playPopSound(pitch = 440) {
        if (!this.audioCtx) return;
        try {
            if (this.audioCtx.state === "suspended") {
                this.audioCtx.resume();
            }
            const osc = this.audioCtx.createOscillator();
            const gain = this.audioCtx.createGain();
            osc.type = "sine";
            osc.frequency.setValueAtTime(pitch, this.audioCtx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(pitch * 1.5, this.audioCtx.currentTime + 0.08);

            gain.gain.setValueAtTime(0.08, this.audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + 0.12);

            osc.connect(gain);
            gain.connect(this.audioCtx.destination);

            osc.start();
            osc.stop(this.audioCtx.currentTime + 0.12);
        } catch (e) {}
    }

    bindEvents() {
        if (this.chatForm) {
            this.chatForm.addEventListener("submit", (e) => {
                e.preventDefault();
                const text = this.chatInput.value.trim();
                if (!text) return;

                this.wsSend({
                    type: "chat_message",
                    text: text
                });
                this.chatInput.value = "";
            });
        }

        // Reaction buttons
        const reactionButtons = document.querySelectorAll(".reaction-btn");
        reactionButtons.forEach((btn) => {
            btn.addEventListener("click", () => {
                const emoji = btn.dataset.emoji || "❤️";
                this.wsSend({
                    type: "reaction",
                    emoji: emoji
                });
                this.spawnReaction(emoji);
            });
        });
    }

    handleIncomingMessage(data) {
        const { sender, text, time } = data;
        const myName = this.getMyName();
        const isMine = sender === myName;

        const bubble = document.createElement("div");
        bubble.className = `chat-bubble ${isMine ? "mine" : "theirs"}`;

        const authorSpan = document.createElement("span");
        authorSpan.className = "chat-author";
        authorSpan.innerText = sender;

        const textSpan = document.createElement("span");
        textSpan.className = "chat-text";
        textSpan.innerText = text;

        const timeSpan = document.createElement("span");
        timeSpan.className = "chat-time";
        timeSpan.innerText = time || "";

        bubble.appendChild(authorSpan);
        bubble.appendChild(textSpan);
        bubble.appendChild(timeSpan);

        this.chatMessages.appendChild(bubble);
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;

        if (!isMine) {
            this.playPopSound(520);
        }
    }

    spawnReaction(emoji) {
        if (!this.reactionContainer) return;

        this.playPopSound(emoji === "❤️" ? 620 : 440);

        // Spawn 3 slightly staggered particles for richer romantic visual
        for (let i = 0; i < 3; i++) {
            setTimeout(() => {
                const el = document.createElement("div");
                el.className = "floating-particle";
                el.innerText = emoji;

                // Random horizontal positioning between 15% and 85%
                const leftPercent = 15 + Math.random() * 70;
                el.style.left = `${leftPercent}%`;
                el.style.bottom = `${10 + Math.random() * 20}%`;
                el.style.fontSize = `${2 + Math.random() * 1.5}rem`;

                this.reactionContainer.appendChild(el);

                setTimeout(() => {
                    el.remove();
                }, 2500);
            }, i * 150);
        }
    }

    updateUserCount(count) {
        if (this.userCountBadge) {
            this.userCountBadge.innerText = `${count} watching`;
        }
    }
}

window.ChatManager = ChatManager;
