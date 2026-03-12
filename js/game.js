// AHK_VISIBLE_EDIT_TEST
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const stateEl = document.getElementById('state');
const effectEl = document.getElementById('effect');
const startBtn = document.getElementById('startBtn');
const audioBtn = document.getElementById('audioBtn');

const W = canvas.width;
const H = canvas.height;
const bestKey = 'boss-dodge-best';
const laneCount = 4;
const laneWidth = W / laneCount;

let best = Number(localStorage.getItem(bestKey) || 0);
bestEl.textContent = best;

let running = false;
let gameOver = true;
let score = 0;
let frame = 0;
let spawnRate = 42;
let baseSpeed = 3.5;
let animationId = null;
let touchActive = false;
let audioEnabled = true;
let audioContext = null;
let bgmStarted = false;
let bgmInterval = null;
let scoreMultiplier = 1;
let slowEffectUntil = 0;
let accelEffectUntil = 0;
let roadOffset = 0;
let lastRunScore = 0;
let crashFlash = 0;
let crashSequence = null;
let debris = [];
let sparks = [];
let skidMarks = [];

const assetDir = './assets/processed';
const images = {
  player: loadImage(`${assetDir}/player_bike_up_processed.png`),
  enemyBike: loadImage(`${assetDir}/enemy_bike_down_processed.png`),
  sedan: loadImage(`${assetDir}/traffic_sedan_processed.png`),
  truck: loadImage(`${assetDir}/traffic_truck_processed.png`),
  sports: loadImage(`${assetDir}/traffic_sports_car_processed.png`)
};

const player = {
  x: W / 2 - 28,
  y: H - 94,
  w: 56,
  h: 92,
  speed: 7,
  dx: 0
};

let traffic = [];
let items = [];
let popups = [];

const vehicleTypes = [
  { type: 'bike', image: 'enemyBike', w: 34, h: 78, hitScale: 0.62 },
  { type: 'car', image: 'sedan', w: 82, h: 38, hitScale: 0.72 },
  { type: 'truck', image: 'truck', w: 104, h: 48, hitScale: 0.8 },
  { type: 'sport', image: 'sports', w: 90, h: 44, hitScale: 0.72 }
];

const itemConfigs = {
  slow: { color: '#60a5fa', points: 0, size: 26, glow: '#93c5fd' },
  scoreLarge: { color: '#f59e0b', points: 30, size: 36, glow: '#fcd34d' },
  scoreMedium: { color: '#fbbf24', points: 55, size: 30, glow: '#fde68a' },
  scoreSmall: { color: '#fde047', points: 90, size: 24, glow: '#fff59d' },
  accel: { color: '#a855f7', points: 0, size: 26, glow: '#d8b4fe' }
};

function loadImage(src) {
  const img = new Image();
  img.src = src;
  return img;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function ensureAudio() {
  if (!audioEnabled) return;
  if (!audioContext) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audioContext = new Ctx();
  }
  if (audioContext.state === 'suspended') audioContext.resume();
}

function beep({ freq = 440, type = 'sine', duration = 0.12, volume = 0.03, slideTo = null }) {
  if (!audioEnabled) return;
  ensureAudio();
  if (!audioContext) return;
  const now = audioContext.currentTime;
  const osc = audioContext.createOscillator();
  const gain = audioContext.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, now + duration);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(volume, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  osc.connect(gain);
  gain.connect(audioContext.destination);
  osc.start(now);
  osc.stop(now + duration + 0.03);
}

function playCrashSound() {
  beep({ freq: 110, type: 'sawtooth', duration: 0.34, volume: 0.055, slideTo: 48 });
  beep({ freq: 880, type: 'square', duration: 0.08, volume: 0.028, slideTo: 180 });
}

