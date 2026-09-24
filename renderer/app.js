import * as THREE from '../node_modules/three/build/three.module.js';

// --- Renderer / scene (created eagerly; sized once the first category plays) ---
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({
  canvas,
  alpha: true,
  antialias: false,
});
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setClearColor(0x000000, 0);

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-100, 100, 100, -100, 0.1, 10);
camera.position.z = 1;

// --- Texture cache, keyed by the resolved peon-asset:// URL main.js sent us ---
// Multiple categories commonly share one atlas file; main.js already dedupes
// the URL for that case (see toAssetUrl), so this cache also dedupes the
// actual GPU upload — a shared atlas is only ever loaded once.
const textureLoader = new THREE.TextureLoader();
const textureCache = new Map();

function loadTexture(url, onSettled) {
  let tex = textureCache.get(url);
  if (tex) {
    if (onSettled) onSettled();
    return tex;
  }
  tex = textureLoader.load(
    url,
    () => {
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      tex.needsUpdate = true;
      if (onSettled) onSettled();
    },
    undefined,
    (err) => {
      console.warn('[peon-pet] Failed to load texture:', url, err);
      if (onSettled) onSettled();
    }
  );
  textureCache.set(url, tex);
  return tex;
}

// Every variant's texture, across every category, plus border/bg if
// present — loaded once up front so a later category transition never has
// to wait on a first-time load. See the #loading overlay in initScene.
function collectAllUrls(config) {
  const urls = [];
  for (const variants of Object.values(config.animations || {})) {
    for (const variant of variants) urls.push(variant.url);
  }
  if (config.assets?.bg) urls.push(config.assets.bg.url);
  if (config.assets?.borders) urls.push(config.assets.borders.url);
  return urls;
}

function preloadAllTextures(urls, onDone) {
  const unique = [...new Set(urls)];
  if (unique.length === 0) {
    onDone();
    return;
  }
  let remaining = unique.length;
  for (const url of unique) {
    loadTexture(url, () => {
      remaining--;
      if (remaining <= 0) onDone();
    });
  }
}

// --- Sprite/bg/border meshes (created lazily — sizes aren't known until the
// first category plays; see applySize) ---
let geometry = null;
let material = null;
let sprite = null;
let bgMesh = null;
let borderMesh = null;
let pendingBgAsset = null;
let pendingBorderAsset = null;
let currentWinW = 0;
let currentWinH = 0;

// --- Flash overlay ---
async function loadShader(url) {
  const r = await fetch(url);
  return r.text();
}

let flashMesh = null;
let flashIntensity = 0;
const flashColor = new THREE.Color(1, 1, 0);
let flashDecay = 2.0;

async function setupFlash(width, height) {
  const vert = await loadShader('./shaders/flash.vert');
  const frag = await loadShader('./shaders/flash.frag');

  const flashMat = new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    uniforms: {
      flashColor: { value: flashColor },
      flashIntensity: { value: 0.0 },
    },
    transparent: true,
    depthTest: false,
  });

  const flashGeo = new THREE.PlaneGeometry(width, height);
  flashMesh = new THREE.Mesh(flashGeo, flashMat);
  flashMesh.position.z = 0.5;
  scene.add(flashMesh);
}

function triggerFlash(r, g, b, intensity = 0.6, decay = 3.0) {
  if (!flashMesh) return;
  flashColor.setRGB(r, g, b);
  flashMesh.material.uniforms.flashColor.value = flashColor;
  flashIntensity = intensity;
  flashDecay = decay;
}

// --- Session dots (glowing orbs) ---
const MAX_DOTS = 10;
const DOT_SIZE_BASE = 12;
const DOT_GAP_BASE  = 6;
const DOT_TOP_PADDING_BASE = 12;
const DOT_REFERENCE_WIDTH = 200; // window width these base constants were tuned for
let dotScaleFactor = 1; // recomputed in applySize as currentWinW / DOT_REFERENCE_WIDTH

