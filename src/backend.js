/**
 * GP_LIVE // SYS.CTRL
 * backend.js — BackendController: audio loop, input routing, ROM loading
 *
 * Author      : KRANK
 * Modified by : JaJo_EkiZ — click support on key buttons (v0.2.0)
 *                          — bass/mid/high into state + spectrum update call (v0.3.0)
 *                          — activeBands + band scalar (v0.4.0)
 *                          — SequencerEngine per-group bin-driven stepping (v0.5.0)
 * Version     : 0.5.0
 * License     : MIT
 */

import { createState } from './constants.js';
import { SabTransport } from './transport.js';
import { AudioEngine } from './audio.js';
import { KeyboardHandler, GamepadHandler } from './input.js';
import { BackendUI } from './ui.js';
import { PreviewPanel } from './preview.js';
import { RomParser } from './rom.js';
import { SequencerEngine } from './sequencer.js';

export class BackendController {
    constructor() {
        this._state = createState();
        this._sab = new SabTransport();
        this._audio = new AudioEngine();
        this._preview = new PreviewPanel(this._state);
        this._gamepad = new GamepadHandler(this._state, this._onInputUpdate.bind(this));
        this._projWin = null;
        this._counter = 0;
        this._romAtlas = null;

        // ── Sequencer (v0.5.0) ───────────────────────────────────────────────
        // Created before BackendUI so ui.js can receive it in the constructor.
        this._sequencer = new SequencerEngine(this._state, this._onInputUpdate.bind(this));

        this._ui = new BackendUI(
            this._onInputUpdate.bind(this),
            this._state,
            this._sequencer,
        );

        this._bindButtons();
        this._bindRomLoader();
        this._ui.setGamepadStatus(false);

        // Band selection callback
        this._ui.onBandSelectionChange(() => {
            this._state.activeBands = this._ui.getActiveBins();
        });
    }

    // ── Input routing ────────────────────────────────────────────────────────

    _onInputUpdate(group, key) {
        switch (group) {
            case 'space':
                // Sequencer not active: advance burstType respecting blocks
                if (!this._state.seqState?.space?.active) {
                    this._advanceBurstType();
                }
                this._ui.flashSpace();
                this._ui.flashGamepadBtn('gp-a');
                this._ui.updateBurstType(this._state.burstType);
                break;
            case 'space-direct':
                // Direct burst type button click — burstType already set, just flash
                this._ui.flashSpace();
                this._ui.flashGamepadBtn('gp-a');
                this._ui.updateBurstType(this._state.burstType);
                break;
            case 'palettes':
                this._ui.updateKeyGroup('palettes', key);
                break;
            case 'patterns':
                this._ui.updateKeyGroup('patterns', key);
                break;
            case 'effects':
                this._ui.updateKeyGroup('effects', key);
                break;
            case 'loops':
                this._ui.updateKeyGroup('loops', key);
                break;
        }
        if (['palettes', 'patterns', 'effects', 'loops'].includes(group)) {
            const seq = this._state.seqState[group];
            if (seq?.active) this._ui.flashSeqStep(group);
        }
        if (group === 'space') {
            const seq = this._state.seqState?.space;
            if (seq?.active) this._ui.flashSeqStep('space');
        }
    }

    /** Advance burstType by one step, skipping blocked types. */
    _advanceBurstType() {
        const total = 5;
        const blocked = this._state.seqState?.space?.blockedSteps ?? new Set();
        if (blocked.size >= total) return;
        let next = this._state.burstType ?? 0;
        for (let i = 0; i < total; i++) {
            next = (next + 1) % total;
            if (!blocked.has(next)) break;
        }
        this._state.burstType = next;
    }

    // ── Button bindings ───────────────────────────────────────────────────────

