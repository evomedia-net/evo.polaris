// evomedia.net evo.polaris — https://github.com/evomedia-net/evo.polaris
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

// The Milky Way as a photograph, projected into the sky view.
//
// Until this, the band was two terms of arithmetic -- a cosine toward the
// galactic centre times a Gaussian across the plane -- drawn as 780 radial
// gradients. A smooth symmetric glow, which is not what the Milky Way looks
// like: it has the Great Rift down its middle, a lopsided bulge, bright
// clouds in Cygnus and Scutum, and two companion galaxies off to one side. A
// formula has none of that, at any resolution.
//
// This projects ESO/S. Brunier's all-sky panorama instead (see
// scripts/build-milkyway.py for how the texture is made, and for the credit
// that the licence requires to be visible wherever it is drawn).
//
// TWO RENDERERS, ONE PICTURE.
//
//   WebGL   A fragment shader runs the inverse projection for every pixel on
//           the GPU: screen -> sky direction -> galactic longitude/latitude
//           -> texture. Full resolution at full frame rate. Supported on
//           ~97% of browsers in use, every iPhone since 2012 among them.
//
//   Canvas  The same arithmetic in JavaScript, per pixel, at reduced
//           resolution, smoothed back up by the browser. Measured on a
//           desktop at 12.7 ms for a quarter-size pass; a phone is 3-5x
//           slower, so the divisor adapts to what the device can actually
//           manage. It suits this subject: the band is a diffuse glow with
//           no edges, so a quarter-resolution render upscaled is not a
//           visible compromise.
//
// Neither is the last resort. If the image never loads, or the GL context
// is lost mid-session, draw() says so and the caller falls back to the old
// procedural blobs -- so the band is never simply absent.
//
// THE SAME MATHS AS EVERYTHING ELSE. screenToVector() in skyview.js is the
// inverse projection the tap and the drag already use; the shader is a
// transcription of it. The galactic frame comes from galacticToEquatorial()
// and equatorialToVector(), the exact pipeline the stars go through,
// precession included -- so the band can never sit a fraction of a degree
// off the stars because two copies of the astronomy disagreed.

import { galacticToEquatorial, equatorialToVector } from './skyview.js';

export const CREDIT = 'ESO/S. Brunier';
export const SOURCE_URL = 'https://www.eso.org/public/images/eso0932a/';
export const TEXTURE = './src/data/milkyway.webp';

// How the two renderers agree on where a direction lands in the texture.
// build-milkyway.py measured the source's handedness against the Magellanic
// Clouds: longitude increases LEFTWARD, centre at l = 0, so u runs from 0.5
// downwards as l grows. Latitude is up, so v shrinks as b grows.
export function texCoord(lRad, bRad) {
  const u = ((0.5 - lRad / (2 * Math.PI)) % 1 + 1) % 1;
  const v = 0.5 - bRad / Math.PI;
  return { u, v };
}

/**
 * The galactic axes as directions in the horizontal frame, for this moment
 * and place: where (l=0,b=0), (l=90,b=0) and the north galactic pole are in
 * the sky right now. Dotting a sky direction with these gives its galactic
 * Cartesian coordinates -- no explicit matrix, and no second copy of the
 * rotation. Recomputed on the slow tick with the stars, because sidereal
 * time moves it.
 */
export function galacticBasis(lstHours, latDeg, precess = null) {
  const axis = (l, b) => {
    const { ra, dec } = galacticToEquatorial(l, b);
    return equatorialToVector(ra, dec, lstHours, latDeg, precess);
  };
  return { gx: axis(0, 0), gy: axis(90, 0), gz: axis(0, 90) };
}

/** A horizontal-frame direction to galactic longitude and latitude, radians. */
export function toGalactic(v, { gx, gy, gz }) {
  const dot = (a) => v[0] * a[0] + v[1] * a[1] + v[2] * a[2];
  const x = dot(gx), y = dot(gy), z = dot(gz);
  return {
    l: Math.atan2(y, x),
    b: Math.asin(Math.max(-1, Math.min(1, z))),
  };
}