const DOT_VERT = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const DOT_FRAG = `
  uniform vec3  dotColor;
  uniform float pulse;   // 0..1 animated for active, 0 for idle
  uniform float visible; // 0 or 1
  varying vec2 vUv;
  void main() {
    if (visible < 0.5) discard;
    vec2  c    = vUv - 0.5;
    float dist = length(c);
    // Soft core
    float core = 1.0 - smoothstep(0.20, 0.32, dist);
    // Outer glow ring — only for active
    float glow = (1.0 - smoothstep(0.32, 0.50, dist)) * pulse * 0.6;
    float alpha = core + glow;
    if (alpha < 0.01) discard;
    vec3 col = dotColor + dotColor * pulse * 0.5;
    gl_FragColor = vec4(col, alpha);
  }
`;

const dotMeshes = [];
const dotStates = [];  // { active: bool }

for (let i = 0; i < MAX_DOTS; i++) {
  const mat = new THREE.ShaderMaterial({
    vertexShader:   DOT_VERT,
    fragmentShader: DOT_FRAG,
    uniforms: {
      dotColor: { value: new THREE.Color(0x666666) },
      pulse:    { value: 0.0 },
      visible:  { value: 0.0 },
    },
    transparent: true,
    depthTest: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(DOT_SIZE_BASE, DOT_SIZE_BASE), mat);
  mesh.position.z = 0.6;
  scene.add(mesh);
  dotMeshes.push(mesh);
  dotStates.push({ active: false });
}

function updateDots(sessions) {
  const dotSize = DOT_SIZE_BASE * dotScaleFactor;
  const dotGap = DOT_GAP_BASE * dotScaleFactor;
  const count = Math.min(sessions.length, MAX_DOTS);
  const totalWidth = count * dotSize + Math.max(0, count - 1) * dotGap;
  const startX = -totalWidth / 2 + dotSize / 2;
  const y = currentWinH / 2 - DOT_TOP_PADDING_BASE * dotScaleFactor;

  for (let i = 0; i < MAX_DOTS; i++) {
    const mesh = dotMeshes[i];
    const u    = mesh.material.uniforms;
    mesh.scale.setScalar(dotScaleFactor);
    if (i < count) {
      const { hot, warm } = sessions[i];
      dotStates[i].active = hot;
      mesh.position.x = startX + i * (dotSize + dotGap);
      mesh.position.y = y;
      // hot = bright green pulsing, warm = dim green static, else grey
      u.dotColor.value.set(hot ? 0x44ff44 : warm ? 0x1a4d1a : 0x333333);
      u.visible.value = 1.0;
    } else {
      dotStates[i].active = false;
      u.visible.value = 0.0;
    }
  }
}

// --- Particle burst ---
const PARTICLE_COUNT = 30;
const particlePositions = new Float32Array(PARTICLE_COUNT * 3);
const particleColors = new Float32Array(PARTICLE_COUNT * 3);
const particleVelocities = new Array(PARTICLE_COUNT);

const particleGeo = new THREE.BufferGeometry();
particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
particleGeo.setAttribute('color', new THREE.BufferAttribute(particleColors, 3));

const particleMat = new THREE.PointsMaterial({
  size: 6,
  vertexColors: true,
  transparent: true,
  opacity: 1.0,
  depthTest: false,
  sizeAttenuation: false,
});

const particles = new THREE.Points(particleGeo, particleMat);
particles.visible = false;
particles.position.z = 0.8;
scene.add(particles);

let particleLifetime = 0;
const PARTICLE_DURATION = 1.2;

function burstParticles() {
  particleLifetime = PARTICLE_DURATION;
  particles.visible = true;
  particleMat.opacity = 1.0;

  const goldColors = [
    [1.0, 0.85, 0.0],
    [1.0, 1.0,  0.4],
    [0.9, 0.6,  0.1],
  ];

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    particlePositions[i * 3]     = (Math.random() - 0.5) * 40;
    particlePositions[i * 3 + 1] = -40 + (Math.random() - 0.5) * 20;
    particlePositions[i * 3 + 2] = 0;

    const angle = (Math.random() * Math.PI) - Math.PI / 2;
    const speed = 40 + Math.random() * 80;
    particleVelocities[i] = {
      x: Math.cos(angle) * speed,
      vy: Math.abs(Math.sin(angle)) * speed + 20,
      gravity: -60 - Math.random() * 40,
    };

    const c = goldColors[Math.floor(Math.random() * goldColors.length)];
    particleColors[i * 3]     = c[0];
    particleColors[i * 3 + 1] = c[1];
    particleColors[i * 3 + 2] = c[2];
  }

  particleGeo.attributes.position.needsUpdate = true;
  particleGeo.attributes.color.needsUpdate = true;
}

