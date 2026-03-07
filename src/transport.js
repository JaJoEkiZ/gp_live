/**
 * GP_LIVE // SYS.CTRL
 * transport.js — SharedArrayBuffer state bridge between controller and projector
 *
 * Author  : KRANK
 * Version : 0.1.0
 * License : MIT
 *
 * SabTransport wraps a SharedArrayBuffer so controller and projector can share
 * audio-reactive state at zero serialization cost. Falls back gracefully to
 * postMessage when SharedArrayBuffer is unavailable (no COOP/COEP headers).
 */

import { SAB_FIELDS, SAB_SIZE } from './constants.js';

export class SabTransport {
    constructor() {
        this.active = false;
        this.buffer = null;
        this._view = null;
    }

    /** Allocate a new SAB. Returns true if SAB is available in this context. */
    init() {
        if (typeof SharedArrayBuffer === 'undefined') return false;
        this.buffer = new SharedArrayBuffer(SAB_SIZE);
        this._view = new Uint8Array(this.buffer);
        this.active = true;
        return true;
    }

    /** Attach to an existing SAB received from the controller window. */
    attach(sab) {
        this.buffer = sab;
        this._view = new Uint8Array(sab);
        this.active = true;
    }

    /** Write the current state into the SAB (controller side). */
    write(state, syncCounter) {
        if (!this.active) return;
        const v = this._view;
        v[SAB_FIELDS.sync] = syncCounter % 255;
        v[SAB_FIELDS.vol] = state.vol;
        state.freqs.forEach((f, i) => { v[SAB_FIELDS.freqsStart + i] = f; });
        v[SAB_FIELDS.palette] = state.palette;
        v[SAB_FIELDS.pattern] = state.pattern;
        v[SAB_FIELDS.effect] = state.effect;
        v[SAB_FIELDS.loop] = state.loop;
        v[SAB_FIELDS.spaceTrig] = state.spaceTrig;
        v[SAB_FIELDS.band] = state.band;       // ← v0.4.0
    }

    /** Read the SAB into a state object (projector side). */
    read(state) {
        if (!this.active) return;
        const v = this._view;
        state.vol = v[SAB_FIELDS.vol];
        state.palette = v[SAB_FIELDS.palette];
        state.pattern = v[SAB_FIELDS.pattern];
        state.effect = v[SAB_FIELDS.effect];
        state.loop = v[SAB_FIELDS.loop];
        state.spaceTrig = v[SAB_FIELDS.spaceTrig];
        for (let i = 0; i < 16; i++) {
            state.freqs[i] = v[SAB_FIELDS.freqsStart + i];
        }
        state.band = v[SAB_FIELDS.band];              // ← v0.4.0
    }
}
