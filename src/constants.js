/**
 * GP_LIVE // SYS.CTRL
 * constants.js — shared configuration, state factory, visual tables
 *
 * Author      : KRANK
 * Modified by : JaJo_EkiZ — bass/mid/high band fields in state + SAB (v0.3.0)
 *                          — activeBands selection + state.band (v0.4.0)
 *                          — seqState per group (v0.5.0)
 * Version     : 0.5.0
 * License     : MIT
 */

// ── Keyboard layout ─────────────────────────────────────────────────────────

export const KEY_MAPS = Object.freeze({
    palettes: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
    patterns: ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
    effects: ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
    loops: ['Z', 'X', 'C', 'V', 'B', 'N', 'M'],
});

// ── SharedArrayBuffer layout ─────────────────────────────────────────────────

export const SAB_FIELDS = Object.freeze({
    sync: 0,
    vol: 1,
    freqsStart: 2,   // bytes 2..17
    palette: 18,
    pattern: 19,
    effect: 20,
    loop: 21,
    spaceTrig: 22,
    bass: 23,
    mid: 24,
    high: 25,
    band: 26,
    burstType: 27,
});

export const SAB_SIZE = 64;

// ── Mutable state factory ────────────────────────────────────────────────────

export const createState = () => ({
    sync: 0,
    vol: 0,
    freqs: new Array(16).fill(0),
    palette: 0,
    pattern: 0,
    effect: 0,
    loop: 3,
    spaceTrig: 0,
    burstType: 0,
    gain: 1.0,
    bass: 0,
    mid: 0,
    high: 0,
    band: 0,
    activeBands: new Array(16).fill(true),

    // ── Sequencer state (v0.5.0) ─────────────────────────────────────────────
    // One entry per group. binIdx=-1 means sequencer is off for that group.
    // threshold: 0..255, cooldownMs: minimum ms between steps.
    // Threshold is adaptive — computed per-frame by SequencerEngine, not stored here.
    seqState: {
        palettes: { active: false, binIdx: -1, step: 0, lastTrigMs: 0 },
        patterns: { active: false, binIdx: -1, step: 0, lastTrigMs: 0 },
        effects: { active: false, binIdx: -1, step: 0, lastTrigMs: 0 },
        loops: { active: false, binIdx: -1, step: 0, lastTrigMs: 0 },
        space: { active: false, binIdx: -1, step: 0, lastTrigMs: 0 },
    },
});

// ── Band bin ranges ──────────────────────────────────────────────────────────

export const BAND_RANGES = Object.freeze({
    bass: { start: 0, end: 5 },
    mid: { start: 5, end: 11 },
    high: { start: 11, end: 16 },
});

// ── Sequencer cooldown (ms) ──────────────────────────────────────────────────
// Minimum time between steps regardless of bin activity.
// Prevents double-triggers on a single loud peak.

export const SEQ_COOLDOWN_MS = 120;

// ── Visual palettes ──────────────────────────────────────────────────────────

export const PALETTES = Object.freeze([
    { bg: '#050505', c1: '#00ffcc', c2: '#ff0055' },  // 1  Cyberpunk
    { bg: '#000000', c1: '#00ff00', c2: '#ffffff' },  // 2  Matrix
    { bg: '#110022', c1: '#ff00ff', c2: '#00ffff' },  // 3  Vaporwave
    { bg: '#1a0505', c1: '#ff3300', c2: '#ffcc00' },  // 4  Meltdown
    { bg: '#eeeeee', c1: '#000000', c2: '#ff0000' },  // 5  Mirror's Edge
    { bg: '#0a0a0a', c1: '#ffffff', c2: '#555555' },  // 6  Noir
    { bg: '#001a33', c1: '#00ccff', c2: '#ffffff' },  // 7  Tron
    { bg: '#222200', c1: '#ffff00', c2: '#ff8800' },  // 8  Hazard
    { bg: '#050011', c1: '#aa00ff', c2: '#0055ff' },  // 9  Deep Space
    { bg: '#050505', c1: '#ff0055', c2: '#ff0055' },  // 0  Panic
]);

// ── Loop / time speed table ──────────────────────────────────────────────────

export const SPEED_MAP = Object.freeze([0, 0.2, 0.5, 1, 2, 4, -1]);