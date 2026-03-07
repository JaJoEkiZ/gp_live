/**
 * GP_LIVE // SYS.CTRL
 * renderer.js — Canvas2D visual engine: patterns, glyph bursts, post-effects
 *
 * Author      : KRANK
 * Modified by : JaJo_EkiZ — band-driven visuals, vol→band (v0.3.0)
 * Version     : 0.3.0
 * License : MIT
 *
 * One Renderer instance = one canvas. Instantiated in both the controller
 * preview panel (320×180) and the projector fullscreen canvas (1920×1080+).
 *
 * Pattern key → case map:
 *   Q=0  Dot Matrix          W=1  Audio Scope       E=2  ASCII/ROM Field
 *   R=3  ANSI/ROM Field      T=4  Grid Floor        Y=5  Sine Waveform
 *   U=6  Binary Rain         I=7  Polygons          O=8  Target Lock
 *   P=9  Noise Static
 *
 * Effect key → case map:
 *   A=0  None                S=1  Chromatic Aberration   D=2  CRT Scanlines
 *   F=3  Glitch Slice        G=4  Invert Block           H=5  Pixelate
 *   J=6  Feedback Zoom       K=7  Hue Shift              L=8  Total Chaos
 */

import { PALETTES, SPEED_MAP } from './constants.js';

export class Renderer {
    /**
     * @param {HTMLCanvasElement} canvas  Target rendering canvas.
     */
    constructor(canvas) {
        this._canvas = canvas;
        this._ctx = canvas.getContext('2d');
        this._t = 0;
        this._vectors = [];   // active glyph-burst particles
        this._lastSpaceTrig = 0;
        this._rom = null; // RomAtlas | null
        this._resize();
        window.addEventListener('resize', this._resize.bind(this));
    }

    /** Attach (or detach) a RomAtlas. Pass null to return to text mode. */
    setRom(atlas) { this._rom = atlas; }

    // ── Private geometry getters ─────────────────────────────────────────────

    get ctx() { return this._ctx; }
    get _cw() { return this._canvas.width; }
    get _ch() { return this._canvas.height; }
    get _cx() { return this._cw / 2; }
    get _cy() { return this._ch / 2; }

    _resize() {
        this._canvas.width = window.innerWidth;
        this._canvas.height = window.innerHeight;
    }

    // ── Main render entry ────────────────────────────────────────────────────

    render(state) {
        this._t += 0.02 * (SPEED_MAP[state.loop] ?? 1);

        const colors = PALETTES[state.palette] ?? PALETTES[0];
        const { ctx, _t: t, _cw: cw, _ch: ch } = this;
        const { effect } = state;

        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        ctx.fillStyle = effect === 0 ? colors.bg : `${colors.bg}dd`;
        ctx.fillRect(0, 0, cw, ch);
        ctx.lineWidth = 2 + (state.band / 50);

        this._drawPattern(state, colors);
        this._handleGlyphBursts(state, colors);
        this._applyEffect(state, colors);
    }

    // ── ROM cell helper ──────────────────────────────────────────────────────