/**
 * How much smaller than the screen the canvas fallback should render.
 *
 * Adaptive, because a phone is 3-5x slower than the desktop this was measured
 * on and there is no way to ask a device how fast it is except by trying. A
 * pass that overran the budget doubles the divisor; one that came in with
 * plenty to spare halves it, down to the floor. Capped so a slow device
 * settles at "coarse" rather than "off".
 */
export function pickDivisor(msLast, divisor, { budget = 12, min = 2, max = 8 } = {}) {
  if (msLast > budget * 1.4) return Math.min(max, divisor * 2);
  if (msLast < budget * 0.35) return Math.max(min, divisor / 2);
  return divisor;
}

// Tint and gain: the band as it looks to a dark-adapted eye, and in Night
// Mode as a red shade that keeps that adaptation. Applied identically by
// both renderers, and by the legend swatch, so they cannot disagree.
export const TINT = {
  day:   { rgb: [150 / 255, 170 / 255, 225 / 255], gain: 0.85 },
  night: { rgb: [170 / 255, 0, 0],                 gain: 0.55 },
};

const VERT = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

// screenToVector(), transcribed. gl_FragCoord counts from the bottom, the
// canvas from the top, hence the flip on y.
const FRAG = `
precision highp float;
uniform sampler2D u_tex;
uniform vec2 u_size;
uniform float u_focal;
uniform vec3 u_right, u_up, u_forward;
uniform vec3 u_gx, u_gy, u_gz;
uniform vec3 u_tint;
uniform float u_gain;
const float TWO_PI = 6.28318530718;
const float PI = 3.14159265359;
void main() {
  float dx = gl_FragCoord.x - u_size.x * 0.5;
  float dy = (u_size.y - gl_FragCoord.y) - u_size.y * 0.5;
  float a = dx / u_focal;
  float b = -dy / u_focal;
  vec3 v = normalize(u_forward + a * u_right + b * u_up);
  vec3 g = vec3(dot(v, u_gx), dot(v, u_gy), dot(v, u_gz));
  float lat = asin(clamp(g.z, -1.0, 1.0));
  float lon = atan(g.y, g.x);
  vec2 uv = vec2(fract(0.5 - lon / TWO_PI), 0.5 - lat / PI);
  float lum = texture2D(u_tex, uv).r;
  gl_FragColor = vec4(u_tint * lum * u_gain, 1.0);
}
`;

/**
 * Build the layer. Loads the texture once; picks WebGL if the browser has it
 * and nobody asked for the fallback (`?nogl=1` does, which is how the canvas
 * path gets looked at on a device that would never otherwise use it).
 */
