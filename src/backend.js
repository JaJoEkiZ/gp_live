/**
 * GP_LIVE // SYS.CTRL
 * backend.js — BackendController: audio loop, input routing, ROM loading
 *
 * Author      : KRANK
 * Modified by : JaJo_EkiZ — pass onUpdate+state to BackendUI for click support (v0.2.0)
 *                          — bass/mid/high into state + spectrum update call (v0.3.0)
 * Version     : 0.3.0
 * License     : MIT
 *
 * Owns the rAF loop for the controller window. Responsibilities:
 *   — Read microphone FFT each frame and push data into shared state.
 *   — Poll the gamepad inside the existing rAF (zero extra overhead).
 *   — Synchronise state to the projector via SAB or postMessage fallback.
 *   — Handle ROM file loading, scan-parameter UI, and tile forwarding.
 */

import { createState } from './constants.js';
import { SabTransport } from './transport.js';
import { AudioEngine } from './audio.js';
import { KeyboardHandler, GamepadHandler } from './input.js';
import { BackendUI } from './ui.js';
import { PreviewPanel } from './preview.js';
import { RomParser } from './rom.js';

export class BackendController {
    constructor() {
        this._state = createState();
        this._sab = new SabTransport();
        this._audio = new AudioEngine();
        this._ui = new BackendUI(this._onInputUpdate.bind(this), this._state);
        this._preview = new PreviewPanel(this._state);
        this._gamepad = new GamepadHandler(this._state, this._onInputUpdate.bind(this));
        this._projWin = null;
        this._counter = 0;
        this._romAtlas = null;

        this._bindButtons();
        this._bindRomLoader();
        this._ui.setGamepadStatus(false);
    }

    // ── Input routing ────────────────────────────────────────────────────────

    _onInputUpdate(group, key) {
        switch (group) {
            case 'space':
                this._ui.flashSpace();
                this._ui.flashGamepadBtn('gp-a');
                break;
            case 'palettes': this._ui.updateKeyGroup('palettes', key); this._ui.flashGamepadBtn('gp-lr'); break;
            case 'patterns': this._ui.updateKeyGroup('patterns', key); this._ui.flashGamepadBtn('gp-lr2'); break;
            case 'effects': this._ui.updateKeyGroup('effects', key); this._ui.flashGamepadBtn('gp-dpad-x'); break;
            case 'loops': this._ui.updateKeyGroup('loops', key); this._ui.flashGamepadBtn('gp-dpad-y'); break;
            case '_gpconnect':
                this._ui.setGamepadStatus(true, key);
                this._ui.log(`Gamepad connected: ${key}`);
                break;
            case '_gpdisconnect':
                this._ui.setGamepadStatus(false);
                this._ui.log('Gamepad disconnected.');
                break;
            case '_gpreset':
                this._ui.log('Gamepad: state reset to defaults.');
                this._ui.flashGamepadBtn('gp-start');
                break;
            case '_gpgain':
                this._ui.syncGainSlider(key);
                break;
        }
    }

    // ── ROM Loader ───────────────────────────────────────────────────────────