// --- Screen shake ---
let shakeIntensity = 0;
const SHAKE_DECAY = 8.0;

// --- ANIM_FLASH map ---
const ANIM_FLASH = {
  waking:    () => triggerFlash(0.4, 0.8, 1.0, 0.3, 2.0),
  alarmed:   () => triggerFlash(1.0, 0.1, 0.1, 0.5, 2.5),
  celebrate: () => triggerFlash(1.0, 0.8, 0.0, 0.5, 2.0),
  annoyed:   () => triggerFlash(0.8, 0.4, 0.0, 0.3, 2.0),
};

// --- Animation state machine (config arrives over IPC — see initScene) ---
// ANIM_CONFIG[category] is an array of variants (CEAP's variant-selection
// unit), not a single config object — most categories today have exactly
// one, but the schema always takes an array.
let ANIM_CONFIG = {};
let animLoopStarted = false; // guard against double-starting the RAF loop on re-init
let currentAnim = 'sleeping';
let currentVariant = null;   // the specific variant picked for currentAnim
let currentFrame = 0;
let frameTimer = 0;
let pendingIdle = false;
let remainingLoops = 0;  // extra replays for non-sleeping anims
const REACTION_LOOPS = 3;  // play reaction animations 3x before sleeping
let idleTimer = null;
const IDLE_TIMEOUT_MS = 30000;
let isSubAgent = false;
let anySessionActive = false;
let scale = 1;         // user's --scale / config "scale", resolved once in main.js
let borderMargin = { x: 0, y: 0 }; // 0 unless the user enabled borders AND the pack has one; already density-adjusted per axis (see resolvePack's displayMargin)

// Per-category "last played variant" — process-lifetime only, per CEAP's
// variant-selection algorithm (docs/ceap-spec.md#variant-selection).
const lastPlayedIndex = {};

function pickVariant(animName) {
  const variants = ANIM_CONFIG[animName];
  if (!variants || variants.length === 0) return null;
  if (variants.length === 1) return { variant: variants[0], index: 0 };
  const lastIndex = lastPlayedIndex[animName];
  const candidates = variants.map((_, i) => i).filter((i) => i !== lastIndex);
  const index = candidates[Math.floor(Math.random() * candidates.length)];
  return { variant: variants[index], index };
}

function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!isSubAgent && !anySessionActive) playAnim('sleeping');
  }, IDLE_TIMEOUT_MS);
}

// Resizes the window (via main.js) and the local scene to match `variant`'s
// own displayWidth/displayHeight — CEAP sizing is per-file, not per-pack,
// so this runs on every transition, not just once at startup. The sprite/
// bg always render at their exact declared size; a border (if the user
// enabled one and the pack has one) grows the *window* around them rather
// than shrinking the sprite to fit — see lib/pet-size.js.
function applySize(variant) {
  const spriteSize = window.peonBridge.computeWindowSize(variant, { marginX: 0, marginY: 0, scale, subAgent: isSubAgent });
  const winSize = window.peonBridge.computeWindowSize(variant, { marginX: borderMargin.x, marginY: borderMargin.y, scale, subAgent: isSubAgent });
  const winW = Math.round(winSize.width);
  const winH = Math.round(winSize.height);
  const spriteW = spriteSize.width;
  const spriteH = spriteSize.height;

  if (sprite && winW === currentWinW && winH === currentWinH) return;
  currentWinW = winW;
  currentWinH = winH;
  dotScaleFactor = winW / DOT_REFERENCE_WIDTH;

  window.peonBridge.resizePet({ width: winW, height: winH });

  document.documentElement.style.width = `${winW}px`;
  document.documentElement.style.height = `${winH}px`;
  document.body.style.width = `${winW}px`;
  document.body.style.height = `${winH}px`;

  renderer.setSize(winW, winH);

  camera.left = -winW / 2;
  camera.right = winW / 2;
  camera.top = winH / 2;
  camera.bottom = -winH / 2;
  camera.updateProjectionMatrix();

  if (geometry) geometry.dispose();
  geometry = new THREE.PlaneGeometry(spriteW, spriteH);
  if (sprite) {
    sprite.geometry = geometry;
  } else {
    material = new THREE.MeshBasicMaterial({ map: null, transparent: true, alphaTest: 0.01 });
    sprite = new THREE.Mesh(geometry, material);
    scene.add(sprite);
  }

  if (pendingBgAsset) {
    if (bgMesh) {
      bgMesh.geometry.dispose();
      bgMesh.geometry = new THREE.PlaneGeometry(spriteW, spriteH);
    } else {
      bgMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(spriteW, spriteH),
        new THREE.MeshBasicMaterial({ map: loadTexture(pendingBgAsset.url), transparent: true })
      );
      bgMesh.position.z = -0.5;
      scene.add(bgMesh);
    }
  }

  if (pendingBorderAsset) {
    if (borderMesh) {
      borderMesh.geometry.dispose();
      borderMesh.geometry = new THREE.PlaneGeometry(winW, winH);
    } else {
      borderMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(winW, winH),
        new THREE.MeshBasicMaterial({ map: loadTexture(pendingBorderAsset.url), transparent: true, depthTest: false })
      );
      borderMesh.position.z = 0.4;
      scene.add(borderMesh);
    }
  }

  if (flashMesh) {
    flashMesh.geometry.dispose();
    flashMesh.geometry = new THREE.PlaneGeometry(winW, winH);
  } else {
    setupFlash(winW, winH); // async; flashMesh is null until shaders load
  }
}

