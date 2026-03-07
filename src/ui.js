/**
 * GP_LIVE // SYS.CTRL
 * ui.js — BackendUI: DOM feedback layer for the controller window
 *
 * Author      : KRANK
 * Modified by : JaJo_EkiZ — click support on key buttons (v0.2.0)
 *                          — 16-band spectrum analyzer with bass/mid/high coloring (v0.3.0)
 * Version     : 0.3.0
 * License     : MIT
 *
 * All DOM mutation for the backend panel lives here.
 * BackendController calls these methods; it never touches the DOM directly.
 */

import { KEY_MAPS, BAND_RANGES } from './constants.js';

// Band color scheme: bass=red, mid=cyan, high=yellow
const BAND_COLORS = Object.freeze({
    bass: '#ff0055',
    mid: '#00ffcc',
    high: '#ffff00',
});

export class BackendUI {
    /**
     * @param {Function|null} onUpdate  Same callback used by KeyboardHandler/GamepadHandler.
     * @param {object|null}   state     Shared mutable state object.
     */
    constructor(onUpdate = null, state = null) {
        this._sysLog = document.getElementById('sys-log');
        this._vuMeter = document.getElementById('vu-meter');
        this._sabStatus = document.getElementById('sab-status');
        this._state = state;   // kept for spectrum selection
        this._buildKeys(onUpdate, state);
        this._buildSpectrum();
    }

    // ── Keyboard display ─────────────────────────────────────────────────────

    _buildKeys(onUpdate, state) {
        const FIELD = { palettes: 'palette', patterns: 'pattern', effects: 'effect', loops: 'loop' };

        const build = (containerId, group, keys, defaultActive) => {
            const container = document.getElementById(containerId);
            keys.forEach((k, idx) => {
                const el = document.createElement('div');
                el.className = 'key';
                el.id = `ui-key-${k}`;
                el.innerText = k;

                // ── click listener ───────────────────────────────────────
                if (onUpdate && state) {
                    el.addEventListener('click', () => {
                        state[FIELD[group]] = idx;
                        onUpdate(group, k);
                    });
                }
                // ────────────────────────────────────────────────────────

                container.appendChild(el);
            });
            document.getElementById(`ui-key-${defaultActive}`)?.classList.add('active');
        };

        build('keys-palettes', 'palettes', KEY_MAPS.palettes, '1');
        build('keys-patterns', 'patterns', KEY_MAPS.patterns, 'Q');
        build('keys-effects', 'effects', KEY_MAPS.effects, 'A');
        build('keys-loops', 'loops', KEY_MAPS.loops, 'V');

        // Spacebar / burst
        if (onUpdate && state) {
            document.getElementById('key-space')?.addEventListener('click', () => {
                state.spaceTrig = (state.spaceTrig + 1) % 255;
                onUpdate('space', ' ');
                this.flashSpace();
            });
        }
    }

    /** Highlight the active key in a group and dim the rest. */
    updateKeyGroup(group, activeKey) {
        KEY_MAPS[group]?.forEach(k => {
            document.getElementById(`ui-key-${k}`)
                ?.classList.toggle('active', k === activeKey);
        });
    }

    /** Brief flash on the spacebar indicator. */
    flashSpace() {
        const el = document.getElementById('key-space');
        if (!el) return;
        el.classList.add('active');
        setTimeout(() => el.classList.remove('active'), 100);
    }

    // ── Spectrum analyzer ────────────────────────────────────────────────────

