/**
 * GP_LIVE // SYS.CTRL
 * ui.js — BackendUI: DOM feedback layer for the controller window
 *
 * Author      : KRANK
 * Modified by : JaJo_EkiZ — click support on key buttons (v0.2.0)
 *                          — 16-band spectrum analyzer with bass/mid/high coloring (v0.3.0)
 *                          — bin drag-selection for state.band (v0.4.0)
 *                          — per-group sequencer controls: SEQ button, threshold slider,
 *                            bin-link mode, spectrum highlight (v0.5.0)
 * Version     : 0.5.0
 * License     : MIT
 */

import { KEY_MAPS, BAND_RANGES } from './constants.js';

// Band color scheme
const BAND_COLORS = Object.freeze({
    bass: '#ff0055',
    mid: '#00ffcc',
    high: '#ffff00',
});

// One accent color per group — used for SEQ button + bin highlight in spectrum
const GROUP_COLORS = Object.freeze({
    palettes: '#ff9900',
    patterns: '#00ccff',
    effects: '#cc00ff',
    loops: '#00ff66',
    space: '#ffffff',
});

export class BackendUI {
    /**
     * @param {Function|null} onUpdate  Unified input callback.
     * @param {object|null}   state     Shared mutable state object.
     * @param {object|null}   sequencer SequencerEngine instance.
     */
    constructor(onUpdate = null, state = null, sequencer = null) {
        this._sysLog = document.getElementById('sys-log');
        this._vuMeter = document.getElementById('vu-meter');
        this._sabStatus = document.getElementById('sab-status');
        this._sequencer = sequencer;

        // Which group is currently waiting for a bin-link click (null = none)
        this._linkingGroup = null;

        this._buildKeys(onUpdate, state);
        this._buildSpectrum();
    }

    // ── Keyboard display + SEQ controls ──────────────────────────────────────

    _buildKeys(onUpdate, state) {
        const FIELD = { palettes: 'palette', patterns: 'pattern', effects: 'effect', loops: 'loop' };

        const build = (containerId, group, keys, defaultActive) => {
            const container = document.getElementById(containerId);
            if (!container) return;

            // ── SEQ toolbar (injected above the key row) ─────────────────────
            const toolbar = document.createElement('div');
            toolbar.className = 'seq-toolbar';
            toolbar.id = `seq-toolbar-${group}`;

            // [SEQ] toggle button
            const seqBtn = document.createElement('button');
            seqBtn.className = 'seq-btn';
            seqBtn.id = `seq-btn-${group}`;
            seqBtn.innerText = 'SEQ';
            seqBtn.style.setProperty('--grp-color', GROUP_COLORS[group]);
            seqBtn.title = 'Enable sequencer for this group';

            // Bin indicator label
            const binLabel = document.createElement('span');
            binLabel.className = 'seq-bin-label';
            binLabel.id = `seq-bin-${group}`;
            binLabel.innerText = '—';

            // Adaptive threshold readout (live, computed by SequencerEngine)
            const thrReadout = document.createElement('span');
            thrReadout.className = 'seq-thr-val';
            thrReadout.id = `seq-thr-val-${group}`;
            thrReadout.innerText = 'THR:—';
            thrReadout.title = 'Adaptive peak threshold (auto)';

            toolbar.appendChild(seqBtn);
            toolbar.appendChild(binLabel);
            toolbar.appendChild(thrReadout);

            // Insert toolbar into the .control-block (parent of .key-row),
            // just before the key-row — so it doesn't break the horizontal flex layout
            const parent = container.parentElement;
            if (parent) parent.insertBefore(toolbar, container);
            else container.appendChild(toolbar);

            // ── SEQ button click ─────────────────────────────────────────────
            seqBtn.addEventListener('click', () => {
                if (!state) return;
                const seq = state.seqState?.[group];
                if (!seq) return;

                if (!seq.active) {
                    this._linkingGroup = group;
                    seqBtn.classList.add('linking');
                    seqBtn.innerText = 'LINK BIN…';
                    this.log(`SEQ [${group}]: click a spectrum bin to link`);
                } else {
                    seq.active = false;
                    seq.binIdx = -1;
                    this._linkingGroup = null;
                    seqBtn.classList.remove('active', 'linking');
                    seqBtn.innerText = 'SEQ';
                    binLabel.innerText = '—';
                    this.log(`SEQ [${group}]: disabled`);
                }
            });

            // ── Key buttons ──────────────────────────────────────────────────
            keys.forEach((k, idx) => {
                // Wrapper holds the key label + its lock button side by side
                const wrap = document.createElement('div');
                wrap.className = 'key-wrap';

                const el = document.createElement('div');
                el.className = 'key';
                el.id = `ui-key-${k}`;
                el.innerText = k;

                const lockBtn = document.createElement('button');
                lockBtn.className = 'key-lock-btn';
                lockBtn.id = `lock-${group}-${idx}`;
                lockBtn.innerText = '✕';
                lockBtn.title = 'Block this step from sequencer';

                if (onUpdate && state) {
                    el.addEventListener('click', () => {
                        state[FIELD[group]] = idx;
                        this._sequencer?.syncStep(group, k);
                        onUpdate(group, k);
                    });

                    lockBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const liveState = this._sequencer?._state ?? state;
                        const seq = liveState.seqState?.[group];
                        if (!seq) return;
                        if (!seq.blockedSteps) seq.blockedSteps = new Set();
                        const blocked = seq.blockedSteps;
                        if (blocked.has(idx)) {
                            blocked.delete(idx);
                            wrap.classList.remove('seq-blocked');
                            lockBtn.classList.remove('active');
                        } else {
                            blocked.add(idx);
                            wrap.classList.add('seq-blocked');
                            lockBtn.classList.add('active');
                        }
                    });
                }

                wrap.appendChild(el);
                wrap.appendChild(lockBtn);
                container.appendChild(wrap);
            });