function setFrame(frame) {
  const cfg = currentVariant;
  if (!cfg) return;
  const tex = loadTexture(cfg.url);
  if (material.map !== tex) {
    material.map = tex;
    material.needsUpdate = true;
  }
  const { u0, u1, v0, v1 } = window.peonBridge.computeUVs(cfg, frame);
  // PlaneGeometry vertex UV order: [0]=TL, [1]=TR, [2]=BL, [3]=BR
  const uv = geometry.attributes.uv;
  uv.setXY(0, u0, v1); // TL
  uv.setXY(1, u1, v1); // TR
  uv.setXY(2, u0, v0); // BL
  uv.setXY(3, u1, v0); // BR
  uv.needsUpdate = true;
}

function playAnim(animName) {
  // A category the active pack doesn't declare (e.g. a missing reaction)
  // has no entry in ANIM_CONFIG at all — pickVariant returns null, and the
  // event that would have triggered this simply has no visible effect, per
  // docs/ceap-spec.md#category-fallback. No substitute is ever played.
  const picked = pickVariant(animName);
  if (!picked) return;

  pendingIdle = false;
  currentAnim = animName;
  currentVariant = picked.variant;
  lastPlayedIndex[animName] = picked.index;
  currentFrame = 0;
  frameTimer = 0;
  const loops = currentVariant.loops ?? REACTION_LOOPS;
  remainingLoops = (animName !== 'sleeping') ? loops - 1 : 0;
  applySize(currentVariant);
  setFrame(0);
  if (ANIM_FLASH[animName]) {
    ANIM_FLASH[animName]();
  }
  if (animName !== 'sleeping') {
    resetIdleTimer();
  }
}

// --- Tooltip (rendered in its own always-on-top window — see main.js's
// ensureTooltipWindow. An OS window can't render past its own bounds, so a
// tooltip drawn inside this window would get clipped at small --scale.) ---
let currentSessions = [];

function hitTestDots(px, py) {
  const count = Math.min(currentSessions.length, MAX_DOTS);
  if (count === 0) return -1;
  const dotSize = DOT_SIZE_BASE * dotScaleFactor;
  const dotGap = DOT_GAP_BASE * dotScaleFactor;
  const totalWidth = count * dotSize + Math.max(0, count - 1) * dotGap;
  const startThreeX = -totalWidth / 2 + dotSize / 2;
  const dotCanvasY = DOT_TOP_PADDING_BASE * dotScaleFactor; // winH/2 - (winH/2 - padding)
  const HIT_R = dotSize;                                    // slightly wider than visual for easier hover
  for (let i = 0; i < count; i++) {
    const dotCanvasX = startThreeX + i * (dotSize + dotGap) + currentWinW / 2;
    const dx = px - dotCanvasX;
    const dy = py - dotCanvasY;
    if (dx * dx + dy * dy < HIT_R * HIT_R) return i;
  }
  return -1;
}

