/**
 * GP_LIVE // SYS.CTRL
 * input.js — keyboard, gamepad and pointer input handlers
 *
 * Author      : KRANK
 * Modified by : JaJo_EkiZ — click/touch support on key buttons (v0.2.0)
 * Version     : 0.2.0
 * License     : MIT
 *
 * Both handlers share the same onUpdate callback signature:
 *   onUpdate(group: string, key: string) → void
 *
 * Groups: 'palettes' | 'patterns' | 'effects' | 'loops' | 'space'
 *   plus internal groups prefixed with '_' for gamepad meta-events.
 */

import { KEY_MAPS } from './constants.js';

// ── Keyboard ─────────────────────────────────────────────────────────────────

export class KeyboardHandler {
    constructor(state, onUpdate) {
        this._state    = state;
        this._onUpdate = onUpdate;
        window.addEventListener('keydown', this._handle.bind(this));
    }

    _handle(e) {
        if (e.repeat) return;
        const key = e.key.toUpperCase();

        const FIELD = { palettes: 'palette', patterns: 'pattern', effects: 'effect', loops: 'loop' };

        const tryMap = (group) => {
            const idx = KEY_MAPS[group].indexOf(key);
            if (idx === -1) return false;
            this._state[FIELD[group]] = idx;
            this._onUpdate(group, key);
            this._highlightKey(group, idx);   // refleja el click visualmente
            return true;
        };

        tryMap('palettes') || tryMap('patterns') || tryMap('effects') || tryMap('loops');

        if (e.code === 'Space') {
            e.preventDefault();
            this._state.spaceTrig = (this._state.spaceTrig + 1) % 255;
            this._onUpdate('space', ' ');
            this._flashSpace();
        }
    }

    // ── Click binding ────────────────────────────────────────────────────────

    /**
     * Engancha los listeners de click a los botones ya renderizados en el DOM.
     * Llamar después de que el HTML esté poblado.
     */
    bindClickTargets() {
        const FIELD = { palettes: 'palette', patterns: 'pattern', effects: 'effect', loops: 'loop' };
        const ROWS  = {
            palettes : document.getElementById('keys-palettes'),
            patterns : document.getElementById('keys-patterns'),
            effects  : document.getElementById('keys-effects'),
            loops    : document.getElementById('keys-loops'),
        };

        for (const [group, row] of Object.entries(ROWS)) {
            if (!row) continue;
            row.addEventListener('click', (e) => {
                const btn = e.target.closest('[data-idx]');
                if (!btn) return;
                const idx = parseInt(btn.dataset.idx, 10);
                const key = KEY_MAPS[group][idx];
                this._state[FIELD[group]] = idx;
                this._onUpdate(group, key);
                this._highlightKey(group, idx);
            });
        }

        // Spacebar / burst
        const spaceBtn = document.getElementById('key-space');
        if (spaceBtn) {
            spaceBtn.addEventListener('click', () => {
                this._state.spaceTrig = (this._state.spaceTrig + 1) % 255;
                this._onUpdate('space', ' ');
                this._flashSpace();
            });
        }
    }

    // ── Visual feedback ──────────────────────────────────────────────────────

    _highlightKey(group, activeIdx) {
        const rowId = { palettes: 'keys-palettes', patterns: 'keys-patterns',
                        effects:  'keys-effects',  loops:    'keys-loops' }[group];
        const row = document.getElementById(rowId);
        if (!row) return;
        row.querySelectorAll('[data-idx]').forEach(btn => {
            btn.classList.toggle('active', parseInt(btn.dataset.idx, 10) === activeIdx);
        });
    }

    _flashSpace() {
        const btn = document.getElementById('key-space');
        if (!btn) return;
        btn.classList.add('active');
        setTimeout(() => btn.classList.remove('active'), 120);
    }
}
// ── Gamepad ──────────────────────────────────────────────────────────────────

export class GamepadHandler {
    static DEADZONE      = 0.15;
    static AXIS_THRESHOLD = 0.55;

    /**
     * @param {object}   state    Shared mutable state object.
     * @param {Function} onUpdate Same callback as KeyboardHandler.
     */
    constructor(state, onUpdate) {
        this._state        = state;
        this._onUpdate     = onUpdate;
        this._connected    = false;
        this._gpIndex      = -1;
        this._btnPrev      = new Uint8Array(32);
        this._axisDebounce = {};

        window.addEventListener('gamepadconnected',    this._onConnect.bind(this));
        window.addEventListener('gamepaddisconnected', this._onDisconnect.bind(this));
    }

    get connected() { return this._connected; }