function startBgm() {
  if (!audioEnabled) return;
  ensureAudio();
  if (!audioContext || bgmStarted) return;
  const beat = 60 / 158;
  const leadPattern = [659.25, 783.99, 987.77, 783.99, 659.25, 783.99, 1046.5, 1174.66];
  const bassPattern = [110, 110, 146.83, 164.81, 110, 110, 146.83, 196];
  let step = 0;
  let nextTime = audioContext.currentTime + 0.05;
  bgmInterval = setInterval(() => {
    if (!audioEnabled || !audioContext || !running) return;
    while (nextTime < audioContext.currentTime + 0.4) {
      tone(nextTime, bassPattern[step % bassPattern.length], 'sawtooth', 0.18, step % 2 === 0 ? 0.022 : 0.014);
      if (step % 2 === 0) tone(nextTime, leadPattern[step % leadPattern.length], 'square', 0.16, 0.016);
      nextTime += beat / 2;
      step++;
    }
  }, 80);
  bgmStarted = true;
}

function tone(time, note, type, length, volume) {
  const osc = audioContext.createOscillator();
  const gain = audioContext.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(note, time);
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.linearRampToValueAtTime(volume, time + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + length);
  osc.connect(gain);
  gain.connect(audioContext.destination);
  osc.start(time);
  osc.stop(time + length + 0.02);
}

function stopBgm() {
  if (bgmInterval) clearInterval(bgmInterval);
  bgmInterval = null;
  bgmStarted = false;
}

function setEffectText(text, color = '#eef2ff') {
  effectEl.textContent = text;
  effectEl.style.color = color;
}

function addPopup(text, x, y, color, size = 20, glow = color) {
  popups.push({ text, x, y, color, glow, life: 60, size });
}

function getCurrentFallMultiplier() {
  let multiplier = 1;
  if (Date.now() < slowEffectUntil) multiplier *= 0.6;
  if (Date.now() < accelEffectUntil) multiplier *= 1.72;
  return multiplier;
}

function updateEffectState() {
  const now = Date.now();
  const slowActive = now < slowEffectUntil;
  const accelActive = now < accelEffectUntil;
  if (slowActive && accelActive) setEffectText('高壓混速', '#c084fc');
  else if (slowActive) setEffectText('緩速巡航', '#60a5fa');
  else if (accelActive) setEffectText('極速衝分', '#c084fc');
  else setEffectText('無', '#eef2ff');
  scoreMultiplier = accelActive ? 2.8 : 1;
}

function resetGame() {
  score = 0;
  frame = 0;
  spawnRate = 42;
  baseSpeed = 3.5;
  roadOffset = 0;
  crashFlash = 0;
  crashSequence = null;
  slowEffectUntil = 0;
  accelEffectUntil = 0;
  scoreMultiplier = 1;
  gameOver = false;
  traffic = [];
  items = [];
  popups = [];
  debris = [];
  sparks = [];
  skidMarks = [];
  player.x = W / 2 - player.w / 2;
  player.dx = 0;
  scoreEl.textContent = '0';
  stateEl.textContent = '進行中';
  setEffectText('無');
}

function startGame() {
  ensureAudio();
  resetGame();
  running = true;
  gameOver = false;
  startBgm();
  cancelAnimationFrame(animationId);
  beep({ freq: 523.25, type: 'triangle', duration: 0.12, volume: 0.04, slideTo: 659.25 });
  loop();
}

function endGame(hitVehicle) {
  if (gameOver || crashSequence) return;
  running = false;
  lastRunScore = Math.floor(score);
  stateEl.innerHTML = '<span class="danger">撞車</span>';
  if (score > best) {
    best = Math.floor(score);
    localStorage.setItem(bestKey, String(best));
    bestEl.textContent = best;
  }
  stopBgm();
  playCrashSound();
  crashFlash = 1;
  const target = hitVehicle || player;
  spawnCrashEffects(target);
  crashSequence = {
    framesLeft: 120,
    overlayDelay: 120,
    playerStartY: player.y,
    playerEndY: Math.max(28, player.y - 40),
    targetRef: target,
    targetStartY: target.y,
    targetEndY: Math.max(-target.h, target.y - 40)
  };
  gameOver = false;
  loop();
}

