/**
 * GP_LIVE // SYS.CTRL
 * audio.js — microphone capture and FFT analysis engine
 *
 * Author      : KRANK
 * Modified by : JaJo_EkiZ — bass/mid/high + log-scale spectrum (v0.4.0)
 * Version     : 0.4.0
 * License     : MIT
 *
 * Wraps the Web Audio API. A single AnalyserNode reads from the mic stream
 * and exposes a 16-band frequency snapshot (log-scaled) + scalar volume
 * + bass/mid/high band averages on every frame.
 * The caller is responsible for requesting mic permission before calling init().
 */

import { BAND_RANGES } from './constants.js';

// ── Log-scale bin mapping ─────────────────────────────────────────────────────
//
// Maps 16 display bars onto FFT bins using a logarithmic curve so that each
// bar covers a perceptually equal slice of the spectrum (like human hearing).
// Pre-computed once at module load to avoid per-frame allocation.
//
// With fftSize=256 → 128 bins.  We skip bin 0 (DC offset) and start at 1.
// Each bar averages its assigned bin range and scales by gain.
//
// Approximate Hz per bar at 44100 Hz sample rate:
//   Bar 0 :  86 Hz    Bar 4 : 430 Hz    Bar 8 : 2.1 kHz
//   Bar 11 : 5.6 kHz  Bar 15 : 11 kHz

const NUM_BARS = 16;
const LOG_RANGES = (() => {
    const totalBins = 128;   // frequencyBinCount for fftSize=256
    return Array.from({ length: NUM_BARS }, (_, i) => {
        const start = Math.max(1, Math.floor(Math.pow(totalBins, i / NUM_BARS)));
        const end = Math.max(start + 1, Math.floor(Math.pow(totalBins, (i + 1) / NUM_BARS)));
        return { start, end: Math.min(end, totalBins) };
    });
})();

export class AudioEngine {
    constructor() {
        this._ctx = null;
        this._analyser = null;
        this._data = null;
        this.ready = false;
    }

    async init() {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this._ctx = new (window.AudioContext || window.webkitAudioContext)();
        this._analyser = this._ctx.createAnalyser();
        this._analyser.fftSize = 256;   // 128 bins — more freq resolution
        this._analyser.smoothingTimeConstant = 0.3;
        this._ctx.createMediaStreamSource(stream).connect(this._analyser);
        this._data = new Uint8Array(this._analyser.frequencyBinCount);
        this.ready = true;
    }

    read(gain = 1.0) {
        if (!this.ready) return {
            vol: 0, freqs: new Array(NUM_BARS).fill(0),
            bass: 0, mid: 0, high: 0,
        };

        this._analyser.getByteFrequencyData(this._data);

        // Log-scaled bars: average the FFT bins assigned to each bar
        const freqs = Array.from({ length: NUM_BARS }, (_, i) => {
            const { start, end } = LOG_RANGES[i];
            let sum = 0;
            for (let b = start; b < end; b++) sum += this._data[b];
            return Math.min(255, Math.floor((sum / (end - start)) * gain));
        });

        const vol = Math.min(255, Math.floor(freqs.reduce((a, b) => a + b, 0) / NUM_BARS));

        const avg = (start, end) => {
            const slice = freqs.slice(start, end);
            return Math.floor(slice.reduce((a, b) => a + b, 0) / slice.length);
        };

        const bass = avg(BAND_RANGES.bass.start, BAND_RANGES.bass.end);
        const mid = avg(BAND_RANGES.mid.start, BAND_RANGES.mid.end);
        const high = avg(BAND_RANGES.high.start, BAND_RANGES.high.end);

        return { vol, freqs, bass, mid, high };
    }
}