    _bindRomLoader() {
        const zone = document.getElementById('rom-drop-zone');
        const input = document.getElementById('rom-file-input');

        let _buf = null;
        let _header = null;
        let _banks = [];

        const ui = {
            label: document.getElementById('rom-drop-label'),
            strip: document.getElementById('rom-tile-strip'),
            meta: document.getElementById('rom-meta'),
            meta2: document.getElementById('rom-meta2'),
            modeLabel: document.getElementById('rom-mode-label'),
            scanCtrl: document.getElementById('rom-scan-controls'),
            scanMode: document.getElementById('rom-scan-mode'),
            bankRow: document.getElementById('rom-bank-row'),
            bankSel: document.getElementById('rom-bank-sel'),
            manualRow: document.getElementById('rom-manual-row'),
            offStart: document.getElementById('rom-off-start'),
            offEnd: document.getElementById('rom-off-end'),
            qualSlider: document.getElementById('rom-quality'),
            qualVal: document.getElementById('rom-quality-val'),
            rescanBtn: document.getElementById('rom-rescan'),
        };

        ui.scanMode.addEventListener('change', () => {
            ui.bankRow.style.display = ui.scanMode.value === 'bank' ? 'flex' : 'none';
            ui.manualRow.style.display = ui.scanMode.value === 'manual' ? 'flex' : 'none';
        });

        ui.qualSlider.addEventListener('input', () => {
            ui.qualVal.textContent = `${ui.qualSlider.value}%`;
        });

        const applyAtlas = (atlas) => {
            this._romAtlas = atlas;
            this._preview._renderer.setRom(atlas);
            ui.strip.style.display = 'block';
            atlas.renderStrip(ui.strip, '#00ffcc', '#ff0055');
            document.getElementById('rom-tile-count').textContent = atlas.tileCount;
            ui.meta.style.display = 'flex';
            ui.modeLabel.style.display = 'block';
            this._sendRomToProjector();
        };

        const buildOpts = () => {
            const minScore = parseInt(ui.qualSlider.value) / 100;
            const mode = ui.scanMode.value;
            if (mode === 'auto') {
                return { start: 0x150, end: _buf.byteLength, minScore };
            }
            if (mode === 'bank') {
                const bank = _banks[parseInt(ui.bankSel.value)] ?? _banks[0];
                return { start: bank?.start ?? 0x150, end: bank?.end ?? _buf.byteLength, minScore };
            }
            const parseHex = (s, fallback) => {
                const n = parseInt(s.trim(), s.trim().startsWith('0x') ? 16 : 10);
                return isNaN(n) ? fallback : n;
            };
            return {
                start: parseHex(ui.offStart.value, 0x150),
                end: parseHex(ui.offEnd.value, _buf.byteLength),
                minScore,
            };
        };

        const scan = (opts) => {
            if (!_buf) return null;
            const atlas = RomParser.parse(_buf, opts);
            applyAtlas(atlas);
            const s = (opts.start ?? 0x150).toString(16);
            const e = (opts.end ?? _buf.byteLength).toString(16);
            const q = Math.round((opts.minScore ?? 0.35) * 100);
            this._ui.log(`Scan [0x${s}–0x${e}] → ${atlas.tileCount} tiles (quality ≥ ${q}%)`);
            return atlas;
        };

        ui.rescanBtn.addEventListener('click', () => scan(buildOpts()));

        const load = async (file) => {
            if (!file) return;
            const MAX_MB = 8;
            if (file.size > MAX_MB * 1024 * 1024) {
                this._ui.log(`ROM too large (${(file.size / 1048576).toFixed(1)} MB > ${MAX_MB} MB)`);
                return;
            }

            this._ui.log(`Loading: ${file.name} (${(file.size / 1024).toFixed(0)} KB)…`);
            zone.classList.remove('loaded');
            ui.label.textContent = '⟳ PARSING…';

            try {
                _buf = await file.arrayBuffer();
                _header = RomParser.parseHeader(_buf);
                _banks = _header ? RomParser.getBanks(_buf, _header) : [];

                ui.bankSel.innerHTML = '';
                _banks.forEach((b, i) => {
                    const opt = document.createElement('option');
                    opt.value = i;
                    opt.textContent = b.label;
                    ui.bankSel.appendChild(opt);
                });

                if (_header) {
                    document.getElementById('rom-title').textContent = _header.title;
                    document.getElementById('rom-size').textContent = `${(file.size / 1024).toFixed(0)} KB`;
                    document.getElementById('rom-cart-type').textContent = _header.cartType;
                    document.getElementById('rom-bank-count').textContent = _header.bankCount;
                    const chkEl = document.getElementById('rom-chk-status');
                    chkEl.textContent = `CHK: ${_header.checksumOk ? 'OK ✓' : 'FAIL ✗'}`;
                    chkEl.style.color = _header.checksumOk ? 'var(--fg)' : 'var(--accent)';
                    ui.meta2.style.display = 'flex';
                    ui.offEnd.value = `0x${_buf.byteLength.toString(16)}`;
                    this._ui.log(
                        `Header: "${_header.title}" | ${_header.cartType} | ${_header.bankCount} banks` +
                        ` | CGB: ${_header.isCGB ? 'YES' : 'NO'} | CHK: ${_header.checksumOk ? 'OK' : 'FAIL'}`
                    );
                } else {
                    this._ui.log('No valid GB header — scanning entire file.');
                    document.getElementById('rom-title').textContent = 'NO HEADER';
                    ui.meta2.style.display = 'flex';
                }

                ui.scanCtrl.style.display = 'block';

                const atlas = scan(buildOpts());
                if (atlas?.tileCount === 0) {
                    this._ui.log('No tiles found. Try lowering the QUALITY slider or changing scan range.');
                }

                zone.classList.add('loaded');
                ui.label.textContent = `◈ ${_header?.title ?? file.name} LOADED`;

            } catch (err) {
                this._ui.log(`ROM error: ${err.message}`);
                ui.label.textContent = '▸ DRAG & DROP .gb/.gbc OR CLICK TO LOAD';
            }
        };

        zone.addEventListener('click', () => input.click());
        input.addEventListener('change', (e) => load(e.target.files[0]));
        zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
        zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
        zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('dragover'); load(e.dataTransfer.files[0]); });
    }

    // ── ROM → projector serialization ────────────────────────────────────────

    _sendRomToProjector() {
        if (!this._romAtlas || !this._projWin || this._projWin.closed) return;
        const count = this._romAtlas.tileCount;
        const flat = new Uint8Array(count * 64);
        for (let i = 0; i < count; i++) {
            flat.set(this._romAtlas._tiles[i], i * 64);
        }
        const copy = new Uint8Array(flat);
        this._projWin.postMessage({ type: 'ROM_DATA', tileCount: count, tiles: copy }, '*', [copy.buffer]);
    }

    // ── Button bindings ───────────────────────────────────────────────────────

    _bindButtons() {
        document.getElementById('btn-init').addEventListener('click', async (e) => {
            try {
                await this._audio.init();

                const sabOk = this._sab.init();
                this._ui.setSabStatus(sabOk);
                this._ui.log(sabOk
                    ? 'Audio pipeline active. SAB buffer allocated.'
                    : 'Audio pipeline active. SAB unavailable — using postMessage fallback.');

                new KeyboardHandler(this._state, this._onInputUpdate.bind(this));

                document.getElementById('audio-gain').addEventListener('input', ({ target }) => {
                    this._state.gain = target.value / 100;
                    document.getElementById('gain-val').innerText = `${target.value}%`;
                });

                e.target.disabled = true;
                e.target.innerText = 'ENGINE ONLINE';
                document.getElementById('btn-projector').disabled = false;
                requestAnimationFrame(this._loop.bind(this));

            } catch (err) {
                this._ui.log(`ERROR: ${err.message}`);
                alert('Microphone access is required.');
            }
        });

        document.getElementById('btn-projector').addEventListener('click', () => {
            const url = `${window.location.href.split('?')[0]}?mode=projector`;
            this._projWin = window.open(url, 'GP_LIVE_Projector',
                'width=1280,height=720,menubar=no,toolbar=no,location=no');
            this._ui.log('Launching display window…');

            window.addEventListener('message', (e) => {
                if (e.data === 'PROJECTOR_READY') {
                    this._ui.log('Display sync established.');
                    this._projWin.postMessage({
                        type: 'INIT',
                        useSab: this._sab.active,
                        sab: this._sab.active ? this._sab.buffer : null,
                    }, '*');
                    if (this._romAtlas) {
                        setTimeout(() => this._sendRomToProjector(), 200);
                    }
                }
                if (e.data?.type === 'PREVIEW_FRAME' && e.data.bitmap) {
                    this._preview.receiveBitmap(e.data.bitmap);
                }
            });
        });
    }

    // ── RAF loop ─────────────────────────────────────────────────────────────

    _loop(now) {
        // 1. Audio — band source: mainGain > single bin > 0 (none)
        const { vol, freqs, bass, mid, high } = this._audio.read(this._state.gain);
        let band = 0;
        if (this._state.useMainGain) band = vol;
        else if (this._state.activeBand !== null) band = freqs[this._state.activeBand] ?? 0;
        Object.assign(this._state, { vol, freqs, bass, mid, high, band });
        this._ui.updateVU(vol);
        this._ui.updateSpectrum(freqs, bass, mid, high);

        // 2. Gamepad
        this._gamepad.poll();

        // 3. Sync state to projector
        if (this._sab.active) {
            this._sab.write(this._state, this._counter++);
        } else if (this._projWin && !this._projWin.closed) {
            this._projWin.postMessage({ type: 'STATE_UPDATE', state: this._state }, '*');
        }

        // 4. Detect projector close
        if (this._projWin?.closed) {
            this._projWin = null;
            this._preview.fallbackToLocal();
        }

        // 5. Preview
        this._preview.tick(now);

        requestAnimationFrame(this._loop.bind(this));
    }
}