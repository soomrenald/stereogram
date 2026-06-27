const $ = (id) => document.getElementById(id);
const canvas = $('outputCanvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const renderCanvas = document.createElement('canvas');
const renderCtx = renderCanvas.getContext('2d', { willReadFrequently: true });
let patternImg = null;
let depthImg = null;

const controls = [
  'outW','outH','renderScale','tileW','depthWPercent','depthHPercent','depthXPercent','depthYPercent',
  'projection','depthStrength','depthBlur','gamma','seed','jitter','contrast','brightness'
];

function status(msg) { $('status').textContent = msg; }
function val(id) { const el = $(id); return el.type === 'number' || el.type === 'range' ? Number(el.value) : el.value; }

function seededRandom(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not load image')); };
    img.src = url;
  });
}

$('patternInput').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  patternImg = await loadImageFromFile(file);
  status('Pattern loaded.');
});

$('depthInput').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  depthImg = await loadImageFromFile(file);
  status('Depth map loaded.');
});

function makeSamplePattern() {
  const c = document.createElement('canvas');
  c.width = 192; c.height = 192;
  const g = c.getContext('2d');
  const rand = seededRandom(9917);
  for (let y = 0; y < c.height; y += 6) {
    for (let x = 0; x < c.width; x += 6) {
      const r = Math.floor(rand() * 255);
      const b = Math.floor(rand() * 255);
      g.fillStyle = `rgb(${r},${120 + Math.floor(rand()*100)},${b})`;
      g.fillRect(x, y, 6, 6);
    }
  }
  g.globalAlpha = 0.35;
  for (let i = 0; i < 80; i++) {
    g.beginPath();
    g.arc(rand()*c.width, rand()*c.height, 3 + rand()*12, 0, Math.PI*2);
    g.fillStyle = `hsl(${rand()*360} 90% 70%)`;
    g.fill();
  }
  const img = new Image();
  img.src = c.toDataURL();
  return new Promise(resolve => img.onload = () => resolve(img));
}

function makeSampleDepth() {
  const c = document.createElement('canvas');
  c.width = 600; c.height = 600;
  const g = c.getContext('2d');
  g.fillStyle = 'black'; g.fillRect(0,0,c.width,c.height);
  const grad = g.createRadialGradient(300,300,40,300,300,250);
  grad.addColorStop(0, 'white');
  grad.addColorStop(0.55, '#999');
  grad.addColorStop(1, 'black');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(300,300,250,0,Math.PI*2); g.fill();
  g.fillStyle = '#ddd';
  g.font = 'bold 220px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('3D', 300, 315);
  const img = new Image();
  img.src = c.toDataURL();
  return new Promise(resolve => img.onload = () => resolve(img));
}

$('sampleBtn').addEventListener('click', async () => {
  patternImg = await makeSamplePattern();
  depthImg = await makeSampleDepth();
  status('Sample loaded.');
  generate();
});

function drawScaledImageToData(img, w, h, blur = 0) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = true;
  g.filter = blur > 0 ? `blur(${blur}px)` : 'none';
  g.drawImage(img, 0, 0, w, h);
  g.filter = 'none';
  return g.getImageData(0, 0, w, h);
}

function makePatternStrip(img, stripW, h, seed, jitterPct, contrast, brightness) {
  const c = document.createElement('canvas');
  c.width = stripW; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  const rand = seededRandom(seed);
  const pat = g.createPattern(img, 'repeat');
  g.fillStyle = pat;
  g.fillRect(0, 0, stripW, h);

  const data = g.getImageData(0, 0, stripW, h);
  const d = data.data;
  const jitter = jitterPct / 100;
  for (let i = 0; i < d.length; i += 4) {
    for (let k = 0; k < 3; k++) {
      let v = d[i+k];
      v = (v - 128) * contrast + 128 + brightness;
      v += (rand() - 0.5) * 255 * jitter;
      d[i+k] = Math.max(0, Math.min(255, v));
    }
    d[i+3] = 255;
  }
  return data;
}

