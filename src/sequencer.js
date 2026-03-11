/**
 * GP_LIVE // SYS.CTRL
 * sequencer.js — SequencerEngine: per-group bin-driven step sequencer
 *
 * Author      : JaJo_EkiZ (v0.5.0)
 * License     : MIT
 *
 * Threshold is adaptive: a rolling average of the linked bin's amplitude.
 * A peak is detected when the bin exceeds (average × PEAK_RATIO), ensuring
 * the sequencer responds to musical peaks regardless of overall signal level.
 * Cooldown prevents double-triggers on the same peak.
 */

import { KEY_MAPS, SEQ_COOLDOWN_MS } from './constants.js';

const GROUP_FIELD = Object.freeze({
    palettes: 'palette',
    patterns: 'pattern',
    effects : 'effect',
    loops   : 'loop',
});

// Bin value must exceed (rollingAvg × PEAK_RATIO) to trigger a step
const PEAK_RATIO = 1.4;

// Rolling average smoothing factor (0=no update, 1=instant)
const AVG_ALPHA = 0.05;

export class SequencerEngine {
    /**
     * @param {object}   state     Shared mutable state.
     * @param {Function} onUpdate  Unified input callback.
     */
    constructor(state, onUpdate) {
        this._state    = state;
        this._onUpdate = onUpdate;

        // Per-group rolling average of the linked bin's amplitude
        this._rollingAvg = {
            palettes: 0,
            patterns: 0,
            effects : 0,
            loops   : 0,
            space   : 0,
        };
    }

    /**
     * Called every rAF frame after freqs are written into state.
     * @param {number} nowMs  performance.now() from the rAF callback.
     */
    tick(nowMs) {
        const { freqs, seqState } = this._state;

        for (const group of Object.keys(seqState)) {
            const seq = seqState[group];
            if (!seq.active || seq.binIdx < 0) continue;

            const binVal = freqs[seq.binIdx] ?? 0;

            // Update rolling average
            this._rollingAvg[group] =
                AVG_ALPHA * binVal + (1 - AVG_ALPHA) * this._rollingAvg[group];

            const avg = this._rollingAvg[group];

            // Peak: bin exceeds adaptive threshold AND cooldown elapsed
            const threshold = avg * PEAK_RATIO;
            const cooldownOk = (nowMs - seq.lastTrigMs) >= SEQ_COOLDOWN_MS;

            if (binVal >= threshold && avg > 8 && cooldownOk) {
                seq.lastTrigMs = nowMs;
                this._advance(group, seq);
            }
        }
    }

    _advance(group, seq) {
        // Defensive: ensure blockedSteps exists on old state objects
        if (!seq.blockedSteps) seq.blockedSteps = new Set();
        const blocked = seq.blockedSteps;

        // space: fire burst AND advance burst type, skipping blocked types
        if (group === 'space') {
            const total = 5;
            if (blocked.size >= total) return;
            let next = seq.step;
            for (let i = 0; i < total; i++) {
                next = (next + 1) % total;
                if (!blocked.has(next)) break;
            }
            seq.step              = next;
            this._state.burstType = next;
            this._state.spaceTrig = (this._state.spaceTrig + 1) % 255;
            this._onUpdate('space', ' ');
            return;
        }

        const keys  = KEY_MAPS[group];
        const field = GROUP_FIELD[group];
        if (blocked.size >= keys.length) return;
        let next = seq.step;
        for (let i = 0; i < keys.length; i++) {
            next = (next + 1) % keys.length;
            if (!blocked.has(next)) break;
        }
        seq.step           = next;
        this._state[field] = next;
        this._onUpdate(group, keys[next]);
    }

    /**
     * Sync step pointer when user manually presses a key mid-sequence.
     */
    syncStep(group, key) {
        const seq = this._state.seqState[group];
        if (!seq) return;
        const idx = KEY_MAPS[group].indexOf(key);
        if (idx !== -1) seq.step = idx;
        // Reset rolling avg so the sequencer re-calibrates from the new context
        this._rollingAvg[group] = 0;
    }

    /**
     * Expose current adaptive threshold for a group (for UI display).
     * @returns {number} 0..255
     */
    getThreshold(group) {
        return Math.round(this._rollingAvg[group] * PEAK_RATIO);
    }
}