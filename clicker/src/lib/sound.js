// Web Audio API & Haptics for interactive click feedback
/** @type {AudioContext | null} */
let audioCtx = null;
let soundMuted = false;

function getAudioContext() {
    if (!audioCtx && typeof window !== 'undefined') {
        const AudioContextClass = window.AudioContext || /** @type {any} */ (window).webkitAudioContext;
        if (AudioContextClass) {
            audioCtx = new AudioContextClass();
        }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    return audioCtx;
}

export function isMuted() {
    return soundMuted;
}

export function toggleMute() {
    soundMuted = !soundMuted;
    return soundMuted;
}

/**
 * Play a punchy, satisfying pop/coin sound with pitch scaling by combo streak
 * @param {number} [combo=0]
 */
export function playClickSound(combo = 0) {
    if (soundMuted) return;
    try {
        const ctx = getAudioContext();
        if (!ctx) return;

        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        // Pentatonic scale based on combo streak
        const baseFreq = 480;
        const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];
        const step = scale[combo % scale.length];
        const octave = Math.min(Math.floor(combo / scale.length), 2);
        const freq = baseFreq * Math.pow(2, (step + octave * 12) / 12);

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now);
        osc.frequency.exponentialRampToValueAtTime(freq * 1.4, now + 0.05);

        gain.gain.setValueAtTime(0.25, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now);
        osc.stop(now + 0.08);
    } catch {
        // Fallback gracefully if Web Audio is blocked
    }
}

/**
 * Play a celebratory ascending fanfare for bonus clicks
 */
export function playBonusSound() {
    if (soundMuted) return;
    try {
        const ctx = getAudioContext();
        if (!ctx) return;

        const chords = [523.25, 659.25, 783.99, 1046.50]; // C5 - E5 - G5 - C6
        chords.forEach((freq, idx) => {
            const now = ctx.currentTime + idx * 0.05;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, now);

            gain.gain.setValueAtTime(0.2, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

            osc.connect(gain);
            gain.connect(ctx.destination);

            osc.start(now);
            osc.stop(now + 0.3);
        });
    } catch {
        // Fallback gracefully
    }
}

/**
 * Trigger mobile haptic vibration
 * @param {number | number[]} pattern
 */
export function triggerHaptic(pattern = 15) {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        try {
            navigator.vibrate(pattern);
        } catch {
            // Ignore
        }
    }
}