    /**
     * Build the spectrum canvas and inject it into the audio panel,
     * right below the VU meter.
     */
    _buildSpectrum() {
        const vuContainer = document.getElementById('spectrum-container');
        if (!vuContainer) return;

        // Labels row: BASS / MID / HIGH
        const labels = document.createElement('div');
        labels.style.cssText = [
            'display:flex',
            'justify-content:space-between',
            'font-size:.65rem',
            'letter-spacing:.08em',
            'margin-bottom:4px',
        ].join(';');

        const mkLabel = (text, color) => {
            const s = document.createElement('span');
            s.innerText = text;
            s.style.color = color;
            return s;
        };
        labels.appendChild(mkLabel('◂ BASS', BAND_COLORS.bass));
        labels.appendChild(mkLabel('MID', BAND_COLORS.mid));
        labels.appendChild(mkLabel('HIGH ▸', BAND_COLORS.high));
        vuContainer.appendChild(labels);

        // Canvas
        this._specCanvas = document.createElement('canvas');
        this._specCanvas.width = 256;
        this._specCanvas.height = 96;
        this._specCanvas.style.cssText = [
            'width:100%',
            'height:96px',
            'margin-top:4px',
            'display:block',
            'image-rendering:pixelated',
            'cursor:crosshair',
        ].join(';');
        vuContainer.appendChild(this._specCanvas);
        this._specCtx = this._specCanvas.getContext('2d');

        // ── single-bar selection via click / drag ────────────────────────────────
        let _dragging = false;

        const _binFromX = (clientX) => {
            const rect = this._specCanvas.getBoundingClientRect();
            const x = (clientX - rect.left) / rect.width;  // 0..1
            return Math.min(15, Math.max(0, Math.floor(x * 16)));
        };

        const _select = (bin) => {
            if (!this._state) return;
            // Click on the already-selected bar → deselect (band = 0)
            if (this._state.activeBand === bin) {
                this._state.activeBand = null;
            } else {
                this._state.activeBand = bin;
            }
        };

        this._specCanvas.addEventListener('mousedown', (e) => {
            _dragging = true;
            _select(_binFromX(e.clientX));
            e.preventDefault();
        });
        this._specCanvas.addEventListener('mousemove', (e) => {
            if (!_dragging) return;
            _select(_binFromX(e.clientX));
        });
        const _stopDrag = () => { _dragging = false; };
        window.addEventListener('mouseup', _stopDrag);
        window.addEventListener('mouseleave', _stopDrag);
        // ───────────────────────────────────────────────────────────────────


        // Band value readouts: B:000 / M:000 / H:000
        this._bandReadout = document.createElement('div');
        this._bandReadout.style.cssText = [
            'display:flex',
            'justify-content:space-between',
            'margin-top:3px',
            'font-size:.65rem',
            'font-family:monospace',
        ].join(';');

        this._bassVal = document.createElement('span');
        this._midVal = document.createElement('span');
        this._highVal = document.createElement('span');
        this._actVal = document.createElement('span');
        this._bassVal.style.color = BAND_COLORS.bass;
        this._midVal.style.color = BAND_COLORS.mid;
        this._highVal.style.color = BAND_COLORS.high;
        this._actVal.style.color = '#888';
        this._bassVal.innerText = 'B:000';
        this._midVal.innerText = 'M:000';
        this._highVal.innerText = 'H:000';
        this._actVal.innerText = 'BIN:--';
        this._bandReadout.appendChild(this._bassVal);
        this._bandReadout.appendChild(this._midVal);
        this._bandReadout.appendChild(this._highVal);
        this._bandReadout.appendChild(this._actVal);
        vuContainer.appendChild(this._bandReadout);

        // ── MAIN GAIN checkbox ──────────────────────────────────────────
        const gainRow = document.createElement('label');
        gainRow.style.cssText = [
            'display:flex',
            'align-items:center',
            'gap:6px',
            'margin-top:6px',
            'font-size:.65rem',
            'font-family:monospace',
            'color:#888',
            'cursor:pointer',
            'user-select:none',
        ].join(';');

        this._mainGainChk = document.createElement('input');
        this._mainGainChk.type = 'checkbox';
        this._mainGainChk.id = 'main-gain-toggle';
        this._mainGainChk.checked = false;
        this._mainGainChk.style.accentColor = 'var(--fg, #00ffcc)';
        this._mainGainChk.addEventListener('change', () => {
            if (this._state) this._state.useMainGain = this._mainGainChk.checked;
            // Deselect bin when main gain takes over
            if (this._mainGainChk.checked && this._state)
                this._state.activeBand = null;
        });

        const gainLabel = document.createElement('span');
        gainLabel.innerText = 'MAIN GAIN INPUT';
        gainRow.appendChild(this._mainGainChk);
        gainRow.appendChild(gainLabel);
        vuContainer.appendChild(gainRow);
        // ──────────────────────────────────────────────────────────────
    }   // end _buildSpectrum

    // ── Spectrum render ───────────────────────────────────────────────────────

    /**
     * Render the 16-band spectrum. Called every rAF frame from BackendController.
     * Bars are colored by band: bass=red, mid=cyan, high=yellow.
     * The active bin (if any) is shown at full brightness; others at 18%.
     *
     * @param {number[]} freqs  16-element array of amplitudes 0..255.
     * @param {number}   bass   Band average 0..255.
     * @param {number}   mid    Band average 0..255.
     * @param {number}   high   Band average 0..255.
     */
    updateSpectrum(freqs, bass, mid, high) {
        if (!this._specCtx) return;

        const ctx = this._specCtx;
        const W = this._specCanvas.width;
        const H = this._specCanvas.height;
        const N = freqs.length;
        const barW = Math.floor(W / N);
        const gap = 1;
        const activeBand = this._state?.activeBand ?? null;
        const useMainGain = this._state?.useMainGain ?? false;

        // Background
        ctx.fillStyle = '#0a0c14';
        ctx.fillRect(0, 0, W, H);

        for (let i = 0; i < N; i++) {
            const active = !useMainGain && (i === activeBand);
            const val = freqs[i] / 255;
            const barH = Math.max(1, Math.floor(val * H));
            const x = i * barW;
            const y = H - barH;

            let color;
            if (i < BAND_RANGES.bass.end) color = BAND_COLORS.bass;
            else if (i < BAND_RANGES.mid.end) color = BAND_COLORS.mid;
            else color = BAND_COLORS.high;

            ctx.globalAlpha = active ? 1 : 0.18;
            ctx.fillStyle = color;
            ctx.fillRect(x, y, barW - gap, barH);

            ctx.globalAlpha = active ? 1 : 0.12;
            ctx.fillStyle = active ? '#ffffff' : '#333';
            ctx.fillRect(x, H - 2, barW - gap, 2);
        }
        ctx.globalAlpha = 1;

        const fmt = n => String(Math.round(n)).padStart(3, '0');
        let binLabel;
        if (useMainGain) binLabel = 'VOL';
        else if (activeBand !== null) binLabel = `BIN:${String(activeBand).padStart(2, '0')}`;
        else binLabel = 'BIN:--';

        this._bassVal.innerText = `B:${fmt(bass)}`;
        this._midVal.innerText = `M:${fmt(mid)}`;
        this._highVal.innerText = `H:${fmt(high)}`;
        this._actVal.innerText = binLabel;
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
