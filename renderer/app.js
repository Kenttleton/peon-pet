
import * as THREE from '../node_modules/three/build/three.module.js';

// --- Renderer / scene (created eagerly; sized once config arrives) ---
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
const textureLoader = new THREE.TextureLoader();
const textureCache = new Map();

function loadTexture(url) {
  let tex = textureCache.get(url);
  if (tex) return tex;
  tex = textureLoader.load(url, () => {
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
  });
  textureCache.set(url, tex);
  return tex;
}

// --- Sprite mesh (created once config arrives — filenames aren't known yet) ---
let geometry = null;
let material = null;
let sprite = null;
let bgMesh = null;
let borderMesh = null;

// --- Flash overlay ---
async function loadShader(url) {
  const r = await fetch(url);
  return r.text();
}

let flashMesh = null;
let flashIntensity = 0;
const flashColor = new THREE.Color(1, 1, 0);
let flashDecay = 2.0;

async function setupFlash(size) {
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

  const flashGeo = new THREE.PlaneGeometry(size, size);
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
const DOT_SIZE = 12;
const DOT_GAP  = 6;
const DOT_Y    = 88;

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
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(DOT_SIZE, DOT_SIZE), mat);
  mesh.position.z = 0.6;
  scene.add(mesh);
  dotMeshes.push(mesh);
  dotStates.push({ active: false });
}

function updateDots(sessions) {
  const count = Math.min(sessions.length, MAX_DOTS);
  const totalWidth = count * DOT_SIZE + Math.max(0, count - 1) * DOT_GAP;
  const startX = -totalWidth / 2 + DOT_SIZE / 2;

  for (let i = 0; i < MAX_DOTS; i++) {
    const mesh = dotMeshes[i];
    const u    = mesh.material.uniforms;
    if (i < count) {
      const { hot, warm } = sessions[i];
      dotStates[i].active = hot;
      mesh.position.x = startX + i * (DOT_SIZE + DOT_GAP);
      mesh.position.y = DOT_Y;
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
  setFrame(0);
  if (ANIM_FLASH[animName]) {
    ANIM_FLASH[animName]();
  }
  if (animName !== 'sleeping') {
    resetIdleTimer();
  }
}

// --- Tooltip ---
const tooltip = document.getElementById('tooltip');
let currentSessions = [];

function hitTestDots(px, py) {
  const count = Math.min(currentSessions.length, MAX_DOTS);
  if (count === 0) return -1;
  const totalWidth = count * DOT_SIZE + Math.max(0, count - 1) * DOT_GAP;
  const startThreeX = -totalWidth / 2 + DOT_SIZE / 2;
  const dotCanvasY = 100 - DOT_Y;  // Three.js DOT_Y=88 → canvas pixel y=12
  const HIT_R = DOT_SIZE;           // slightly wider than visual for easier hover
  for (let i = 0; i < count; i++) {
    const dotCanvasX = startThreeX + i * (DOT_SIZE + DOT_GAP) + 100;
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
  tooltip.style.display = 'none';
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
  tooltip.innerHTML = html;
  tooltip.style.display = 'block';
  // Position tooltip: prefer to the right/below cursor, clamped inside window
  const tw = tooltip.offsetWidth;
  const th = tooltip.offsetHeight;
  tooltip.style.left = Math.min(px + 6, 200 - tw - 2) + 'px';
  tooltip.style.top  = Math.min(py + 6, 200 - th - 2) + 'px';
}

function handleMouseLeave() {
  if (!dragging) tooltip.style.display = 'none';
}

canvas.addEventListener('mousemove', handleMouseMove);
canvas.addEventListener('mouseleave', handleMouseLeave);

// --- One-time scene init, driven by the resolved CEAP pack over IPC ---
function initScene(config) {
  isSubAgent = !!config.subAgent;
  ANIM_CONFIG = config.animations || {};
  const size = config.size;

  document.documentElement.style.width = `${size}px`;
  document.documentElement.style.height = `${size}px`;
  document.body.style.width = `${size}px`;
  document.body.style.height = `${size}px`;

  renderer.setSize(size, size);

  const half = size / 2;
  camera.left = -half;
  camera.right = half;
  camera.top = half;
  camera.bottom = -half;
  camera.updateProjectionMatrix();

  const inner = size * 0.9;

  // No cross-pack fallback for bg/borders (docs/ceap-spec.md#asset-fallback):
  // a pack that omits either gets no such layer, not orc's — so the mesh is
  // only created when the resolved asset is actually present. No grey/white
  // placeholder plane stands in for a missing one.
  const bgAsset = config.assets?.bg;
  if (bgAsset) {
    bgMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(inner, inner),
      new THREE.MeshBasicMaterial({ map: loadTexture(bgAsset.url), transparent: true })
    );
    bgMesh.position.z = -0.5;
    scene.add(bgMesh);
  }

  geometry = new THREE.PlaneGeometry(inner, inner);
  material = new THREE.MeshBasicMaterial({
    map: null,
    transparent: true,
    alphaTest: 0.01,
  });
  sprite = new THREE.Mesh(geometry, material);
  scene.add(sprite);

  const borderAsset = config.assets?.borders;
  if (borderAsset) {
    borderMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshBasicMaterial({ map: loadTexture(borderAsset.url), transparent: true, depthTest: false })
    );
    borderMesh.position.z = 0.4;
    scene.add(borderMesh);
  }

  setupFlash(size);

  // Sub-agent windows: no dots, no tooltip
  if (isSubAgent) {
    for (const mesh of dotMeshes) {
      scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    tooltip.style.display = 'none';
    canvas.removeEventListener('mousemove', handleMouseMove);
    canvas.removeEventListener('mouseleave', handleMouseLeave);
  }

  playAnim('sleeping');
  requestAnimationFrame(animate);
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