// --- Drag handling ---
let dragging = false;

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;  // left-click only
  dragging = true;
  window.peonBridge.hideTooltip();
  canvas.setPointerCapture(e.pointerId);
  window.peonBridge.startDrag();
});

canvas.addEventListener('pointerup', (e) => {
  if (e.button !== 0 || !dragging) return;
  dragging = false;
  window.peonBridge.stopDrag();
});

canvas.addEventListener('lostpointercapture', () => {
  if (!dragging) return;
  dragging = false;
  window.peonBridge.stopDrag();
});

canvas.addEventListener('pointercancel', () => {
  if (!dragging) return;
  dragging = false;
  window.peonBridge.stopDrag();
});

function handleMouseMove(e) {
  if (dragging) return;  // suppress tooltip during drag
  const px = e.offsetX;
  const py = e.offsetY;
  const idx = hitTestDots(px, py);
  let html;
  if (idx >= 0) {
    const s = currentSessions[idx];
    const status = s.hot ? '<span style="color:#44ff44">active</span>'
                         : s.warm ? '<span style="color:#1aaa1a">idle</span>'
                         : '<span style="color:#555">cold</span>';
    const label = s.cwd ? s.cwd.split('/').filter(Boolean).pop() : ('…' + s.id.slice(-8));
    html = `${label} &bull; ${status}`;
  } else {
    const active = currentSessions.filter(s => s.hot).length;
    const total  = currentSessions.length;
    if (total === 0) {
      html = 'Peon Pet';
    } else {
      const names = currentSessions
        .map(s => s.cwd ? s.cwd.split('/').filter(Boolean).pop() : null)
        .filter(Boolean);
      html = names.length ? names.join('<br>') : `${active}/${total} sessions`;
    }
  }
  // e.screenX/screenY are the cursor's absolute screen position — the
  // tooltip window is positioned by main.js, independent of this window's
  // own bounds, so there's no window-relative math needed here at all.
  window.peonBridge.showTooltip({ html, x: e.screenX + 6, y: e.screenY + 6 });
}

function handleMouseLeave() {
  if (!dragging) window.peonBridge.hideTooltip();
}

canvas.addEventListener('mousemove', handleMouseMove);
canvas.addEventListener('mouseleave', handleMouseLeave);