function spawnCrashEffects(target) {
  const cx = target.x + target.w / 2;
  const cy = target.y + target.h / 2;

  for (let i = 0; i < 24; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 2 + Math.random() * 6;
    sparks.push({
      x: cx,
      y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 10 + Math.random() * 10,
      maxLife: 20,
      len: 10 + Math.random() * 16,
      color: i % 3 === 0 ? '#fff7ae' : i % 2 === 0 ? '#fbbf24' : '#fb7185'
    });
  }

  for (let i = 0; i < 34; i++) {
    const burst = 4 + Math.random() * 9;
    debris.push({
      x: cx,
      y: cy,
      vx: (Math.random() - 0.5) * burst,
      vy: (Math.random() - 0.5) * burst,
      size: 5 + Math.random() * 9,
      life: 46 + Math.random() * 24,
      color: i % 4 === 0 ? '#fff7ae' : i % 3 === 0 ? '#fb7185' : i % 2 === 0 ? '#fbbf24' : '#f97316'
    });
  }

  const skidBaseX = player.x + player.w / 2;
  const skidBaseY = player.y + player.h / 2 + 12;
  skidMarks.push(
    { x: skidBaseX - 12, y: skidBaseY, w: 11, h: 118, life: 150, rot: -0.08 },
    { x: skidBaseX + 12, y: skidBaseY + 6, w: 11, h: 132, life: 150, rot: 0.08 },
    { x: skidBaseX, y: skidBaseY + 28, w: 16, h: 78, life: 110, rot: 0.02 }
  );
}

function getLaneForX(x, width) {
  return clamp(Math.floor((x + width / 2) / laneWidth), 0, laneCount - 1);
}

function randomLaneX(width, lane = null) {
  const chosenLane = lane ?? Math.floor(Math.random() * laneCount);
  const padding = (laneWidth - width) / 2;
  return chosenLane * laneWidth + padding;
}

function canSpawnInLane(lane, height) {
  const minGap = Math.max(88, height * 1.35);
  return !traffic.some(v => getLaneForX(v.x, v.w) === lane && v.y < minGap);
}

function spawnTraffic() {
  const model = vehicleTypes[Math.floor(Math.random() * vehicleTypes.length)];
  const laneOrder = Array.from({ length: laneCount }, (_, i) => i).sort(() => Math.random() - 0.5);
  const lane = laneOrder.find(l => canSpawnInLane(l, model.h));
  if (lane === undefined) return;
  traffic.push({
    ...model,
    lane,
    x: randomLaneX(model.w, lane),
    y: -model.h - 20,
    vy: baseSpeed + Math.random() * 1.8,
    sway: Math.random() * 0.6 - 0.3,
    rotation: model.type === 'bike' ? 0 : Math.PI / 2
  });
}

function spawnItem() {
  const roll = Math.random();
  let type = 'scoreMedium';
  if (roll < 0.18) type = 'slow';
  else if (roll < 0.34) type = 'accel';
  else if (roll < 0.56) type = 'scoreLarge';
  else if (roll < 0.82) type = 'scoreMedium';
  else type = 'scoreSmall';
  const cfg = itemConfigs[type];
  items.push({ type, x: randomLaneX(cfg.size), y: -cfg.size - 16, w: cfg.size, h: cfg.size, vy: Math.max(2.4, baseSpeed * 0.72), rot: 0 });
}

function awardScore(points, x, y, itemType) {
  score += points;
  scoreEl.textContent = Math.floor(score);
  const sizes = { scoreLarge: 30, scoreMedium: 34, scoreSmall: 38 };
  addPopup(`+${points}`, x, y, '#fff7b2', sizes[itemType] || 28, '#facc15');
  beep({ freq: 660, type: 'triangle', duration: 0.1, volume: 0.04, slideTo: 920 });
}

function applyItem(item) {
  const cx = item.x + item.w / 2;
  const cy = item.y + item.h / 2;
  if (item.type === 'slow') {
    if (Date.now() >= slowEffectUntil) {
      slowEffectUntil = Date.now() + 6000;
      addPopup('緩速!', cx, cy, '#93c5fd', 26, '#60a5fa');
      beep({ freq: 360, type: 'sine', duration: 0.18, volume: 0.05, slideTo: 240 });
    } else {
      addPopup('已緩速', cx, cy, '#bfdbfe', 18, '#93c5fd');
    }
  }
  if (item.type === 'accel') {
    accelEffectUntil = Date.now() + 5000;
    addPopup('Boost!', cx, cy, '#e9d5ff', 28, '#c084fc');
    beep({ freq: 420, type: 'square', duration: 0.12, volume: 0.035, slideTo: 780 });
  }
  if (item.type.startsWith('score')) awardScore(itemConfigs[item.type].points, cx, cy, item.type);
}

