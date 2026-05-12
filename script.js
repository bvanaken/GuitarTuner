const STRINGS = [
  { name: "E", octave: 2, freq: 82.4069,  label: "6th" },
  { name: "A", octave: 2, freq: 110.000,  label: "5th" },
  { name: "D", octave: 3, freq: 146.832,  label: "4th" },
  { name: "G", octave: 3, freq: 195.998,  label: "3rd" },
  { name: "B", octave: 3, freq: 246.942,  label: "2nd" },
  { name: "E", octave: 4, freq: 329.628,  label: "1st" },
];

const els = {
  note: document.getElementById("note"),
  targetNote: document.getElementById("targetNote"),
  octave: document.getElementById("octave"),
  needle: document.getElementById("needle"),
  status: document.getElementById("status"),
  detectedFreq: document.getElementById("detectedFreq"),
  targetFreq: document.getElementById("targetFreq"),
  hint: document.getElementById("hint"),
  toggleBtn: document.getElementById("toggleBtn"),
  stringSelect: document.getElementById("stringSelect"),
  svg: document.getElementById("headstockSvg"),
};

buildHeadstock();

let audioCtx = null;
let analyser = null;
let mediaStream = null;
let rafId = null;
let running = false;
let buf = null;

// Smoothing state: median over recent pitch estimates
const pitchHistory = [];
const HISTORY_LEN = 6;

els.toggleBtn.addEventListener("click", async () => {
  if (running) stop(); else await start();
});

document.querySelectorAll('input[name="mode"]').forEach((r) => {
  r.addEventListener("change", () => {
    els.stringSelect.disabled = r.value !== "manual" || !r.checked;
  });
});

async function start() {
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
  } catch (err) {
    els.status.textContent = "Microphone access denied.";
    return;
  }

  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const src = audioCtx.createMediaStreamSource(mediaStream);

  // High-pass filter to reduce low-frequency rumble below low E
  const hp = audioCtx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 60;
  hp.Q.value = 0.7;

  // Low-pass to reduce harmonics/noise above the guitar's useful range
  const lp = audioCtx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 1200;
  lp.Q.value = 0.7;

  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 4096;
  buf = new Float32Array(analyser.fftSize);

  src.connect(hp);
  hp.connect(lp);
  lp.connect(analyser);

  running = true;
  els.toggleBtn.textContent = "Stop";
  els.toggleBtn.classList.add("recording");
  els.status.textContent = "Listening…";
  loop();
}

function stop() {
  running = false;
  if (rafId) cancelAnimationFrame(rafId);
  if (mediaStream) mediaStream.getTracks().forEach((t) => t.stop());
  if (audioCtx) audioCtx.close();
  audioCtx = null; analyser = null; mediaStream = null;
  els.toggleBtn.textContent = "Start";
  els.toggleBtn.classList.remove("recording");
  els.status.textContent = "Stopped";
  resetDisplay();
}

function loop() {
  if (!running) return;
  analyser.getFloatTimeDomainData(buf);
  const freq = autoCorrelate(buf, audioCtx.sampleRate);
  if (freq > 0) {
    pitchHistory.push(freq);
    if (pitchHistory.length > HISTORY_LEN) pitchHistory.shift();
    const stable = median(pitchHistory);
    render(stable);
  } else {
    pitchHistory.length = 0;
    renderSilent();
  }
  rafId = requestAnimationFrame(loop);
}

function render(freq) {
  const manual = document.querySelector('input[name="mode"]:checked').value === "manual";
  const targetIdx = manual
    ? parseInt(els.stringSelect.value, 10)
    : closestStringIndex(freq);
  const target = STRINGS[targetIdx];
  const cents = 1200 * Math.log2(freq / target.freq);

  // If way off (more than ~80 cents) and auto-mode, we still show the nearest
  // but warn. In manual we keep pointing at the user-selected string.
  const absCents = Math.abs(cents);
  const clamped = Math.max(-50, Math.min(50, cents));
  const needlePct = 50 + (clamped / 50) * 50; // -50..+50 cents => 0..100%

  els.needle.style.left = `${needlePct}%`;
  els.note.textContent = target.name;
  els.targetNote.textContent = target.name;
  els.octave.textContent = target.octave;
  els.detectedFreq.textContent = freq.toFixed(1);
  els.targetFreq.textContent = target.freq.toFixed(1);

  highlightString(targetIdx);

  // Classify tuning state
  els.note.classList.remove("good", "close", "flat", "sharp");
  els.needle.classList.remove("good", "bad");
  els.hint.classList.remove("up", "down", "ok");
  els.status.classList.remove("good");

  if (absCents <= 5) {
    els.note.classList.add("good");
    els.needle.classList.add("good");
    els.hint.classList.add("ok");
    els.hint.textContent = "In tune";
    els.status.textContent = `${target.name}${target.octave} — in tune`;
    els.status.classList.add("good");
  } else if (absCents <= 15) {
    els.note.classList.add("close");
    els.hint.textContent = cents < 0 ? "almost — slightly flat" : "almost — slightly sharp";
    els.status.textContent = `${target.name}${target.octave} — close`;
  } else {
    els.note.classList.add(cents < 0 ? "flat" : "sharp");
    els.needle.classList.add("bad");
    if (cents < 0) {
      els.hint.classList.add("up");
      els.hint.textContent = `${Math.round(-cents)}¢ flat`;
    } else {
      els.hint.classList.add("down");
      els.hint.textContent = `${Math.round(cents)}¢ sharp`;
    }
    els.status.textContent = `${target.name}${target.octave}`;
  }
}

