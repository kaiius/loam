// Minimal Canvas2D -> SVG shim, just enough for Wildcode's renderer/painter.
// Tracks a CTM and emits SVG elements with baked transforms.

export class SvgCtx {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.defs = [];
    this.body = [];
    this.stack = [];
    this.ctm = [1, 0, 0, 1, 0, 0];
    this.path = [];
    this.clipId = 0;
    this.gradId = 0;
    this.fillStyle = '#000';
    this.strokeStyle = '#000';
    this.lineWidth = 1;
    this.lineCap = 'butt';
    this.globalAlpha = 1;
    this.dash = '';
    this.font = '10px sans-serif';
    this.textAlign = 'left';
    this.clipPath = null;
    this._shapes = [];
  }

  // --- state ---
  save() {
    this.stack.push({
      ctm: [...this.ctm], fillStyle: this.fillStyle, strokeStyle: this.strokeStyle,
      lineWidth: this.lineWidth, lineCap: this.lineCap, globalAlpha: this.globalAlpha,
      dash: this.dash, font: this.font, textAlign: this.textAlign, clipPath: this.clipPath,
    });
  }
  restore() {
    const s = this.stack.pop();
    if (!s) return;
    Object.assign(this, {
      ctm: s.ctm, fillStyle: s.fillStyle, strokeStyle: s.strokeStyle,
      lineWidth: s.lineWidth, lineCap: s.lineCap, globalAlpha: s.globalAlpha,
      dash: s.dash, font: s.font, textAlign: s.textAlign, clipPath: s.clipPath,
    });
  }
  setLineDash(d) { this.dash = d.length ? d.join(' ') : ''; }
  get lineDashOffset() { return 0; }
  set lineDashOffset(v) {}

  // --- transforms ---
  transform(a, b, c, d, e, f) {
    const [a1, b1, c1, d1, e1, f1] = this.ctm;
    this.ctm = [
      a1 * a + c1 * b, b1 * a + d1 * b,
      a1 * c + c1 * d, b1 * c + d1 * d,
      a1 * e + c1 * f + e1, b1 * e + d1 * f + f1,
    ];
  }
  translate(x, y) { this.transform(1, 0, 0, 1, x, y); }
  scale(x, y) { this.transform(x, 0, 0, y === undefined ? x : y, 0, 0); }
  rotate(a) { this.transform(Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0); }
  get _t() { const [a, b, c, d, e, f] = this.ctm; return `matrix(${a} ${b} ${c} ${d} ${e} ${f})`; }

  // --- paths ---
  beginPath() { this.path = []; this._shapes = []; }
  moveTo(x, y) { this.path.push(`M${x} ${y}`); }
  lineTo(x, y) { this.path.push(`L${x} ${y}`); }
  quadraticCurveTo(cpx, cpy, x, y) { this.path.push(`Q${cpx} ${cpy} ${x} ${y}`); }
  closePath() { this.path.push('Z'); }
  arcTo(x1, y1, x2, y2) { this.lineTo(x1, y1); } // sharp-corner approx, fine for QA
  arc(x, y, r, a0, a1) {
    const full = Math.abs(a1 - a0) >= Math.PI * 2 - 0.01;
    if (full) { this._shapes.push({ kind: 'circle', x, y, r }); return; }
    const sx = x + r * Math.cos(a0), sy = y + r * Math.sin(a0);
    const ex = x + r * Math.cos(a1), ey = y + r * Math.sin(a1);
    const large = (a1 - a0) % (Math.PI * 2) > Math.PI ? 1 : 0;
    this.path.push(`M${sx} ${sy} A${r} ${r} 0 ${large} 1 ${ex} ${ey}`);
  }
  ellipse(x, y, rx, ry, rot = 0) {
    this._shapes.push({ kind: 'ellipse', x, y, rx, ry, rot });
  }

  _styleAttrs(extra = '') {
    const op = this.globalAlpha !== 1 ? ` opacity="${this.globalAlpha}"` : '';
    const dash = this.dash ? ` stroke-dasharray="${this.dash}"` : '';
    const clip = this.clipPath ? ` clip-path="url(#${this.clipPath})"` : '';
    return `${extra} transform="${this._t}"${op}${dash}${clip}`;
  }

  _emitShape(s) {
    if (s.kind === 'circle') {
      this.body.push(`<circle cx="${s.x}" cy="${s.y}" r="${s.r}"${this._styleAttrs()}/>`);
    } else {
      this.body.push(`<ellipse cx="${s.x}" cy="${s.y}" rx="${s.rx}" ry="${s.ry}"${s.rot ? '' : ''}${this._styleAttrs()}/>`);
    }
  }

  fill() {
    const fill = this._paint(this.fillStyle);
    this._flushShapes(fill, null);
    if (this.path.length) {
      this.body.push(`<path d="${this.path.join(' ')}" fill="${fill}" stroke="none"${this._styleAttrs()}/>`);
    }
    this.path = [];
  }
  stroke() {
    const stroke = this._paint(this.strokeStyle);
    this._flushShapes('none', stroke);
    if (this.path.length) {
      this.body.push(`<path d="${this.path.join(' ')}" fill="none" stroke="${stroke}" stroke-width="${this.lineWidth}" stroke-linecap="${this.lineCap}"${this._styleAttrs()}/>`);
    }
    this.path = [];
  }
  _flushShapes(fill, stroke) {
    // shapes were queued on a temp list during path building
    if (!this._shapes) this._shapes = [];
    for (const s of this._shapes) {
      const base = s.kind === 'circle'
        ? `<circle cx="${s.x}" cy="${s.y}" r="${s.r}"`
        : `<ellipse cx="${s.x}" cy="${s.y}" rx="${s.rx}" ry="${s.ry}"`;
      const sw = stroke && stroke !== 'none' ? ` stroke="${stroke}" stroke-width="${this.lineWidth}" stroke-linecap="${this.lineCap}"` : '';
      this.body.push(`${base} fill="${fill}"${sw}${this._styleAttrs()}/>`);
    }
    this._shapes = [];
  }
  _paint(style) {
    if (typeof style === 'string' && style.startsWith('hsl')) {
      return hslToRgb(style);
    }
    if (style && style._grad) {
      const id = `g${this.gradId++}`;
      const stops = style._stops.map((s) => `<stop offset="${s[0]}" stop-color="${s[1]}"/>`).join('');
      this.defs.push(`<linearGradient id="${id}" x1="${style._x1}" y1="${style._y1}" x2="${style._x2}" y2="${style._y2}">${stops}</linearGradient>`);
      return `url(#${id})`;
    }
    return style;
  }
  clip() {
    const id = `cp${this.clipId++}`;
    const d = this.path.join(' ');
    this.defs.push(`<clipPath id="${id}"><path d="${d}" transform="${this._t}"/></clipPath>`);
    this.clipPath = id;
    this.path = [];
  }
  fillRect(x, y, w, h) {
    const fill = this._paint(this.fillStyle);
    this.body.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"${this._styleAttrs()}/>`);
  }
  fillText(text, x, y) {
    const m = /(\d+(?:\.\d+)?)px/.exec(this.font);
    const size = m ? parseFloat(m[1]) : 12;
    const anchor = this.textAlign === 'center' ? 'middle' : this.textAlign === 'right' ? 'end' : 'start';
    const esc = String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    this.body.push(`<text x="${x}" y="${y}" font-size="${size}" font-family="sans-serif" text-anchor="${anchor}" fill="${this._paint(this.fillStyle)}"${this._styleAttrs()}>${esc}</text>`);
  }
  measureText() { return { width: 60 }; }
  createLinearGradient(x1, y1, x2, y2) {
    const g = { _grad: true, _x1: x1, _y1: y1, _x2: x2, _y2: y2, _stops: [] };
    g.addColorStop = (o, c) => g._stops.push([o, c]);
    return g;
  }

  toSVG() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${this.w}" height="${this.h}" viewBox="0 0 ${this.w} ${this.h}">` +
      `<defs>${this.defs.join('')}</defs>` + this.body.join('') + `</svg>`;
  }
}

// cairosvg doesn't parse hsl(), so convert for faithful QA renders.
function hslToRgb(hsl) {
  const m = /hsl\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)/.exec(hsl);
  if (!m) return hsl;
  let h = ((Number(m[1]) % 360) + 360) % 360 / 360;
  const s = Number(m[2]) / 100, l = Number(m[3]) / 100;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const r = Math.round(f(h + 1 / 3) * 255), g = Math.round(f(h) * 255), b = Math.round(f(h - 1 / 3) * 255);
  return `rgb(${r},${g},${b})`;
}