function update() {
  if (crashSequence) {
    roadOffset += 8;
    const totalFrames = crashSequence.overlayDelay || 120;
    const progress = 1 - (crashSequence.framesLeft / totalFrames);
    player.y = crashSequence.playerStartY + (crashSequence.playerEndY - crashSequence.playerStartY) * progress;
    if (crashSequence.targetRef) {
      crashSequence.targetRef.y = crashSequence.targetStartY + (crashSequence.targetEndY - crashSequence.targetStartY) * progress;
    }

    for (const spark of sparks) {
      spark.x += spark.vx;
      spark.y += spark.vy;
      spark.vx *= 0.9;
      spark.vy *= 0.9;
      spark.life -= 1;
    }
    for (const piece of debris) {
      piece.x += piece.vx;
      piece.y += piece.vy;
      piece.vx *= 0.96;
      piece.vy *= 0.96;
      piece.life -= 1;
    }
    for (const skid of skidMarks) skid.life -= 1;
    if (crashFlash > 0) crashFlash *= 0.9;

    sparks = sparks.filter(s => s.life > 0);
    debris = debris.filter(p => p.life > 0);
    skidMarks = skidMarks.filter(s => s.life > 0);

    crashSequence.framesLeft -= 1;
    if (crashSequence.framesLeft <= 0) {
      crashSequence = null;
      gameOver = true;
      player.y = H - 94;
      player.dx = 0;
    }
    return;
  }

  frame++;
  roadOffset += 10;
  updateEffectState();
  score += 0.12 * scoreMultiplier;
  scoreEl.textContent = Math.floor(score);
  if (frame % spawnRate === 0) spawnTraffic();
  if (frame % 200 === 0) spawnItem();
  if (frame % 300 === 0) {
    baseSpeed += 0.32;
    spawnRate = Math.max(18, spawnRate - 2);
  }

  player.x += player.dx;
  player.x = clamp(player.x, 8, W - player.w - 8);
  const fallMultiplier = getCurrentFallMultiplier();

  for (const v of traffic) {
    v.y += v.vy * fallMultiplier;
    v.x += v.sway;
    v.x = clamp(v.x, 6, W - v.w - 6);
    v.lane = getLaneForX(v.x, v.w);
  }

  const laneGroups = Array.from({ length: laneCount }, () => []);
  for (const v of traffic) laneGroups[v.lane ?? getLaneForX(v.x, v.w)].push(v);
  for (const laneTraffic of laneGroups) {
    laneTraffic.sort((a, b) => b.y - a.y);
    for (let i = 0; i < laneTraffic.length - 1; i++) {
      const front = laneTraffic[i];
      const back = laneTraffic[i + 1];
      const minGap = Math.max(72, (front.h + back.h) * 0.6);
      const actualGap = front.y - (back.y + back.h);
      if (actualGap < minGap) {
        back.y = front.y - back.h - minGap;
      }
    }
  }
  for (const item of items) {
    item.y += item.vy * Math.max(0.9, fallMultiplier * 0.95);
    item.rot += 0.04;
  }
  for (const popup of popups) {
    popup.y -= 0.85;
    popup.life -= 1;
  }
  for (const spark of sparks) {
    spark.x += spark.vx;
    spark.y += spark.vy;
    spark.vx *= 0.9;
    spark.vy *= 0.9;
    spark.life -= 1;
  }
  for (const piece of debris) {
    piece.x += piece.vx;
    piece.y += piece.vy;
    piece.vx *= 0.96;
    piece.vy *= 0.96;
    piece.life -= 1;
  }
  for (const skid of skidMarks) skid.life -= 1;
  if (crashFlash > 0) crashFlash *= 0.92;

  traffic = traffic.filter(v => v.y < H + v.h);
  items = items.filter(item => item.y < H + item.h);
  popups = popups.filter(p => p.life > 0);
  sparks = sparks.filter(s => s.life > 0);
  debris = debris.filter(p => p.life > 0);
  skidMarks = skidMarks.filter(s => s.life > 0);

  for (const v of traffic) {
    if (collides(player, v)) {
      endGame(v);
      return;
    }
  }
  items = items.filter(item => {
    if (collides(player, item)) {
      applyItem(item);
      return false;
    }
    return true;
  });
}