function renderSilent() {
  els.note.textContent = "–";
  els.octave.textContent = "";
  els.detectedFreq.textContent = "–";
  els.needle.style.left = "50%";
  els.needle.classList.remove("good", "bad");
  els.note.classList.remove("good", "close", "flat", "sharp");
  els.hint.className = "hint";
  els.hint.textContent = "";
  els.status.classList.remove("good");
  els.status.textContent = "Play a string…";
  highlightString(-1);
  els.targetNote.classList.remove("active");
  els.targetFreq.textContent = "–";
}

function resetDisplay() {
  renderSilent();
  els.status.textContent = "Stopped";
}

function closestStringIndex(freq) {
  let best = 0, bestDist = Infinity;
  for (let i = 0; i < STRINGS.length; i++) {
    const dist = Math.abs(1200 * Math.log2(freq / STRINGS[i].freq));
    if (dist < bestDist) { bestDist = dist; best = i; }
  }
  return best;
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// -----------------------------
// Pitch detection: autocorrelation with parabolic interpolation.
// Adapted from the well-known pitchdetect.js by Chris Wilson.
// -----------------------------
function autoCorrelate(buffer, sampleRate) {
  let SIZE = buffer.length;
  let rms = 0;
  for (let i = 0; i < SIZE; i++) rms += buffer[i] * buffer[i];
  rms = Math.sqrt(rms / SIZE);
  if (rms < 0.01) return -1;

  let r1 = 0, r2 = SIZE - 1;
  const thres = 0.2;
  for (let i = 0; i < SIZE / 2; i++) if (Math.abs(buffer[i]) < thres) { r1 = i; break; }
  for (let i = 1; i < SIZE / 2; i++) if (Math.abs(buffer[SIZE - i]) < thres) { r2 = SIZE - i; break; }

  const trimmed = buffer.slice(r1, r2);
  SIZE = trimmed.length;

  const c = new Array(SIZE).fill(0);
  for (let i = 0; i < SIZE; i++)
    for (let j = 0; j < SIZE - i; j++)
      c[i] = c[i] + trimmed[j] * trimmed[j + i];

  let d = 0;
  while (d < SIZE - 1 && c[d] > c[d + 1]) d++;

  let maxval = -1, maxpos = -1;
  for (let i = d; i < SIZE; i++) {
    if (c[i] > maxval) { maxval = c[i]; maxpos = i; }
  }
  let T0 = maxpos;
  if (T0 <= 0) return -1;

  const x1 = c[T0 - 1] || 0;
  const x2 = c[T0];
  const x3 = c[T0 + 1] || 0;
  const a = (x1 + x3 - 2 * x2) / 2;
  const b = (x3 - x1) / 2;
  if (a) T0 = T0 - b / (2 * a);

  const freq = sampleRate / T0;
  if (freq < 60 || freq > 1200) return -1;
  return freq;
}

// -----------------------------
// Guitar headstock visualization (SVG)
// -----------------------------
function buildHeadstock() {
  const svg = els.svg;
  const NS = "http://www.w3.org/2000/svg";

  // Wooden headstock outline
  const defs = document.createElementNS(NS, "defs");
  defs.innerHTML = `
    <linearGradient id="wood" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#a06a38"/>
      <stop offset="50%" stop-color="#8b5a2b"/>
      <stop offset="100%" stop-color="#5c3a1c"/>
    </linearGradient>
    <linearGradient id="neck" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#6b4421"/>
      <stop offset="100%" stop-color="#4a2e16"/>
    </linearGradient>
  `;
  svg.appendChild(defs);

  // Neck (strings exit here)
  const neck = document.createElementNS(NS, "rect");
  neck.setAttribute("x", "160"); neck.setAttribute("y", "230");
  neck.setAttribute("width", "80"); neck.setAttribute("height", "30");
  neck.setAttribute("fill", "url(#neck)");
  svg.appendChild(neck);

  // Headstock shape
  const head = document.createElementNS(NS, "path");
  head.setAttribute("d", "M140 40 Q200 10 260 40 L270 220 Q200 240 130 220 Z");
  head.setAttribute("fill", "url(#wood)");
  head.setAttribute("stroke", "#3a240f");
  head.setAttribute("stroke-width", "2");
  svg.appendChild(head);

  // Nut
  const nut = document.createElementNS(NS, "rect");
  nut.setAttribute("x", "150"); nut.setAttribute("y", "222");
  nut.setAttribute("width", "100"); nut.setAttribute("height", "8");
  nut.setAttribute("fill", "#f0e6d2");
  nut.setAttribute("rx", "1");
  svg.appendChild(nut);

  // Tuning pegs — 3 left, 3 right, staggered
  // Left side (from top-most peg going down): 6th, 4th, 2nd strings by convention on a 3+3 headstock
  // For simplicity we'll map index 0..5 to pegs and strings.
  const pegPositions = [
    { side: "L", y: 60  }, // string 0: low E (6th)
    { side: "L", y: 115 }, // string 1: A (5th)
    { side: "L", y: 170 }, // string 2: D (4th)
    { side: "R", y: 60  }, // string 3: G (3rd)
    { side: "R", y: 115 }, // string 4: B (2nd)
    { side: "R", y: 170 }, // string 5: high E (1st)
  ];

  // Draw strings first (so pegs overlay)
  // Each string runs from its peg down past the nut out the bottom of the SVG.
  pegPositions.forEach((p, i) => {
    const pegX = p.side === "L" ? 120 : 280;
    const stringX = 160 + i * (80 / 5); // spread 6 strings evenly across 80px neck
    const line = document.createElementNS(NS, "line");
    line.setAttribute("x1", pegX);
    line.setAttribute("y1", p.y);
    line.setAttribute("x2", stringX);
    line.setAttribute("y2", 226);
    line.setAttribute("stroke", "#d9d2c4");
    line.setAttribute("stroke-width", stringWidth(i));
    line.setAttribute("stroke-linecap", "round");
    line.setAttribute("data-string", String(i));
    line.classList.add("string-line");
    svg.appendChild(line);

    // Continuation on the neck
    const lineN = document.createElementNS(NS, "line");
    lineN.setAttribute("x1", stringX);
    lineN.setAttribute("y1", 230);
    lineN.setAttribute("x2", stringX);
    lineN.setAttribute("y2", 260);
    lineN.setAttribute("stroke", "#d9d2c4");
    lineN.setAttribute("stroke-width", stringWidth(i));
    lineN.setAttribute("stroke-linecap", "round");
    lineN.setAttribute("data-string-neck", String(i));
    svg.appendChild(lineN);
  });

  // Pegs on top
  pegPositions.forEach((p, i) => {
    const pegX = p.side === "L" ? 120 : 280;
    const peg = document.createElementNS(NS, "g");
    peg.setAttribute("data-peg", String(i));
    peg.classList.add("peg");

    const post = document.createElementNS(NS, "circle");
    post.setAttribute("cx", p.side === "L" ? 145 : 255);
    post.setAttribute("cy", p.y);
    post.setAttribute("r", 5);
    post.setAttribute("fill", "#d9d2c4");
    post.setAttribute("stroke", "#3a240f");
    peg.appendChild(post);

    const knob = document.createElementNS(NS, "circle");
    knob.setAttribute("cx", pegX);
    knob.setAttribute("cy", p.y);
    knob.setAttribute("r", 12);
    knob.setAttribute("fill", "#2a1a0a");
    knob.setAttribute("stroke", "#d9d2c4");
    knob.setAttribute("stroke-width", "2");
    peg.appendChild(knob);

    const label = document.createElementNS(NS, "text");
    label.setAttribute("x", pegX);
    label.setAttribute("y", p.y + 4);
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("font-size", "10");
    label.setAttribute("fill", "#f5ecd9");
    label.setAttribute("font-family", "sans-serif");
    label.textContent = STRINGS[i].name;
    peg.appendChild(label);

    svg.appendChild(peg);
  });
}

function stringWidth(i) {
  // Lower strings are thicker
  return (1.2 + (5 - i) * 0.35).toFixed(2);
}

function highlightString(activeIdx) {
  els.svg.querySelectorAll(".string-line, [data-string-neck]").forEach((l) => {
    const idx = parseInt(l.getAttribute("data-string") || l.getAttribute("data-string-neck"), 10);
    if (idx === activeIdx) {
      l.setAttribute("stroke", "#f4b860");
      l.setAttribute("filter", "drop-shadow(0 0 4px rgba(244,184,96,0.8))");
    } else {
      l.setAttribute("stroke", "#d9d2c4");
      l.removeAttribute("filter");
    }
  });
  els.svg.querySelectorAll("[data-peg]").forEach((peg) => {
    const idx = parseInt(peg.getAttribute("data-peg"), 10);
    const knob = peg.querySelectorAll("circle")[1];
    if (idx === activeIdx) {
      knob.setAttribute("stroke", "#f4b860");
      knob.setAttribute("stroke-width", "3");
    } else {
      knob.setAttribute("stroke", "#d9d2c4");
      knob.setAttribute("stroke-width", "2");
    }
  });
  if (activeIdx >= 0) els.targetNote.classList.add("active");
  else els.targetNote.classList.remove("active");
}

resetDisplay();
