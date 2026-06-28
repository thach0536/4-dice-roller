import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ==========================================
// Theme Configurations
// ==========================================
const THEMES = {
  'neon-blue': {
    primary: '#00f3ff',
    primaryHex: 0x00f3ff,
    secondary: '#002b3d',
    faceBg: '#090e1a',
    textColor: '#ffffff',
    borderColor: '#00f3ff',
  },
  'ruby-red': {
    primary: '#ff0077',
    primaryHex: 0xff0077,
    secondary: '#3d0016',
    faceBg: '#1a0910',
    textColor: '#ffffff',
    borderColor: '#ff0077',
  },
  'emerald-green': {
    primary: '#00ffaa',
    primaryHex: 0x00ffaa,
    secondary: '#003d25',
    faceBg: '#091a14',
    textColor: '#ffffff',
    borderColor: '#00ffaa',
  },
  'golden-sun': {
    primary: '#ffcc00',
    primaryHex: 0xffcc00,
    secondary: '#3d3000',
    faceBg: '#1a1809',
    textColor: '#ffffff',
    borderColor: '#ffcc00',
  }
};

let currentThemeName = 'neon-blue';
let currentTheme = THEMES[currentThemeName];

// ==========================================
// Sound Effects Controller (Web Audio API)
// ==========================================
class SoundController {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      console.warn("Web Audio API is not supported in this browser", e);
    }
  }

  playBounce(volume = 1.0) {
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;

    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }

    const now = this.ctx.currentTime;

    // 1. Synthesize Impact Bass Thump (low-frequency oscillator sweep)
    const osc = this.ctx.createOscillator();
    const oscGain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(150, now);
    osc.frequency.exponentialRampToValueAtTime(30, now + 0.12 * volume);
    
    oscGain.gain.setValueAtTime(0.4 * volume, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15 * volume);
    
    osc.connect(oscGain);
    oscGain.connect(this.ctx.destination);
    
    osc.start(now);
    osc.stop(now + 0.16);

    // 2. Synthesize High-Frequency Clack/Rattle (white noise burst)
    const bufferSize = this.ctx.sampleRate * 0.08 * volume; // Up to 80ms
    if (bufferSize <= 0) return;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1200, now);
    filter.Q.setValueAtTime(4, now);

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.25 * volume, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.07 * volume);

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(this.ctx.destination);

    noise.start(now);
    noise.stop(now + 0.08 * volume);
  }
}

const soundCtrl = new SoundController();

// ==========================================
// Application State & DOM
// ==========================================
const containerEl = document.getElementById('canvas-container');
const loaderEl = document.getElementById('canvas-loader');
const rollBtn = document.getElementById('roll-button');
const resetBtn = document.getElementById('btn-reset');
const topBtn = document.getElementById('btn-top');
const bottomBtn = document.getElementById('btn-bottom');
const soundToggleBtn = document.getElementById('sound-toggle');
const resultOverlayEl = document.getElementById('result-overlay');
const resultValueEl = document.getElementById('result-value');
const themeButtons = document.querySelectorAll('.theme-btn');

let scene, camera, renderer, controls;
let dieMesh, shadowMesh, platformMesh, ringMesh;
let pointLight;

// Dice rolling state variables
let isRolling = false;
let rollProgress = 0; // 0 to 1
const rollDuration = 2.4; // Extended to 2.4 seconds to accommodate landing + presentation phase
let preRollQuaternion = new THREE.Quaternion();
let postRollQuaternion = new THREE.Quaternion();
let Q_land = new THREE.Quaternion(); // The locked orientation resting flat on floor
let Q_reveal = new THREE.Quaternion(); // The locked presentation rotation facing the camera
let spinStartQuat = new THREE.Quaternion();
let spinAxis = new THREE.Vector3();
let spinSpeed = 25; // radians per second
let rollDrift = { x: 0, z: 0 };
let lastBounceFraction = 0;
let rolledResult = 4;
let revealCalculated = false;