function collides(a, b) {
  const scaleA = a.hitScale || 0.62;
  const scaleB = b.hitScale || 0.72;
  const ax = a.x + a.w * (1 - scaleA) / 2;
  const ay = a.y + a.h * (1 - scaleA) / 2;
  const aw = a.w * scaleA;
  const ah = a.h * scaleA;
  const bx = b.x + b.w * (1 - scaleB) / 2;
  const by = b.y + b.h * (1 - scaleB) / 2;
  const bw = b.w * scaleB;
  const bh = b.h * scaleB;
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function drawRoad() {
  ctx.clearRect(0, 0, W, H);
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#0e1735');
  sky.addColorStop(1, '#060911');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#1f2937';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#2d3748';
  ctx.fillRect(0, 0, 14, H);
  ctx.fillRect(W - 14, 0, 14, H);
  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.lineWidth = 3;
  for (let i = 1; i < laneCount; i++) {
    const x = i * laneWidth;
    for (let y = -40 + (roadOffset % 40); y < H; y += 40) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + 22);
      ctx.stroke();
    }
  }
}

function drawImageVehicle(img, x, y, w, h, rotation = 0) {
  if (!img.complete || !img.naturalWidth) {
    ctx.fillStyle = '#94a3b8';
    ctx.fillRect(x, y, w, h);
    return;
  }
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate(rotation);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  ctx.restore();
}

function drawPlayer() {
  drawImageVehicle(images.player, player.x, player.y, player.w, player.h, 0);
}

function drawTraffic() {
  for (const v of traffic) {
    drawImageVehicle(images[v.image], v.x, v.y, v.w, v.h, v.rotation || 0);
  }
}