function sampleDepth(depthData, x, y, params) {
  const { depthX, depthY, depthW, depthH, gamma, projection } = params;
  if (x < depthX || y < depthY || x >= depthX + depthW || y >= depthY + depthH) return 0;
  const u = Math.floor((x - depthX) / depthW * depthData.width);
  const v = Math.floor((y - depthY) / depthH * depthData.height);
  const idx = (v * depthData.width + u) * 4;
  const d = depthData.data;
  let lum = (0.2126*d[idx] + 0.7152*d[idx+1] + 0.0722*d[idx+2]) / 255;
  lum = Math.pow(lum, gamma);
  return projection === 'outward' ? 1 - lum : lum;
}

function drawFusionGuide() {
  if (!canvas.width || !canvas.height) return;

  const guideSeparation = Math.max(16, Math.round(val('tileW') * Math.max(0.25, val('renderScale'))));
  const radius = Math.max(4, Math.round(Math.min(canvas.width, canvas.height) * 0.008));
  const bottomPadding = Math.max(radius + 6, Math.round(canvas.height * 0.02));
  const centerX = canvas.width / 2;
  const y = canvas.height - bottomPadding;
  const leftX = Math.max(radius + 4, centerX - guideSeparation / 2);
  const rightX = Math.min(canvas.width - radius - 4, centerX + guideSeparation / 2);

  ctx.save();
  ctx.fillStyle = '#ff2b2b';
  ctx.strokeStyle = 'rgba(255,255,255,0.65)';
  ctx.lineWidth = Math.max(1, radius * 0.35);
  for (const x of [leftX, rightX]) {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function renderPreviewWithGuide() {
  canvas.width = renderCanvas.width;
  canvas.height = renderCanvas.height;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(renderCanvas, 0, 0);
  drawFusionGuide();
}

function generate() {
  if (!patternImg || !depthImg) {
    status('Load both a pattern image and a depth map, or use the sample.');
    return;
  }

  const scale = Math.max(0.25, val('renderScale'));
  const w = Math.round(val('outW') * scale);
  const h = Math.round(val('outH') * scale);
  const tileW = Math.max(16, Math.round(val('tileW') * scale));
  const strength = val('depthStrength');
  const maxShift = Math.max(1, Math.round(tileW * strength));

  renderCanvas.width = w;
  renderCanvas.height = h;

  const depthW = Math.round(w * val('depthWPercent') / 100);
  const depthH = Math.round(h * val('depthHPercent') / 100);
  const depthX = Math.round((w - depthW) * val('depthXPercent') / 100);
  const depthY = Math.round((h - depthH) * val('depthYPercent') / 100);

  const depthData = drawScaledImageToData(depthImg, Math.max(1, depthW), Math.max(1, depthH), val('depthBlur') * scale);
  const strip = makePatternStrip(patternImg, tileW, h, val('seed'), val('jitter'), val('contrast'), val('brightness'));
  const out = renderCtx.createImageData(w, h);

  const params = { depthX, depthY, depthW, depthH, gamma: val('gamma'), projection: val('projection') };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const outIdx = (y * w + x) * 4;
      const depth = sampleDepth(depthData, x, y, params);
      const shift = Math.round(depth * maxShift);
      const sourceX = x - tileW + shift;

      if (sourceX >= 0) {
        const srcIdx = (y * w + sourceX) * 4;
        out.data[outIdx] = out.data[srcIdx];
        out.data[outIdx+1] = out.data[srcIdx+1];
        out.data[outIdx+2] = out.data[srcIdx+2];
        out.data[outIdx+3] = 255;
      } else {
        const sx = ((x % tileW) + tileW) % tileW;
        const stripIdx = (y * tileW + sx) * 4;
        out.data[outIdx] = strip.data[stripIdx];
        out.data[outIdx+1] = strip.data[stripIdx+1];
        out.data[outIdx+2] = strip.data[stripIdx+2];
        out.data[outIdx+3] = 255;
      }
    }
  }

  renderCtx.putImageData(out, 0, 0);
  renderPreviewWithGuide();
  $('downloadBtn').disabled = false;
  status(`Generated ${w}×${h}px stereogram.`);
}

$('generateBtn').addEventListener('click', generate);
controls.forEach(id => $(id).addEventListener('change', () => { if (patternImg && depthImg) generate(); }));

$('downloadBtn').addEventListener('click', () => {
  const link = document.createElement('a');
  link.download = 'stereogram.png';
  link.href = renderCanvas.toDataURL('image/png');
  link.click();
});

status('Load images or click “Load sample”.');