// Regular Tetrahedron Math & Geometry
const R = 1.5; // Circumradius
const v0 = new THREE.Vector3(0, R, 0); // Vertex 0 (Value 4)
const x1 = (Math.sqrt(8) / 3) * R;
const y1 = (-1 / 3) * R;
const v1 = new THREE.Vector3(x1, y1, 0); // Vertex 1 (Value 1)
const x2 = (-Math.sqrt(2) / 3) * R;
const y2 = (-1 / 3) * R;
const z2 = (Math.sqrt(6) / 3) * R;
const v2 = new THREE.Vector3(x2, y2, z2); // Vertex 2 (Value 2)
const x3 = (-Math.sqrt(2) / 3) * R;
const y3 = (-1 / 3) * R;
const z3 = (-Math.sqrt(6) / 3) * R;
const v3 = new THREE.Vector3(x3, y3, z3); // Vertex 3 (Value 3)

// Map results to the vertex that points UP when that result is rolled.
// (e.g. if result is 1, it lands on Face 0 (opposite to v0), so v0 points UP).
const landingVertexForResult = {
  1: v0, // Lands on Face 0 (value 1) -> v0 points UP
  2: v3, // Lands on Face 1 (value 2) -> v3 points UP
  3: v1, // Lands on Face 2 (value 3) -> v1 points UP
  4: v2, // Lands on Face 3 (value 4) -> v2 points UP
};

// Arrays for local geometry calculations
const localNormals = [];
const faceUps = [];

function initGeometryMath() {
  // Clear any previous calculations
  localNormals.length = 0;
  faceUps.length = 0;

  // Face Centroids
  const c0 = new THREE.Vector3().add(v1).add(v2).add(v3).multiplyScalar(1/3); // Face 0
  const c1 = new THREE.Vector3().add(v0).add(v2).add(v1).multiplyScalar(1/3); // Face 1
  const c2 = new THREE.Vector3().add(v0).add(v3).add(v2).multiplyScalar(1/3); // Face 2
  const c3 = new THREE.Vector3().add(v0).add(v1).add(v3).multiplyScalar(1/3); // Face 3

  // Local Normals (outward facing)
  // Face 0: [v1, v2, v3]
  localNormals.push(new THREE.Vector3().crossVectors(v2.clone().sub(v1), v3.clone().sub(v1)).normalize());
  // Face 1: [v0, v2, v1]
  localNormals.push(new THREE.Vector3().crossVectors(v2.clone().sub(v0), v1.clone().sub(v0)).normalize());
  // Face 2: [v0, v3, v2]
  localNormals.push(new THREE.Vector3().crossVectors(v3.clone().sub(v0), v2.clone().sub(v0)).normalize());
  // Face 3: [v0, v1, v3]
  localNormals.push(new THREE.Vector3().crossVectors(v1.clone().sub(v0), v3.clone().sub(v0)).normalize());

  // Face Up vectors (from centroid towards Corner 0)
  faceUps.push(new THREE.Vector3().subVectors(v1, c0).normalize());
  faceUps.push(new THREE.Vector3().subVectors(v0, c1).normalize());
  faceUps.push(new THREE.Vector3().subVectors(v0, c2).normalize());
  faceUps.push(new THREE.Vector3().subVectors(v0, c3).normalize());
}