function drawToken(item) {
  const cfg = itemConfigs[item.type];
  ctx.save();
  ctx.translate(item.x + item.w / 2, item.y + item.h / 2);
  ctx.rotate(item.rot);
  ctx.fillStyle = cfg.color;
  ctx.shadowBlur = 18;
  ctx.shadowColor = cfg.glow;
  ctx.beginPath();
  ctx.arc(0, 0, item.w / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, item.w / 2 - 4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${Math.max(12, item.w * 0.42)}px Segoe UI`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (item.type === 'slow') ctx.fillText('S', 0, 1);
  else if (item.type === 'accel') ctx.fillText('A', 0, 1);
  else if (item.type === 'scoreLarge') ctx.fillText('30', 0, 1);
  else if (item.type === 'scoreMedium') ctx.fillText('55', 0, 1);
  else if (item.type === 'scoreSmall') ctx.fillText('90', 0, 1);
  ctx.restore();
}

function drawItems() { for (const item of items) drawToken(item); }

function drawSkidMarks() {
  for (const mark of skidMarks) {
    const alpha = Math.max(0, mark.life / 150);
    ctx.save();
    ctx.globalAlpha = alpha * 0.6;
    ctx.translate(mark.x, mark.y);
    ctx.rotate(mark.rot);

    const grad = ctx.createLinearGradient(0, -mark.h / 2, 0, mark.h / 2);
    grad.addColorStop(0, 'rgba(15,23,42,0)');
    grad.addColorStop(0.15, 'rgba(30,41,59,0.82)');
    grad.addColorStop(0.5, 'rgba(15,23,42,0.95)');
    grad.addColorStop(0.85, 'rgba(30,41,59,0.82)');
    grad.addColorStop(1, 'rgba(15,23,42,0)');

    ctx.fillStyle = grad;
    ctx.shadowBlur = 10;
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.fillRect(-mark.w / 2, -mark.h / 2, mark.w, mark.h);

    ctx.globalAlpha = alpha * 0.22;
    ctx.fillStyle = '#94a3b8';
    ctx.fillRect(-mark.w / 4, -mark.h / 2, mark.w / 2, mark.h);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

function drawSparks() {
  for (const spark of sparks) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, spark.life / spark.maxLife);
    ctx.strokeStyle = spark.color;
    ctx.lineWidth = 2 + Math.max(0, spark.life / 8);
    ctx.shadowBlur = 16;
    ctx.shadowColor = spark.color;
    ctx.beginPath();
    ctx.moveTo(spark.x, spark.y);
    ctx.lineTo(spark.x - spark.vx * 2.2, spark.y - spark.vy * 2.2);
    ctx.stroke();
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

function drawDebris() {
  for (const piece of debris) {
    const alpha = Math.max(0, piece.life / 70);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(piece.x + piece.size / 2, piece.y + piece.size / 2);
    ctx.rotate((piece.vx + piece.vy) * 0.08);
    ctx.fillStyle = piece.color;
    ctx.shadowBlur = 20;
    ctx.shadowColor = piece.color;
    ctx.fillRect(-piece.size / 2, -piece.size / 2, piece.size, piece.size);
    ctx.globalAlpha = alpha * 0.45;
    ctx.fillStyle = '#fff7ed';
    ctx.fillRect(-piece.size / 5, -piece.size / 5, piece.size / 2.5, piece.size / 2.5);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

function drawPopups() {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const popup of popups) {
    ctx.globalAlpha = Math.max(0, popup.life / 60);
    ctx.shadowBlur = 14;
    ctx.shadowColor = popup.glow;
    ctx.fillStyle = popup.color;
    ctx.font = `bold ${popup.size}px Segoe UI`;
    ctx.fillText(popup.text, popup.x, popup.y);
  }
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
}

function drawCrashFlash() {
  if (crashFlash <= 0.01) return;
  ctx.fillStyle = `rgba(255,80,80,${Math.min(crashFlash * 0.35, 0.35)})`;
  ctx.fillRect(0, 0, W, H);
}

function draw() {
  drawRoad();
  drawSkidMarks();
  drawTraffic();
  drawItems();
  drawPlayer();
  drawSparks();
  drawDebris();
  drawPopups();
  drawCrashFlash();
  if (gameOver) overlayGameOver();
}

function overlayGameOver() {
  ctx.fillStyle = 'rgba(3,6,15,0.72)';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#ff8a8a';
  ctx.textAlign = 'center';
  ctx.font = 'bold 54px Segoe UI';
  ctx.fillText('GAME OVER', W / 2, H / 2 - 42);
  ctx.fillStyle = '#e2e8f0';
  ctx.font = 'bold 24px Segoe UI';
  ctx.fillText(`本次分數 ${lastRunScore}`, W / 2, H / 2 + 2);
  ctx.font = '20px Segoe UI';
  ctx.fillText(`最高分 ${best}`, W / 2, H / 2 + 38);
  ctx.fillStyle = '#cbd5e1';
  ctx.fillText('按「開始 / 重新開始」再跑一趟', W / 2, H / 2 + 78);
}

function loop() {
  if (running || crashSequence) update();
  draw();
  if (running || crashSequence) animationId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();
  if (e.key === 'ArrowLeft' || key === 'a') player.dx = -player.speed;
  if (e.key === 'ArrowRight' || key === 'd') player.dx = player.speed;
  if (!running && e.key === ' ') startGame();
});

document.addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  if (['arrowleft', 'a', 'arrowright', 'd'].includes(k)) {
    if (!touchActive) player.dx = 0;
  }
});

canvas.addEventListener('pointerdown', (e) => { touchActive = true; moveToPointer(e); });
canvas.addEventListener('pointermove', (e) => { if (touchActive) moveToPointer(e); });
window.addEventListener('pointerup', () => { touchActive = false; player.dx = 0; });

function moveToPointer(e) {
  const rect = canvas.getBoundingClientRect();
  const scale = W / rect.width;
  const px = (e.clientX - rect.left) * scale;
  player.x = clamp(px - player.w / 2, 8, W - player.w - 8);
}

startBtn.addEventListener('click', startGame);
audioBtn.addEventListener('click', () => {
  audioEnabled = !audioEnabled;
  audioBtn.textContent = `音效：${audioEnabled ? '開' : '關'}`;
  if (!audioEnabled) stopBgm();
  else if (running) startBgm();
});

draw();
setEffectText('無');
overlayGameOver();