// --- One-time setup, driven by the resolved CEAP pack over IPC ---
// Safe to call again on config hot-reload: clears stale meshes, resets
// animation config, and restarts sleeping — but never double-starts the RAF loop.
function initScene(config) {
  isSubAgent = !!config.subAgent;
  scale = config.scale ?? 1;
  ANIM_CONFIG = config.animations || {};

  // Clear per-pack variant history so the new pack starts fresh
  for (const k of Object.keys(lastPlayedIndex)) delete lastPlayedIndex[k];

  // No cross-pack fallback for bg/borders (docs/ceap-spec.md#asset-fallback)
  // — a pack that omits either (or a border the user hasn't enabled) gets
  // no such layer, not orc's. main.js already applies the border-enabled
  // gate before this ever arrives: config.assets.borders is only present
  // when the user opted in AND the pack has one.
  const newBgAsset = config.assets?.bg ?? null;
  const newBorderAsset = config.assets?.borders ?? null;
  borderMargin = newBorderAsset?.displayMargin ?? { x: 0, y: 0 };

  // Remove stale bg/border meshes if the new config no longer has them,
  // or if the asset URL changed (pack switch). They'll be recreated lazily
  // by the next applySize() call.
  if (bgMesh && (!newBgAsset || newBgAsset.url !== pendingBgAsset?.url)) {
    scene.remove(bgMesh);
    bgMesh.geometry.dispose();
    bgMesh.material.dispose();
    bgMesh = null;
  }
  if (borderMesh && (!newBorderAsset || newBorderAsset.url !== pendingBorderAsset?.url)) {
    scene.remove(borderMesh);
    borderMesh.geometry.dispose();
    borderMesh.material.dispose();
    borderMesh = null;
  }
  // Force applySize to re-run by invalidating the cached window dimensions
  currentWinW = 0;
  currentWinH = 0;

  pendingBgAsset = newBgAsset;
  pendingBorderAsset = newBorderAsset;

  // Sub-agent windows: no dots, no tooltip (idempotent — guards against re-init)
  if (isSubAgent && dotMeshes[0]?.parent === scene) {
    for (const mesh of dotMeshes) {
      scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    canvas.removeEventListener('mousemove', handleMouseMove);
    canvas.removeEventListener('mouseleave', handleMouseLeave);
  }

  // Loading gate: preload all textures for the new pack, then play sleeping.
  // The RAF loop is only started once — subsequent re-inits skip it.
  const loadingEl = document.getElementById('loading');
  preloadAllTextures(collectAllUrls(config), () => {
    if (loadingEl) loadingEl.style.display = 'none';
    playAnim('sleeping');
    if (!animLoopStarted) {
      animLoopStarted = true;
      requestAnimationFrame(animate);
    }
  });
}

// --- IPC events ---
window.peonBridge.onConfig(initScene);

window.peonBridge.onEvent(({ anim }) => {
  // Sub-agents only respond to the initial waking event
  if (isSubAgent && anim !== 'waking') return;
  // Don't wake if already active — only wake from sleep
  if (anim === 'waking' && currentAnim !== 'sleeping') return;
  playAnim(anim);
});

window.peonBridge.onSessionUpdate(({ sessions }) => {
  currentSessions = sessions;
  updateDots(sessions);
  const wasActive = anySessionActive;
  anySessionActive = sessions.some(s => s.hot);
  // If a session just became hot and the character is sleeping, wake to typing
  if (anySessionActive && !wasActive && currentAnim === 'sleeping') {
    playAnim('typing');
  }
});

// --- Render loop ---
let lastTime = 0;
function animate(time) {
  requestAnimationFrame(animate);
  const delta = Math.min((time - lastTime) / 1000, 0.1);
  lastTime = time;

  // Animate dot pulse
  for (let i = 0; i < MAX_DOTS; i++) {
    if (dotStates[i].active) {
      dotMeshes[i].material.uniforms.pulse.value = (Math.sin(time * 0.003 + i) + 1) / 2;
    } else {
      dotMeshes[i].material.uniforms.pulse.value = 0.0;
    }
  }

  // Decay flash
  if (flashMesh && flashIntensity > 0) {
    flashIntensity = Math.max(0, flashIntensity - delta * flashDecay);
    flashMesh.material.uniforms.flashIntensity.value = flashIntensity;
  }

  // Update particles
  if (particleLifetime > 0) {
    particleLifetime -= delta;
    particleMat.opacity = Math.max(0, particleLifetime / PARTICLE_DURATION);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const v = particleVelocities[i];
      if (!v) continue;
      particlePositions[i * 3]     += v.x * delta;
      particlePositions[i * 3 + 1] += v.vy * delta;
      v.vy += v.gravity * delta;
    }
    particleGeo.attributes.position.needsUpdate = true;

    if (particleLifetime <= 0) {
      particles.visible = false;
    }
  }

  // Advance animation frame
  const cfg = currentVariant;
  if (cfg) {
    frameTimer += delta;
    if (frameTimer >= 1 / cfg.fps) {
      frameTimer = 0;
      currentFrame++;
      if (currentFrame >= cfg.frames) {
        if (cfg.loop) {
          currentFrame = 0;
        } else {
          if (remainingLoops > 0) {
            remainingLoops--;
            currentFrame = 0;
          } else {
            currentFrame = cfg.frames - 1;
            if (!pendingIdle) {
              pendingIdle = true;
              setTimeout(() => {
                pendingIdle = false;
                // Sub-agents always stay typing while alive
                if (isSubAgent || anySessionActive) {
                  playAnim('typing');
                } else {
                  playAnim('sleeping');
                }
              }, 300);
            }
          }
        }
      }
      setFrame(currentFrame);
    }
  }

  // Screen shake
  if (shakeIntensity > 0) {
    shakeIntensity = Math.max(0, shakeIntensity - SHAKE_DECAY * delta);
    sprite.position.x = (Math.random() - 0.5) * shakeIntensity;
    sprite.position.y = (Math.random() - 0.5) * shakeIntensity;
  } else {
    sprite.position.x = 0;
    sprite.position.y = 0;
  }

  renderer.render(scene, camera);
}