            document.getElementById(`ui-key-${defaultActive}`)?.classList.add('active');
        };

        build('keys-palettes', 'palettes', KEY_MAPS.palettes, '1');
        build('keys-patterns', 'patterns', KEY_MAPS.patterns, 'Q');
        build('keys-effects', 'effects', KEY_MAPS.effects, 'A');
        build('keys-loops', 'loops', KEY_MAPS.loops, 'V');

        // ── Burst type buttons ────────────────────────────────────────────────
        const BURST_NAMES = ['RING', 'FRAME', 'NOVA', 'DRAIN', 'SIGIL'];
        const burstRow = document.getElementById('burst-type-row');
        if (burstRow && state) {
            BURST_NAMES.forEach((name, idx) => {
                const wrap = document.createElement('div');
                wrap.className = 'key-wrap';

                const el = document.createElement('div');
                el.className = 'key burst-type-btn';
                el.id = `burst-type-${idx}`;
                el.innerText = name;

                const lockBtn = document.createElement('button');
                lockBtn.className = 'key-lock-btn';
                lockBtn.id = `lock-space-${idx}`;
                lockBtn.innerText = '✕';
                lockBtn.title = `Block ${name} from sequencer`;

                // Left click on label: fire this burst type directly (no advance)
                el.addEventListener('click', () => {
                    const liveState = this._sequencer?._state ?? state;
                    liveState.burstType = idx;
                    liveState.spaceTrig = (liveState.spaceTrig + 1) % 255;
                    this.updateBurstType(idx);
                    this.flashSpace();
                    onUpdate?.('space-direct', ' ');
                });

                lockBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    // Use sequencer's state ref to guarantee same object as _advance reads
                    const liveState = this._sequencer?._state ?? state;
                    if (!liveState.seqState?.space) return;
                    const seq = liveState.seqState.space;
                    if (!seq.blockedSteps) seq.blockedSteps = new Set();
                    const blocked = seq.blockedSteps;
                    if (blocked.has(idx)) {
                        blocked.delete(idx);
                        wrap.classList.remove('seq-blocked');
                        lockBtn.classList.remove('active');
                    } else {
                        blocked.add(idx);
                        wrap.classList.add('seq-blocked');
                        lockBtn.classList.add('active');
                    }
                });

                wrap.appendChild(el);
                wrap.appendChild(lockBtn);
                burstRow.appendChild(wrap);
            });
        }

        // Spacebar / burst
        if (onUpdate && state) {
            document.getElementById('key-space')?.addEventListener('click', () => {
                state.spaceTrig = (state.spaceTrig + 1) % 255;
                onUpdate('space', ' ');
                this.flashSpace();
            });
        }

        // Spacebar SEQ button (toolbar injected in HTML)
        const spaceSeqBtn = document.getElementById('seq-btn-space');
        if (spaceSeqBtn && state) {
            spaceSeqBtn.style.setProperty('--grp-color', '#ffffff');
            spaceSeqBtn.addEventListener('click', () => {
                // Ensure seqState.space exists (defensive for old state objects)
                if (!state.seqState) state.seqState = {};
                if (!state.seqState.space) {
                    state.seqState.space = { active: false, binIdx: -1, step: 0, lastTrigMs: 0, blockedSteps: new Set() };
                } else if (!state.seqState.space.blockedSteps) {
                    // Preserve existing state but add missing blockedSteps
                    state.seqState.space.blockedSteps = new Set();
                }
                const seq = state.seqState.space;
                if (!seq.active) {
                    this._linkingGroup = 'space';
                    spaceSeqBtn.classList.add('linking');
                    spaceSeqBtn.innerText = 'LINK BIN…';
                    this.log('SEQ [space]: click a spectrum bin to link');
                } else {
                    seq.active = false;
                    seq.binIdx = -1;
                    this._linkingGroup = null;
                    if (this._sequencer?._state) this._sequencer._state.burstType = null;
                    spaceSeqBtn.classList.remove('active', 'linking');
                    spaceSeqBtn.innerText = 'SEQ';
                    const lbl = document.getElementById('seq-bin-space');
                    if (lbl) lbl.innerText = '—';
                    this.log('SEQ [space]: disabled');
                }
            });
        }
    }

    /** Illuminate the active burst type button (0-4), dim the rest. */
    updateBurstType(typeIdx) {
        for (let i = 0; i < 5; i++) {
            document.getElementById(`burst-type-${i}`)
                ?.classList.toggle('active', i === typeIdx);
        }
    }

    /** Highlight the active key in a group and dim the rest. */
    updateKeyGroup(group, activeKey) {
        KEY_MAPS[group]?.forEach(k => {
            document.getElementById(`ui-key-${k}`)
                ?.classList.toggle('active', k === activeKey);
        });
    }

    /** Flash the SEQ button for a group when a step fires. */
    flashSeqStep(group) {
        const btn = document.getElementById(`seq-btn-${group}`);
        if (!btn) return;
        btn.classList.add('trig');
        setTimeout(() => btn.classList.remove('trig'), 80);
    }

    /** Brief flash on the spacebar indicator. */
    flashSpace() {
        const el = document.getElementById('key-space');
        if (!el) return;
        el.classList.add('active');
        setTimeout(() => el.classList.remove('active'), 100);
    }

    // ── Spectrum analyzer ────────────────────────────────────────────────────

    _buildSpectrum() {
        const container = document.getElementById('spectrum-container');
        if (!container) return;

        this._activeBins = new Array(16).fill(true);
        this._isDragging = false;
        this._dragValue = true;

        // Labels row
        const labels = document.createElement('div');
        labels.style.cssText = [
            'display:flex', 'justify-content:space-between',
            'font-size:.65rem', 'letter-spacing:.08em', 'margin-bottom:4px',
        ].join(';');

        const mkLabel = (text, color) => {
            const s = document.createElement('span');
            s.innerText = text; s.style.color = color; return s;
        };
        labels.appendChild(mkLabel('◂ BASS', BAND_COLORS.bass));
        labels.appendChild(mkLabel('MID', BAND_COLORS.mid));
        labels.appendChild(mkLabel('HIGH ▸', BAND_COLORS.high));
        container.appendChild(labels);

        // Canvas
        this._specCanvas = document.createElement('canvas');
        this._specCanvas.width = 256;
        this._specCanvas.height = 160;
        this._specCanvas.style.cssText = [
            'width:100%', 'height:160px', 'display:block',
            'image-rendering:pixelated', 'cursor:crosshair',
        ].join(';');
        container.appendChild(this._specCanvas);
        this._specCtx = this._specCanvas.getContext('2d');

        // ── Interaction ──────────────────────────────────────────────────────
        const binFromX = (clientX) => {
            const rect = this._specCanvas.getBoundingClientRect();
            return Math.max(0, Math.min(15, Math.floor(((clientX - rect.left) / rect.width) * 16)));
        };

        this._specCanvas.addEventListener('mousedown', (e) => {
            const bin = binFromX(e.clientX);

            // If a group is waiting for a bin link — link it
            if (this._linkingGroup) {
                this._linkBin(this._linkingGroup, bin);
                return;
            }

            // Otherwise: drag-select active bins
            this._isDragging = true;
            this._dragValue = !this._activeBins[bin];
            this._activeBins[bin] = this._dragValue;
            this._onBandSelectionChange?.();
        });

        this._specCanvas.addEventListener('mousemove', (e) => {
            if (!this._isDragging || this._linkingGroup) return;
            const bin = binFromX(e.clientX);
            this._activeBins[bin] = this._dragValue;
            this._onBandSelectionChange?.();
        });

        window.addEventListener('mouseup', () => { this._isDragging = false; });

        // Hint
        const hint = document.createElement('div');
        hint.style.cssText = 'font-size:.6rem;color:#0088aa;margin-top:3px;text-align:center;';
        hint.innerText = 'DRAG TO SELECT ACTIVE BINS  ·  SEQ: CLICK BIN TO LINK';
        container.appendChild(hint);

        // Band readouts
        this._bandReadout = document.createElement('div');
        this._bandReadout.style.cssText = [
            'display:flex', 'justify-content:space-between',
            'margin-top:5px', 'font-size:.65rem', 'font-family:monospace',
        ].join(';');

        this._bassVal = document.createElement('span');
        this._midVal = document.createElement('span');
        this._highVal = document.createElement('span');
        this._activeVal = document.createElement('span');
        this._bassVal.style.color = BAND_COLORS.bass;
        this._midVal.style.color = BAND_COLORS.mid;
        this._highVal.style.color = BAND_COLORS.high;
        this._activeVal.style.color = '#ffffff';
        this._bassVal.innerText = 'B:000';
        this._midVal.innerText = 'M:000';
        this._highVal.innerText = 'H:000';
        this._activeVal.innerText = 'ACT:000';
        [this._bassVal, this._midVal, this._highVal, this._activeVal]
            .forEach(el => this._bandReadout.appendChild(el));
        container.appendChild(this._bandReadout);
    }

    // ── Bin linking ───────────────────────────────────────────────────────────

    /**
     * Link a frequency bin to a sequencer group.
     * Called when the user clicks on the spectrum canvas while in linking mode.
     */
    _linkBin(group, binIdx) {
        // Find the state ref via the seqState we already have through the btn click closure.
        // We reach it via the sequencer's state reference.
        const seq = this._sequencer?._state?.seqState?.[group];
        if (!seq) return;

        seq.active = true;
        seq.binIdx = binIdx;
        seq.step = 0;
        seq.lastTrigMs = 0;

        // Update UI
        const btn = document.getElementById(`seq-btn-${group}`);
        const lbl = document.getElementById(`seq-bin-${group}`);
        if (btn) {
            btn.classList.remove('linking');
            btn.classList.add('active');
            btn.innerText = 'SEQ ●';
        }
        if (lbl) lbl.innerText = `BIN ${binIdx}`;

        this._linkingGroup = null;
        this.log(`SEQ [${group}]: linked to bin ${binIdx}`);
    }

    /** Returns a copy of the active bins array. */
    getActiveBins() { return [...this._activeBins]; }

    /** Register callback for bin drag-selection changes. */
    onBandSelectionChange(cb) { this._onBandSelectionChange = cb; }

    /**
     * Render the 16-band spectrum.
     * Bins linked to a sequencer group are highlighted with that group's color.
     * Bins pending link (linking mode active) pulse white.
     */
    updateSpectrum(freqs, bass, mid, high, band) {
        if (!this._specCtx) return;

        const ctx = this._specCtx;
        const W = this._specCanvas.width;
        const H = this._specCanvas.height;
        const N = freqs.length;
        const barW = Math.floor(W / N);
        const gap = 1;
        const selH = 4;

        ctx.fillStyle = '#0a0c14';
        ctx.fillRect(0, 0, W, H);

        // Build a map of bin → group color for linked sequencers
        const binGroupColor = {};
        if (this._sequencer) {
            const seqState = this._sequencer._state?.seqState ?? {};
            for (const [group, seq] of Object.entries(seqState)) {
                if (seq.active && seq.binIdx >= 0) {
                    binGroupColor[seq.binIdx] = GROUP_COLORS[group];
                }
            }
        }

        const isLinking = this._linkingGroup !== null;

        for (let i = 0; i < N; i++) {
            const val = freqs[i] / 255;
            const barH = Math.max(1, Math.floor(val * (H - selH - 2)));
            const x = i * barW;
            const y = H - selH - 2 - barH;
            const active = this._activeBins[i];

            // Bar color: group highlight > band color > dimmed
            let color;
            if (binGroupColor[i]) {
                color = binGroupColor[i];
                ctx.globalAlpha = 1.0;
            } else {
                if (i < BAND_RANGES.bass.end) color = BAND_COLORS.bass;
                else if (i < BAND_RANGES.mid.end) color = BAND_COLORS.mid;
                else color = BAND_COLORS.high;
                ctx.globalAlpha = active ? 1.0 : 0.25;
            }

            ctx.fillStyle = color;
            ctx.fillRect(x, y, barW - gap, barH);

            // Peak dot
            ctx.fillStyle = binGroupColor[i] ? '#ffffffee' : (active ? '#ffffffcc' : '#ffffff33');
            ctx.globalAlpha = 1.0;
            ctx.fillRect(x, y, barW - gap, 1);

            // Linking mode: pulse white overlay on all bins to signal "pick one"
            if (isLinking) {
                ctx.fillStyle = '#ffffff';
                ctx.globalAlpha = 0.08 + 0.08 * Math.sin(Date.now() / 150 + i * 0.4);
                ctx.fillRect(x, 0, barW - gap, H - selH);
            }

            ctx.globalAlpha = 1.0;

            // Selection strip at bottom
            ctx.fillStyle = active ? '#ffffff' : '#222233';
            ctx.fillRect(x, H - selH, barW - gap, selH);
        }

        // Numeric readouts
        const fmt = n => String(Math.round(n)).padStart(3, '0');
        this._bassVal.innerText = `B:${fmt(bass)}`;
        this._midVal.innerText = `M:${fmt(mid)}`;
        this._highVal.innerText = `H:${fmt(high)}`;
        this._activeVal.innerText = `ACT:${fmt(band)}`;

        // Update adaptive threshold readouts for each active sequencer group
        if (this._sequencer) {
            for (const group of ['palettes', 'patterns', 'effects', 'loops', 'space']) {
                const el = document.getElementById(`seq-thr-val-${group}`);
                if (!el) continue;
                const seq = this._sequencer._state?.seqState?.[group];
                if (seq?.active && seq.binIdx >= 0) {
                    el.innerText = `THR:${fmt(this._sequencer.getThreshold(group))}`;
                } else {
                    el.innerText = 'THR:—';
                }
            }
        }
    }

    // ── Audio VU ─────────────────────────────────────────────────────────────

    updateVU(vol) {
        this._vuMeter.style.width = `${(vol / 255) * 100}%`;
        this._vuMeter.style.background = vol > 200 ? 'var(--accent)' : 'var(--fg)';
    }

    // ── SAB status ───────────────────────────────────────────────────────────

    setSabStatus(active) {
        this._sabStatus.innerText = active ? 'SAB: ACTIVE' : 'SAB: FALLBACK (postMessage)';
        this._sabStatus.style.background = active ? 'var(--fg)' : 'var(--accent)';
        if (active) this._sabStatus.style.color = 'var(--bg)';
    }

    // ── Gamepad indicators ───────────────────────────────────────────────────

    setGamepadStatus(connected, label = '') {
        const el = document.getElementById('gp-status');
        if (!el) return;
        el.innerText = connected ? `GAMEPAD: ${label.slice(0, 20)}` : 'GAMEPAD: DISCONNECTED';
        el.style.background = connected ? 'var(--fg)' : '#333';
        el.style.color = connected ? 'var(--bg)' : '#fff';
    }

    flashGamepadBtn(id) {
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.add('active');
        setTimeout(() => el.classList.remove('active'), 130);
    }

    syncGainSlider(gain) {
        const pct = Math.round(gain * 100);
        const slider = document.getElementById('audio-gain');
        const label = document.getElementById('gain-val');
        if (slider) slider.value = pct;
        if (label) label.innerText = `${pct}%`;
    }

    // ── System log ───────────────────────────────────────────────────────────

    log(msg) {
        const time = new Date().toTimeString().split(' ')[0];
        this._sysLog.innerHTML = `[${time}] ${msg}\n` + this._sysLog.innerHTML;
    }
}