// ==========================================
// 2D Texture Generator for Faces (Single Center Number)
// ==========================================
function createFaceTexture(faceIndex, theme) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  // Coordinates of equilateral triangle in UV canvas space
  const x0 = 256, y0 = 40;     // Top corner
  const x1 = 40,  y1 = 472;    // Bottom-Left
  const x2 = 472, y2 = 472;    // Bottom-Right

  // 1. Draw solid background
  ctx.fillStyle = theme.faceBg;
  ctx.fillRect(0, 0, 512, 512);

  // 2. Draw outer triangle shape
  ctx.fillStyle = theme.faceBg;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x2, y2);
  ctx.lineTo(x1, y1);
  ctx.closePath();
  ctx.fill();

  // 3. Draw border inside
  ctx.strokeStyle = theme.primary;
  ctx.lineWidth = 20;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // 4. Draw neon glows
  ctx.strokeStyle = theme.primary + '22'; // low opacity glow
  ctx.lineWidth = 44;
  ctx.stroke();

  // Geometric Centroid
  const cx = 256;
  const cy = 328;

  // 5. Draw decorative glowing rune ring around the number
  ctx.strokeStyle = theme.primary + '1a';
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.arc(cx, cy, 95, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = theme.primary;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(cx, cy, 95, 0, Math.PI * 2);
  ctx.stroke();

  // 6. Draw single large number in the center (upright)
  const label = faceIndex + 1;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.shadowColor = theme.primary;
  ctx.shadowBlur = 25;
  ctx.fillStyle = theme.textColor;
  ctx.font = '800 150px Outfit, "Noto Sans TC", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label.toString(), 0, 8); // Offset slightly down for optical centering
  ctx.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// ==========================================
// Three.js Scene Setup
// ==========================================
function initEngine() {
  const width = containerEl.clientWidth;
  const height = containerEl.clientHeight;

  // Pre-calculate math vectors
  initGeometryMath();

  // Scene
  scene = new THREE.Scene();

  // Camera
  camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
  camera.position.set(0, 3.5, 6);

  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  containerEl.appendChild(renderer.domElement);

  // Controls - orbit limits updated to allow looking from underneath
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.minDistance = 3.5;
  controls.maxDistance = 12;
  // Allow full rotation (360 degrees) vertically
  controls.maxPolarAngle = Math.PI; 
  controls.target.set(0, 0.2, 0);

  // Lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.45);
  scene.add(ambientLight);

  // Directional Light with Shadows
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
  dirLight.position.set(5, 10, 5);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 1024;
  dirLight.shadow.mapSize.height = 1024;
  dirLight.shadow.camera.near = 0.5;
  dirLight.shadow.camera.far = 25;
  dirLight.shadow.camera.left = -6;
  dirLight.shadow.camera.right = 6;
  dirLight.shadow.camera.top = 6;
  dirLight.shadow.camera.bottom = -6;
  dirLight.shadow.bias = -0.0005;
  scene.add(dirLight);

  // Point Light for Neon Glow
  pointLight = new THREE.PointLight(currentTheme.primaryHex, 2.5, 12, 1.5);
  pointLight.position.set(0, 1.5, 0);
  scene.add(pointLight);

  // Create Smoked Translucent Glass Platform
  const platformGeo = new THREE.RingGeometry(0, 4.2, 64);
  const platformMat = new THREE.MeshStandardMaterial({
    color: 0x080c14,
    roughness: 0.1,
    metalness: 0.9,
    transparent: true,
    opacity: 0.55,
    side: THREE.DoubleSide, // Render both sides to see it from underneath
  });
  platformMesh = new THREE.Mesh(platformGeo, platformMat);
  platformMesh.rotation.x = -Math.PI / 2;
  platformMesh.position.y = -0.5; // Rest plane
  platformMesh.receiveShadow = true;
  scene.add(platformMesh);

  // Glowing boundary ring for the platform
  const ringGeo = new THREE.RingGeometry(4.15, 4.2, 64);
  const ringMat = new THREE.MeshBasicMaterial({
    color: currentTheme.primaryHex,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.65,
  });
  ringMesh = new THREE.Mesh(ringGeo, ringMat);
  ringMesh.rotation.x = Math.PI / 2;
  ringMesh.position.y = -0.49;
  scene.add(ringMesh);

  // Custom Shadow Plane (For smooth fake soft shadow)
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = 128;
  shadowCanvas.height = 128;
  const sCtx = shadowCanvas.getContext('2d');
  const gradient = sCtx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0.95)');
  gradient.addColorStop(0.3, 'rgba(0, 0, 0, 0.7)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  sCtx.fillStyle = gradient;
  sCtx.fillRect(0, 0, 128, 128);

  const shadowGeo = new THREE.PlaneGeometry(3.5, 3.5);
  const shadowMat = new THREE.MeshBasicMaterial({
    map: new THREE.CanvasTexture(shadowCanvas),
    transparent: true,
    opacity: 0.65,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
  shadowMesh.rotation.x = -Math.PI / 2;
  shadowMesh.position.y = -0.495; // Resting just above the platform surface
  scene.add(shadowMesh);

  // Build the Die
  buildDie();

  // Hide the loader once initialized
  loaderEl.classList.add('fade-out');

  // Set initial camera view
  resetCamera();

  // Window resize handler
  window.addEventListener('resize', onWindowResize);
}

// ==========================================
// Build/Rebuild the 3D Die Mesh
// ==========================================
function buildDie() {
  if (dieMesh) scene.remove(dieMesh);

  // Create non-indexed geometry for custom face mapping
  const geometry = new THREE.BufferGeometry();
  const vertices = [];
  const uvs = [];

  // Face 0: [v1, v2, v3]
  vertices.push(v1.x, v1.y, v1.z);
  vertices.push(v2.x, v2.y, v2.z);
  vertices.push(v3.x, v3.y, v3.z);

  // Face 1: [v0, v2, v1]
  vertices.push(v0.x, v0.y, v0.z);
  vertices.push(v2.x, v2.y, v2.z);
  vertices.push(v1.x, v1.y, v1.z);

  // Face 2: [v0, v3, v2]
  vertices.push(v0.x, v0.y, v0.z);
  vertices.push(v3.x, v3.y, v3.z);
  vertices.push(v2.x, v2.y, v2.z);

  // Face 3: [v0, v1, v3]
  vertices.push(v0.x, v0.y, v0.z);
  vertices.push(v1.x, v1.y, v1.z);
  vertices.push(v3.x, v3.y, v3.z);

  // Identical UV coordinates for all 4 faces
  for (let i = 0; i < 4; i++) {
    uvs.push(
      0.5, 1.0,  // Top corner
      0.0, 0.0,  // Bottom-Left
      1.0, 0.0   // Bottom-Right
    );
  }

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();

  // Define groups for the 4 separate face materials
  geometry.addGroup(0, 3, 0); // Face 0
  geometry.addGroup(3, 3, 1); // Face 1
  geometry.addGroup(6, 3, 2); // Face 2
  geometry.addGroup(9, 3, 3); // Face 3

  // Load textures and create materials
  const materials = [];
  for (let i = 0; i < 4; i++) {
    const faceTex = createFaceTexture(i, currentTheme);
    materials.push(
      new THREE.MeshStandardMaterial({
        map: faceTex,
        roughness: 0.15,
        metalness: 0.5,
        bumpMap: faceTex,
        bumpScale: 0.025,
      })
    );
  }

  dieMesh = new THREE.Mesh(geometry, materials);
  dieMesh.castShadow = true;
  dieMesh.receiveShadow = false;
  
  // Set starting position
  dieMesh.position.set(0, 0, 0);
  scene.add(dieMesh);
}

// ==========================================
// Roll Mechanics & Presentation Reveal Math
// ==========================================
function startRoll() {
  if (isRolling) return;

  isRolling = true;
  rollProgress = 0;
  lastBounceFraction = 0;
  revealCalculated = false;
  
  // Disable UI buttons
  rollBtn.disabled = true;
  themeButtons.forEach(btn => btn.disabled = true);
  resultOverlayEl.classList.add('hidden');

  // 1. Pick a random result: 1, 2, 3, or 4
  rolledResult = Math.floor(Math.random() * 4) + 1;

  // 2. Capture starting orientation
  preRollQuaternion.copy(dieMesh.quaternion);

  // 3. Calculate target LANDING orientation (flat on the platform)
  const landingVertex = landingVertexForResult[rolledResult];
  const alignQuat = new THREE.Quaternion();
  alignQuat.setFromUnitVectors(landingVertex.clone().normalize(), new THREE.Vector3(0, 1, 0));

  const randomYRot = new THREE.Quaternion();
  randomYRot.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI * 2);

  Q_land.multiplyQuaternions(randomYRot, alignQuat);

  // 4. Set up spin properties for first phase
  spinAxis.set(
    Math.random() - 0.5,
    Math.random() * 0.5 + 0.5,
    Math.random() - 0.5
  ).normalize();
  spinSpeed = 24 + Math.random() * 8; // Rads/sec

  // 5. Set up horizontal drift movement
  rollDrift.x = (Math.random() - 0.5) * 1.5;
  rollDrift.z = (Math.random() - 0.5) * 1.5;

  // Play initial lift sound
  soundCtrl.playBounce(0.35);
}

// Orthonormal Basis Change Math: rotates the rolled face directly to the camera viewport upright
function calculateRevealQuaternion() {
  const idx = rolledResult - 1; // Face index (0 to 3)

  // Get vector from die to camera in world space
  const dirToCamera = new THREE.Vector3().subVectors(camera.position, dieMesh.position).normalize();

  // Create target world basis vectors
  const z_w = dirToCamera.clone().normalize();
  const x_w = new THREE.Vector3();
  if (Math.abs(z_w.y) > 0.999) {
    x_w.set(1, 0, 0); // fallback if looking straight down/up
  } else {
    x_w.crossVectors(new THREE.Vector3(0, 1, 0), z_w).normalize();
  }
  const y_w = new THREE.Vector3().crossVectors(z_w, x_w).normalize();

  // Create local basis vectors of the target face
  const z_l = localNormals[idx].clone().normalize();
  const y_l = faceUps[idx].clone().normalize();
  const x_l = new THREE.Vector3().crossVectors(y_l, z_l).normalize();

  // Build basis change matrices
  const mLocal = new THREE.Matrix4().makeBasis(x_l, y_l, z_l);
  const mWorld = new THREE.Matrix4().makeBasis(x_w, y_w, z_w);

  // Target Rotation matrix: R = World * Local_Transpose
  const mLocalT = mLocal.clone().transpose();
  const mReveal = new THREE.Matrix4().multiplyMatrices(mWorld, mLocalT);

  Q_reveal.setFromRotationMatrix(mReveal);
}

// Easing functions
function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// Core Physics and Animation updates
function updateRoll(deltaTime) {
  if (!isRolling) return;

  rollProgress += deltaTime / rollDuration;
  if (rollProgress >= 1) {
    rollProgress = 1;
    isRolling = false;
  }

  // --- 1. Position Y (Gravity physics -> resting flat -> presentation hover) ---
  let height = 0;
  let bounceFraction = 0;

  if (rollProgress < 0.35) {
    // Bounce 1
    const tNorm = rollProgress / 0.35;
    height = 4 * tNorm * (1 - tNorm) * 2.8;
    bounceFraction = 0.35;
  } else if (rollProgress < 0.5) {
    // Bounce 2
    const tNorm = (rollProgress - 0.35) / 0.15;
    height = 4 * tNorm * (1 - tNorm) * 0.7;
    bounceFraction = 0.5;
  } else if (rollProgress < 0.55) {
    // Bounce 3 (final tap)
    const tNorm = (rollProgress - 0.5) / 0.05;
    height = 4 * tNorm * (1 - tNorm) * 0.15;
    bounceFraction = 0.55;
  } else if (rollProgress < 0.65) {
    // Rest flat on floor
    height = 0;
    bounceFraction = 0.65;
  } else {
    // Presentation phase: smoothly hover upwards
    const s = (rollProgress - 0.65) / 0.35;
    height = easeInOutCubic(s) * 0.75; // Hovers at 0.75 units high
    bounceFraction = 1.0;
  }

  // Trigger bounce sound at impact
  if (lastBounceFraction !== bounceFraction && rollProgress >= lastBounceFraction) {
    let volume = 1.0;
    if (lastBounceFraction === 0.35) volume = 0.85;
    else if (lastBounceFraction === 0.5) volume = 0.45;
    else if (lastBounceFraction === 0.55) volume = 0.2;
    
    if (lastBounceFraction < 0.6) {
      soundCtrl.playBounce(volume);
    }
    lastBounceFraction = bounceFraction;
  }

  dieMesh.position.y = height;

  // --- 2. Position X & Z Drift ---
  // Only drift during landing phase (p < 0.6)
  if (rollProgress < 0.65) {
    const driftDecay = Math.pow(0.06, deltaTime);
    rollDrift.x *= driftDecay;
    rollDrift.z *= driftDecay;

    dieMesh.position.x += rollDrift.x * deltaTime * 3.2;
    dieMesh.position.z += rollDrift.z * deltaTime * 3.2;

    // Platform border collisions
    const dist = Math.sqrt(dieMesh.position.x * dieMesh.position.x + dieMesh.position.z * dieMesh.position.z);
    if (dist > 3.0) {
      const force = 3.0 / dist;
      dieMesh.position.x *= force;
      dieMesh.position.z *= force;
      rollDrift.x = -rollDrift.x * 0.4;
      rollDrift.z = -rollDrift.z * 0.4;
    }
  } else {
    // Smoothly return X, Z back to origin (0,0) during hover presentation
    const s = (rollProgress - 0.65) / 0.35;
    const tEase = easeInOutCubic(s);
    dieMesh.position.x *= (1 - tEase * 0.1);
    dieMesh.position.z *= (1 - tEase * 0.1);
  }

  // --- 3. Rotation (Wild Spin -> land flat -> reveal presentation) ---
  if (rollProgress < 0.4) {
    // Spin wildly
    dieMesh.quaternion.multiplyQuaternions(
      new THREE.Quaternion().setFromAxisAngle(spinAxis, spinSpeed * deltaTime),
      dieMesh.quaternion
    );
    spinStartQuat.copy(dieMesh.quaternion);
  } else if (rollProgress < 0.55) {
    // Slerp to flat landing position Q_land
    const s = (rollProgress - 0.4) / 0.15;
    const tEase = easeOutCubic(s);
    dieMesh.quaternion.slerpQuaternions(spinStartQuat, Q_land, tEase);
  } else if (rollProgress < 0.65) {
    // Lock at Q_land flat on table
    dieMesh.quaternion.copy(Q_land);
  } else {
    // Slerp from Q_land to Q_reveal (facing camera upright)
    if (!revealCalculated) {
      calculateRevealQuaternion();
      revealCalculated = true;
    }

    const s = (rollProgress - 0.65) / 0.35;
    const tEase = easeInOutCubic(s);
    dieMesh.quaternion.slerpQuaternions(Q_land, Q_reveal, tEase);
  }

  // --- 4. Lights and Shadows ---
  // Point light follows the die and pulses intensity slightly during hover
  pointLight.position.x = dieMesh.position.x;
  pointLight.position.y = dieMesh.position.y + 1.2;
  pointLight.position.z = dieMesh.position.z;
  
  if (rollProgress >= 0.65) {
    const s = (rollProgress - 0.65) / 0.35;
    pointLight.intensity = 2.5 + Math.sin(s * Math.PI) * 1.5;
  } else {
    pointLight.intensity = 2.5;
  }

  // Fake soft shadow follows die on platform (fades out as it floats up)
  shadowMesh.position.x = dieMesh.position.x;
  shadowMesh.position.z = dieMesh.position.z;
  const shadowScale = 1.0 + (height / 2.0);
  shadowMesh.scale.set(shadowScale, shadowScale, 1);
  shadowMesh.material.opacity = Math.max(0.04, 0.65 - (height / 2.0));

  // --- 5. End of Roll ---
  if (!isRolling) {
    rollDrift.x = 0;
    rollDrift.z = 0;
    
    // Lock in final presentation orientation
    dieMesh.quaternion.copy(Q_reveal);
    
    // Enable UI controls
    rollBtn.disabled = false;
    themeButtons.forEach(btn => btn.disabled = false);

    // Show text results
    resultValueEl.textContent = rolledResult;
    resultOverlayEl.classList.remove('hidden');
  }
}

// ==========================================
// Camera View Presets
// ==========================================
function resetCamera() {
  if (controls) {
    controls.reset();
    camera.position.set(0, 3.5, 6);
    controls.target.set(0, 0.2, 0);
  }
}

function setTopView() {
  if (controls) {
    controls.reset();
    camera.position.set(0, 6.8, 0.01);
    controls.target.set(0, 0, 0);
  }
}

function setBottomView() {
  if (controls) {
    controls.reset();
    // Position below the table looking up. MaxPolarAngle = PI allows this.
    camera.position.set(0, -6.8, 0.01);
    controls.target.set(0, 0, 0);
  }
}

// ==========================================
// Theme Switcher
// ==========================================
function changeTheme(themeName) {
  if (!THEMES[themeName]) return;
  
  currentThemeName = themeName;
  currentTheme = THEMES[themeName];

  // Update HTML body theme class
  document.body.className = '';
  document.body.classList.add(`theme-${themeName}`);

  // Re-build materials / textures
  buildDie();

  // Update platform ring color
  if (ringMesh) {
    ringMesh.material.color.setHex(currentTheme.primaryHex);
  }

  // Update point light color
  if (pointLight) {
    pointLight.color.setHex(currentTheme.primaryHex);
  }

  // Update active state in theme buttons
  themeButtons.forEach(btn => {
    if (btn.dataset.theme === themeName) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

// ==========================================
// Resize Handler
// ==========================================
function onWindowResize() {
  if (!camera || !renderer) return;

  const width = containerEl.clientWidth;
  const height = containerEl.clientHeight;

  camera.aspect = width / height;
  camera.updateProjectionMatrix();

  renderer.setSize(width, height);
}

// ==========================================
// Event Listeners Setup
// ==========================================
function setupEvents() {
  rollBtn.addEventListener('click', () => {
    soundCtrl.init(); // Initialize audio context on user action
    startRoll();
  });

  resetBtn.addEventListener('click', resetCamera);
  topBtn.addEventListener('click', setTopView);
  bottomBtn.addEventListener('click', setBottomView);

  soundToggleBtn.addEventListener('click', () => {
    soundCtrl.init();
    soundCtrl.muted = !soundCtrl.muted;
    if (soundCtrl.muted) {
      document.getElementById('volume-icon-on').classList.add('hidden');
      document.getElementById('volume-icon-off').classList.remove('hidden');
    } else {
      document.getElementById('volume-icon-on').classList.remove('hidden');
      document.getElementById('volume-icon-off').classList.add('hidden');
    }
  });

  themeButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      const theme = e.target.dataset.theme;
      changeTheme(theme);
    });
  });
}

// ==========================================
// Main Animation Loop
// ==========================================
let clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);

  const deltaTime = Math.min(clock.getDelta(), 0.1);

  // Update roll physics/animation
  updateRoll(deltaTime);

  // Update controls
  if (controls) {
    // Disable orbit controls while rolling to prevent weird camera jumping.
    // Allow controls during presentation phase so user can inspect.
    const allowControls = !isRolling || (rollProgress >= 0.65);
    controls.enabled = allowControls;
    controls.update();
  }

  // Render scene
  if (renderer && scene && camera) {
    renderer.render(scene, camera);
  }
}

// ==========================================
// Initialization entry point
// ==========================================
window.addEventListener('DOMContentLoaded', () => {
  initEngine();
  setupEvents();
  animate();
});