    _onConnect(e) {
        this._connected = true;
        this._gpIndex   = e.gamepad.index;
        this._onUpdate('_gpconnect', e.gamepad.id);
    }

    _onDisconnect(e) {
        if (e.gamepad.index === this._gpIndex) {
            this._connected = false;
            this._gpIndex   = -1;
            this._onUpdate('_gpdisconnect', '');
        }
    }

    /**
     * Poll the gamepad API once per rAF frame.
     * Must be called from inside the animation loop.
     */
    poll() {
        if (!this._connected) return;
        const gp = navigator.getGamepads()[this._gpIndex];
        if (!gp) return;

        const st  = this._state;
        const now = performance.now();
        const ad  = this._axisDebounce;

        // Edge detection: fires only on the frame a button is first pressed.
        const fell = (idx) => {
            const cur  = gp.buttons[idx]?.pressed ? 1 : 0;
            const prev = this._btnPrev[idx];
            this._btnPrev[idx] = cur;
            return cur && !prev;
        };

        // Palettes: LB (4) ← → RB (5)
        if (fell(4)) { st.palette = (st.palette - 1 + 10) % 10; this._onUpdate('palettes', KEY_MAPS.palettes[st.palette]); }
        if (fell(5)) { st.palette = (st.palette + 1)      % 10; this._onUpdate('palettes', KEY_MAPS.palettes[st.palette]); }

        // Patterns: LT (6) ← → RT (7)
        if (fell(6)) { st.pattern = (st.pattern - 1 + 10) % 10; this._onUpdate('patterns', KEY_MAPS.patterns[st.pattern]); }
        if (fell(7)) { st.pattern = (st.pattern + 1)      % 10; this._onUpdate('patterns', KEY_MAPS.patterns[st.pattern]); }

        // Effects: D-pad ◄ (14) ► (15)
        if (fell(14)) { st.effect = (st.effect - 1 + 9) % 9; this._onUpdate('effects', KEY_MAPS.effects[st.effect]); }
        if (fell(15)) { st.effect = (st.effect + 1)     % 9; this._onUpdate('effects', KEY_MAPS.effects[st.effect]); }

        // Loop speed: D-pad ▲ (12) ▼ (13)
        if (fell(12)) { st.loop = Math.min(6, st.loop + 1); this._onUpdate('loops', KEY_MAPS.loops[st.loop]); }
        if (fell(13)) { st.loop = Math.max(0, st.loop - 1); this._onUpdate('loops', KEY_MAPS.loops[st.loop]); }

        // Burst: A (0) or B (1)
        if (fell(0) || fell(1)) {
            st.spaceTrig = (st.spaceTrig + 1) % 255;
            this._onUpdate('space', ' ');
        }

        // Start (9) → reset defaults
        if (fell(9)) {
            Object.assign(st, { palette: 0, pattern: 0, effect: 0, loop: 3 });
            this._onUpdate('palettes', '1');
            this._onUpdate('patterns', 'Q');
            this._onUpdate('effects',  'A');
            this._onUpdate('loops',    'V');
            this._onUpdate('_gpreset', '');
        }

        // Left stick Y → mic gain
        const lyRaw = gp.axes[1] ?? 0;
        const ly    = Math.abs(lyRaw) < GamepadHandler.DEADZONE ? 0 : lyRaw;
        if (ly !== 0) {
            st.gain = Math.max(0, Math.min(3.0, st.gain - ly * 0.015));
            this._onUpdate('_gpgain', st.gain);
        }

        // Right stick X → discrete pattern snap
        const rxRaw = gp.axes[2] ?? 0;
        const rx    = Math.abs(rxRaw) < GamepadHandler.DEADZONE ? 0 : rxRaw;
        if (rx > GamepadHandler.AXIS_THRESHOLD && !ad.rx_pos && now - (ad.rx_t ?? 0) > 200) {
            st.pattern = (st.pattern + 1) % 10;
            this._onUpdate('patterns', KEY_MAPS.patterns[st.pattern]);
            ad.rx_pos = true; ad.rx_t = now;
        } else if (rx < -GamepadHandler.AXIS_THRESHOLD && !ad.rx_neg && now - (ad.rx_t ?? 0) > 200) {
            st.pattern = (st.pattern - 1 + 10) % 10;
            this._onUpdate('patterns', KEY_MAPS.patterns[st.pattern]);
            ad.rx_neg = true; ad.rx_t = now;
        } else if (Math.abs(rx) < GamepadHandler.DEADZONE) {
            ad.rx_pos = ad.rx_neg = false;
        }
    }
}