export function createMilkyWay({
  src = TEXTURE,
  forceFallback = false,
  doc = globalThis.document,
  makeImage = () => new globalThis.Image(),
  now = () => globalThis.performance.now(),
} = {}) {
  const layer = {
    mode: 'loading',        // 'loading' | 'webgl' | 'canvas' | 'none'
    lost: false,            // WebGL context gone; draw() declines until restored
    divisor: 4,             // canvas fallback: start at quarter size
    lastMs: 0,
    ready: null,
    draw: null,
  };

  let img = null;
  let gl = null, glCanvas = null, program = null, texture = null, uniforms = null;
  let lum = null, lumW = 0, lumH = 0;          // canvas fallback sample buffer
  let small = null, smallCtx = null, smallData = null;
  let lastKey = '';

  // ---- WebGL ---------------------------------------------------------------

  function initGL() {
    glCanvas = doc.createElement('canvas');
    gl = glCanvas.getContext('webgl', {
      alpha: false, antialias: false, depth: false, stencil: false,
      preserveDrawingBuffer: true,   // read by drawImage after the draw, reliably
      premultipliedAlpha: false,
    });
    if (!gl) return false;

    // A lost context is not an error, it is a phone doing what phones do:
    // backgrounded, low on memory, or just a tab switch on iOS. Without these
    // two handlers the band would vanish after a phone call and never return.
    glCanvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();          // tells the browser we intend to restore
      layer.lost = true;
    });
    glCanvas.addEventListener('webglcontextrestored', () => {
      if (buildProgram() && uploadTexture()) layer.lost = false;
    });

    return buildProgram() && uploadTexture();
  }

  function compile(type, srcText) {
    const s = gl.createShader(type);
    gl.shaderSource(s, srcText);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      gl.deleteShader(s);
      return null;
    }
    return s;
  }

  function buildProgram() {
    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return false;
    program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return false;
    gl.useProgram(program);

    // One triangle strip covering the clip space; the shader does the rest.
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    uniforms = {};
    for (const n of ['u_tex', 'u_size', 'u_focal', 'u_right', 'u_up', 'u_forward',
                     'u_gx', 'u_gy', 'u_gz', 'u_tint', 'u_gain']) {
      uniforms[n] = gl.getUniformLocation(program, n);
    }
    return true;
  }

  function uploadTexture() {
    // 4096x2048 is a power of two, which is what lets longitude REPEAT (the
    // seam at l=180 is then just another pixel) and lets mipmaps exist for
    // the widest fields, where the texture is being shrunk three times over.
    const max = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    if (img.naturalWidth > max) return false;
    texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, gl.LUMINANCE, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.uniform1i(uniforms.u_tex, 0);
    return true;
  }

  function drawGL(ctx, { basis, focal, w, h, night, galactic }) {
    if (glCanvas.width !== w || glCanvas.height !== h) {
      glCanvas.width = w; glCanvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    const tint = night ? TINT.night : TINT.day;
    gl.uniform2f(uniforms.u_size, w, h);
    gl.uniform1f(uniforms.u_focal, focal);
    gl.uniform3fv(uniforms.u_right, basis.right);
    gl.uniform3fv(uniforms.u_up, basis.up);
    gl.uniform3fv(uniforms.u_forward, basis.forward);
    gl.uniform3fv(uniforms.u_gx, galactic.gx);
    gl.uniform3fv(uniforms.u_gy, galactic.gy);
    gl.uniform3fv(uniforms.u_gz, galactic.gz);
    gl.uniform3fv(uniforms.u_tint, tint.rgb);
    gl.uniform1f(uniforms.u_gain, tint.gain);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    // Additive onto the black sky, like the blobs it replaces: black in the
    // texture adds nothing, so there is no rectangle to see.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(glCanvas, 0, 0);
    ctx.restore();
  }

  // ---- Canvas fallback -------------------------------------------------------

  function initCanvas() {
    // Sample from a quarter-size copy: the fallback renders at a fraction of
    // the screen anyway, so 4096 wide would be memory spent on detail it can
    // never show. 1024x512 as bare luminance is half a megabyte.
    lumW = 1024; lumH = 512;
    const c = doc.createElement('canvas');
    c.width = lumW; c.height = lumH;
    const cx = c.getContext('2d', { willReadFrequently: true });
    if (!cx) return false;
    cx.drawImage(img, 0, 0, lumW, lumH);
    const data = cx.getImageData(0, 0, lumW, lumH).data;
    lum = new Uint8Array(lumW * lumH);
    for (let i = 0, j = 0; i < lum.length; i++, j += 4) lum[i] = data[j];
    small = doc.createElement('canvas');
    smallCtx = small.getContext('2d');
    return !!smallCtx;
  }

  function sampleLum(u, v) {
    // Bilinear, wrapping in u (longitude) and clamping in v. This is what
    // makes a quarter-size render from a 1024-wide strip look smooth rather
    // than like a mosaic.
    const x = u * lumW - 0.5, y = v * lumH - 0.5;
    let x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    x0 = ((x0 % lumW) + lumW) % lumW;
    const x1 = (x0 + 1) % lumW;
    y0 = Math.max(0, Math.min(lumH - 1, y0));
    const y1 = Math.min(lumH - 1, y0 + 1);
    const a = lum[y0 * lumW + x0], b = lum[y0 * lumW + x1];
    const c = lum[y1 * lumW + x0], d = lum[y1 * lumW + x1];
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }

  function drawCanvas(ctx, { basis, focal, w, h, night, galactic }) {
    const d = layer.divisor;
    const sw = Math.max(1, Math.round(w / d)), sh = Math.max(1, Math.round(h / d));
    // Nothing moved since last time: reuse the picture. In Manual Mode this is
    // every frame between presses, which is most of them.
    const key = [sw, sh, focal, night ? 1 : 0, ...basis.right, ...basis.up, ...basis.forward,
                 ...galactic.gx, ...galactic.gz].join(',');
    if (key !== lastKey) {
      const t0 = now();
      if (small.width !== sw || small.height !== sh || !smallData) {
        small.width = sw; small.height = sh;
        smallData = smallCtx.createImageData(sw, sh);
      }
      const px = smallData.data;
      const tint = night ? TINT.night : TINT.day;
      const [tr, tg, tb] = tint.rgb.map((c) => c * tint.gain);
      const { right, up, forward } = basis;
      const { gx, gy, gz } = galactic;
      const f = focal / d;                       // the small canvas is the screen, scaled
      const cx = sw / 2, cy = sh / 2;
      let i = 0;
      for (let y = 0; y < sh; y++) {
        const b = -(y + 0.5 - cy) / f;
        for (let x = 0; x < sw; x++) {
          const a = (x + 0.5 - cx) / f;
          const vx = forward[0] + a * right[0] + b * up[0];
          const vy = forward[1] + a * right[1] + b * up[1];
          const vz = forward[2] + a * right[2] + b * up[2];
          const n = Math.hypot(vx, vy, vz) || 1;
          const nx = vx / n, ny = vy / n, nz = vz / n;
          const gX = nx * gx[0] + ny * gx[1] + nz * gx[2];
          const gY = nx * gy[0] + ny * gy[1] + nz * gy[2];
          const gZ = nx * gz[0] + ny * gz[1] + nz * gz[2];
          const lat = Math.asin(gZ > 1 ? 1 : gZ < -1 ? -1 : gZ);
          const lon = Math.atan2(gY, gX);
          const u = ((0.5 - lon / (2 * Math.PI)) % 1 + 1) % 1;
          const v = 0.5 - lat / Math.PI;
          const L = sampleLum(u, v);
          px[i++] = L * tr; px[i++] = L * tg; px[i++] = L * tb; px[i++] = 255;
        }
      }
      smallCtx.putImageData(smallData, 0, 0);
      layer.lastMs = now() - t0;
      layer.divisor = pickDivisor(layer.lastMs, d);
      lastKey = key;
    }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(small, 0, 0, sw, sh, 0, 0, w, h);
    ctx.restore();
  }

  // ---- lifecycle -------------------------------------------------------------

  layer.ready = new Promise((resolve) => {
    img = makeImage();
    img.onload = () => {
      let ok = false;
      if (!forceFallback) {
        try { ok = initGL(); } catch { ok = false; }
        if (ok) layer.mode = 'webgl';
      }
      if (!ok) {
        try { ok = initCanvas(); } catch { ok = false; }
        layer.mode = ok ? 'canvas' : 'none';
      }
      resolve(ok);
    };
    img.onerror = () => { layer.mode = 'none'; resolve(false); };
    img.src = src;
  });

  /** Paint the band onto ctx. False means "could not" -- draw the blobs. */
  layer.draw = (ctx, args) => {
    if (layer.mode === 'webgl') {
      if (layer.lost) return false;
      try { drawGL(ctx, args); return true; } catch { return false; }
    }
    if (layer.mode === 'canvas') {
      try { drawCanvas(ctx, args); return true; } catch { return false; }
    }
    return false;
  };

  return layer;
}