    /**
     * Draw one tile from `seq` at the given position, or return false so the
     * caller can fall back to its original text/shape drawing code.
     * RomAtlas.draw() sets globalAlpha internally.
     *
     * @param {CanvasRenderingContext2D} ctx
     * @param {number[]|null}  seq    5-element tile-index array, or null.
     * @param {number}         i      Cycle index (will wrap via modulo).
     * @param {number}         x      Top-left x.
     * @param {number}         y      Top-left y.
     * @param {number}         size   Tile size in pixels.
     * @param {number}         alpha  0..1 opacity.
     * @param {object}         colors { c1, c2 } hex strings.
     * @returns {boolean}  true if tile was drawn; false if no ROM loaded.
     */
    _cell(ctx, seq, i, x, y, size, alpha, colors) {
        if (!seq) return false;
        this._rom.draw(
            ctx,
            seq[((i % seq.length) + seq.length) % seq.length],
            x, y, size,
            colors.c1, colors.c2,
            alpha
        );
        return true;
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  PATTERNS
    // ══════════════════════════════════════════════════════════════════════════

    _drawPattern(state, colors) {
        const { ctx, _t: t, _cw: cw, _ch: ch, _cx: cx, _cy: cy } = this;
        const { band, vol, freqs: rawFreqs, pattern } = state;
        // Scale all freqs by the band/vol ratio so patterns fully respect the
        // selected bin. If band=0 (silent bin), all reactive motion stops.
        const _scale = vol > 0 ? band / vol : 0;
        const freqs = rawFreqs.map(f => Math.floor(f * _scale));

        // When a ROM is loaded each pattern gets 5 unique tiles, sampled from
        // a different region of the atlas. Null → original drawing code runs.
        const seq = this._rom ? this._rom.getSeq(pattern, 5) : null;

        switch (pattern) {

            case 0: { // Q: Dot Matrix
                const SPACING = 20;
                ctx.fillStyle = colors.c1;
                let n = 0;
                for (let x = 0; x < cw; x += SPACING) {
                    const fv = (freqs[Math.floor((x / cw) * 16)] ?? 0) / 255;
                    for (let y = 0; y < ch; y += SPACING) {
                        const w1 = Math.sin(x * 0.05 + t * (1 + fv));
                        const w2 = Math.cos(y * 0.05 - t);
                        if (w1 * w2 > (0.1 - band / 1000)) {
                            if (!this._cell(ctx, seq, n++, x - 8, y - 8, 16, 0.9, colors)) {
                                ctx.fillRect(
                                    Math.floor((x + Math.round(w1) * SPACING) / SPACING) * SPACING,
                                    Math.floor((y + Math.round(w2) * SPACING) / SPACING) * SPACING,
                                    6, 6
                                );
                            }
                        }
                    }
                }
                ctx.globalAlpha = 1;
                break;
            }

            case 1: { // W: Circular Audio Scope
                if (seq) {
                    let n = 0;
                    for (let i = 0; i <= Math.PI * 2; i += 0.25) {
                        const fIdx = Math.floor((i / (Math.PI * 2)) * 15);
                        const r = 100 + freqs[fIdx] + band * Math.sin(t * 5);
                        this._cell(ctx, seq, n++,
                            cx + Math.cos(i + t) * r - 8,
                            cy + Math.sin(i + t) * r - 8,
                            16, 0.85, colors);
                    }
                    ctx.globalAlpha = 1;
                } else {
                    ctx.strokeStyle = colors.c2;
                    ctx.beginPath();
                    for (let i = 0; i <= Math.PI * 2; i += 0.1) {
                        const fIdx = Math.floor((i / (Math.PI * 2)) * 15);
                        const r = 100 + freqs[fIdx] + band * Math.sin(t * 5);
                        const px = cx + Math.cos(i + t) * r;
                        const py = cy + Math.sin(i + t) * r;
                        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
                    }
                    ctx.closePath();
                    ctx.stroke();
                }
                break;
            }

            case 2: { // E: ASCII / ROM field
                const CHARS = '@#%&$!?/\\|{}[]<>~^*+=:;_-0OI';
                const SZ = seq ? 16 : 24;
                const cols = Math.ceil(cw / SZ);
                const rows = Math.ceil(ch / SZ);

                const field = (wx, wy) =>
                    Math.sin(wx * 0.055 + t * 0.7) * Math.cos(wy * 0.065 - t * 0.5) * 0.45 +
                    Math.sin(wx * 0.110 - t * 1.1) * Math.sin(wy * 0.095 + t * 0.65) * 0.35 +
                    Math.cos(wx * 0.030 + wy * 0.045 + t * 0.35) * 0.20;

                ctx.save();
                ctx.textBaseline = 'top';
                if (!seq) ctx.font = `${SZ - 2}px monospace`;

                let n = 0;
                for (let c = 0; c < cols; c++) {
                    for (let r = 0; r < rows; r++) {
                        const fv = freqs[Math.floor((c / cols) * 16)] / 255;
                        const val = field(c * SZ, r * SZ);
                        if (val < (0.05 - fv * 0.45 - band / 600)) continue;
                        const rot = Math.sin(c * 0.7 + r * 1.3 + t * 0.9) * 0.5 + 0.5;
                        if (rot < 0.2) continue;
                        const alpha = 0.3 + rot * 0.7;
                        if (!this._cell(ctx, seq, n++, c * SZ, r * SZ, SZ, alpha, colors)) {
                            const fi = ((c * 17 + r * 31) % CHARS.length + CHARS.length) % CHARS.length;
                            ctx.globalAlpha = alpha;
                            ctx.fillStyle = (c + r) % 2 === 0 ? colors.c1 : colors.c2;
                            ctx.fillText(CHARS[fi], c * SZ, r * SZ);
                        }
                    }
                }
                ctx.globalAlpha = 1;
                ctx.restore();
                break;
            }

            case 3: { // R: ANSI / ROM field
                const POOL = '╔╗╚╝╠╣╦╩╬═║─│┌┐└┘├┤┬┴┼█▓▒░▄▀▌▐';
                const SZ = seq ? 16 : 20;
                const cols = Math.ceil(cw / SZ);
                const rows = Math.ceil(ch / SZ);

                const field = (wx, wy) =>
                    Math.sin(wx * 0.070 + t * 0.60) * Math.cos(wy * 0.080 - t * 0.45) * 0.40 +
                    Math.cos(wx * 0.130 - t * 0.90) * Math.sin(wy * 0.120 + t * 0.55) * 0.35 +
                    Math.sin((wx + wy) * 0.040 + t * 0.25) * 0.25;

                ctx.save();
                ctx.textBaseline = 'top';
                if (!seq) ctx.font = `${SZ - 1}px monospace`;

                let n = 0;
                for (let c = 0; c < cols; c++) {
                    for (let r = 0; r < rows; r++) {
                        const fv = freqs[Math.floor((c / cols) * 16)] / 255;
                        const val = field(c * SZ, r * SZ);
                        if (val < (0.02 - fv * 0.45 - band / 620)) continue;
                        const scan = Math.sin(r * 0.8 + t * 4.5);
                        if (scan > 0.92 && Math.sin(c * 3.7 + t) > 0.5) continue;
                        const alpha = 0.4 + Math.abs(val) * 0.6;
                        if (!this._cell(ctx, seq, n++, c * SZ, r * SZ, SZ, alpha, colors)) {
                            const fi = ((c * 13 + r * 19) % POOL.length + POOL.length) % POOL.length;
                            ctx.globalAlpha = alpha;
                            ctx.fillStyle = (c + r) % 2 === 0 ? colors.c1 : colors.c2;
                            ctx.fillText(POOL[fi], c * SZ, r * SZ);
                        }
                    }
                }
                ctx.globalAlpha = 1;
                ctx.restore();
                break;
            }

            case 4: { // T: Grid Floor Perspective
                ctx.strokeStyle = colors.c1;
                for (let i = 0; i < ch; i += 30) {
                    const y = cy + Math.pow(i / ch, 2) * ch;
                    const off = (t * 50) % 30;
                    ctx.beginPath(); ctx.moveTo(0, y + off); ctx.lineTo(cw, y + off); ctx.stroke();
                }
                for (let i = 0; i < 16; i++) {
                    const barH = freqs[i] * 1.5;
                    const bx = cx - 400 + i * 50;
                    if (seq) {
                        const tileH = 16;
                        for (let row = 0; row < Math.ceil(barH / tileH); row++) {
                            this._cell(ctx, seq, i + row, bx, cy - row * tileH - tileH, tileH, 0.9, colors);
                        }
                        ctx.globalAlpha = 1;
                    } else {
                        ctx.fillStyle = colors.c2;
                        ctx.fillRect(bx, cy, 40, -barH);
                    }
                }
                break;
            }

            case 5: { // Y: Sine Waveform
                if (seq) {
                    let n = 0;
                    for (let x = 0; x < cw; x += 18) {
                        const y = cy + Math.sin(x * 0.01 + t * 5) * freqs[Math.floor((x / cw) * 16)];
                        this._cell(ctx, seq, n++, x - 8, y - 8, 16, 0.9, colors);
                    }
                    ctx.globalAlpha = 1;
                } else {
                    ctx.strokeStyle = colors.c1;
                    ctx.beginPath();
                    for (let x = 0; x < cw; x += 10) {
                        const y = cy + Math.sin(x * 0.01 + t * 5) * freqs[Math.floor((x / cw) * 16)];
                        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
                    }
                    ctx.stroke();
                }
                break;
            }

            case 6: { // U: Binary Rain / Tile Cascade
                if (seq) {
                    const cols = Math.ceil(cw / 18);
                    for (let i = 0; i < cols; i++) {
                        if (freqs[i % 16] <= 60) continue;
                        const y = ((Math.sin(i * 3.7) * 0.5 + 0.5) * ch + t * 180) % ch;
                        this._cell(ctx, seq, i, i * 18, y, 16, 0.9, colors);
                    }
                    ctx.globalAlpha = 1;
                } else {
                    ctx.fillStyle = colors.c2;
                    ctx.font = '20px monospace';
                    for (let i = 0; i < 30; i++) {
                        if (freqs[i % 16] > 100) {
                            ctx.fillText(
                                Math.random() > 0.5 ? '1' : '0',
                                (i * 50 + t * 100) % cw,
                                (Math.sin(i * 123) * ch + t * 200) % ch
                            );
                        }
                    }
                }
                break;
            }

            case 7: { // I: Concentric Polygons
                const sides = 3 + Math.floor(band / 50);
                if (seq) {
                    let n = 0;
                    for (let r = 50; r < Math.min(cw, ch) * 0.7; r += 80) {
                        const dir = r % 2 === 0 ? 1 : -1;
                        for (let i = 0; i <= sides; i++) {
                            const ang = (i / sides) * Math.PI * 2 + t * dir;
                            this._cell(ctx, seq, n++,
                                cx + Math.cos(ang) * r - 8,
                                cy + Math.sin(ang) * r - 8,
                                16, 0.9, colors);
                        }
                    }
                    ctx.globalAlpha = 1;
                } else {
                    ctx.strokeStyle = colors.c1;
                    for (let r = 50; r < cw; r += 80) {
                        const dir = r % 2 === 0 ? 1 : -1;
                        ctx.beginPath();
                        for (let i = 0; i <= sides; i++) {
                            const ang = (i / sides) * Math.PI * 2 + t * dir;
                            const px = cx + Math.cos(ang) * r;
                            const py = cy + Math.sin(ang) * r;
                            i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
                        }
                        ctx.stroke();
                    }
                }
                break;
            }

            case 8: { // O: Target Lock
                if (seq) {
                    let n = 0;
                    for (let x = 0; x < cw; x += 24) this._cell(ctx, seq, n++, x, cy - 8, 16, 0.7, colors);
                    for (let y = 0; y < ch; y += 24) this._cell(ctx, seq, n++, cx - 8, y, 16, 0.7, colors);
                    [100 + band, 150 + freqs[2]].forEach(radius => {
                        for (let a = 0; a < Math.PI * 2; a += 0.2) {
                            this._cell(ctx, seq, n++,
                                cx + Math.cos(a + t) * radius - 8,
                                cy + Math.sin(a + t) * radius - 8,
                                16, 0.85, colors);
                        }
                    });
                    ctx.globalAlpha = 1;
                } else {
                    ctx.strokeStyle = colors.c2;
                    ctx.beginPath(); ctx.arc(cx, cy, 100 + band, 0, Math.PI * 2); ctx.stroke();
                    ctx.beginPath(); ctx.arc(cx, cy, 150 + freqs[2], t, t + Math.PI); ctx.stroke();
                    ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(cw, cy); ctx.stroke();
                    ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, ch); ctx.stroke();
                }
                break;
            }

            case 9: { // P: Noise Static
                if (seq) {
                    for (let i = 0; i < Math.floor(band * 1.5); i++) {
                        this._cell(ctx, seq, i,
                            Math.random() * cw, Math.random() * ch,
                            8 + Math.random() * 16,
                            0.6 + Math.random() * 0.4, colors);
                    }
                    ctx.globalAlpha = 1;
                } else {
                    ctx.fillStyle = colors.c1;
                    for (let i = 0; i < band * 5; i++) {
                        ctx.fillRect(Math.random() * cw, Math.random() * ch,
                            Math.random() * 10, Math.random() * 10);
                    }
                }
                break;
            }
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  GLYPH BURSTS (SPACEBAR / BTN-A)
    // ══════════════════════════════════════════════════════════════════════════

    _handleGlyphBursts(state, colors) {
        const { ctx, _cw: cw, _ch: ch } = this;
        const { spaceTrig } = state;

        // Fallback char pools when no ROM is loaded
        const BOX_D = '╔╗╚╝╠╣╦╩╬═║╪╫';
        const BOX_S = '┌┐└┘├┤┬┴┼─│╴╵╶╷';
        const ASCII = '@#%&!?/\\|{}[]<>~^*+=:;_-';
        const BLOCKS = '█▓▒░▄▀▌▐▙▛▜▟■▪';

        const SIGILS = [
            ['  ╬  ', '═╬═╬═╬═', '  ╬  '],
            [' ╔══╗ ', '╠ ◉◉ ╣', ' ╚══╝ '],
            ['╔═╗╔═╗', '║◈║║◈║', '╚╦╩╦╝', '  ╩╩  '],
            ['   ╦   ', ' ╔═╩═╗ ', '═╣ ◈ ╠═', ' ╚═╦═╝ ', '   ╩   '],
            [' ↑↑↑ ', '←← ╬ →→', ' ↓↓↓ '],
        ];

        // Deterministic hash: produces uniform float in [0,1) from two ints + seed
        const uh = (a, b, s = 0) => {
            let h = (Math.imul(a ^ 0xdeadbeef, 2246822519)
                ^ Math.imul(b ^ 0xcafebabe, 1013904223)
                ^ Math.imul(s, 374761393)) >>> 0;
            h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
            h ^= h >>> 13;
            return (h >>> 0) / 0xFFFFFFFF;
        };

        // Spawn a new burst on spacebar
        if (spaceTrig !== this._lastSpaceTrig) {
            this._lastSpaceTrig = spaceTrig;
            const type = Math.floor(Math.random() * 5);
            const seed = Math.floor(Math.random() * 65535);
            this._vectors.push({
                x: Math.random() * cw, y: Math.random() * ch,
                type, life: 1.0, age: 0, seed,
                c1: Math.random() > 0.5 ? colors.c1 : colors.c2,
                c2: Math.random() > 0.5 ? colors.c2 : colors.c1,
                decay: [0.013, 0.011, 0.015, 0.014, 0.012][type],
                seq: this._rom ? this._rom.getSeq(seed % 10, 5) : null,
            });
        }

        ctx.save();
        ctx.textBaseline = 'middle';

        for (let i = this._vectors.length - 1; i >= 0; i--) {
            const v = this._vectors[i];
            v.age += 1;
            v.life -= v.decay;
            if (v.life <= 0) { this._vectors.splice(i, 1); continue; }

            // Per-burst draw helper: ROM tile or fallback text character
            const bc = (pool, idx, x, y, sz, alpha) => {
                if (!this._cell(ctx, v.seq, idx, x - sz / 2, y - sz / 2, sz, alpha, { c1: v.c1, c2: v.c2 })) {
                    ctx.globalAlpha = alpha;
                    ctx.fillStyle = idx % 2 === 0 ? v.c1 : v.c2;
                    ctx.fillText(pool[Math.floor(uh(idx, v.seed) * pool.length)], x, y);
                }
            };

            switch (v.type) {

                case 0: { // Radial Ring Burst
                    const RINGS = 6, SZ = 15;
                    if (!v.seq) ctx.font = `${SZ}px monospace`;
                    for (let ring = 0; ring < RINGS; ring++) {
                        if (v.age < ring * 5) continue;
                        const rAge = v.age - ring * 5;
                        const radius = rAge * 4 + ring * 18;
                        const nChars = Math.max(6, Math.floor(2 * Math.PI * radius / SZ));
                        const ringLife = Math.max(0, 1 - rAge / 45);
                        const pool = ring % 2 === 0 ? BOX_D : BOX_S;
                        for (let j = 0; j < nChars; j++) {
                            const ang = (j / nChars) * Math.PI * 2 + v.age * 0.018;
                            bc(pool, j + ring * 10,
                                v.x + Math.cos(ang) * radius,
                                v.y + Math.sin(ang) * radius,
                                SZ, v.life * ringLife);
                        }
                    }
                    break;
                }

                case 1: { // Nested ANSI Frames
                    const MAX_F = 7, SZ = 13;
                    if (!v.seq) ctx.font = `${SZ}px monospace`;
                    for (let f = 0; f < MAX_F; f++) {
                        if (v.age < f * 4) continue;
                        const fw = (f + 1) * 3;
                        const fh = (f + 1) * 2;
                        const frameLife = Math.max(0, 1 - (v.age - f * 4) / 38);
                        let n = f * 30;
                        for (let c = -fw; c <= fw; c++) {
                            for (let r = -fh; r <= fh; r++) {
                                const eX = Math.abs(c) === fw, eY = Math.abs(r) === fh;
                                if (!eX && !eY) continue;
                                if (!(eX && eY) && uh(c + fw, r + fh, v.seed + f + Math.floor(v.age / 4)) < 0.28 * (1 - frameLife)) continue;
                                const glyph = eX && eY
                                    ? (c < 0 ? (r < 0 ? '╔' : '╚') : (r < 0 ? '╗' : '╝'))
                                    : (eX ? '║' : '═');
                                bc([glyph], n++, v.x + c * SZ, v.y + r * SZ, SZ, v.life * frameLife);
                            }
                        }
                    }
                    break;
                }

                case 2: { // ASCII Supernova
                    const SPOKES = 10 + Math.floor(uh(v.seed, 0, 1) * 10), SZ = 13;
                    if (!v.seq) ctx.font = `${SZ}px monospace`;
                    for (let s = 0; s < SPOKES; s++) {
                        const baseAng = (s / SPOKES) * Math.PI * 2 + v.seed * 0.001;
                        const reach = Math.floor(v.age * 0.55);
                        for (let d = 0; d < reach && d < 22; d++) {
                            const r = d * SZ * 1.25;
                            const ang = baseAng + Math.sin(d * 0.35 + v.age * 0.06) * 0.25;
                            const pool = d < 4 ? BLOCKS : (d < 12 ? BOX_S : ASCII);
                            bc(pool, s * 25 + d,
                                v.x + Math.cos(ang) * r,
                                v.y + Math.sin(ang) * r,
                                SZ, v.life * Math.max(0, 1 - d / 22));
                        }
                    }
                    break;
                }

                case 3: { // Block Column Drain
                    const COLS = 4 + Math.floor(uh(v.seed, 1, 0) * 7);
                    const ROWS = 14 + Math.floor(uh(v.seed, 2, 0) * 8);
                    const SZ = 11;
                    const ox = v.x - (COLS * SZ) / 2;
                    const oy = v.y - (ROWS * SZ) / 2;
                    if (!v.seq) ctx.font = `${SZ}px monospace`;
                    for (let c = 0; c < COLS; c++) {
                        for (let r = 0; r < ROWS; r++) {
                            const fillAge = v.age - r * 1.4 - c * 0.4;
                            if (fillAge < 0) continue;
                            const drainAge = fillAge - 18;
                            if (drainAge > ROWS * 2) continue;
                            const intensity = drainAge < 0
                                ? Math.min(1, fillAge / 4)
                                : Math.max(0, 1 - drainAge / (ROWS * 1.6));
                            const bi = Math.min(BLOCKS.length - 1, Math.floor((1 - intensity) * BLOCKS.length));
                            bc([BLOCKS[bi]], c * ROWS + r,
                                ox + c * SZ + SZ / 2, oy + r * SZ + SZ / 2,
                                SZ, v.life * intensity);
                        }
                    }
                    break;
                }

                case 4: { // ASCII Sigil
                    const SZ = 17;
                    const sigil = SIGILS[Math.floor(uh(v.seed, 0, 99) * SIGILS.length)];
                    if (!v.seq) ctx.font = `bold ${SZ}px monospace`;
                    const fadeIn = Math.min(1, v.age / 12);
                    const decayT = Math.pow(Math.max(0, 1 - v.life), 1.6);
                    let n = 0;
                    for (let row = 0; row < sigil.length; row++) {
                        const line = sigil[row];
                        for (let col = 0; col < line.length; col++) {
                            if (line[col] === ' ') continue;
                            const cr = uh(col, row, v.seed + Math.floor(v.age * 0.8));
                            const glyph = cr < decayT
                                ? (cr < decayT * 0.5 ? BOX_D : ASCII)[Math.floor(uh(col * 3, row * 7, v.age) * (cr < decayT * 0.5 ? BOX_D.length : ASCII.length))]
                                : line[col];
                            bc([glyph], n++,
                                v.x + (col - line.length / 2) * SZ * 0.62,
                                v.y + (row - sigil.length / 2) * SZ,
                                SZ, v.life * fadeIn * (0.55 + 0.45 * (1 - cr * decayT)));
                        }
                    }
                    break;
                }
            }
        }

        ctx.globalAlpha = 1;
        ctx.restore();
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  POST-PROCESSING EFFECTS
    // ══════════════════════════════════════════════════════════════════════════

    _applyEffect(state, colors) {
        if (state.effect === 0) return;
        const { ctx, _canvas: canvas, _cw: cw, _ch: ch, _t: t } = this;
        const { band, effect } = state;

        switch (effect) {
            case 1: // S: Chromatic Aberration
                ctx.globalCompositeOperation = 'lighter';
                ctx.drawImage(canvas, 10 + band / 10, 0);
                ctx.drawImage(canvas, -(10 + band / 10), 0);
                break;
            case 2: // D: CRT Scanlines
                ctx.fillStyle = 'rgba(0,0,0,0.4)';
                for (let y = 0; y < ch; y += 4) ctx.fillRect(0, y, cw, 2);
                break;
            case 3: // F: Glitch Slice
                if (Math.random() < 0.2 + band / 500) {
                    const gh = ch * (0.02 + Math.random() * 0.1);
                    const gy = Math.random() * ch;
                    ctx.drawImage(canvas, 0, gy, cw, gh, (Math.random() - 0.5) * 100, gy, cw, gh);
                }
                break;
            case 4: // G: Invert Color Block
                ctx.globalCompositeOperation = 'difference';
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(Math.random() * cw * 0.5, Math.random() * ch * 0.5,
                    cw * 0.5 * Math.random(), ch * Math.random());
                break;
            case 5: // H: Pixelate / Mosaic
                ctx.drawImage(canvas, 0, 0, cw * 0.1, ch * 0.1);
                ctx.imageSmoothingEnabled = false;
                ctx.drawImage(canvas, 0, 0, cw * 0.1, ch * 0.1, 0, 0, cw, ch);
                ctx.imageSmoothingEnabled = true;
                break;
            case 6: // J: Feedback Zoom
                ctx.drawImage(canvas, -10, -10, cw + 20, ch + 20);
                break;
            case 7: // K: Hue Shift
                ctx.globalCompositeOperation = 'hue';
                ctx.fillStyle = `hsl(${(t * 100) % 360}, 100%, 50%)`;
                ctx.fillRect(0, 0, cw, ch);
                break;
            case 8: // L: Total Chaos
                ctx.drawImage(canvas,
                    (Math.random() - 0.5) * band * 0.5,
                    (Math.random() - 0.5) * band * 0.5);
                ctx.globalCompositeOperation = 'difference';
                ctx.fillStyle = Math.random() > 0.5 ? colors.c1 : colors.c2;
                if (Math.random() > 0.7) ctx.fillRect(0, Math.random() * ch, cw, 50);
                break;
        }
        ctx.globalCompositeOperation = 'source-over';
    }
}