    _bindButtons() {
        // Audio init (must be triggered by user gesture)
        document.getElementById('btn-init')?.addEventListener('click', async (e) => {
            await this._audio.init();
            this._ui.log('AUDIO: microphone initialized');
            this._ui.syncGainSlider(this._state.gain);
            e.target.disabled = true;
            e.target.innerText = 'ENGINE ONLINE';
            const projBtn = document.getElementById('btn-projector');
            if (projBtn) projBtn.disabled = false;
            requestAnimationFrame(this._loop.bind(this));
        });

        // Gain slider
        document.getElementById('audio-gain')?.addEventListener('input', (e) => {
            this._state.gain = parseInt(e.target.value) / 100;
            document.getElementById('gain-val').innerText = `${e.target.value}%`;
        });

        // Projector popup
        document.getElementById('btn-projector')?.addEventListener('click', () => {
            this._projWin = window.open('?mode=projector', 'projector',
                'width=1280,height=720,menubar=no,toolbar=no');
            this._projWin.addEventListener('load', () => {
                // Attempt SAB first
                if (this._sab.init()) {
                    this._projWin.postMessage(
                        { type: 'INIT', useSab: true, sab: this._sab.buffer }, '*');
                    this._ui.setSabStatus(true);
                } else {
                    this._projWin.postMessage(
                        { type: 'INIT', useSab: false }, '*');
                    this._ui.setSabStatus(false);
                }
            });

            window.addEventListener('message', ({ data }) => {
                if (data === 'PROJECTOR_READY') {
                    this._ui.log('PROJECTOR: connected');
                }
                if (data?.type === 'PREVIEW_FRAME' && data.bitmap) {
                    this._preview.receiveBitmap(data.bitmap);
                }
            });
        });
    }

    // ── ROM loader ────────────────────────────────────────────────────────────

    _bindRomLoader() {
        document.getElementById('rom-file')?.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            try {
                const buf = await file.arrayBuffer();
                const parser = new RomParser(new Uint8Array(buf));
                this._romAtlas = parser.atlas;
                const count = parser.tileCount;
                this._ui.log(`ROM: loaded "${file.name}" — ${count} tiles`);

                if (this._projWin && !this._projWin.closed) {
                    const flat = new Uint8Array(count * 64);
                    for (let i = 0; i < count; i++) {
                        flat.set(this._romAtlas.shadeArrays[i], i * 64);
                    }
                    this._projWin.postMessage(
                        { type: 'ROM_DATA', tiles: flat.buffer, tileCount: count }, '*',
                        [flat.buffer]);
                }
            } catch (err) {
                this._ui.log(`ROM ERR: ${err.message}`);
            }
        });

        document.getElementById('rom-rescan')?.addEventListener('click', () => {
            const start = parseInt(document.getElementById('rom-start')?.value ?? 0);
            const stride = parseInt(document.getElementById('rom-stride')?.value ?? 16);
            this._ui.log(`ROM RESCAN: start=${start} stride=${stride}`);
        });
    }

    // ── RAF loop ─────────────────────────────────────────────────────────────

    _loop(now) {
        // 1. Audio
        const { vol, freqs, bass, mid, high } = this._audio.read(this._state.gain);

        const active = this._state.activeBands;
        const activeBins = freqs.filter((_, i) => active[i]);
        const band = activeBins.length
            ? Math.floor(activeBins.reduce((a, b) => a + b, 0) / activeBins.length)
            : 0;

        Object.assign(this._state, { vol, freqs, bass, mid, high, band });
        this._ui.updateVU(vol);
        this._ui.updateSpectrum(freqs, bass, mid, high, band);

        // 2. Sequencer — tick before gamepad so manual overrides win on same frame
        this._sequencer.tick(now);

        // 3. Gamepad
        this._gamepad.poll();

        // 4. Sync state to projector
        if (this._sab.active) {
            this._sab.write(this._state, this._counter++);
        } else if (this._projWin && !this._projWin.closed) {
            this._projWin.postMessage({ type: 'STATE_UPDATE', state: this._state }, '*');
        }

        // 5. Detect projector close
        if (this._projWin?.closed) {
            this._projWin = null;
            this._preview.fallbackToLocal();
        }

        // 6. Preview
        this._preview.tick(now);

        requestAnimationFrame(this._loop.bind(this));
    }
}