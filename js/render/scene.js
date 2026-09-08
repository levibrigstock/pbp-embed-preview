/**
 * Presentation-grade Three.js viewer for We Build Structures / PoleBarn Pro.
 * Soft shadows, sky, grass, metal roof, sales-ready screenshots.
 */

import * as THREE from '../../vendor/three.module.js';
// Relative vendor path so Safari embed does not depend on import maps for the viewer graph.
import { OrbitControls } from '../../vendor/OrbitControls.js';
import { generateFraming } from '../domain/framing.js?v=20260806f';
import {
 roofRise,
 wallLength,
 formatOpeningSize,
 leanToAttachHeight,
 leanToOverhangFt,
 isWallOpen,
 openWallList,
 isLeanFaceOpen,
} from '../domain/types.js?v=20260806f';
import { buildSitePropMesh } from './props.js';

const FT = 1;

/** Prefer r152+ colorSpace; fall back to deprecated encoding for older Three. */
function setRendererOutputSRGB(renderer) {
 if (!renderer) return;
 if ('outputColorSpace' in renderer && THREE.SRGBColorSpace != null) {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
 } else if ('outputEncoding' in renderer && THREE.sRGBEncoding != null) {
  renderer.outputEncoding = THREE.sRGBEncoding;
 }
}

/** @param {THREE.Texture} tex @param {boolean} [srgb=true] color map vs data/normal/roughness */
function setTextureColorSpace(tex, srgb = true) {
 if (!tex) return;
 if ('colorSpace' in tex && THREE.SRGBColorSpace != null) {
  tex.colorSpace = srgb
   ? THREE.SRGBColorSpace
   : (THREE.NoColorSpace != null ? THREE.NoColorSpace : '');
 } else if (srgb && 'encoding' in tex && THREE.sRGBEncoding != null) {
  tex.encoding = THREE.sRGBEncoding;
 }
}


/** Compact label for opening size badges */
function formatOpeningLabel(w, h) {
 try {
 return formatOpeningSize(w, h).replace(/\s+/g, '');
 } catch {
 return `${w}'×${h}'`;
 }
}

const COLOR_HEX = {
 BK: 0x121212,
 AL: 0xf7ecd8,
 GAL: 0xc8d0d8,
 WH: 0xffffff,
 BR: 0x6b3f24,
 TN: 0xd4b896,
 GR: 0x1f6b38,
 RD: 0xb01e1e,
 BU: 0x7a1838,
 SL: 0x4a5160,
 LB: 0x4f8fc4,
 CG: 0xb08455,
};

export class SceneView {
 constructor(canvas, handlers = {}) {
 this.canvas = canvas;
 this.handlers = handlers;
 /** Public embed / phone-safe WebGL path (less GPU, no shadows/env map). */
 this.lite = !!(handlers.lite || handlers.embed);
 this.mode = 'orbit';
 this.placeOpeningDraft = null;
 /** @type {{ type: string } | null} */
 this.placePropDraft = null;
 this.project = null;
 this.showFraming = false;
 this.showMetal = true;
 this.presentationMode = false;
 this.autoOrbit = false;
 this.selectedOpeningId = null;
 this.selectedPropId = null;
 this._clock = new THREE.Clock();
 this._drag = null;
 this._envMap = null;
 this._groundPick = null;
 this.propPickables = [];

 this.webglOk = false;
 this.renderer = null;
 this.scene = new THREE.Scene();
 this.scene.background = new THREE.Color(this.lite ? 0xa8c8e0 : 0x7eb4d8);
 this.scene.fog = new THREE.FogExp2(this.lite ? 0xd8e4ec : 0xc5dce8, this.lite ? 0.0007 : 0.00135);
 this.camera = new THREE.PerspectiveCamera(38, 1, 0.4, 900);
 this.camera.position.set(72, 28, 78);
 this.controls = null;
 this.raycaster = new THREE.Raycaster();
 this.pointer = new THREE.Vector2();
 this.root = new THREE.Group();
 this.scene.add(this.root);
 this.envGroup = new THREE.Group();
 this.scene.add(this.envGroup);
 this.pickables = [];
 this.openingMeshes = [];
 this._labelSprites = [];

 // Create WebGL renderer — do not throw; app UI still works without it
 try {
 const primary = this.lite ? 'lite' : 'full';
 try {
 this._createRenderer(canvas, primary);
 } catch (err) {
 if (!this.lite) throw err;
 console.warn('Lite WebGL init failed, retrying safer settings', err);
 this._disposeRendererQuiet();
 this._createRenderer(canvas, 'safer');
 }
 this._attachControls(canvas);
 if (this.lite) {
 this._buildSimpleGround();
 } else {
 try {
 this._buildEnvironment();
 } catch (err) {
 console.warn('Environment build failed, using plain ground', err);
 this._buildSimpleGround();
 }
 }
 this._lights();
 if (!this.lite) {
 try {
 this._setupEnvMap();
 } catch (err) {
 console.warn('Env map skipped', err);
 }
 }
 this._onResize = () => this.resize();
 window.addEventListener('resize', this._onResize);
 canvas.addEventListener('pointerdown', (e) => this._onPointerDown(e));
 canvas.addEventListener('pointermove', (e) => this._onPointerMove(e));
 canvas.addEventListener('pointerup', (e) => this._onPointerUp(e));
 canvas.addEventListener('pointerleave', (e) => this._onPointerUp(e));
 this.resize();
 this._running = true;
 this._loop();
 } catch (err) {
 console.error('WebGL unavailable — running without 3D view', err);
 this.webglOk = false;
 this._running = false;
 this._paintWebglFallback(canvas, err);
 }
 }

 /** Drop a failed / partial renderer before a safer retry. */
 _disposeRendererQuiet() {
 try {
 if (this.renderer) {
 this.renderer.dispose?.();
 }
 } catch (_) {}
 this.renderer = null;
 this.webglOk = false;
 }

 /**
 * @param {HTMLCanvasElement} canvas
 * @param {'full'|'lite'|'safer'} profile
 */
 _createRenderer(canvas, profile) {
 const liteLike = profile === 'lite' || profile === 'safer';
 const opts =
 profile === 'full'
 ? {
 canvas,
 antialias: true,
 alpha: false,
 preserveDrawingBuffer: true,
 powerPreference: 'high-performance',
 }
 : profile === 'lite'
 ? {
 // Sharp on modern phones (iPhone etc.); still no shadows/env map.
 // preserveDrawingBuffer so embed quote elevations can toDataURL reliably.
 canvas,
 antialias: true,
 alpha: false,
 preserveDrawingBuffer: true,
 powerPreference: 'default',
 }
 : {
 // Even safer retry if sharp lite OOMs/crashes
 // preserveDrawingBuffer: same — elevation capture after render.
 canvas,
 antialias: false,
 alpha: false,
 preserveDrawingBuffer: true,
 powerPreference: 'low-power',
 failIfMajorPerformanceCaveat: false,
 };
 this.renderer = new THREE.WebGLRenderer(opts);
 const gl = this.renderer.getContext?.();
 if (!gl) throw new Error('No WebGL context');
 this.webglOk = true;
 const dpr = window.devicePixelRatio || 1;
 // lite used to cap at 1.25 → blurry on 2–3× phones; match full sharpness, safer stays 1
 const prCap = profile === 'full' ? 2 : profile === 'lite' ? 2 : 1;
 this.renderer.setPixelRatio(Math.min(dpr, prCap));
 this.renderer.shadowMap.enabled = !liteLike;
 if (!liteLike) {
 this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
 }
 // Lite/embed: no ACES — Filmic crush was turning Bright White gray/beige on phones.
 if (liteLike) {
 this.renderer.toneMapping = THREE.NoToneMapping;
 this.renderer.toneMappingExposure = 1;
 } else {
 this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
 this.renderer.toneMappingExposure = 1.18;
 }
 setRendererOutputSRGB(this.renderer);
 }

 _attachControls(canvas) {
 this.controls = new OrbitControls(this.camera, canvas);
 this.controls.enableDamping = true;
 this.controls.dampingFactor = 0.055;
 // Allow orbit under the building (past horizon) and free pan
 this.controls.minPolarAngle = 0.02;
 this.controls.maxPolarAngle = Math.PI - 0.02; // was ~0.485π — blocked under-side views
 this.controls.enablePan = true;
 this.controls.screenSpacePanning = true; // pan follows camera plane (incl. vertical)
 this.controls.minDistance = 8;
 this.controls.maxDistance = 400;
 this.controls.target.set(20, 8, 30);
 this.controls.autoRotate = false;
 this.controls.autoRotateSpeed = 0.55;
 // Right-drag / two-finger = pan; middle-drag also pans
 this.controls.mouseButtons = {
 LEFT: THREE.MOUSE.ROTATE,
 MIDDLE: THREE.MOUSE.PAN,
 RIGHT: THREE.MOUSE.PAN,
 };
 }

 _paintWebglFallback(canvas, err) {
 try {
 const parent = canvas?.parentElement;
 if (!parent) return;
 let note = parent.querySelector('.webgl-fallback');
 if (!note) {
 note = document.createElement('div');
 note.className = 'webgl-fallback';
 note.style.cssText =
 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;background:#1a1520;color:#f0d0b0;font:14px system-ui;z-index:5;';
 parent.appendChild(note);
 }
 if (this.lite) {
 note.innerHTML =
 '<div><b>3D view could not start on this device</b><br/><br/>' +
 'Building sizes and the quote form still work — you can finish your request without the 3D preview.<br/>' +
 'Try another browser, or open this page on a desktop if you need the viewer.<br/><br/>' +
 '<span style="opacity:.7;font-size:12px">' +
 String(err?.message || err || '') +
 '</span></div>';
 } else {
 note.innerHTML =
 '<div><b>3D view could not start (WebGL)</b><br/><br/>' +
 'The rest of the app still works (sizes, item list, save/load).<br/>' +
 'Enable hardware acceleration in your browser, or try Chrome/Safari.<br/><br/>' +
 '<span style="opacity:.7;font-size:12px">' +
 String(err?.message || err || '') +
 '</span></div>';
 }
 if (canvas) canvas.style.display = 'none';
 } catch (_) {}
 }

 _buildSimpleGround() {
 const siteGreen = 0x3a6a30;
 const pad = new THREE.Mesh(
 new THREE.CircleGeometry(50, 48),
 new THREE.MeshStandardMaterial({ color: siteGreen, roughness: 0.95 }),
 );
 pad.rotation.x = -Math.PI / 2;
 pad.position.y = -0.035;
 pad.receiveShadow = true;
 this.envGroup.add(pad);
 const ground = new THREE.Mesh(
 new THREE.RingGeometry(50, 180, 64),
 new THREE.MeshStandardMaterial({
 color: siteGreen,
 roughness: 0.95,
 side: THREE.FrontSide,
 }),
 );
 ground.rotation.x = -Math.PI / 2;
 ground.position.y = -0.04;
 ground.receiveShadow = true;
 this.envGroup.add(ground);
 }

 /* ───────────── Environment ───────────── */

 /** Procedural grass albedo for ground (soft, not noisy) — kept light for fast boot */
 _grassTexture() {
 if (this._grassTex) return this._grassTex;
 const S = 128;
 const c = document.createElement('canvas');
 c.width = c.height = S;
 const ctx = c.getContext('2d');
 ctx.fillStyle = '#4a7a3a';
 ctx.fillRect(0, 0, S, S);
 for (let k = 0; k < 80; k++) {
 ctx.fillStyle = `rgba(${40 + Math.random() * 40},${80 + Math.random() * 50},${30 + Math.random() * 25},${0.15 + Math.random() * 0.2})`;
 ctx.beginPath();
 ctx.ellipse(
 Math.random() * S,
 Math.random() * S,
 4 + Math.random() * 18,
 3 + Math.random() * 12,
 Math.random() * Math.PI,
 0,
 Math.PI * 2,
 );
 ctx.fill();
 }
 const tex = new THREE.CanvasTexture(c);
 tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
 tex.repeat.set(36, 36);
 tex.anisotropy = 4;
 setTextureColorSpace(tex, true);
 this._grassTex = tex;
 return tex;
 }

 _gravelTexture() {
 if (this._gravelTex) return this._gravelTex;
 const S = 256;
 const c = document.createElement('canvas');
 c.width = c.height = S;
 const ctx = c.getContext('2d');
 ctx.fillStyle = '#7a7e72';
 ctx.fillRect(0, 0, S, S);
 for (let i = 0; i < 2800; i++) {
 const v = 90 + Math.random() * 70;
 ctx.fillStyle = `rgb(${v},${v * 0.95},${v * 0.85})`;
 ctx.fillRect(Math.random() * S, Math.random() * S, 1 + Math.random() * 2, 1 + Math.random() * 2);
 }
 const tex = new THREE.CanvasTexture(c);
 tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
 tex.repeat.set(6, 6);
 tex.anisotropy = 4;
 setTextureColorSpace(tex, true);
 this._gravelTex = tex;
 return tex;
 }

 _buildEnvironment() {
 // Sky dome — richer blue → warm horizon
 const skyGeo = new THREE.SphereGeometry(420, 48, 24);
 const skyMat = new THREE.ShaderMaterial({
 side: THREE.BackSide,
 depthWrite: false,
 uniforms: {
 topColor: { value: new THREE.Color(0x2f6fb0) },
 midColor: { value: new THREE.Color(0x8ec4e8) },
 bottomColor: { value: new THREE.Color(0xeef4e4) },
 sunDir: { value: new THREE.Vector3(0.45, 0.75, 0.35).normalize() },
 offset: { value: 0 },
 exponent: { value: 0.62 },
 },
 vertexShader: `
 varying vec3 vWorldPosition;
 void main() {
 vec4 worldPosition = modelMatrix * vec4(position, 1.0);
 vWorldPosition = worldPosition.xyz;
 gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
 }
 `,
 fragmentShader: `
 uniform vec3 topColor;
 uniform vec3 midColor;
 uniform vec3 bottomColor;
 uniform vec3 sunDir;
 uniform float offset;
 uniform float exponent;
 varying vec3 vWorldPosition;
 void main() {
 vec3 dir = normalize(vWorldPosition + offset);
 float h = dir.y;
 float t = max(pow(max(h, 0.0), exponent), 0.0);
 vec3 col = mix(bottomColor, midColor, smoothstep(-0.12, 0.28, h));
 col = mix(col, topColor, t);
 // Soft sun disc glow
 float sun = pow(max(dot(dir, sunDir), 0.0), 48.0);
 col += vec3(1.0, 0.92, 0.75) * sun * 0.55;
 float haze = pow(max(dot(dir, sunDir), 0.0), 4.0) * 0.12;
 col += vec3(1.0, 0.85, 0.6) * haze;
 gl_FragColor = vec4(col, 1.0);
 }
 `,
 });
 this._skyMat = skyMat;
 this.envGroup.add(new THREE.Mesh(skyGeo, skyMat));

 // Soft cloud puffs (billboard-ish spheres, low opacity)
 const cloudMat = new THREE.MeshStandardMaterial({
 color: 0xffffff,
 roughness: 1,
 metalness: 0,
 transparent: true,
 opacity: 0.22,
 depthWrite: false,
 });
 for (let i = 0; i < 10; i++) {
 const cloud = new THREE.Group();
 const ang = (i / 10) * Math.PI * 2 + 0.3;
 const dist = 90 + (i % 3) * 25;
 cloud.position.set(Math.cos(ang) * dist, 28 + (i % 4) * 4, Math.sin(ang) * dist);
 for (let j = 0; j < 4; j++) {
 const puff = new THREE.Mesh(
 new THREE.SphereGeometry(6 + (j % 3) * 2.5, 12, 10),
 cloudMat,
 );
 puff.position.set(j * 5 - 6, (j % 2) * 1.5, (j - 1.5) * 2);
 puff.scale.set(1.4, 0.55, 1);
 cloud.add(puff);
 }
 this.envGroup.add(cloud);
 }

 // Site pad + outer field — same green (no white center disc)
 const siteGreen = 0x3a6a30;
 const grassMap = this._grassTexture();

 // Inner circle under building / trees — solid match to outer ring green
 const sitePad = new THREE.Mesh(
 new THREE.CircleGeometry(48, 64),
 new THREE.MeshStandardMaterial({
 color: siteGreen,
 roughness: 0.96,
 metalness: 0,
 side: THREE.FrontSide,
 }),
 );
 sitePad.rotation.x = -Math.PI / 2;
 sitePad.position.y = -0.035;
 sitePad.receiveShadow = true;
 this.envGroup.add(sitePad);

 // Outer field ring — same green
 const ground = new THREE.Mesh(
 new THREE.RingGeometry(48, 200, 96),
 new THREE.MeshStandardMaterial({
 color: siteGreen,
 map: grassMap,
 roughness: 0.94,
 metalness: 0,
 side: THREE.FrontSide,
 }),
 );
 if (ground.material.map) {
 ground.material.map.wrapS = ground.material.map.wrapT = THREE.RepeatWrapping;
 ground.material.map.repeat.set(14, 14);
 ground.material.map.needsUpdate = true;
 }
 ground.rotation.x = -Math.PI / 2;
 ground.position.y = -0.04;
 ground.receiveShadow = true;
 this.envGroup.add(ground);

 // Mown band just outside site pad — same green
 const ring = new THREE.Mesh(
 new THREE.RingGeometry(48, 95, 80),
 new THREE.MeshStandardMaterial({
 color: siteGreen,
 roughness: 0.98,
 side: THREE.FrontSide,
 }),
 );
 ring.rotation.x = -Math.PI / 2;
 ring.position.y = -0.03;
 ring.receiveShadow = true;
 this.envGroup.add(ring);

 // Distant horizon hills
 for (let i = 0; i < 6; i++) {
 const hill = new THREE.Mesh(
 new THREE.SphereGeometry(42 + i * 7, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2),
 new THREE.MeshStandardMaterial({
 color: new THREE.Color().setHSL(0.32, 0.28, 0.28 + i * 0.02),
 roughness: 1,
 transparent: true,
 opacity: 0.4,
 }),
 );
 const ang = (i / 6) * Math.PI * 2 + 0.4;
 hill.position.set(Math.cos(ang) * 175, -10, Math.sin(ang) * 175);
 hill.scale.set(1.5, 0.32 + i * 0.04, 1.25);
 this.envGroup.add(hill);
 }

 // Trees placed later in rebuild() relative to building footprints
 this._treeGroup = new THREE.Group();
 this._treeGroup.name = 'landscapeTrees';
 this.envGroup.add(this._treeGroup);
 }

 /**
   * Place landscape trees at least clearFt outside every building (and lean-to) footprint.
   */
 _layoutLandscapeTrees(clearFt = 15) {
 if (!this._treeGroup) {
 this._treeGroup = new THREE.Group();
 this._treeGroup.name = 'landscapeTrees';
 this.envGroup.add(this._treeGroup);
 }
 while (this._treeGroup.children.length) {
 const c = this._treeGroup.children.pop();
 c.traverse((obj) => {
 if (obj.geometry) obj.geometry.dispose();
 if (obj.material) {
 if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
 else obj.material.dispose();
 }
 });
 }

 const boxes = this._buildingClearanceBoxes(clearFt);
 // Candidate ring positions around overall site
 let minX = 0;
 let maxX = 40;
 let minZ = 0;
 let maxZ = 40;
 for (const b of this.project?.buildings || []) {
 const sx = b.siteX || 0;
 const sz = b.siteZ || 0;
 minX = Math.min(minX, sx);
 maxX = Math.max(maxX, sx + (b.width || 30));
 minZ = Math.min(minZ, sz);
 maxZ = Math.max(maxZ, sz + (b.length || 40));
 }
 const cx = (minX + maxX) / 2;
 const cz = (minZ + maxZ) / 2;
 const halfW = (maxX - minX) / 2;
 const halfL = (maxZ - minZ) / 2;
 // Place trees on a ring outside the clearance envelope
 const ringR = Math.max(halfW, halfL) + clearFt + 12;
 const candidates = [];
 const n = 12;
 for (let i = 0; i < n; i++) {
 const ang = (i / n) * Math.PI * 2 + 0.35;
 candidates.push([cx + Math.cos(ang) * ringR, cz + Math.sin(ang) * ringR]);
 // second ring farther out, staggered
 const r2 = ringR + 14 + (i % 3) * 4;
 candidates.push([
 cx + Math.cos(ang + 0.2) * r2,
 cz + Math.sin(ang + 0.2) * r2,
 ]);
 }
 // Corner clusters
 for (const [ox, oz] of [
 [-1, -1],
 [1, -1],
 [-1, 1],
 [1, 1],
 ]) {
 candidates.push([
 cx + ox * (halfW + clearFt + 10),
 cz + oz * (halfL + clearFt + 10),
 ]);
 candidates.push([
 cx + ox * (halfW + clearFt + 18),
 cz + oz * (halfL + clearFt + 6),
 ]);
 }

 const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3428, roughness: 0.95 });
 const leafMats = [
 new THREE.MeshStandardMaterial({ color: 0x2d5a32, roughness: 0.9 }),
 new THREE.MeshStandardMaterial({ color: 0x3a6e38, roughness: 0.88 }),
 new THREE.MeshStandardMaterial({ color: 0x245028, roughness: 0.92 }),
 ];

 let placed = 0;
 for (let i = 0; i < candidates.length && placed < 14; i++) {
 const [x, z] = candidates[i];
 if (!this._pointClearOfBuildings(x, z, boxes)) continue;

 const tree = new THREE.Group();
 const h = 7 + (placed % 4) * 1.4;
 const trunk = new THREE.Mesh(
 new THREE.CylinderGeometry(0.22, 0.32, h * 0.35, 8),
 trunkMat,
 );
 trunk.position.y = h * 0.18;
 trunk.castShadow = true;
 tree.add(trunk);
 const leafMat = leafMats[placed % leafMats.length];
 for (let t = 0; t < 3; t++) {
 const cone = new THREE.Mesh(
 new THREE.ConeGeometry(2.2 - t * 0.35, h * 0.38, 10),
 leafMat,
 );
 cone.position.y = h * 0.35 + t * h * 0.18;
 cone.castShadow = true;
 cone.receiveShadow = true;
 tree.add(cone);
 }
 tree.position.set(x, 0, z);
 tree.scale.setScalar(0.85 + (placed % 3) * 0.12);
 this._treeGroup.add(tree);
 placed++;
 }
 }

 /** Axis-aligned expanded footprints for main + lean-tos (world XZ, feet). */
 _buildingClearanceBoxes(clearFt = 15) {
 const boxes = [];
 for (const b of this.project?.buildings || []) {
 const sx = b.siteX || 0;
 const sz = b.siteZ || 0;
 const W = b.width || 30;
 const L = b.length || 40;
 boxes.push({
 minX: sx - clearFt,
 maxX: sx + W + clearFt,
 minZ: sz - clearFt,
 maxZ: sz + L + clearFt,
 });
 for (const lt of b.leanTos || []) {
 const depth = lt.depth || 12;
 const wall = lt.wall || 'left';
 const off = lt.offset || 0;
 const len =
 lt.length > 0
 ? lt.length
 : (wall === 'front' || wall === 'back' ? W : L) - off;
 if (wall === 'left') {
 boxes.push({
 minX: sx - depth - clearFt,
 maxX: sx + clearFt,
 minZ: sz + off - clearFt,
 maxZ: sz + off + len + clearFt,
 });
 } else if (wall === 'right') {
 boxes.push({
 minX: sx + W - clearFt,
 maxX: sx + W + depth + clearFt,
 minZ: sz + off - clearFt,
 maxZ: sz + off + len + clearFt,
 });
 } else if (wall === 'front') {
 boxes.push({
 minX: sx + off - clearFt,
 maxX: sx + off + len + clearFt,
 minZ: sz - depth - clearFt,
 maxZ: sz + clearFt,
 });
 } else {
 boxes.push({
 minX: sx + off - clearFt,
 maxX: sx + off + len + clearFt,
 minZ: sz + L - clearFt,
 maxZ: sz + L + depth + clearFt,
 });
 }
 }
 }
 return boxes;
 }

 _pointClearOfBuildings(x, z, boxes) {
 for (const box of boxes) {
 if (x >= box.minX && x <= box.maxX && z >= box.minZ && z <= box.maxZ) {
 return false;
 }
 }
 return true;
 }

 /** Image-based lighting so metal panels catch sky reflections */
 _setupEnvMap() {
 if (this.lite) return;
 try {
 const pmrem = new THREE.PMREMGenerator(this.renderer);
 pmrem.compileEquirectangularShader();
 const envScene = new THREE.Scene();
 const envSky = new THREE.Mesh(
 new THREE.SphereGeometry(50, 32, 16),
 new THREE.ShaderMaterial({
 side: THREE.BackSide,
 uniforms: {
 top: { value: new THREE.Color(0x4a8ec8) },
 bot: { value: new THREE.Color(0xd8e8c8) },
 },
 vertexShader: `
 varying vec3 vP;
 void main() {
 vP = position;
 gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
 }
 `,
 fragmentShader: `
 uniform vec3 top;
 uniform vec3 bot;
 varying vec3 vP;
 void main() {
 float h = normalize(vP).y * 0.5 + 0.5;
 gl_FragColor = vec4(mix(bot, top, h), 1.0);
 }
 `,
 }),
 );
 envScene.add(envSky);
 const sun = new THREE.Mesh(
 new THREE.SphereGeometry(4, 16, 12),
 new THREE.MeshBasicMaterial({ color: 0xfff2d0 }),
 );
 sun.position.set(30, 40, 10);
 envScene.add(sun);
 const rt = pmrem.fromScene(envScene, 0.04);
 this._envMap = rt.texture;
 this.scene.environment = this._envMap;
 try {
 this.scene.environmentIntensity = 0.85;
 } catch (_) {
 /* older three builds */
 }
 pmrem.dispose();
 } catch (err) {
 console.warn('env map skipped', err);
 }
 }

 _lights() {
 // Lite/embed: neutral lights so white panels don't pick up sky blue.
 const amb = new THREE.AmbientLight(this.lite ? 0xf0f0f0 : 0xd0e0f0, this.lite ? 0.55 : 0.22);
 this.scene.add(amb);

 const hemi = new THREE.HemisphereLight(
 this.lite ? 0xffffff : 0xe8f2ff,
 this.lite ? 0xb0b0b0 : 0x5a7048,
 this.lite ? 0.45 : 0.62,
 );
 this.scene.add(hemi);

 // Key sun
 this.sun = new THREE.DirectionalLight(this.lite ? 0xffffff : 0xfff2dc, this.lite ? 1.15 : 1.55);
 this.sun.position.set(55, 95, 38);
 if (!this.lite) {
 this.sun.castShadow = true;
 this.sun.shadow.mapSize.set(3072, 3072);
 this.sun.shadow.camera.near = 1;
 this.sun.shadow.camera.far = 300;
 this.sun.shadow.camera.left = -100;
 this.sun.shadow.camera.right = 100;
 this.sun.shadow.camera.top = 100;
 this.sun.shadow.camera.bottom = -100;
 this.sun.shadow.bias = -0.0002;
 this.sun.shadow.normalBias = 0.035;
 this.sun.shadow.radius = 2.5;
 } else {
 this.sun.castShadow = false;
 }
 this.scene.add(this.sun);
 this.scene.add(this.sun.target);

 // Cool fill
 const fill = new THREE.DirectionalLight(this.lite ? 0xe8e8e8 : 0xb0ccf0, this.lite ? 0.25 : 0.42);
 fill.position.set(-45, 35, -55);
 this.scene.add(fill);

 // Warm rim / bounce
 const rim = new THREE.DirectionalLight(this.lite ? 0xf0f0f0 : 0xffd8b0, this.lite ? 0.2 : 0.38);
 rim.position.set(-18, 28, 65);
 this.scene.add(rim);

 // Soft ground bounce
 const bounce = new THREE.DirectionalLight(this.lite ? 0xe0e0e0 : 0xc8d8a0, this.lite ? 0.12 : 0.18);
 bounce.position.set(10, -20, 10);
 this.scene.add(bounce);
 }

 _colorFor(code, fallback = 0xcccccc) {
 if (code == null || code === '') return fallback;
 // Already a numeric hex
 if (typeof code === 'number' && Number.isFinite(code)) return code >>> 0;
 const key = String(code).trim().toUpperCase();
 if (Object.prototype.hasOwnProperty.call(COLOR_HEX, key)) return COLOR_HEX[key];
 // Accept 0xRRGGBB / #RRGGBB strings
 if (/^#?[0-9A-F]{6}$/i.test(key.replace(/^0X/, ''))) {
 const hex = key.replace(/^#/, '').replace(/^0X/, '');
 return parseInt(hex, 16) >>> 0;
 }
 return fallback;
 }

 /**
   * Procedural 29ga ag-panel maps (major ribs + minor corrugation + panel seams).
   * Cached per base color. U = across ribs, V = along panel length.
   * UV scale: 1 world unit (ft) → set repeat accordingly.
   */
 _agPanelMaps(hex) {
 this._agMapCache = this._agMapCache || new Map();
 const key = hex >>> 0;
 if (this._agMapCache.has(key)) return this._agMapCache.get(key);

 const W = 512;
 const H = 512;
 const cMap = document.createElement('canvas');
 cMap.width = W;
 cMap.height = H;
 const nMap = document.createElement('canvas');
 nMap.width = W;
 nMap.height = H;
 const rMap = document.createElement('canvas');
 rMap.width = W;
 rMap.height = H;
 const ctx = cMap.getContext('2d');
 const nctx = nMap.getContext('2d');
 const rctx = rMap.getContext('2d');

 const base = new THREE.Color(hex);
 const img = ctx.createImageData(W, H);
 const nimg = nctx.createImageData(W, H);
 const rimg = rctx.createImageData(W, H);

 // Ag panel profile across U (one panel module = full canvas width = 3 ft coverage)
 // Major high ribs + minor intermediate ribs (typical exposed-fastener ag panel)
 for (let y = 0; y < H; y++) {
 for (let x = 0; x < W; x++) {
 const u = x / W; // 0..1 across one panel
 const v = y / H;

 // Major ribs near edges + center (like R-panel / high-rib ag)
 // Profile height 0..1
 let profile = 0;
 // Trapezoid major ribs at ~0, 0.5, 1.0 of panel
 const majors = [0.0, 0.5, 1.0];
 for (const m of majors) {
 const d = Math.min(Math.abs(u - m), Math.abs(u - m + 1), Math.abs(u - m - 1));
 // major rib ~1.25" wide on 36" panel ≈ 0.035 of width, tall
 profile = Math.max(profile, Math.exp(-Math.pow(d / 0.028, 2)) * 1.0);
 }
 // Minor ribs between majors
 const minors = [0.17, 0.33, 0.67, 0.83];
 for (const m of minors) {
 const d = Math.abs(u - m);
 profile = Math.max(profile, Math.exp(-Math.pow(d / 0.018, 2)) * 0.35);
 }
 // Subtle oil-canning / flat waviness
 profile += 0.04 * Math.sin(u * Math.PI * 14) * Math.sin(v * Math.PI * 3);

 // Panel end lap / side lap seam darkening
 const seam = u < 0.012 || u > 0.988 ? 0.18 : 0;

 // Screw lines along length every ~2 ft (v direction): tiny dark dots rows
 const screwRow = Math.abs(((v * 8) % 1) - 0.5);
 const screwCol = Math.min(
 ...[0.08, 0.5, 0.92].map((m) => Math.abs(u - m)),
 );
 const screw = screwRow < 0.03 && screwCol < 0.025 ? 0.25 : 0;

 // Grayscale shade only — panel hue is material.color (keeps Bright White white).
 // Light panels: almost no flatten; seams/screws stay subtle.
 const lum = 0.2126 * base.r + 0.7152 * base.g + 0.0722 * base.b;
 const shadeFloor = lum > 0.75 ? 1 : lum > 0.45 ? 0.9 : 0.76;
 const shadeAmp = Math.max(0.08, 1 - shadeFloor) * 0.9;
 const seamW = lum > 0.75 ? 0.06 : 0.18;
 const screwW = lum > 0.75 ? 0.12 : 0.35;
 const shade = Math.max(0.55, shadeFloor + profile * shadeAmp - seam * seamW - screw * screwW);
 const i = (y * W + x) * 4;
 const g = Math.min(255, Math.max(0, Math.round(255 * shade)));
 img.data[i] = g;
 img.data[i + 1] = g;
 img.data[i + 2] = g;
 img.data[i + 3] = 255;

 // Normal map: derivative of profile in U (ribs run along V)
 // Sample neighbor for slope
 const u2 = (x + 1) / W;
 let p2 = 0;
 for (const m of majors) {
 const d = Math.min(Math.abs(u2 - m), Math.abs(u2 - m + 1), Math.abs(u2 - m - 1));
 p2 = Math.max(p2, Math.exp(-Math.pow(d / 0.028, 2)));
 }
 for (const m of minors) {
 const d = Math.abs(u2 - m);
 p2 = Math.max(p2, Math.exp(-Math.pow(d / 0.018, 2)) * 0.35);
 }
 const du = (p2 - profile) * 3.2; // strength
 // normal in tangent space
 let nx = -du;
 let ny = 0.0;
 let nz = 1.0;
 const len = Math.hypot(nx, ny, nz) || 1;
 nx /= len;
 ny /= len;
 nz /= len;
 nimg.data[i] = (nx * 0.5 + 0.5) * 255;
 nimg.data[i + 1] = (ny * 0.5 + 0.5) * 255;
 nimg.data[i + 2] = (nz * 0.5 + 0.5) * 255;
 nimg.data[i + 3] = 255;

 // Roughness: shinier on rib peaks, duller in flats
 const rough = 0.22 + (1 - profile) * 0.28 + seam * 0.15;
 const rv = Math.min(255, Math.max(0, rough * 255));
 rimg.data[i] = rv;
 rimg.data[i + 1] = rv;
 rimg.data[i + 2] = rv;
 rimg.data[i + 3] = 255;
 }
 }
 ctx.putImageData(img, 0, 0);
 nctx.putImageData(nimg, 0, 0);
 rctx.putImageData(rimg, 0, 0);

 const map = new THREE.CanvasTexture(cMap);
 const normalMap = new THREE.CanvasTexture(nMap);
 const roughnessMap = new THREE.CanvasTexture(rMap);
 for (const t of [map, normalMap, roughnessMap]) {
 t.wrapS = t.wrapT = THREE.RepeatWrapping;
 try {
 t.anisotropy = Math.min(8, this.renderer?.capabilities?.getMaxAnisotropy?.() || 4);
 } catch (_) {
 t.anisotropy = 4;
 }
 setTextureColorSpace(t, t === map);
 t.needsUpdate = true;
 }

 const pack = { map, normalMap, roughnessMap };
 this._agMapCache.set(key, pack);
 return pack;
 }

 /**
   * Shared wall-skin look (main + lean use identical params).
   */
 _wallPanelOpts(extra = {}) {
 return {
 metalness: 0.78,
 roughness: 0.32,
 normalStrength: 1.35,
 clearcoat: 0.35,
 clearcoatRoughness: 0.28,
 ...extra,
 };
 }

 /**
   * Ag-panel metal material. ftAcross/ftAlong set UV so ribs are ~3' panel modules.
   * Geometry UVs are 0..1 over the panel face. Optional worldU0/worldV0 (ft) shift
   * the texture phase so seams continue across stacked panels / eave → gable.
   */
 _agPanelMat(hex, ftAcross, ftAlong, opts = {}) {
 try {
 const maps = this._agPanelMaps(hex);
 const map = maps.map.clone();
 const normalMap = maps.normalMap.clone();
 const roughnessMap = maps.roughnessMap.clone();
 const panelW = 3;
 const across = Math.max(Number(ftAcross) || 10, 0.25);
 const along = Math.max(Number(ftAlong) || 10, 0.25);
 const repX = across / panelW;
 const repY = along / 8;
 // Phase so world foot u/v maps continuously: tex = (uv + offset) * repeat
 // offset.x = worldU0/across → tex_u at uv=0 equals worldU0/3
 const offU =
 opts.worldU0 != null && across > 0 ? Number(opts.worldU0) / across : 0;
 const offV =
 opts.worldV0 != null && along > 0 ? Number(opts.worldV0) / along : 0;
 for (const t of [map, normalMap, roughnessMap]) {
 t.wrapS = t.wrapT = THREE.RepeatWrapping;
 t.repeat.set(repX, repY);
 t.offset.set(offU, offV);
 if (opts.rotate90) {
 t.center.set(0.5, 0.5);
 t.rotation = Math.PI / 2;
 t.repeat.set(repY, repX);
 t.offset.set(offV, offU);
 }
 t.needsUpdate = true;
 }
 // Physical metal with clearcoat. Lite/embed: less metal wash so colors read on phone.
 const liteMetal = !!this.lite;
 const col = new THREE.Color(hex >>> 0);
 const lum = 0.2126 * col.r + 0.7152 * col.g + 0.0722 * col.b;
 const mat = new THREE.MeshPhysicalMaterial({
 // Hue on the material; map is grayscale rib shade (see _agPanelMaps).
 color: col,
 map,
 normalMap,
 roughnessMap,
 metalness: opts.metalness ?? (liteMetal ? 0 : 0.88),
 roughness: opts.roughness ?? (liteMetal ? 0.82 : 0.28),
 clearcoat: opts.clearcoat ?? (liteMetal ? 0 : 0.35),
 clearcoatRoughness: opts.clearcoatRoughness ?? (liteMetal ? 1 : 0.28),
 envMapIntensity: opts.envMapIntensity ?? (liteMetal ? 0 : 1.15),
 normalScale: new THREE.Vector2(
 opts.normalStrength ?? (liteMetal ? 0.9 : 1.45),
 opts.normalStrength ?? (liteMetal ? 0.9 : 1.45),
 ),
 transparent: opts.transparent ?? false,
 opacity: opts.opacity ?? 1,
 side: opts.side ?? THREE.FrontSide,
 });
 // Tiny emissive lift so Bright White / Alamo don't sink to beige under ambient
 if (liteMetal && lum > 0.7) {
 mat.emissive = col.clone();
 mat.emissiveIntensity = lum > 0.9 ? 0.08 : 0.04;
 }
 return mat;
 } catch (err) {
 console.warn('ag panel mat fallback', err);
 return this._metalMat(hex, opts);
 }
 }

 _metalMat(hex, opts = {}) {
 // Trim / ridge / solid metal accents — lite/embed keeps colors readable on phone
 const col = new THREE.Color(this._colorFor(hex, 0xcccccc));
 const liteMetal = !!this.lite;
 return new THREE.MeshPhysicalMaterial({
 color: col,
 metalness: opts.metalness ?? (liteMetal ? 0.08 : 0.62),
 roughness: opts.roughness ?? (liteMetal ? 0.7 : 0.38),
 clearcoat: opts.clearcoat ?? (liteMetal ? 0 : 0.35),
 clearcoatRoughness: opts.clearcoatRoughness ?? (liteMetal ? 1 : 0.3),
 envMapIntensity: opts.envMapIntensity ?? (liteMetal ? 0 : 0.85),
 flatShading: false,
 transparent: opts.transparent ?? false,
 opacity: opts.opacity ?? 1,
 side: opts.side ?? THREE.FrontSide,
 });
 }

 /**
   * Vertical rib segments along wall, skipping only the opening rectangle
   * (metal/ribs continue above windows and above doors).
   */
 _ribVerticalSegments(wallH, along, openings) {
 // returns [{v0,v1}] height segments where a rib may exist at this along-position
 let segs = [{ v0: 0, v1: wallH }];
 for (const o of openings || []) {
 const ow = Number(o.width) || 3;
 const off = Number(o.offset) || 0;
 if (along < off - 0.12 || along > off + ow + 0.12) continue;
 const oh = Number(o.height) || 7;
 const sill = Math.max(0, Number(o.sillHeight) || 0);
 const bot = sill;
 const top = sill + oh;
 const next = [];
 for (const s of segs) {
 if (top <= s.v0 || bot >= s.v1) {
 next.push(s);
 continue;
 }
 if (bot > s.v0 + 0.05) next.push({ v0: s.v0, v1: bot });
 if (top < s.v1 - 0.05) next.push({ v0: top, v1: s.v1 });
 }
 segs = next;
 }
 return segs.filter((s) => s.v1 - s.v0 > 0.08);
 }

 /** Physical rib extrusion so ag panel reads in silhouette (not just texture). */
 _addAgRibs(group, wdef, hex, majorEveryFt = 3, minorEveryFt = 0.75, openings = []) {
 if (!this.showMetal) return;
 const ribMetal = this.lite ? 0.08 : 0.85;
 const ribRough = this.lite ? 0.7 : 0.28;
 const majorMat = new THREE.MeshStandardMaterial({
 color: new THREE.Color(hex).offsetHSL(0, 0, 0.06),
 metalness: ribMetal,
 roughness: ribRough,
 });
 const minorMat = new THREE.MeshStandardMaterial({
 color: new THREE.Color(hex).offsetHSL(0, 0, 0.02),
 metalness: this.lite ? 0.06 : 0.8,
 roughness: this.lite ? 0.72 : 0.32,
 });

 const isFrontBack = wdef.wall === 'front' || wdef.wall === 'back';
 const span = wdef.w;
 const wallH = wdef.h / (FT || 1); // h is already in world units (ft * FT)

 const placeRib = (d, heightSeg, major) => {
 const ht = heightSeg.v1 - heightSeg.v0;
 if (ht < 0.08) return;
 const vMid = (heightSeg.v0 + heightSeg.v1) / 2;
 const t = d / span - 0.5;
 let rib;
 if (isFrontBack) {
 rib = new THREE.Mesh(
 new THREE.BoxGeometry(major ? 0.14 : 0.07, ht, major ? 0.28 : 0.2),
 major ? majorMat : minorMat,
 );
 rib.position.set(
 wdef.x + t * span,
 vMid,
 wdef.z + (wdef.wall === 'front' ? (major ? 0.12 : 0.1) : major ? -0.12 : -0.1),
 );
 } else {
 rib = new THREE.Mesh(
 new THREE.BoxGeometry(major ? 0.28 : 0.2, ht, major ? 0.14 : 0.07),
 major ? majorMat : minorMat,
 );
 rib.position.set(
 wdef.x + (wdef.wall === 'left' ? (major ? 0.12 : 0.1) : major ? -0.12 : -0.1),
 vMid,
 wdef.z + t * span,
 );
 }
 rib.castShadow = true;
 group.add(rib);
 };

 // major high ribs
 for (let d = 0; d <= span + 0.01; d += majorEveryFt) {
 for (const seg of this._ribVerticalSegments(wallH, d, openings)) {
 placeRib(d, seg, true);
 }
 }
 // minor ribs between majors
 for (let d = minorEveryFt; d < span; d += minorEveryFt) {
 if (d % majorEveryFt < 0.1) continue;
 for (const seg of this._ribVerticalSegments(wallH, d, openings)) {
 placeRib(d, seg, false);
 }
 }
 }

 /**
   * Corrugated roof plane geometry — real 3D ag-panel ribs you can see at the eave edge.
   * local X = across slope (rib direction), local Z = along ridge, Y up after transform.
   */
 _corrugatedRoofGeometry(widthAcross, lengthAlong, ribSpacing = 0.75, ribDepth = 0.1) {
 const segsX = Math.max(8, Math.ceil(widthAcross / 0.12));
 const segsZ = Math.max(4, Math.ceil(lengthAlong / 2));
 const geo = new THREE.PlaneGeometry(widthAcross, lengthAlong, segsX, segsZ);
 // Plane is XY by default in three? Actually PlaneGeometry is XY, we rotate later.
 // Default PlaneGeometry lies in XY facing +Z. We'll use as X = across, Y = along, then rotate.
 const pos = geo.attributes.position;
 for (let i = 0; i < pos.count; i++) {
 const x = pos.getX(i);
 // trapezoidal-ish rib: abs of sawtooth
 const phase = ((x + widthAcross / 2) / ribSpacing) * Math.PI * 2;
 const rib = Math.pow(Math.abs(Math.sin(phase)), 0.45) * ribDepth;
 // major every 4th
 const major = Math.pow(Math.abs(Math.sin(phase / 4)), 0.35) * ribDepth * 0.55;
 pos.setZ(i, rib + major); // displace toward outside before rotation
 }
 pos.needsUpdate = true;
 geo.computeVertexNormals();
 return geo;
 }

 /* ───────────── Public API ───────────── */

 setMode(mode) {
 this.mode = mode;
 if (this.controls) {
 this.controls.enabled =
 mode === 'orbit' || this.presentationMode || mode === 'place-prop';
 if (mode === 'orbit') this.controls.enabled = true;
 }
 if (this.canvas) {
 this.canvas.style.cursor =
 mode === 'place-opening' || mode === 'place-prop' || mode === 'open-wall'
 ? 'crosshair'
 : mode === 'move-opening'
 ? 'grab'
 : 'default';
 }
 }

 setPlaceOpeningDraft(draft) {
 this.placeOpeningDraft = draft;
 }

 setPlacePropDraft(draft) {
 this.placePropDraft = draft; // { type }
 }

 setPresentationMode(on) {
 this.presentationMode = !!on;
 if (on) {
 this.showFraming = false;
 this.showMetal = true;
 this.setAutoOrbit(true);
 this.heroShot();
 } else {
 this.setAutoOrbit(false);
 }
 this.rebuild();
 }

 setAutoOrbit(on) {
 this.autoOrbit = !!on;
 if (!this.webglOk || !this.controls) return;
 this.controls.autoRotate = this.autoOrbit;
 }

 resize() {
 if (!this.renderer || !this.canvas) return;
 const parent = this.canvas.parentElement;
 const w = parent?.clientWidth || 800;
 const h = parent?.clientHeight || 600;
 if (w < 2 || h < 2) return;
 this.renderer.setSize(w, h, false);
 this.camera.aspect = w / h;
 this.camera.updateProjectionMatrix();
 }

 _loop() {
 if (!this._running || !this.renderer) return;
 requestAnimationFrame(() => this._loop());
 this.controls?.update?.();
 // gentle sun drift for life
 const t = this._clock.getElapsedTime();
 if (this.sun) {
 this.sun.position.x = 55 + Math.sin(t * 0.05) * 8;
 this.sun.position.z = 35 + Math.cos(t * 0.04) * 6;
 if (this._skyMat?.uniforms?.sunDir) {
 this._skyMat.uniforms.sunDir.value
 .copy(this.sun.position)
 .normalize();
 }
 }
 try {
 this.renderer.render(this.scene, this.camera);
 } catch (err) {
 console.warn('render frame failed', err);
 }
 }

 dispose() {
 this._running = false;
 window.removeEventListener('resize', this._onResize);
 this.renderer.dispose();
 }

 setProject(project) {
 this.project = project;
 this.rebuild();
 }

 rebuild() {
 try {
 while (this.root.children.length) {
 const c = this.root.children.pop();
 c.traverse((obj) => {
 if (obj.geometry) obj.geometry.dispose();
 if (obj.material) {
 if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
 else obj.material.dispose();
 }
 });
 }
 this.pickables = [];
 this.openingMeshes = [];
 this.propPickables = [];
 this._labelSprites = [];
 if (!this.project) return;
 for (const b of this.project.buildings || []) {
 try {
 this._addBuilding(b);
 } catch (err) {
 console.error('Failed to add building', b?.name, err);
 }
 }
 // Invisible ground for placing background props
 this._ensureGroundPick();
 for (const p of this.project.props || []) {
 try {
 this._addSiteProp(p);
 } catch (err) {
 console.error('Failed to add prop', p?.type, err);
 }
 }
 // Trees always ≥15' outside building / lean-to footprints
 try {
 this._layoutLandscapeTrees(15);
 } catch (err) {
 console.warn('Tree layout failed', err);
 }
 this._updateSunTarget();
 } catch (err) {
 console.error('Scene rebuild failed', err);
 }
 }

 _ensureGroundPick() {
 if (this._groundPick) {
 this.root.remove(this._groundPick);
 this._groundPick.geometry?.dispose();
 this._groundPick.material?.dispose?.();
 this._groundPick = null;
 }
 const mesh = new THREE.Mesh(
 new THREE.PlaneGeometry(400, 400),
 new THREE.MeshBasicMaterial({
 visible: false,
 side: THREE.DoubleSide,
 depthWrite: false,
 }),
 );
 mesh.rotation.x = -Math.PI / 2;
 mesh.position.y = 0.02;
 mesh.userData = { kind: 'ground' };
 this.root.add(mesh);
 this._groundPick = mesh;
 }

 _addSiteProp(prop) {
 const mesh = buildSitePropMesh(prop.type);
 const s = prop.scale || 1;
 mesh.scale.setScalar(s);
 mesh.position.set(prop.x * FT, 0, prop.z * FT);
 mesh.rotation.y = THREE.MathUtils.degToRad(prop.rotationDeg || 0);
 mesh.userData = { kind: 'prop', propId: prop.id, type: prop.type };
 mesh.traverse((o) => {
 if (o.isMesh) {
 o.castShadow = true;
 o.receiveShadow = true;
 o.userData = { ...o.userData, kind: 'prop', propId: prop.id };
 }
 });
 // Selection ring
 if (prop.id === this.selectedPropId) {
 const ring = new THREE.Mesh(
 new THREE.RingGeometry(1.2 * s, 1.45 * s, 32),
 new THREE.MeshBasicMaterial({
 color: 0xe8871a,
 side: THREE.DoubleSide,
 transparent: true,
 opacity: 0.85,
 depthWrite: false,
 }),
 );
 ring.rotation.x = -Math.PI / 2;
 ring.position.y = 0.05;
 mesh.add(ring);
 }
 this.root.add(mesh);
 this.propPickables.push(mesh);
 }

 _updateSunTarget() {
 if (!this.project?.buildings?.length) return;
 const b = this.project.buildings[0];
 this.sun.target.position.set(
 b.siteX + b.width / 2,
 0,
 b.siteZ + b.length / 2,
 );
 this.sun.target.updateMatrixWorld();
 }

 frameAll() {
 if (!this.webglOk || !this.controls) return;
 const box = new THREE.Box3().setFromObject(this.root);
 if (box.isEmpty()) return;
 const center = box.getCenter(new THREE.Vector3());
 const size = box.getSize(new THREE.Vector3());
 const maxDim = Math.max(size.x, size.y, size.z, 24);
 this.controls.target.copy(center);
 this.controls.target.y = size.y * 0.35;
 this.camera.position.set(
 center.x + maxDim * 0.95,
 center.y + maxDim * 0.42,
 center.z + maxDim * 0.95,
 );
 this.controls.update();
 }

 /** Dramatic sales angle — slightly lower, more cinematic */
 heroShot() {
 if (!this.webglOk || !this.controls) return;
 const box = new THREE.Box3().setFromObject(this.root);
 if (box.isEmpty()) {
 this.camera.position.set(70, 20, 74);
 this.controls.target.set(20, 6.5, 30);
 this.controls.update();
 return;
 }
 const center = box.getCenter(new THREE.Vector3());
 const size = box.getSize(new THREE.Vector3());
 const maxDim = Math.max(size.x, size.y, size.z, 24);
 this.controls.target.set(center.x, size.y * 0.28, center.z);
 // low 3/4 front-corner — classic pole barn brochure angle
 const dist = maxDim * 1.15;
 this.camera.position.set(
 center.x + dist * 0.85,
 center.y + maxDim * 0.32,
 center.z + dist * 0.72,
 );
 this.controls.update();
 }

 /**
   * Export high-res PNG for estimates.
   * @param {{ width?: number, filename?: string, brand?: boolean }} opts
   */
 async captureScreenshot(opts = {}) {
 const exportW = opts.width || 1920;
 const exportH = opts.height || 1080;
 const brand = opts.brand !== false;
 const prevSize = new THREE.Vector2();
 this.renderer.getSize(prevSize);
 const prevPr = this.renderer.getPixelRatio();

 // Temporarily boost quality
 this.renderer.setPixelRatio(1);
 this.renderer.setSize(exportW, exportH, false);
 this.camera.aspect = exportW / exportH;
 this.camera.updateProjectionMatrix();
 this.renderer.render(this.scene, this.camera);

 // Composite onto 2D canvas with brand bar
 const src = this.canvas;
 const out = document.createElement('canvas');
 out.width = exportW;
 out.height = exportH + (brand ? 72 : 0);
 const ctx = out.getContext('2d');

 // dark brand footer strip
 if (brand) {
 const grad = ctx.createLinearGradient(0, 0, exportW, 0);
 grad.addColorStop(0, '#3d1560');
 grad.addColorStop(0.45, '#6b2d9b');
 grad.addColorStop(0.75, '#a83270');
 grad.addColorStop(1, '#c96a18');
 ctx.fillStyle = grad;
 ctx.fillRect(0, 0, exportW, 72);
 ctx.fillStyle = '#fff8f0';
 ctx.font = 'bold 26px Segoe UI, system-ui, sans-serif';
 ctx.fillText('WE BUILD STRUCTURES', 28, 44);
 ctx.font = '15px Segoe UI, system-ui, sans-serif';
 ctx.fillStyle = 'rgba(255,248,240,0.85)';
 const p = this.project;
 const b = p?.buildings?.[0];
 const label = b
 ? `${p.customer || ''} · ${b.width}' × ${b.length}' × ${b.eaveHeight}' · ${b.pitch}/12 ${b.roofStyle}`
 : 'Custom Post-Frame Building';
 ctx.fillText(label, 28, 64);
 ctx.drawImage(src, 0, 0, exportW, exportH, 0, 72, exportW, exportH);
 } else {
 ctx.drawImage(src, 0, 0);
 }

 // restore viewport
 this.renderer.setPixelRatio(prevPr);
 this.renderer.setSize(prevSize.x, prevSize.y, false);
 this.camera.aspect = prevSize.x / Math.max(prevSize.y, 1);
 this.camera.updateProjectionMatrix();
 this.renderer.render(this.scene, this.camera);

 return new Promise((resolve) => {
 out.toBlob((blob) => {
 if (!blob) return resolve(null);
 const name =
 opts.filename ||
 `building-${this.project?.buildings?.[0]?.width || 'custom'}x${this.project?.buildings?.[0]?.length || ''}.png`;
 const a = document.createElement('a');
 a.href = URL.createObjectURL(blob);
 a.download = name;
 a.click();
 URL.revokeObjectURL(a.href);
 resolve(blob);
 }, 'image/png');
 });
 }

 /**
 * True when a toDataURL PNG looks empty / solid (iOS Safari blank buffer).
 * Real building elevations at export size are much larger than a flat fill.
 * @param {string} dataUrl
 * @returns {boolean}
 */
 _isBlankElevationDataUrl(dataUrl) {
 if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image')) {
 return true;
 }
 const comma = dataUrl.indexOf(',');
 const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : '';
 // Solid-color / cleared buffers encode tiny; building shots are typically >> 8KB b64.
 if (b64.length < 8000) return true;
 // Optional pixel sample via WebGL readPixels (needs preserveDrawingBuffer).
 try {
 const gl = this.renderer?.getContext?.();
 const canvas = this.renderer?.domElement;
 if (!gl || !canvas?.width || !canvas?.height) return false;
 const w = canvas.width;
 const h = canvas.height;
 const samples = [
 [0.3, 0.35],
 [0.5, 0.5],
 [0.7, 0.35],
 [0.35, 0.7],
 [0.65, 0.7],
 ];
 const buf = new Uint8Array(4);
 let first = null;
 let same = 0;
 for (const [fx, fy] of samples) {
 const x = Math.min(w - 1, Math.max(0, Math.floor(w * fx)));
 const y = Math.min(h - 1, Math.max(0, Math.floor(h * fy)));
 gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
 const key = `${buf[0]},${buf[1]},${buf[2]}`;
 if (first == null) first = key;
 else if (key === first) same += 1;
 }
 // 4 of 5 remaining samples match the first → nearly uniform frame.
 if (same >= 4) return true;
 } catch (_) {
 /* length heuristic already applied */
 }
 return false;
 }

 /**
 * Render current camera into the drawing buffer and return a PNG data URL.
 * Double-renders so lite/safer Safari has a settled frame before toDataURL.
 * @returns {string}
 */
 _captureElevationFrame() {
 this.controls.update();
 this.renderer.render(this.scene, this.camera);
 this.renderer.render(this.scene, this.camera);
 try {
 return this.renderer.domElement.toDataURL('image/png');
 } catch (err) {
 console.warn('[scene] elevation toDataURL failed', err);
 return '';
 }
 }

 /**
 * Capture clear elevation PNGs of all four sides (front/back/left/right).
 * Phone-safe: uses the live WebGL canvas via toDataURL at a capped size
 * (no 1920 download path). Restores camera + orbit afterward.
 * Keys stay front/back/left/right (worker maps to Sidewall/Endwall filenames).
 *
 * @param {{ maxWidth?: number, maxHeight?: number }} [opts]
 * @returns {Promise<{ front?: string, back?: string, left?: string, right?: string }>}
 * data URLs keyed by wall; empty object when WebGL is unavailable.
 */
 async captureElevationShots(opts = {}) {
 const out = {};
 if (!this.webglOk || !this.renderer || !this.camera || !this.controls) {
 return out;
 }

 const maxW = Math.max(320, Math.min(opts.maxWidth || 1024, 1280));
 const maxH = Math.max(240, Math.min(opts.maxHeight || 640, 800));
 const prevCamPos = this.camera.position.clone();
 const prevTarget = this.controls.target.clone();
 const prevAuto = !!this.controls.autoRotate;
 const prevSize = new THREE.Vector2();
 this.renderer.getSize(prevSize);
 const prevPr = this.renderer.getPixelRatio();
 const prevAspect = this.camera.aspect;

 // Pause auto-orbit while we lock each elevation.
 this.controls.autoRotate = false;

 const box = new THREE.Box3().setFromObject(this.root);
 let center = new THREE.Vector3(20, 8, 30);
 let size = new THREE.Vector3(40, 16, 50);
 if (!box.isEmpty()) {
 center = box.getCenter(new THREE.Vector3());
 size = box.getSize(new THREE.Vector3());
 }
 // Flat elevation eye height (mid building), not a high 3/4 view.
 const eyeY = center.y;
 this.controls.target.set(center.x, center.y, center.z);

 // Cap export size relative to the on-screen canvas so Safari lite stays happy.
 const exportW = Math.min(maxW, Math.max(320, Math.floor(prevSize.x) || maxW));
 const exportH = Math.min(maxH, Math.max(240, Math.floor(prevSize.y) || maxH));

 // FOV-fit so each wall nearly fills the frame (old maxDim*1.35 was way too far).
 const aspect = exportW / Math.max(exportH, 1);
 const vFov = THREE.MathUtils.degToRad(this.camera.fov || 38);
 const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
 const pad = 1.05; // tight; lower = more zoomed in
 const distToFit = (spanW, spanH) => {
 const dH = (spanH * 0.5) / Math.tan(vFov / 2);
 const dW = (spanW * 0.5) / Math.tan(hFov / 2);
 return Math.max(dH, dW, 6) * pad;
 };
 // Endwalls (front/back) frame width×height; sidewalls (left/right) frame length×height.
 const distEnd = distToFit(size.x, size.y);
 const distSide = distToFit(size.z, size.y);
 // Match wall naming: front=-Z, back=+Z, left=-X, right=+X
 const sides = [
 { key: 'front', pos: [center.x, eyeY, center.z - distEnd] },
 { key: 'back', pos: [center.x, eyeY, center.z + distEnd] },
 { key: 'left', pos: [center.x - distSide, eyeY, center.z] },
 { key: 'right', pos: [center.x + distSide, eyeY, center.z] },
 ];

 try {
 this.renderer.setPixelRatio(1);
 this.renderer.setSize(exportW, exportH, false);
 this.camera.aspect = aspect;
 this.camera.updateProjectionMatrix();

 for (const side of sides) {
 this.camera.position.set(side.pos[0], side.pos[1], side.pos[2]);
 let dataUrl = this._captureElevationFrame();
 if (this._isBlankElevationDataUrl(dataUrl)) {
 // One retry after a paint yield — iOS sometimes returns a cleared buffer.
 await new Promise((r) => requestAnimationFrame(r));
 this.camera.position.set(side.pos[0], side.pos[1], side.pos[2]);
 dataUrl = this._captureElevationFrame();
 }
 if (dataUrl && dataUrl.startsWith('data:image') && !this._isBlankElevationDataUrl(dataUrl)) {
 out[side.key] = dataUrl;
 } else if (dataUrl && dataUrl.startsWith('data:image')) {
 // Keep a non-empty URL even if still suspicious — delivery > perfect.
 console.warn('[scene] elevation may be blank', side.key, dataUrl.length);
 out[side.key] = dataUrl;
 }
 // Yield so Safari can keep the page responsive between shots.
 await new Promise((r) => requestAnimationFrame(r));
 }
 } finally {
 this.camera.position.copy(prevCamPos);
 this.controls.target.copy(prevTarget);
 this.controls.autoRotate = prevAuto;
 this.controls.update();
 this.renderer.setPixelRatio(prevPr);
 this.renderer.setSize(prevSize.x, prevSize.y, false);
 this.camera.aspect = prevAspect;
 this.camera.updateProjectionMatrix();
 this.renderer.render(this.scene, this.camera);
 }

 return out;
 }

 /* ───────────── Building mesh ───────────── */

 _siteMatrix(b) {
 const g = new THREE.Group();
 g.position.set(b.siteX * FT, 0, b.siteZ * FT);
 g.rotation.y = THREE.MathUtils.degToRad(b.rotationDeg || 0);
 g.userData.buildingId = b.id;
 return g;
 }

 _addBuilding(b) {
 const group = this._siteMatrix(b);
 this.root.add(group);

 const rise = roofRise(b);
 const W = b.width * FT;
 const L = b.length * FT;
 const H = b.eaveHeight * FT;
 const metalOh = ((b.metalOverhangIn ?? 3) / 12) * FT;
 const frameOh = ((b.overhangIn || 0) / 12) * FT;
 const oh = metalOh + frameOh;

 const wallHex = this._colorFor(b.wallColor, 0xf2ebe0);
 const roofHex = this._colorFor(b.roofColor, 0x1a1a1a);

 // No solid under-building disc (green lawn / AO circle blocked underside truss views)

 // Interior slab ONLY when hasSlab — deeply inset so NO exterior concrete shows
 if (b.hasSlab === true) {
 const wallInset = 0.85; // well inside wall line
 const slabW = Math.max(1, W - wallInset * 2);
 const slabL = Math.max(1, L - wallInset * 2);
 const slabThk = Math.max(0.08, ((b.slabThicknessIn || 4) / 12) * FT * 0.7);
 const slab = new THREE.Mesh(
 new THREE.BoxGeometry(slabW, slabThk, slabL),
 new THREE.MeshStandardMaterial({
 color: 0x8e969e,
 roughness: 0.78,
 metalness: 0.02,
 }),
 );
 // Fully below grade so exterior never sees a concrete apron
 slab.position.set(W / 2, -slabThk / 2 - 0.02, L / 2);
 slab.receiveShadow = true;
 slab.castShadow = false;
 group.add(slab);
 }

 // ── SKIN (metal) vs FRAME toggle ──
 // showMetal = walls + roof + ribs (the "skin")
 // showFraming = posts + trusses + girts + purlins + truss bearers
 // open walls (drive-through): no metal/girts/intermediate posts on those faces
 const hasOpenWall = openWallList(b).length > 0;
 if (this.showMetal) {
 this._addBuildingSkin(group, b, W, L, H, rise, oh, wallHex, roofHex);
 }

 // Invisible pick walls when skin is off (so openings can still be placed)
 if (!this.showMetal) {
 this._addPickWalls(group, b, W, L, H);
 }

 for (const o of b.openings || []) {
 // Skip openings on open drive-through walls (no wall to hang on)
 if ((!o.host || o.host === 'main') && isWallOpen(b, o.wall)) continue;
 if (!o.host || o.host === 'main') this._addOpening(group, b, o);
 }

 // Lean-tos: roof always; walls when enclosed + metal on; posts only when framing or open
 for (const lt of b.leanTos || []) {
 // Match main-building ag-panel params so lean metal reads the same
 const leanWall = this._agPanelMat(
 wallHex,
 Math.max(lt.length || b.length || 40, 12),
 Math.max(lt.eaveHeight || 10, 8),
 {
 metalness: 0.78,
 roughness: 0.32,
 normalStrength: 1.35,
 side: THREE.DoubleSide,
 },
 );
 const leanRoof = this._agPanelMat(
 roofHex,
 Math.max(lt.depth || 12, 8),
 Math.max(lt.length || b.length || 40, 12),
 {
 metalness: 0.88,
 roughness: 0.26,
 normalStrength: 1.75,
 side: THREE.DoubleSide,
 },
 );
 this._addLeanTo(group, b, lt, leanWall, leanRoof);
 }
 for (const o of b.openings || []) {
 if (o.host && o.host !== 'main') this._addLeanOpening(group, b, o);
 }

 // Interior roof structure (trusses + purlins + carriers) always visible under the roof
 // so you can see them through openings / open walls / looking inside.
 this._addInteriorRoofStructure(group, b);

 // Wall framing: full when Frame on or skin off; open-wall posts only when skin-only
 // (so closed-wall posts don't bleed through metal).
 if (this.showFraming || !this.showMetal) {
 this._addFraming(group, b, { skipRoofStructure: true });
 } else if (hasOpenWall) {
 this._addFraming(group, b, { openWallPostsOnly: true, skipRoofStructure: true });
 }

 this._addDimLabels(group, b, W, L, H);
 }

 /** Invisible walls for raycasting when skin is hidden */
 _addPickWalls(group, b, W, L, H) {
 const invis = new THREE.MeshBasicMaterial({
 visible: false,
 transparent: true,
 opacity: 0,
 depthWrite: false,
 side: THREE.DoubleSide,
 });
 const walls = [
 { wall: 'front', w: W, h: H, x: W / 2, y: H / 2, z: 0.05, ry: 0 },
 { wall: 'back', w: W, h: H, x: W / 2, y: H / 2, z: L - 0.05, ry: Math.PI },
 { wall: 'left', w: L, h: H, x: 0.05, y: H / 2, z: L / 2, ry: Math.PI / 2 },
 { wall: 'right', w: L, h: H, x: W - 0.05, y: H / 2, z: L / 2, ry: -Math.PI / 2 },
 ];
 for (const wdef of walls) {
 const mesh = new THREE.Mesh(new THREE.BoxGeometry(wdef.w, wdef.h, 0.12), invis);
 mesh.position.set(wdef.x, wdef.y, wdef.z);
 mesh.rotation.y = wdef.ry;
 mesh.castShadow = false;
 mesh.receiveShadow = false;
 mesh.userData = {
 kind: 'wall',
 host: 'main',
 face: 'main',
 buildingId: b.id,
 wall: wdef.wall,
 wallLength: wallLength(b, wdef.wall),
 };
 group.add(mesh);
 this.pickables.push(mesh);
 }
 }

 /**
   * Subtract opening rectangles from the wall so only the door/window
   * footprint is open — metal remains above and below (and beside).
   * Wall local coords: u along wall (ft), v height from grade (ft).
   * Returns solid panels { u0, u1, v0, v1 }.
   */
 _wallSolidPanels(wallLen, wallH, openings) {
 const gap = 0.06; // small clearance around rough opening
 let solids = [{ u0: 0, u1: wallLen, v0: 0, v1: wallH }];

 const holes = (openings || []).map((o) => {
 const ow = Math.max(0.5, Number(o.width) || 3);
 const oh = Math.max(0.5, Number(o.height) || 7);
 const sill = Math.max(0, Number(o.sillHeight) || 0);
 return {
 u0: Math.max(0, (Number(o.offset) || 0) - gap),
 u1: Math.min(wallLen, (Number(o.offset) || 0) + ow + gap),
 v0: Math.max(0, sill - gap * 0.5),
 v1: Math.min(wallH, sill + oh + gap * 0.5),
 };
 }).filter((h) => h.u1 > h.u0 + 0.02 && h.v1 > h.v0 + 0.02);

 for (const hole of holes) {
 const next = [];
 for (const s of solids) {
 // No overlap — keep panel
 if (hole.u1 <= s.u0 || hole.u0 >= s.u1 || hole.v1 <= s.v0 || hole.v0 >= s.v1) {
 next.push(s);
 continue;
 }
 // Split solid around hole (up to 4 rectangles)
 // Left
 if (hole.u0 > s.u0 + 0.02) {
 next.push({ u0: s.u0, u1: hole.u0, v0: s.v0, v1: s.v1 });
 }
 // Right
 if (hole.u1 < s.u1 - 0.02) {
 next.push({ u0: hole.u1, u1: s.u1, v0: s.v0, v1: s.v1 });
 }
 // Middle column clipped to hole u-range
 const mu0 = Math.max(s.u0, hole.u0);
 const mu1 = Math.min(s.u1, hole.u1);
 if (mu1 > mu0 + 0.02) {
 // Below hole
 if (hole.v0 > s.v0 + 0.02) {
 next.push({ u0: mu0, u1: mu1, v0: s.v0, v1: hole.v0 });
 }
 // Above hole
 if (hole.v1 < s.v1 - 0.02) {
 next.push({ u0: mu0, u1: mu1, v0: hole.v1, v1: s.v1 });
 }
 }
 }
 solids = next;
 }

 if (!solids.length) solids = [{ u0: 0, u1: wallLen, v0: 0, v1: wallH }];
 return solids.filter((p) => p.u1 - p.u0 > 0.04 && p.v1 - p.v0 > 0.04);
 }

 /** Place one wall metal panel in wall-local u/v (ft). */
 _addWallPanel(group, wdef, panel, mat, thick, wallLenFt, buildingId) {
 const len = panel.u1 - panel.u0;
 let ht = panel.v1 - panel.v0;
 if (len < 0.04 || ht < 0.04) return;
 const uMid = (panel.u0 + panel.u1) / 2;
 // Bury bottom panels slightly so no exterior foundation gap shows
 const bury = panel.v0 < 0.15 ? 0.1 : 0;
 ht += bury;
 const vMid = (panel.v0 + panel.v1) / 2 - bury / 2;
 let mesh;
 if (wdef.axis === 'x') {
 mesh = new THREE.Mesh(new THREE.BoxGeometry(len, ht, thick), mat);
 mesh.position.set(uMid, vMid, wdef.z);
 } else {
 mesh = new THREE.Mesh(new THREE.BoxGeometry(thick, ht, len), mat);
 mesh.position.set(wdef.x, vMid, uMid);
 }
 mesh.castShadow = true;
 mesh.receiveShadow = true;
 mesh.userData = {
 kind: 'wall',
 host: 'main',
 face: 'main',
 buildingId,
 wall: wdef.wall,
 wallLength: wallLenFt,
 };
 group.add(mesh);
 }

 /** Metal walls + roof (ag panel). Only called when showMetal is true. */

 /**
  * Effective wainscot band height (ft) for 3D meshes.
  * Color NONE/empty → 0. Explicit height ≤ 0 → off even if a color is selected.
  * Missing/NaN height with color on → historic default 3′.
  */
 _wainscotHeightFt(b, maxHft) {
 const color = b?.wainscotColor;
 if (!color || color === 'NONE' || String(color).toUpperCase() === '') return 0;
 const raw = Number(b.wainscotHeightFt);
 if (Number.isFinite(raw) && raw <= 0) return 0;
 const h = Number.isFinite(raw) && raw > 0 ? raw : 3;
 const cap = Math.max(0.5, (Number(maxHft) || 12) - 0.5);
 return Math.min(Math.max(h, 0.5), cap);
 }

 _addBuildingSkin(group, b, W, L, H, rise, oh, wallHex, roofHex) {
 // wall defs: span is wall length along X for front/back, along Z for left/right
 const walls = [
 { wall: 'front', span: W, h: H, y: H / 2, z: 0.05, axis: 'x', outSign: -1 },
 { wall: 'back', span: W, h: H, y: H / 2, z: L - 0.05, axis: 'x', outSign: 1 },
 { wall: 'left', span: L, h: H, y: H / 2, x: 0.05, axis: 'z', outSign: -1 },
 { wall: 'right', span: L, h: H, y: H / 2, x: W - 0.05, axis: 'z', outSign: 1 },
 ];

 const wainHft = this._wainscotHeightFt(b, b.eaveHeight);
 const hasWainscot = wainHft > 0;
 const wainH = hasWainscot ? wainHft * FT : 0;
 const wainHex = this._colorFor(b.wainscotColor, 0x1a1a1a);
 // Trim color is independent of roof — resolve explicitly so dropdown changes apply
 const trimCode = b.trimColor || b.roofColor || 'BK';
 const trimHex = this._colorFor(trimCode, this._colorFor('BK', 0x1a1a1a));
 const wallHft = H / FT;

 for (const wdef of walls) {
 const wallIsOpen = isWallOpen(b, wdef.wall);
 // Open wall = drive-through only BELOW eave. Gable triangle above eave stays sheeted.
 // Eave walls are only eave-tall, so open = no lower wall metal at all.
 const sheetLowerWall = !wallIsOpen;
 const wallOpenings = (b.openings || []).filter(
 (o) => (!o.host || o.host === 'main') && o.wall === wdef.wall,
 );
 const panels = sheetLowerWall
 ? this._wallSolidPanels(wdef.span, wallHft, wallOpenings)
 : [];
 const thick = 0.16;
 const wallLenFt = wallLength(b, wdef.wall);

 // Invisible full-wall pick plane (open walls still pickable for Open Wall mode)
 // Pick height = eave only (drive-through zone)
 const pickMat = new THREE.MeshBasicMaterial({
 visible: false,
 transparent: true,
 opacity: 0,
 depthWrite: false,
 side: THREE.DoubleSide,
 });
 const pickGeo =
 wdef.axis === 'x'
 ? new THREE.BoxGeometry(wdef.span, wdef.h, 0.08)
 : new THREE.BoxGeometry(0.08, wdef.h, wdef.span);
 const pick = new THREE.Mesh(pickGeo, pickMat);
 if (wdef.axis === 'x') pick.position.set(wdef.span / 2, wdef.y, wdef.z);
 else pick.position.set(wdef.x, wdef.y, wdef.span / 2);
 pick.castShadow = false;
 pick.receiveShadow = false;
 pick.userData = {
 kind: 'wall',
 host: 'main',
 face: 'main',
 buildingId: b.id,
 wall: wdef.wall,
 wallLength: wallLenFt,
 openWall: wallIsOpen,
 };
 group.add(pick);
 this.pickables.push(pick);

 // Drive-through: no lower wall metal / ribs / wainscot (eave height and below)
 if (!sheetLowerWall) continue;

 // Metal panels = wall minus rectangular opening cutouts
 // worldU0/worldV0 keep panel phase continuous across openings & into gable
 for (const panel of panels) {
 const len = panel.u1 - panel.u0;
 const ht = panel.v1 - panel.v0;
 const wallMat = this._agPanelMat(
 wallHex,
 len,
 ht,
 this._wallPanelOpts({
 worldU0: panel.u0,
 worldV0: panel.v0,
 }),
 );
 this._addWallPanel(group, wdef, panel, wallMat, thick, wallLenFt, b.id);
 }

 // Ribs: full wall, skip opening rectangles. Gable front/back ribs are drawn
 // later grade→peak in _addGableEndUpperMetal so the eave joint is one continuous rib.
 const isGableEnd =
 b.roofStyle === 'gable' && (wdef.wall === 'front' || wdef.wall === 'back');
 if (!isGableEnd) {
 const ribWdef = {
 wall: wdef.wall,
 w: wdef.span,
 h: wdef.h,
 x: wdef.axis === 'x' ? wdef.span / 2 : wdef.x,
 y: wdef.y,
 z: wdef.axis === 'x' ? wdef.z : wdef.span / 2,
 };
 this._addAgRibs(group, ribWdef, wallHex, 3, 0.75, wallOpenings);
 }

 // Wainscot: only where lower band is solid (intersect panels with 0..wainH)
 if (hasWainscot && wainH > 0.25) {
 const wainTop = wainH / FT;
 for (const panel of panels) {
 if (panel.v0 >= wainTop - 0.02) continue;
 const v0 = panel.v0;
 const v1 = Math.min(panel.v1, wainTop);
 if (v1 - v0 < 0.04) continue;
 const len = panel.u1 - panel.u0;
 const ht = v1 - v0;
 const wainMat = this._agPanelMat(
 wainHex,
 len,
 ht,
 this._wallPanelOpts({
 worldU0: panel.u0,
 worldV0: v0,
 }),
 );
 const uMid = (panel.u0 + panel.u1) / 2;
 const vMid = (v0 + v1) / 2;
 let wain;
 if (wdef.axis === 'x') {
 wain = new THREE.Mesh(new THREE.BoxGeometry(len, ht, 0.2), wainMat);
 wain.position.set(
 uMid,
 vMid,
 wdef.z + (wdef.wall === 'front' ? -0.04 : 0.04),
 );
 } else {
 wain = new THREE.Mesh(new THREE.BoxGeometry(0.2, ht, len), wainMat);
 wain.position.set(
 wdef.x + (wdef.wall === 'left' ? -0.04 : 0.04),
 vMid,
 uMid,
 );
 }
 wain.castShadow = true;
 group.add(wain);
 }
 // Transition strip along top of wainscot where metal exists at that height
 for (const panel of panels) {
 if (panel.v0 > wainTop + 0.02 || panel.v1 < wainTop - 0.02) continue;
 const len = panel.u1 - panel.u0;
 if (len < 0.08) continue;
 const uMid = (panel.u0 + panel.u1) / 2;
 let strip;
 if (wdef.axis === 'x') {
 strip = new THREE.Mesh(
 new THREE.BoxGeometry(len, 0.1, 0.24),
 this._metalMat(trimHex, { metalness: 0.85, roughness: 0.28 }),
 );
 strip.position.set(uMid, wainH, wdef.z + (wdef.wall === 'front' ? -0.1 : 0.1));
 } else {
 strip = new THREE.Mesh(
 new THREE.BoxGeometry(0.24, 0.1, len),
 this._metalMat(trimHex, { metalness: 0.85, roughness: 0.28 }),
 );
 strip.position.set(wdef.x + (wdef.wall === 'left' ? -0.1 : 0.1), wainH, uMid);
 }
 group.add(strip);
 }
 }
 }

 if (b.roofStyle === 'gable') this._addGableRoof(group, b, W, L, H, rise, oh, wallHex, roofHex);
 else this._addMonoRoof(group, b, W, L, H, rise, oh, roofHex);

 // Full roof-perimeter trim package (matches production 3D: continuous eave,
 // rake on roof edge, corners to eave, ridge). See _addRoofPerimeterTrim.
 this._addRoofPerimeterTrim(group, b, W, L, H, rise, oh, trimHex);
 }

 /**
   * Production-style trim package matching SmartBuild brochure 3D.
   *
   * Shared alignment system (all pieces use the same `out` / `leg` / `T`):
   *   wall metal outer ≈ building-line ± 0.03'
   *   trim outer face  = building-line ± out   (proud of wall, no z-fight)
   *   corner L legs run ALONG each wall face (into the building), not outside
   *   eave bands stop at corner legs and meet flush at the top
   *   rake meets eave at the outer corner
   *
   * Roof metal eave is at x=-oh / W+oh, y=H; gable roof edge at z=-oh / L+oh.
   */
 _addRoofPerimeterTrim(group, b, W, L, H, rise, oh, trimHex) {
 const mat = this._metalMat(trimHex, {
 metalness: 0.52,
 roughness: 0.44,
 clearcoat: 0.22,
 envMapIntensity: 0.5,
 });

 // ── Shared trim dimensions (ft) ──
 const out = 0.17; // building-line → outer face of trim (proud of ~0.03' wall outer)
 const T = 0.09; // formed-metal thickness
 const leg = 0.4; // corner leg width on each wall face (~4¾")
 const eaveBandH = 0.36; // vertical depth of top-of-wall / gable wall-face band
 const fasciaH = 0.34; // drip fascia vertical face (eave + gable rake)
 const lipThk = 0.06;
 const nest = 0.018;
 // Eave band / fascia top sits just under roof plane
 const bandTop = H - nest;
 const bandMidY = bandTop - eaveBandH * 0.5;
 // Corner: slight bury to match wall-panel grade bury, top flush with eave band
 const cornerBot = -0.08;
 const cornerH = bandTop - cornerBot;
 const cornerMidY = cornerBot + cornerH * 0.5;

 // Small helpers: outer-face center of a trim strip of thickness T
 const outerX = (xWall, ox) => xWall + ox * (out - T * 0.5);
 const outerZ = (zWall, oz) => zWall + oz * (out - T * 0.5);

 // ── Ridge cap (gable only) — SB-style formed inverted-V ──
 // SmartBuild top-down: wide smooth brake-formed cap (no panel ribs under it),
 // sharp peak crease, parallel outer edges running the full ridge length.
 if ((b.roofStyle || 'gable') === 'gable' && rise > 0.15) {
 const ridgeLen = L + oh * 2 + 0.18;
 const pitchAng = Math.atan2(rise, W / 2);
 // ~11" each wing along slope (~22" total) — matches SB brochure width
 const wingAlong = 0.95;
 const wingThk = 0.1;
 const lift = 0.08;
 const peakY = H + rise;
 // Slightly smoother/duller than ribbed roof so the cap separates in top-down
 const ridgeMat = this._metalMat(trimHex, {
 metalness: 0.48,
 roughness: 0.48,
 clearcoat: 0.18,
 envMapIntensity: 0.4,
 });

 // Left + right wings lying on each roof plane
 for (const side of [-1, 1]) {
 const mid = wingAlong * 0.5;
 const x = W / 2 + side * mid * Math.cos(pitchAng);
 const y = peakY - mid * Math.sin(pitchAng) + lift + wingThk * 0.5;
 const wing = new THREE.Mesh(
 new THREE.BoxGeometry(wingAlong, wingThk, ridgeLen),
 ridgeMat,
 );
 wing.position.set(x, y, L / 2);
 wing.rotation.z = side < 0 ? pitchAng : -pitchAng;
 wing.castShadow = true;
 group.add(wing);
 }

 // Peak fold / center crease
 const fold = new THREE.Mesh(
 new THREE.BoxGeometry(0.18, 0.12, ridgeLen * 0.999),
 ridgeMat,
 );
 fold.position.set(W / 2, peakY + lift + 0.09, L / 2);
 fold.castShadow = true;
 group.add(fold);

 // Outer edge beads — parallel lines along each side of the cap (SB look)
 for (const side of [-1, 1]) {
 const mid = wingAlong * 0.94;
 const x = W / 2 + side * mid * Math.cos(pitchAng);
 const y = peakY - mid * Math.sin(pitchAng) + lift + wingThk * 0.4;
 const lip = new THREE.Mesh(
 new THREE.BoxGeometry(0.09, wingThk * 1.3, ridgeLen * 0.997),
 ridgeMat,
 );
 lip.position.set(x, y, L / 2);
 lip.rotation.z = side < 0 ? pitchAng : -pitchAng;
 group.add(lip);
 }

 // Gable-end ridge closures
 for (const zEnd of [-oh * 0.1, L + oh * 0.1]) {
 const cap = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.14, 0.12), ridgeMat);
 cap.position.set(W / 2, peakY + lift + 0.05, zEnd);
 group.add(cap);
 }
 }

 // ── Eave package (left & right) ──
 // Band length stops at corner legs so the L-corner reads cleanly; fascia/pan
 // run full drip length (past gables) for continuous roof-edge metal.
 const bandLen = Math.max(1, L - 2 * leg + T); // meets corner legs with tiny overlap
 const dripLen = L + oh * 2 + T;
 for (const side of [-1, 1]) {
 const wallName = side < 0 ? 'left' : 'right';
 const xWall = side < 0 ? 0 : W;
 const xDrip = side < 0 ? -oh : W + oh;
 const ox = side < 0 ? -1 : 1;

 // Drip fascia (outer roof edge)
 const face = new THREE.Mesh(new THREE.BoxGeometry(T, fasciaH, dripLen), mat);
 face.position.set(xDrip + ox * (T * 0.35), bandTop - fasciaH * 0.5, L / 2);
 face.castShadow = true;
 group.add(face);

 // Soffit pan: from trim outer face out to drip
 const panDepth = Math.max(oh + out, 0.2);
 const pan = new THREE.Mesh(new THREE.BoxGeometry(panDepth, lipThk, dripLen), mat);
 pan.position.set(
 xWall + ox * (out + panDepth * 0.5 - T * 0.25),
 bandTop - lipThk * 0.5,
 L / 2,
 );
 pan.castShadow = true;
 group.add(pan);

 // Top-of-wall eave band on OUTER face (stops at corner legs)
 if (!isWallOpen(b, wallName)) {
 const band = new THREE.Mesh(new THREE.BoxGeometry(T, eaveBandH, bandLen), mat);
 band.position.set(outerX(xWall, ox), bandMidY, L / 2);
 band.castShadow = true;
 group.add(band);
 }
 }

 // ── Gable-end package (front & back) — same system as eave side ──
 // Mirrors the eave package so gable reads with the same bold black frame:
 //   1) wall-face band (depth eaveBandH, outer at `out`) following the roof slope
 //   2) drip fascia at roof edge (same fasciaH / T as side eaves)
 //   3) soffit pan wall → drip
 //   4) bands stop at corner legs so the L-corner stays clean
 if ((b.roofStyle || 'gable') === 'gable' && rise > 0.1) {
 // Roof-edge slope (includes metal OH)
 const dripRun = W / 2 + oh;
 const dripLen = Math.hypot(dripRun, rise);
 const dripAng = Math.atan2(rise, dripRun);
 // Wall-plane slope (no OH) — for outer-face band
 const wallAng = Math.atan2(rise, W / 2);
 // Roof line height on the wall plane at horizontal x
 const yWallAt = (x) => H + rise * (1 - Math.abs(x - W / 2) / Math.max(W / 2, 0.01));
 // Roof line height on the drip edge at horizontal x (same pitch, eave at -oh/W+oh)
 const yDripAt = (x) => {
 const half = W / 2 + oh;
 return H + rise * (1 - Math.abs(x - W / 2) / Math.max(half, 0.01));
 };

 for (const end of [
 { wall: 'front', zWall: 0, zDrip: -oh, oz: -1 },
 { wall: 'back', zWall: L, zDrip: L + oh, oz: 1 },
 ]) {
 for (const side of [-1, 1]) {
 const xEaveWall = side < 0 ? 0 : W;
 const xEaveDrip = side < 0 ? -oh : W + oh;
 const xRidge = W / 2;
 const angSign = side < 0 ? 1 : -1;

 // ── 1) Wall-face rake band (matches eave top-of-wall band) ──
 // Starts at corner leg, runs to just shy of peak so peak join sits clean.
 if (!isWallOpen(b, end.wall)) {
 const x0 = side < 0 ? leg - T * 0.4 : W - (leg - T * 0.4);
 const x1 = xRidge + (side < 0 ? -0.06 : 0.06);
 const run = Math.abs(x1 - x0);
 const bandLen = Math.hypot(run, rise * (run / Math.max(W / 2, 0.01)));
 const y0 = yWallAt(x0);
 const y1 = yWallAt(x1);
 // Hang below roof line the same way the eave band hangs below H
 const band = new THREE.Mesh(
 new THREE.BoxGeometry(bandLen, eaveBandH, T),
 mat,
 );
 band.position.set(
 (x0 + x1) / 2,
 (y0 + y1) / 2 - eaveBandH * 0.42,
 outerZ(end.zWall, end.oz),
 );
 band.rotation.z = angSign * wallAng;
 band.castShadow = true;
 group.add(band);
 }

 // ── 2) Roof-edge drip fascia (matches eave drip fascia size) ──
 // Full slope eave-drip → ridge drip; meets side eave fascia at the corner.
 const fascia = new THREE.Mesh(
 new THREE.BoxGeometry(dripLen + 0.04, fasciaH, T),
 mat,
 );
 const xD0 = xEaveDrip;
 const xD1 = xRidge;
 fascia.position.set(
 (xD0 + xD1) / 2,
 (yDripAt(xD0) + yDripAt(xD1)) / 2 - fasciaH * 0.42,
 end.zDrip + end.oz * (T * 0.35),
 );
 fascia.rotation.z = angSign * dripAng;
 fascia.castShadow = true;
 group.add(fascia);

 // ── 3) Soffit pan under gable OH (wall outer → drip) ──
 const panDepth = Math.max(oh + out, 0.2);
 const pan = new THREE.Mesh(
 new THREE.BoxGeometry(dripLen * 0.98, lipThk, panDepth),
 mat,
 );
 pan.position.set(
 (xEaveDrip + xRidge) / 2,
 (yDripAt(xEaveDrip) + yDripAt(xRidge)) / 2 - nest - lipThk * 0.5,
 end.zWall + end.oz * (out + panDepth * 0.5 - T * 0.25),
 );
 pan.rotation.z = angSign * dripAng;
 pan.castShadow = true;
 group.add(pan);
 }

 // Peak join — same visual weight as ridge-end on SB
 const peak = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.12, T * 1.2), mat);
 peak.position.set(
 W / 2,
 H + rise + 0.06,
 end.zDrip + end.oz * (T * 0.2),
 );
 group.add(peak);
 }
 }

 // ── Vertical corner trim — ONE formed L-piece per corner (SB style) ──
 // Single extruded L profile (not two boxes with a gap). Outer faces sit at
 // `out`; legs run along each wall into the building; top flush with eave band.
 const corners = [
 { x: 0, z: 0, ox: -1, oz: -1, walls: ['front', 'left'] },
 { x: W, z: 0, ox: 1, oz: -1, walls: ['front', 'right'] },
 { x: 0, z: L, ox: -1, oz: 1, walls: ['back', 'left'] },
 { x: W, z: L, ox: 1, oz: 1, walls: ['back', 'right'] },
 ];
 // Shared L geometry: legs in +X (gable-into) and +Z (eave-into), bottom y=0
 const lGeo = this._cornerLGeometry(leg, T, cornerH);
 // Negative scale flips winding — use double-side so it still shades
 const cornerMat = mat.clone();
 cornerMat.side = THREE.DoubleSide;
 for (const c of corners) {
 if (c.walls.every((w) => isWallOpen(b, w))) continue;
 const eaveClosed = !isWallOpen(b, c.walls[1]); // left / right
 const gableClosed = !isWallOpen(b, c.walls[0]); // front / back
 const alongEave = -c.oz; // +Z from front, −Z from back
 const alongGable = -c.ox; // +X from left, −X from right

 if (eaveClosed && gableClosed) {
 // Full L — one solid formed corner piece
 const mesh = new THREE.Mesh(lGeo, cornerMat);
 // Outer corner of the L sits at building-line ± out
 mesh.position.set(c.x + c.ox * out, cornerBot, c.z + c.oz * out);
 // Map local +X → along gable, local +Z → along eave
 mesh.scale.set(alongGable, 1, alongEave);
 mesh.castShadow = true;
 group.add(mesh);
 } else if (eaveClosed) {
 // Only eave wall closed — flat strip on that face
 const strip = new THREE.Mesh(new THREE.BoxGeometry(T, cornerH, leg), mat);
 strip.position.set(outerX(c.x, c.ox), cornerMidY, c.z + alongEave * (leg * 0.5));
 strip.castShadow = true;
 group.add(strip);
 } else if (gableClosed) {
 const strip = new THREE.Mesh(new THREE.BoxGeometry(leg, cornerH, T), mat);
 strip.position.set(c.x + alongGable * (leg * 0.5), cornerMidY, outerZ(c.z, c.oz));
 strip.castShadow = true;
 group.add(strip);
 }
 }
 }

 /**
   * Single solid L-profile for corner trim (plan view extruded to height).
   * Local: outer corner at (0,0,0), legs along +X and +Z, height +Y.
   * Thickness T sits inside the L (toward +X/+Z from the outer faces).
   */
 _cornerLGeometry(leg, T, height) {
 const shape = new THREE.Shape();
 // Outer corner at origin; outer faces on the u=0 and v=0 edges
 shape.moveTo(0, 0);
 shape.lineTo(leg, 0); // outer edge along gable wall
 shape.lineTo(leg, T); // end of gable leg
 shape.lineTo(T, T); // inner corner of the L
 shape.lineTo(T, leg); // end of eave leg (inner)
 shape.lineTo(0, leg); // end of eave leg (outer)
 shape.lineTo(0, 0);
 const geo = new THREE.ExtrudeGeometry(shape, {
 depth: height,
 bevelEnabled: false,
 steps: 1,
 curveSegments: 1,
 });
 // ExtrudeGeometry: shape in XY, depth +Z → stand up so depth is +Y
 // (x,y,z) → (x, z, -y) via rotateX(-90°)
 geo.rotateX(-Math.PI / 2);
 // After rotate: shape v mapped to −Z; flip Z so legs run +X and +Z
 geo.scale(1, 1, -1);
 geo.computeVertexNormals();
 return geo;
 }



 /**
   * Main gable roof. Ribs // ridge (along building length) — matches target reference.
   */
 _addGableRoof(group, b, W, L, H, rise, oh, wallHex, roofHex) {
 // U = across slope (eave→ridge), V = along eave — texture ribs run // ridge
 const roofMat = this._agPanelMat(roofHex, W / 2 + oh, L + oh * 2, {
 metalness: 0.88,
 roughness: 0.26,
 normalStrength: 1.75,
 side: THREE.DoubleSide,
 });

 // Left slope: eave-front → ridge-front → ridge-back → eave-back
 this._addRoofQuad(
 group,
 [
 [-oh, H, -oh],
 [W / 2, H + rise, -oh],
 [W / 2, H + rise, L + oh],
 [-oh, H, L + oh],
 ],
 roofMat,
 false,
 'eave',
 );
 // Right slope
 this._addRoofQuad(
 group,
 [
 [W + oh, H, -oh],
 [W / 2, H + rise, -oh],
 [W / 2, H + rise, L + oh],
 [W + oh, H, L + oh],
 ],
 roofMat,
 true,
 'eave',
 );

 // Geometric ribs // ridge (along L)
 this._addRoofSurfaceRibs(group, b, W, L, H, rise, oh, roofHex, 'gable');

 this._addGableEndUpperMetal(group, b, W, L, H, rise, wallHex);
 }

 /**
   * Roof line height on a gable end at horizontal position x (0..W).
   * Peak at W/2, eave height H at both corners.
   */
 _gableRoofYAt(x, W, H, rise) {
 const t = 1 - (2 * Math.abs(x - W / 2)) / Math.max(W, 0.01);
 return H + rise * Math.max(0, Math.min(1, t));
 }

 /**
   * Metal above the eave on front/back gable ends.
   *
   * Built as a thick prism (same 0.16' as wall panels) on the same z-plane,
   * with UVs in absolute feet so rib phase continues from the wall below:
   *   tex_u = x/3, tex_v = y/8  (same as lower wall BoxGeometry + worldU0/V0).
   * Ribs use the exact same placement as _addAgRibs and run continuously
   * through the eave (closed: grade→peak, open: eave→peak).
   */
 _addGableEndUpperMetal(group, b, W, L, H, rise, wallHex) {
 if (rise < 0.25) return;
 const thick = 0.16;
 const peakY = H + rise;
 for (const [wall, z] of [
 ['front', 0.05],
 ['back', L - 0.05],
 ]) {
 const wallOpen = isWallOpen(b, wall);
 // Closed: slight overlap into lower wall; open: sit on eave line
 const yBot = wallOpen ? H : H - 0.05;
 const openings = (b.openings || []).filter(
 (o) => (!o.host || o.host === 'main') && o.wall === wall,
 );

 // Material: UV 0..1 maps to full building width × full height-to-peak,
 // so phase at any world (x,y) matches lower wall panels.
 const mat = this._agPanelMat(
 wallHex,
 W,
 peakY,
 this._wallPanelOpts({
 worldU0: 0,
 worldV0: 0,
 side: THREE.DoubleSide,
 }),
 );

 // Thick triangle prism — same depth as wall boxes, centered on wall plane.
 // UVs match Three.js BoxGeometry exterior faces:
 // front (-Z): U is mirrored (udir=-1) → uv.x = 1 - x/W
 // back (+Z): U is normal → uv.x = x/W
 // V: uv.y = y/peakY with mat ftAlong=peakY → tex_v = y/8 (same as lower wall)
 const half = thick / 2;
 const ring = [
 [0, yBot],
 [W, yBot],
 [W / 2, peakY + 0.04],
 ];
 const isFront = wall === 'front';
 const positions = [];
 const uvs = [];
 // Non-indexed so each face can have correct UVs (no shared-vert UV conflicts)
 const pushTri = (a, b, c, mirrorU) => {
 for (const p of [a, b, c]) {
 const [x, y, zz] = p;
 positions.push(x, y, zz);
 const u = mirrorU ? 1 - x / W : x / W;
 uvs.push(u, y / peakY);
 }
 };
 // Exterior face (what you see from outside)
 if (isFront) {
 // -Z face, mirrored U — verts CCW when looking from -Z (outside)
 pushTri(
 [0, yBot, z - half],
 [W / 2, peakY + 0.04, z - half],
 [W, yBot, z - half],
 true,
 );
 } else {
 // +Z face, normal U — verts CCW when looking from +Z (outside)
 pushTri(
 [0, yBot, z + half],
 [W, yBot, z + half],
 [W / 2, peakY + 0.04, z + half],
 false,
 );
 }
 // Interior face (DoubleSide / interior views)
 if (isFront) {
 pushTri(
 [0, yBot, z + half],
 [W, yBot, z + half],
 [W / 2, peakY + 0.04, z + half],
 false,
 );
 } else {
 pushTri(
 [0, yBot, z - half],
 [W / 2, peakY + 0.04, z - half],
 [W, yBot, z - half],
 true,
 );
 }

 const geo = new THREE.BufferGeometry();
 geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
 geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
 geo.computeVertexNormals();
 const mesh = new THREE.Mesh(geo, mat);
 mesh.castShadow = true;
 mesh.receiveShadow = true;
 mesh.userData = {
 kind: 'wall',
 host: 'main',
 face: 'main',
 buildingId: b.id,
 wall,
 };
 group.add(mesh);

 // Continuous ribs through eave — same formula as lower-wall _addAgRibs
 this._addGableEndRibs(
 group,
 wall,
 W,
 H,
 rise,
 z,
 wallHex,
 wallOpen ? H : 0,
 openings,
 );

 if (wallOpen) {
 const trimHex = this._colorFor(b.trimColor || b.roofColor || 'BK', 0x2a2a2a);
 const bar = new THREE.Mesh(
 new THREE.BoxGeometry(W, 0.16, 0.18),
 this._metalMat(trimHex, { metalness: 0.75, roughness: 0.32 }),
 );
 bar.position.set(W / 2, H + 0.02, z);
 bar.castShadow = true;
 group.add(bar);
 }
 }
 }

 /**
   * Vertical ag ribs on a gable end — same spacing/placement as _addAgRibs for front/back.
   * Each rib runs from yMin to the roof line at that x (continuous through eave).
   */
 _addGableEndRibs(group, wall, W, H, rise, z, hex, yMin, openings = []) {
 if (!this.showMetal) return;
 const ribMetal = this.lite ? 0.08 : 0.85;
 const ribRough = this.lite ? 0.7 : 0.28;
 const majorMat = new THREE.MeshStandardMaterial({
 color: new THREE.Color(hex).offsetHSL(0, 0, 0.06),
 metalness: ribMetal,
 roughness: ribRough,
 });
 const minorMat = new THREE.MeshStandardMaterial({
 color: new THREE.Color(hex).offsetHSL(0, 0, 0.02),
 metalness: this.lite ? 0.06 : 0.8,
 roughness: this.lite ? 0.72 : 0.32,
 });
 const isFront = wall === 'front';
 // Match _addAgRibs front/back placement exactly
 const place = (d, v0, v1, major) => {
 const ht = v1 - v0;
 if (ht < 0.08) return;
 const rib = new THREE.Mesh(
 new THREE.BoxGeometry(major ? 0.14 : 0.07, ht, major ? 0.28 : 0.2),
 major ? majorMat : minorMat,
 );
 rib.position.set(
 d,
 (v0 + v1) / 2,
 z + (isFront ? (major ? 0.12 : 0.1) : major ? -0.12 : -0.1),
 );
 rib.castShadow = true;
 group.add(rib);
 };
 const maxH = H + rise;
 const runRib = (d, major) => {
 const yTop = this._gableRoofYAt(d, W, H, rise);
 // Split around openings (only below eave typically)
 for (const seg of this._ribVerticalSegments(maxH, d, openings)) {
 const lo = Math.max(seg.v0, yMin);
 const hi = Math.min(seg.v1, yTop);
 if (hi - lo > 0.08) place(d, lo, hi, major);
 }
 };
 for (let d = 0; d <= W + 0.01; d += 3) runRib(d, true);
 for (let d = 0.75; d < W; d += 0.75) {
 if (d % 3 < 0.1) continue;
 runRib(d, false);
 }
 }

 _addMonoRoof(group, b, W, L, H, rise, oh, roofHex) {
 // U = across slope, V = along eave — ribs // eave (same language as gable)
 const roofMat = this._agPanelMat(roofHex, W + oh * 2, L + oh * 2, {
 metalness: 0.88,
 roughness: 0.26,
 normalStrength: 1.75,
 side: THREE.DoubleSide,
 });
 this._addRoofQuad(
 group,
 [
 [-oh, H + rise, -oh],
 [W + oh, H, -oh],
 [W + oh, H, L + oh],
 [-oh, H + rise, L + oh],
 ],
 roofMat,
 false,
 'eave',
 );
 this._addRoofSurfaceRibs(group, b, W, L, H, rise, oh, roofHex, 'mono');
 }

 /**
   * Flat roof quad from 4 world-space corners [x,y,z].
   * Auto-flips winding if the face normal points downward so roofs stay visible.
   *
   * @param {'eave'|'downslope'} [uvMode='downslope']
   *   downslope (SB): corners [eaveA, ridgeA, ridgeB, eaveB] → U along eave, V downslope
   *   eave (legacy): U across first edge, V across diagonal edge
   */
 _addRoofQuad(group, corners, mat, flip = false, uvMode = 'downslope') {
 const a = corners[0];
 const b = corners[1];
 const c = corners[2];
 const ex1 = b[0] - a[0];
 const ey1 = b[1] - a[1];
 const ez1 = b[2] - a[2];
 const ex2 = c[0] - a[0];
 const ey2 = c[1] - a[1];
 const ez2 = c[2] - a[2];
 // n = e1 × e2; n.y = ez1*ex2 - ex1*ez2
 const nY = ez1 * ex2 - ex1 * ez2;
 let useFlip = flip;
 if (nY < -1e-8) useFlip = !flip;

 const geo = new THREE.BufferGeometry();
 const flat = [];
 for (const corner of corners) flat.push(corner[0], corner[1], corner[2]);
 geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(flat), 3));
 // downslope UV: c0(0,0) c1(0,1) c2(1,1) c3(1,0) — V = eave→ridge, U along eave
 // legacy eave UV: c0(0,0) c1(1,0) c2(1,1) c3(0,1)
 const uvs =
 uvMode === 'eave'
 ? new Float32Array([0, 0, 1, 0, 1, 1, 0, 1])
 : new Float32Array([0, 0, 0, 1, 1, 1, 1, 0]);
 geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
 geo.setIndex(useFlip ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3]);
 geo.computeVertexNormals();
 let roofMat = mat;
 if (roofMat && roofMat.side !== THREE.DoubleSide) {
 roofMat = roofMat.clone();
 roofMat.side = THREE.DoubleSide;
 }
 const mesh = new THREE.Mesh(geo, roofMat);
 mesh.castShadow = true;
 mesh.receiveShadow = true;
 group.add(mesh);
 return mesh;
 }

 /**
   * Raised roof ribs // ridge (along building length), spaced down the slope.
   * Matches target reference main + gable lean metal language.
   */
 _addRoofSurfaceRibs(group, b, W, L, H, rise, oh, roofHex, style) {
 const ribMat = this._metalMat(new THREE.Color(roofHex).offsetHSL(0, 0, 0.08).getHex(), {
 metalness: 0.9,
 roughness: 0.25,
 });
 const along = L + oh * 2;
 if (style === 'gable') {
 for (const side of [-1, 1]) {
 const half = W / 2 + oh;
 const steps = Math.max(4, Math.floor(half / 0.75));
 const tMax = Math.max(0.7, 1 - 0.9 / Math.max(half, 0.01));
 for (let i = 0; i <= steps; i++) {
 const t = i / steps;
 if (t > tMax) continue;
 const x = side < 0 ? -oh + t * (W / 2 + oh) : W + oh - t * (W / 2 + oh);
 const y = H + t * rise + 0.05;
 const rib = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, along * 0.98), ribMat);
 rib.position.set(x, y, L / 2);
 const ang = Math.atan2(rise, W / 2 + oh);
 rib.rotation.z = side < 0 ? ang : -ang;
 group.add(rib);
 }
 }
 } else {
 const span = W + oh * 2;
 const steps = Math.max(4, Math.floor(span / 0.75));
 for (let i = 0; i <= steps; i++) {
 const t = i / steps;
 const x = -oh + t * span;
 const y = H + rise * (1 - t) + 0.05;
 const rib = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, along * 0.98), ribMat);
 rib.position.set(x, y, L / 2);
 rib.rotation.z = -Math.atan2(rise, span);
 group.add(rib);
 }
 }
 }

 /**
   * Premium walk doors & windows for estimate screenshots.
   * Drawn proud of the wall in the metal cutout so they always read clearly.
   * Used for both main building and enclosed lean-to openings.
   */
 _addOpening(group, b, o) {
 const pos = this._openingWorldPos(b, o, 0.22);
 this._mountOpeningVisual(group, b, o, {
 position: pos.position,
 rotationY: pos.rotationY,
 wallLength: wallLength(b, o.wall),
 host: o.host || 'main',
 face: o.face || 'main',
 wall: o.wall,
 });
 }

 /**
   * Shared premium opening mesh (void + casing + door/window + label + hit target).
   * Local +Z of the group always faces outward from the wall.
   */
 _mountOpeningVisual(group, b, o, opts) {
 const selected = o.id === this.selectedOpeningId;
 const w = Math.max(0.5, Number(o.width) || 3) * FT;
 const h = Math.max(0.5, Number(o.height) || 7) * FT;
 const type = o.type || 'walk';
 const trimHex = this._colorFor(b.trimColor || b.roofColor || 'BK', 0xf2f0ea);

 const g = new THREE.Group();
 g.position.copy(opts.position);
 g.rotation.y = opts.rotationY;
 g.renderOrder = 20;
 g.userData = { kind: 'opening-root', openingId: o.id };

 // Dark opening throat (reads as hole through wall)
 const voidMesh = new THREE.Mesh(
 new THREE.BoxGeometry(w * 0.98, h * 0.98, 0.55),
 new THREE.MeshStandardMaterial({
 color: 0x0a0a0e,
 roughness: 1,
 metalness: 0,
 side: THREE.DoubleSide,
 }),
 );
 voidMesh.position.z = -0.12;
 voidMesh.renderOrder = 18;
 g.add(voidMesh);

 // Brickmold / exterior casing
 const caseCol = selected ? 0xf59e0b : trimHex;
 const caseMat = new THREE.MeshStandardMaterial({
 color: caseCol,
 metalness: 0.55,
 roughness: 0.35,
 emissive: selected ? 0x5c2a00 : 0x000000,
 emissiveIntensity: selected ? 0.25 : 0,
 });
 const caseT = 0.16;
 const caseD = 0.42;
 for (const sx of [-w / 2 - caseT / 2, w / 2 + caseT / 2]) {
 const j = new THREE.Mesh(new THREE.BoxGeometry(caseT, h + caseT * 2.2, caseD), caseMat);
 j.position.set(sx, 0, 0.08);
 j.castShadow = true;
 g.add(j);
 }
 const head = new THREE.Mesh(new THREE.BoxGeometry(w + caseT * 2.2, caseT, caseD), caseMat);
 head.position.set(0, h / 2 + caseT / 2, 0.08);
 g.add(head);
 const sillP = new THREE.Mesh(
 new THREE.BoxGeometry(w + caseT * 2.4, caseT * 0.85, caseD + 0.08),
 caseMat,
 );
 sillP.position.set(0, -h / 2 - caseT * 0.4, 0.12);
 g.add(sillP);

 if (type === 'window') {
 const vinyl = new THREE.MeshStandardMaterial({
 color: 0xf5f5f2,
 roughness: 0.4,
 metalness: 0.08,
 });
 const frameIn = 0.1;
 const sash = new THREE.Mesh(new THREE.BoxGeometry(w * 0.88, h * 0.88, 0.12), vinyl);
 sash.position.z = 0.14;
 g.add(sash);
 const glassMat = new THREE.MeshStandardMaterial({
 color: 0x9ec9e8,
 metalness: 0.15,
 roughness: 0.08,
 transparent: true,
 opacity: 0.55,
 emissive: 0x1a4060,
 emissiveIntensity: 0.18,
 });
 const gh = (h * 0.88 - frameIn * 3) / 2;
 const gw = w * 0.88 - frameIn * 2;
 const g1 = new THREE.Mesh(new THREE.BoxGeometry(gw, gh, 0.04), glassMat);
 g1.position.set(0, gh / 2 + frameIn * 0.5, 0.2);
 g.add(g1);
 const g2 = new THREE.Mesh(new THREE.BoxGeometry(gw, gh, 0.04), glassMat);
 g2.position.set(0, -gh / 2 - frameIn * 0.5, 0.2);
 g.add(g2);
 const rail = new THREE.Mesh(new THREE.BoxGeometry(gw + 0.04, frameIn, 0.1), vinyl);
 rail.position.set(0, 0, 0.19);
 g.add(rail);
 const glint = new THREE.Mesh(
 new THREE.BoxGeometry(gw * 0.35, gh * 0.7, 0.02),
 new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.15 }),
 );
 glint.position.set(-gw * 0.2, gh * 0.15, 0.23);
 g.add(glint);
 } else if (type === 'walk') {
 const doorCol = selected ? 0xc45a20 : this._colorFor(b.trimColor || 'BK', 0x2c2c30);
 const doorSkin = new THREE.MeshStandardMaterial({
 color: doorCol,
 metalness: 0.45,
 roughness: 0.4,
 });
 const door = new THREE.Mesh(new THREE.BoxGeometry(w * 0.9, h * 0.93, 0.12), doorSkin);
 door.position.z = 0.15;
 door.castShadow = true;
 g.add(door);
 const groove = new THREE.MeshStandardMaterial({
 color: new THREE.Color(doorCol).offsetHSL(0, 0, -0.12),
 metalness: 0.4,
 roughness: 0.5,
 });
 const panelW = w * 0.72;
 const panelH = h * 0.28;
 for (const py of [h * 0.22, -h * 0.08, -h * 0.35]) {
 const panel = new THREE.Mesh(new THREE.BoxGeometry(panelW, panelH, 0.04), groove);
 panel.position.set(0, py, 0.22);
 g.add(panel);
 const rim = new THREE.Mesh(
 new THREE.BoxGeometry(panelW * 0.92, panelH * 0.88, 0.02),
 new THREE.MeshStandardMaterial({
 color: new THREE.Color(doorCol).offsetHSL(0, 0, 0.08),
 metalness: 0.5,
 roughness: 0.35,
 }),
 );
 rim.position.set(0, py, 0.24);
 g.add(rim);
 }
 const brass = new THREE.MeshStandardMaterial({
 color: 0xc9a227,
 metalness: 0.9,
 roughness: 0.22,
 });
 const plate = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.55, 0.04), brass);
 plate.position.set(w * 0.28, 0, 0.28);
 g.add(plate);
 const lever = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.06, 0.06), brass);
 lever.position.set(w * 0.28 + 0.08, 0.05, 0.32);
 g.add(lever);
 const deadbolt = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.06, 12), brass);
 deadbolt.rotation.x = Math.PI / 2;
 deadbolt.position.set(w * 0.28, 0.22, 0.3);
 g.add(deadbolt);
 } else if (type === 'overhead' || type === 'slider') {
 const doorCol = selected ? 0xc45a20 : this._colorFor(b.trimColor || 'SL', 0x3a3a40);
 const doorMat = new THREE.MeshStandardMaterial({
 color: doorCol,
 roughness: 0.42,
 metalness: 0.4,
 });
 const door = new THREE.Mesh(new THREE.BoxGeometry(w * 0.94, h * 0.94, 0.14), doorMat);
 door.position.z = 0.14;
 door.castShadow = true;
 g.add(door);
 const lineMat = new THREE.MeshStandardMaterial({
 color: new THREE.Color(doorCol).offsetHSL(0, 0, -0.15),
 roughness: 0.55,
 });
 const panels = 5;
 for (let i = 1; i < panels; i++) {
 const y = -h * 0.47 + (i / panels) * h * 0.94;
 const line = new THREE.Mesh(new THREE.BoxGeometry(w * 0.9, 0.05, 0.16), lineMat);
 line.position.set(0, y, 0.2);
 g.add(line);
 }
 const hnd = new THREE.Mesh(
 new THREE.BoxGeometry(0.35, 0.08, 0.08),
 new THREE.MeshStandardMaterial({ color: 0x222226, metalness: 0.7, roughness: 0.3 }),
 );
 hnd.position.set(0, -h * 0.15, 0.26);
 g.add(hnd);
 } else {
 const fill = new THREE.Mesh(
 new THREE.BoxGeometry(w * 0.9, h * 0.9, 0.1),
 new THREE.MeshStandardMaterial({ color: 0x222226, roughness: 0.6 }),
 );
 fill.position.z = 0.12;
 g.add(fill);
 }

 {
 const sizeTxt =
 type === 'walk'
 ? `WALK ${formatOpeningLabel(o.width, o.height)}`
 : type === 'window'
 ? `WIN ${formatOpeningLabel(o.width, o.height)}`
 : `OH ${formatOpeningLabel(o.width, o.height)}`;
 const label = this._makeOpeningLabel(sizeTxt);
 label.position.set(0, h / 2 + 0.55, 0.4);
 if (!selected) label.scale.set(4.2, 1.05, 1);
 else label.scale.set(5.5, 1.4, 1);
 g.add(label);
 }

 const hit = new THREE.Mesh(
 new THREE.BoxGeometry(w, h, 0.55),
 new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
 );
 hit.userData = {
 kind: 'opening',
 buildingId: b.id,
 openingId: o.id,
 host: opts.host || o.host || 'main',
 face: opts.face || o.face || 'main',
 wall: opts.wall || o.wall,
 wallLength: opts.wallLength,
 width: o.width,
 };
 g.add(hit);
 this.openingMeshes.push(hit);
 g.traverse((obj) => {
 if (obj.isMesh) {
 obj.castShadow = true;
 obj.frustumCulled = false;
 }
 });
 group.add(g);
 }

 _makeOpeningLabel(text) {
 const canvas = document.createElement('canvas');
 canvas.width = 384;
 canvas.height = 96;
 const ctx = canvas.getContext('2d');
 ctx.fillStyle = 'rgba(12,8,18,0.88)';
 ctx.fillRect(12, 16, 360, 64);
 ctx.strokeStyle = '#e8871a';
 ctx.lineWidth = 4;
 ctx.strokeRect(12, 16, 360, 64);
 ctx.fillStyle = '#f5b942';
 ctx.font = 'bold 34px Segoe UI, Arial, sans-serif';
 ctx.textAlign = 'center';
 ctx.textBaseline = 'middle';
 ctx.fillText(text, 192, 48);
 const tex = new THREE.CanvasTexture(canvas);
 setTextureColorSpace(tex, true);
 const spr = new THREE.Sprite(
 new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }),
 );
 spr.scale.set(5.5, 1.4, 1);
 spr.renderOrder = 20;
 return spr;
 }

 /**
   * Center of opening on exterior of wall.
   * Local +Z of the opening group always faces outward.
   * @param {number} outFromWall — how far outside wall face (ft)
   */
 _openingWorldPos(b, o, outFromWall = 0.22) {
 const W = b.width * FT;
 const L = b.length * FT;
 const sill = Number(o.sillHeight) || 0;
 const oh = Math.max(0.5, Number(o.height) || 7);
 const ow = Math.max(0.5, Number(o.width) || 3);
 const y = (sill + oh / 2) * FT;
 const mid = (Number(o.offset) || 0) + ow / 2;
 const out = outFromWall;
 let x = 0;
 let z = 0;
 // Face outward: local +Z → exterior
 // front (z=0): outward −Z → rot Y = π
 // back (z=L): outward +Z → rot Y = 0
 // left (x=0): outward −X → rot Y = −π/2
 // right (x=W): outward +X → rot Y = +π/2
 let rotationY = 0;
 if (o.wall === 'front') {
 x = mid * FT;
 z = -out; // just outside front face (wall sits near z≈0)
 rotationY = Math.PI;
 } else if (o.wall === 'back') {
 x = mid * FT;
 z = L + out;
 rotationY = 0;
 } else if (o.wall === 'left') {
 x = -out;
 z = mid * FT;
 rotationY = -Math.PI / 2;
 } else {
 x = W + out;
 z = mid * FT;
 rotationY = Math.PI / 2;
 }
 return { position: new THREE.Vector3(x, y, z), rotationY };
 }

 /**
   * Full lean-to: structure when framing on / skin off; metal only when showMetal.
   * Enclosed walls when enclosed + metal on.
   */
 _addLeanTo(group, b, lt, wallMat, roofMat) {
 const framing = generateFraming(b);
 const pkg = framing.leanPackages.find((p) => p.lean.id === lt.id);
 if (!pkg) {
 console.warn('Lean-to package missing for', lt.id);
 return;
 }

 const H = Math.max(0.5, (lt.eaveHeight || 10) * FT);
 const mainH = Math.max(H, (b.eaveHeight || 12) * FT);
 const { outerStart, outerEnd, innerStart, innerEnd, length, depth } = pkg;
 if (!(length > 0.1) || !(depth > 0.1)) {
 console.warn('Lean-to has zero length/depth', lt);
 return;
 }

 const isSide = lt.wall === 'left' || lt.wall === 'right';
 const isGable = (lt.roofStyle || 'shed') === 'gable';
 const enclosed = lt.enclosed !== false && this.showMetal !== false;
 const ridgeRise = isGable ? (length / 2) * ((lt.pitch || 3) / 12) * FT : 0;
 // Match engineering attach height (under main eave when lean is lower)
 const attachFt = isGable
 ? Math.max(b.eaveHeight || 12, lt.eaveHeight || 10)
 : leanToAttachHeight(b, lt);
 const attachH = attachFt * FT;
 const sideWallH = isGable ? H + ridgeRise : Math.max(H, attachH);

 // Push geometry slightly off the main wall face to avoid z-fighting main metal
 const outNudge = 0.12; // ft outward from main wall
 const nudge = (p) => {
 if (lt.wall === 'left') return { x: p.x - outNudge, z: p.z };
 if (lt.wall === 'right') return { x: p.x + outNudge, z: p.z };
 if (lt.wall === 'front') return { x: p.x, z: p.z - outNudge };
 return { x: p.x, z: p.z + outNudge }; // back
 };
 // Only nudge the inner (main-wall) edge for roof/wall attach
 const i1 = nudge(innerStart);
 const i2 = nudge(innerEnd);
 const o1 = outerStart;
 const o2 = outerEnd;

 // Roof overhang past outer posts (frame + metal inches → ft).
 // Also project past lean END walls so the eave edge reads clearly past posts.
 const ohFt = Math.max(0, leanToOverhangFt(lt, b));
 const outerDir = {
 x: o1.x - innerStart.x,
 z: o1.z - innerStart.z,
 };
 const odLen = Math.hypot(outerDir.x, outerDir.z) || 1;
 const oxu = outerDir.x / odLen;
 const ozu = outerDir.z / odLen;
 // Unit vector along outer eave (length of lean)
 const alongLen = Math.hypot(o2.x - o1.x, o2.z - o1.z) || 1;
 const axu = (o2.x - o1.x) / alongLen;
 const azu = (o2.z - o1.z) / alongLen;
 // Side/rake overhang past end walls (same total OH as outer eave for a clean box eave)
 const sideOh = ohFt;
 // Outer eave line PAST posts, and past both ends
 const o1x = o1.x + oxu * ohFt - axu * sideOh;
 const o1z = o1.z + ozu * ohFt - azu * sideOh;
 const o2x = o2.x + oxu * ohFt + axu * sideOh;
 const o2z = o2.z + ozu * ohFt + azu * sideOh;
 // Inner (main-wall) edge also gets side OH so rakes align
 const i1x = i1.x - axu * sideOh;
 const i1z = i1.z - azu * sideOh;
 const i2x = i2.x + axu * sideOh;
 const i2z = i2.z + azu * sideOh;

 // Roof / end-wall heights for THIS lean (e.g. 12' deep · 10' eave · 4/12 on 14' main
 // → outer 10', attach min(14, 10+4)=14' — end walls must rake 14' → 10')
 const pitchRatio = (Number(lt.pitch) || 3) / 12;
 const geoRise = depth * pitchRatio * FT; // 12 * 4/12 = 4'
 const hAtOuter = H; // 10' outer eave
 // Pure pitch attach (not flat): outer + rise, capped at main eave
 let hAtMain = isGable
 ? Math.max(H, attachH)
 : Math.min(mainH, hAtOuter + geoRise);
 // Never flatter than 6" of rake on a pitched shed (avoids “rectangle under roof”)
 if (!isGable && hAtMain < hAtOuter + 0.5 * FT) {
 hAtMain = Math.min(mainH, hAtOuter + Math.max(geoRise, 0.5 * FT));
 }

 // Concrete under lean footprint (optional, independent of main hasSlab)
 if (lt.hasSlab === true) {
 this._addLeanSlab(group, pkg, lt, b);
 }

 // Structure visibility (SB sales look):
 // - Frame / metal-off: posts + purlins + outer bearer
 // - Skin on + enclosed: metal only (no framing bleed)
 // - Skin on + open carport: posts only (no blue purlins / orange bearer clutter)
 const frameOnly = this.showFraming || this.showMetal === false;
 const showLeanPosts = frameOnly || !enclosed;
 const showLeanPurlins = frameOnly;
 if (showLeanPosts) {
 this._addLeanPosts(group, pkg, b, lt);
 if (frameOnly) {
 this._addLeanOuterBearer(group, outerStart, outerEnd, H, isSide);
 }
 }

 // Wall thickness & corner miter (ft) — end walls meet outer wall edge-to-edge
 const wallThick = 0.16;
 const cornerInset = wallThick; // miter: outer wall stops where end wall thickness starts
 const trimHex = this._colorFor(b.trimColor || b.roofColor || 'BK', 0x2a2a2a);
 const wallHex = this._colorFor(b.wallColor, 0xf2ebe0);
 const roofHex = this._colorFor(b.roofColor, 0x1a1a1a);

 if (enclosed) {
 // Openings on this lean (for metal cutouts + rib skips)
 const leanOpens = (b.openings || []).filter((op) => op.host === lt.id);
 const outerOpens = leanOpens.filter((op) => (op.face || 'outer') === 'outer');
 const outerOpen = isLeanFaceOpen(lt, 'outer');

 // ── Outer eave wall — skip metal if face open (drive-through) ──
 const t0 = cornerInset / Math.max(length, 0.01);
 const t1 = 1 - t0;
 const oa = {
 x: outerStart.x + (outerEnd.x - outerStart.x) * t0,
 z: outerStart.z + (outerEnd.z - outerStart.z) * t0,
 };
 const ob = {
 x: outerStart.x + (outerEnd.x - outerStart.x) * t1,
 z: outerStart.z + (outerEnd.z - outerStart.z) * t1,
 };

 // Always add pick face (open-wall mode + openings when closed)
 {
 const pick = new THREE.Mesh(
 new THREE.BoxGeometry(
 isSide ? 0.12 : length * FT,
 hAtOuter,
 isSide ? length * FT : 0.12,
 ),
 new THREE.MeshBasicMaterial({
 visible: false,
 transparent: true,
 opacity: 0,
 depthWrite: false,
 side: THREE.DoubleSide,
 }),
 );
 pick.position.set(
 ((outerStart.x + outerEnd.x) / 2) * FT,
 hAtOuter / 2,
 ((outerStart.z + outerEnd.z) / 2) * FT,
 );
 pick.userData = {
 kind: 'wall',
 host: lt.id,
 face: 'outer',
 buildingId: b.id,
 wall: lt.wall,
 wallLength: length,
 leanToId: lt.id,
 openWall: outerOpen,
 };
 group.add(pick);
 this.pickables.push(pick);
 }

 // Wainscot (same visual language as main): full wall metal + proud band + trim strip
 // Enclosed lean only — open/carport leans stay main-structure wainscot only
 const wainHft = this._wainscotHeightFt(b, hAtOuter / FT);
 const wainOn = wainHft > 0;
 const wainH = wainOn ? wainHft * FT : 0;
 const wainHex = this._colorFor(b.wainscotColor, 0x1a1a1a);
 // Outward normal for outer lean face (proud overlay like main)
 let outNx = 0;
 let outNz = 0;
 if (lt.wall === 'left') outNx = -1;
 else if (lt.wall === 'right') outNx = 1;
 else if (lt.wall === 'front') outNz = -1;
 else outNz = 1;

 if (!outerOpen) {
 const oux = (outerEnd.x - outerStart.x) / Math.max(length, 0.01);
 const ouz = (outerEnd.z - outerStart.z) / Math.max(length, 0.01);
 const wallHft = hAtOuter / FT;
 const wainTopFt = wainH > 0.25 ? wainH / FT : 0;

 // Outer wall metal — same recipe as main:
 // full wall in wall color, then solid black lower band (base + proud overlay).
 const outerPanels = this._wallSolidPanels(length, wallHft, outerOpens);
 const addOuterPanel = (u0, u1, v0, v1, hex, proud = 0) => {
 const plen = u1 - u0;
 let pht = v1 - v0;
 if (plen < 0.04 || pht < 0.04) return;
 const bury = v0 < 0.15 ? 0.1 : 0;
 pht += bury;
 const uMid = (u0 + u1) / 2;
 const vMid = (v0 + v1) / 2 - bury / 2;
 const cx = (outerStart.x + oux * uMid) * FT + outNx * proud;
 const cz = (outerStart.z + ouz * uMid) * FT + outNz * proud;
 const thick = proud > 0 ? 0.2 : wallThick;
 // Same ag-panel material as main walls; worldU0/V0 keep rib phase continuous
 const panelMat = this._agPanelMat(
 hex,
 Math.max(plen, 2),
 Math.max(pht, 2),
 this._wallPanelOpts({
 worldU0: u0,
 worldV0: Math.max(0, v0),
 side: THREE.DoubleSide,
 }),
 );
 const mesh = new THREE.Mesh(
 new THREE.BoxGeometry(
 isSide ? thick : plen * FT,
 pht * FT,
 isSide ? plen * FT : thick,
 ),
 panelMat,
 );
 mesh.position.set(cx, vMid * FT, cz);
 mesh.castShadow = true;
 mesh.receiveShadow = true;
 mesh.userData = {
 kind: 'wall',
 host: lt.id,
 face: 'outer',
 buildingId: b.id,
 wall: lt.wall,
 wallLength: length,
 leanToId: lt.id,
 };
 group.add(mesh);
 };

 for (const panel of outerPanels) {
 // Full-height wall color (base skin)
 addOuterPanel(panel.u0, panel.u1, panel.v0, panel.v1, wallHex, 0);
 // Solid wainscot band — base flush + slight proud overlay (matches main)
 if (wainTopFt > 0.04 && panel.v0 < wainTopFt - 0.02) {
 const v1 = Math.min(panel.v1, wainTopFt);
 if (v1 - panel.v0 >= 0.04) {
 // Flush black base so band reads continuous even without overlay
 addOuterPanel(panel.u0, panel.u1, panel.v0, v1, wainHex, 0);
 // Proud overlay like main (0.04' out, 0.2' thick)
 addOuterPanel(panel.u0, panel.u1, panel.v0, v1, wainHex, 0.04);
 }
 }
 }

 // Vertical ribs: wall color only ABOVE wainscot (main lower band is solid black panel)
 this._addLeanFaceRibs(
 group,
 outerStart,
 outerEnd,
 hAtOuter,
 lt.wall,
 wallHex,
 outerOpens,
 wainTopFt,
 );

 // Transition strip along top of wainscot (trim color) — same as main
 if (wainH > 0.25) {
 this._addLeanWainscotTrimStrip(
 group,
 outerStart,
 outerEnd,
 wainH,
 trimHex,
 outNx,
 outNz,
 outerOpens,
 length,
 );
 }

 // Wall-cap strip only if no roof overhang (OH fascia is drawn at the eave edge)
 if (ohFt < 0.04) {
 this._addLeanFasciaStrip(group, oa, ob, hAtOuter - 0.05, isSide, trimHex);
 }
 }

 // ── END walls — same ag panel as main (rake trap + continuous UV + ribs) ──
 for (const [face, aInRaw, aOutRaw] of [
 ['leftEnd', innerStart, outerStart],
 ['rightEnd', innerEnd, outerEnd],
 ]) {
 const faceOpen = isLeanFaceOpen(lt, face);
 const aIn = nudge(aInRaw);
 const aOut = { x: aOutRaw.x, z: aOutRaw.z };
 const pickH = Math.max(hAtMain, hAtOuter);
 const sx = ((aInRaw.x + aOutRaw.x) / 2) * FT;
 const sz = ((aInRaw.z + aOutRaw.z) / 2) * FT;
 const alongDepthX = Math.abs(aOutRaw.x - aInRaw.x) >= Math.abs(aOutRaw.z - aInRaw.z);
 const pick = new THREE.Mesh(
 new THREE.BoxGeometry(
 alongDepthX ? depth * FT : 0.14,
 pickH,
 alongDepthX ? 0.14 : depth * FT,
 ),
 new THREE.MeshBasicMaterial({
 visible: false,
 transparent: true,
 opacity: 0,
 depthWrite: false,
 side: THREE.DoubleSide,
 }),
 );
 pick.position.set(sx, pickH / 2, sz);
 pick.userData = {
 kind: 'wall',
 host: lt.id,
 face,
 buildingId: b.id,
 wall: lt.wall,
 wallLength: depth,
 leanToId: lt.id,
 openWall: faceOpen,
 };
 group.add(pick);
 this.pickables.push(pick);

 if (faceOpen) continue;

 // Outward normal for end face
 let enx = 0;
 let enz = 0;
 if (lt.wall === 'left' || lt.wall === 'right') {
 enx = 0;
 enz = face === 'leftEnd' ? -1 : 1;
 } else {
 enx = face === 'leftEnd' ? -1 : 1;
 enz = 0;
 }

 // Full rake wall in wall color — same panel material as main (continuous UV)
 // When wainscot on: metal from grade (wainscot overlays lower band like main)
 this._addLeanEndWallRake(
 group,
 aIn,
 aOut,
 hAtMain,
 hAtOuter,
 null,
 {
 kind: 'wall',
 host: lt.id,
 face,
 buildingId: b.id,
 wall: lt.wall,
 wallLength: depth,
 leanToId: lt.id,
 },
 0, // full height base metal (wainscot overlays like main walls)
 wallHex,
 enx,
 enz,
 );

 // Proud wainscot band + trim (same visual language as main)
 if (wainH > 0.25) {
 const endWainMat = this._agPanelMat(
 wainHex,
 Math.max(depth, 8),
 Math.max(wainH / FT, 2),
 this._wallPanelOpts({
 worldU0: 0,
 worldV0: 0,
 side: THREE.DoubleSide,
 }),
 );
 this._addLeanEndWainscotRect(
 group,
 aInRaw,
 aOutRaw,
 wainH,
 endWainMat,
 enx,
 enz,
 alongDepthX,
 depth,
 );
 this._addLeanWainscotTrimStrip(
 group,
 aInRaw,
 aOutRaw,
 wainH,
 trimHex,
 enx,
 enz,
 [],
 depth,
 );
 }

 // Ribs: wall color above wainscot only (lower band is solid black panel like main)
 this._addLeanRakeRibs(
 group,
 aIn,
 aOut,
 hAtMain,
 hAtOuter,
 wallHex,
 lt.wall,
 face,
 wainH > 0.25 ? wainH / FT : 0,
 );
 }
 } else {
 // Open lean-to: invisible pick faces for openings (no cast shadow)
 const invis = new THREE.MeshBasicMaterial({
 visible: false,
 transparent: true,
 opacity: 0,
 depthWrite: false,
 side: THREE.DoubleSide,
 });
 const faces = [
 ['outer', outerStart, outerEnd, length, H],
 ['leftEnd', innerStart, outerStart, depth, sideWallH],
 ['rightEnd', innerEnd, outerEnd, depth, sideWallH],
 ];
 for (const [face, a, c, wallLen, ht] of faces) {
 const sx = ((a.x + c.x) / 2) * FT;
 const sz = ((a.z + c.z) / 2) * FT;
 const alongSide = face === 'outer' ? isSide : !isSide;
 const mesh = new THREE.Mesh(
 new THREE.BoxGeometry(
 alongSide ? 0.12 : wallLen * FT,
 ht,
 alongSide ? wallLen * FT : 0.12,
 ),
 invis,
 );
 mesh.position.set(sx, ht / 2, sz);
 mesh.castShadow = false;
 mesh.receiveShadow = false;
 mesh.userData = {
 kind: 'wall',
 host: lt.id,
 face,
 buildingId: b.id,
 wall: lt.wall,
 wallLength: wallLen,
 leanToId: lt.id,
 };
 group.add(mesh);
 this.pickables.push(mesh);
 }
 }

 // Framing under lean roof — frame view only (not sales skin).
 if (showLeanPurlins) {
 this._addLeanPurlins(group, i1, i2, o1, o2, hAtMain, hAtOuter, depth, length);
 }

 // Roof metal + trim only when skin is on
 if (this.showMetal === false) {
 return;
 }

 // Roof plan corners (include side OH past ends for a clean box eave like SB)
 const rI1 = { x: i1x, z: i1z };
 const rI2 = { x: i2x, z: i2z };
 const rO1 = { x: o1x, z: o1z };
 const rO2 = { x: o2x, z: o2z };
 const eaveA = { x: o1x, z: o1z };
 const eaveB = { x: o2x, z: o2z };

 // Roof heights
 const roofYIn = (isGable ? Math.max(mainH, H) : hAtMain) + 0.02;
 const slopeOut =
 depth > 0.05 ? ((hAtOuter - hAtMain) / depth) * FT : 0;
 const roofYOutTip = hAtOuter + slopeOut * ohFt + 0.02;

 if (!isGable) {
 // Shed mono — SB lean: ribs attach→outer (90° from main roof).
 this._addLeanRoofPlane(
 group,
 rI1,
 rI2,
 rO1,
 rO2,
 roofYIn,
 roofYOutTip,
 roofYIn,
 roofYOutTip,
 roofHex,
 depth + ohFt * 2,
 length + sideOh * 2,
 );
 // Lean eave trim package (SB): vertical drip faces OUTSIDE roof edges,
 // high-edge fascia connects up into main eave.
 {
 const outNx = (o1x - i1x) / (Math.hypot(o1x - i1x, o1z - i1z) || 1);
 const outNz = (o1z - i1z) / (Math.hypot(o1x - i1x, o1z - i1z) || 1);
 // Unit along eave (lean length); end-outward for each rake = ±along × out
 const alongLen = Math.hypot(o2x - o1x, o2z - o1z) || 1;
 const axN = (o2x - o1x) / alongLen;
 const azN = (o2z - o1z) / alongLen;
 this._addLeanTransitionFlash(group, i1, i2, roofYIn, isSide, trimHex, {
 mainEaveY: mainH,
 wall: lt.wall,
 });
 this._addLeanOuterEaveFascia(group, eaveA, eaveB, roofYOutTip, trimHex, {
 outNx,
 outNz,
 });
 // Rake at end A (i1/o1): outward is -along; end B: +along
 this._addLeanRakeFasciaEdge(group, rI1, rO1, roofYIn, roofYOutTip, trimHex, {
 endNx: -axN,
 endNz: -azN,
 });
 this._addLeanRakeFasciaEdge(group, rI2, rO2, roofYIn, roofYOutTip, trimHex, {
 endNx: axN,
 endNz: azN,
 });
 }
 } else {
 // Gable lean (SB top-down reference): lean peak sits ON the main roof eave
 // metal — flush with roof surface, not hanging under the overhang/sidewall.
 // Ridge runs outer peak → onto main roof. No under-eave T-joint.
 const halfW = length / 2 || 1;
 const pitch = Number(lt.pitch) || 3;
 const gableRise = halfW * (pitch / 12) * FT;
 const mainOhFt =
 ((Number(b.metalOverhangIn) ?? 3) + (Number(b.overhangIn) || 0)) / 12;
 const mainRise = roofRise(b) * FT;
 const Wft = (Number(b.width) || 40) * FT;
 const Lft = (Number(b.length) || 40) * FT;
 const outNx = (o1x - i1x) / (Math.hypot(o1x - i1x, o1z - i1z) || 1);
 const outNz = (o1z - i1z) / (Math.hypot(o1x - i1x, o1z - i1z) || 1);
 const al = Math.hypot(o2x - o1x, o2z - o1z) || 1;
 const axN = (o2x - o1x) / al;
 const azN = (o2z - o1z) / al;

 // Main roof surface height at eave tip (top of metal)
 const roofTop = mainH + 0.02;
 // Sit lean ON TOP of main roof metal (not under it)
 const onRoofLift = 0.22;
 // How far lean peak sits onto main roof (in from eave tip, up the slope)
 // SB: peak clearly up on main panels — push further past eave (~3.5′)
 const ontoRoof = Math.max(mainOhFt + 3.25, 3.5);
 const roofEdgeOut = Math.max(mainOhFt, 0.15);

 const wallMid = {
 x: (innerStart.x + innerEnd.x) / 2,
 z: (innerStart.z + innerEnd.z) / 2,
 };
 // Main roof eave tip in plan
 const eaveTipMid = {
 x: wallMid.x + outNx * roofEdgeOut,
 z: wallMid.z + outNz * roofEdgeOut,
 };
 // Peak of lean sits ON the main roof (inward from eave tip)
 const peakOnRoof = {
 x: eaveTipMid.x - outNx * ontoRoof,
 z: eaveTipMid.z - outNz * ontoRoof,
 };
 // Main roof Y at that landing (pitch up from eave tip)
 const halfSpan =
 (lt.wall === 'left' || lt.wall === 'right' ? Wft / 2 : Lft / 2) +
 mainOhFt;
 const mainSlope = mainRise / Math.max(halfSpan, 1);
 const peakY = roofTop + ontoRoof * mainSlope + onRoofLift;
 // Outer peak of lean — level ridge out from peak-on-roof (SB flush look)
 // Drop slightly so water runs off lean, not into main
 const outerPeakY = peakY - 0.06;
 // Side eaves of lean (gable drop)
 const eaveY = Math.max(H + 0.02, outerPeakY - gableRise);

 const outerMid = { x: (o1x + o2x) / 2, z: (o1z + o2z) / 2 };
 // High-edge corners of lean at main roof eave tip (// wall) — also ON roof metal
 // Raise corners above lean eave so the attach edge reads as roof-to-roof
 const cornerY = roofTop + onRoofLift * 0.5;
 const tI1 = {
 x: eaveTipMid.x - axN * (halfW + sideOh),
 z: eaveTipMid.z - azN * (halfW + sideOh),
 };
 const tI2 = {
 x: eaveTipMid.x + axN * (halfW + sideOh),
 z: eaveTipMid.z + azN * (halfW + sideOh),
 };
 // Peak on main roof surface (not at wall, not under eave)
 const attachMid = { x: peakOnRoof.x, z: peakOnRoof.z };
 // Eave-tip mid used for ridge path outer→tip→peak
 const tipMid = { x: eaveTipMid.x, z: eaveTipMid.z };

 // ── Lean roof planes ──
 // High edge runs from eave-tip corners through peak ON main roof.
 // Outer edge is outer posts. Peak is on main roof metal.
 this._addLeanRoofPlane(
 group,
 tI1,
 attachMid,
 rO1,
 outerMid,
 cornerY,
 eaveY,
 peakY,
 outerPeakY,
 roofHex,
 depth + ohFt * 2 + ontoRoof + roofEdgeOut,
 halfW + sideOh,
 );
 this._addLeanRoofPlane(
 group,
 tI2,
 attachMid,
 rO2,
 outerMid,
 cornerY,
 eaveY,
 peakY,
 outerPeakY,
 roofHex,
 depth + ohFt * 2 + ontoRoof + roofEdgeOut,
 halfW + sideOh,
 );

 // Clean ridge + valleys ON main roof (no under-eave T-bar)
 this._addGableLeanMainRoofSeal(group, {
 tI1,
 tI2,
 attachMid,
 tipMid,
 outerMid,
 eaveY,
 cornerY,
 peakY,
 outerPeakY,
 roofTop,
 outNx,
 outNz,
 axN,
 azN,
 ontoRoof,
 trimHex,
 length,
 });

 // Front (outer) gable-end metal
 this._addLeanOuterGableEndMetal(
 group,
 rO1,
 rO2,
 outerMid,
 eaveY,
 outerPeakY,
 roofHex,
 outNx,
 outNz,
 );

 // Perimeter black fascia
 this._addLeanRakeFasciaEdge(group, tI1, rO1, cornerY, eaveY, trimHex, {
 endNx: -axN,
 endNz: -azN,
 });
 this._addLeanRakeFasciaEdge(group, tI2, rO2, cornerY, eaveY, trimHex, {
 endNx: axN,
 endNz: azN,
 });
 this._addLeanRakeFasciaEdge(group, rO1, outerMid, eaveY, outerPeakY, trimHex, {
 endNx: outNx,
 endNz: outNz,
 });
 this._addLeanRakeFasciaEdge(group, outerMid, rO2, outerPeakY, eaveY, trimHex, {
 endNx: outNx,
 endNz: outNz,
 });
 this._addLeanOuterEaveFascia(group, rO1, rO2, eaveY, trimHex, {
 outNx,
 outNz,
 });
 }
}


 /**
   * Lean roof metal — same language as main (ribs // ridge / along eave).
   * Matches target gable-lean reference: lean metal continues main rib direction.
   *
   * Texture ribs run along V:
   *   U = across slope (attach → outer)
   *   V = along eave (lean length)
   *
   * Callers: ftAcross = slope run ft, ftAlong = eave length ft.
   */
 _addLeanRoofPlane(
 group,
 attachA,
 attachB,
 outerA,
 outerB,
 yAttachA,
 yOuterA,
 yAttachB,
 yOuterB,
 roofHex,
 ftAcross,
 ftAlong,
 ) {
 const c0 = [attachA.x * FT, yAttachA, attachA.z * FT];
 const c1 = [outerA.x * FT, yOuterA, outerA.z * FT];
 const c2 = [outerB.x * FT, yOuterB, outerB.z * FT];
 const c3 = [attachB.x * FT, yAttachB, attachB.z * FT];

 const slopeFt = Math.max(Number(ftAcross) || 4, 4);
 const eaveFt = Math.max(Number(ftAlong) || 4, 4);
 const roofM = this._agPanelMat(roofHex, slopeFt, eaveFt, {
 metalness: 0.88,
 roughness: 0.26,
 normalStrength: 1.85,
 clearcoat: 0.35,
 clearcoatRoughness: 0.28,
 side: THREE.DoubleSide,
 });
 roofM.polygonOffset = true;
 roofM.polygonOffsetFactor = -1;
 roofM.polygonOffsetUnits = -1;

 const geo = new THREE.BufferGeometry();
 geo.setAttribute(
 'position',
 new THREE.BufferAttribute(
 new Float32Array([
 c0[0], c0[1], c0[2],
 c1[0], c1[1], c1[2],
 c2[0], c2[1], c2[2],
 c3[0], c3[1], c3[2],
 ]),
 3,
 ),
 );
 // UV: c0(0,0) c1(1,0) c2(1,1) c3(0,1) — U=slope, V=eave (// main ridge)
 geo.setAttribute(
 'uv',
 new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2),
 );
 const ex1 = c1[0] - c0[0];
 const ez1 = c1[2] - c0[2];
 const ex2 = c3[0] - c0[0];
 const ez2 = c3[2] - c0[2];
 const flip = ez1 * ex2 - ex1 * ez2 < -1e-8;
 geo.setIndex(flip ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3]);
 geo.computeVertexNormals();
 const mesh = new THREE.Mesh(geo, roofM);
 mesh.castShadow = true;
 mesh.receiveShadow = true;
 group.add(mesh);

 this._addLeanRoofSurfaceRibs(
 group,
 attachA,
 attachB,
 outerA,
 outerB,
 yAttachA,
 yOuterA,
 yAttachB,
 yOuterB,
 roofHex,
 );
 return mesh;
 }

 /**
   * Raised lean ribs // eave (// main ridge), spaced down the slope.
   */
 _addLeanRoofSurfaceRibs(
 group,
 attachA,
 attachB,
 outerA,
 outerB,
 yAA,
 yOA,
 yAB,
 yOB,
 roofHex,
 ) {
 const ribMat = this._metalMat(
 new THREE.Color(roofHex).offsetHSL(0, 0, 0.07).getHex(),
 { metalness: 0.9, roughness: 0.24, side: THREE.DoubleSide },
 );
 const depthRun = Math.hypot(outerA.x - attachA.x, outerA.z - attachA.z) || 1;
 const steps = Math.max(4, Math.floor(depthRun / 0.75));
 for (let i = 1; i < steps; i++) {
 const t = i / steps;
 if (t < 0.08 || t > 0.92) continue;
 const ax = attachA.x + (outerA.x - attachA.x) * t;
 const az = attachA.z + (outerA.z - attachA.z) * t;
 const bx = attachB.x + (outerB.x - attachB.x) * t;
 const bz = attachB.z + (outerB.z - attachB.z) * t;
 const ya = yAA + (yOA - yAA) * t;
 const yb = yAB + (yOB - yAB) * t;
 const dx = (bx - ax) * FT;
 const dy = yb - ya;
 const dz = (bz - az) * FT;
 const len = Math.hypot(dx, dy, dz);
 if (len < 0.35) continue;
 const rib = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.05, len * 0.97), ribMat);
 rib.position.set(
 ((ax + bx) / 2) * FT,
 (ya + yb) / 2 + 0.035,
 ((az + bz) / 2) * FT,
 );
 const dir = new THREE.Vector3(dx, dy, dz);
 if (dir.lengthSq() > 1e-10) {
 rib.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.normalize());
 }
 rib.castShadow = false;
 group.add(rib);
 }
 }

 /**
   * Transition strip along top of wainscot (trim color) — matches main building.
   * a→b wall line in plan (ft). outNx/outNz unit outward normal.
   */
 _addLeanWainscotTrimStrip(
 group,
 a,
 b,
 wainH,
 trimHex,
 outNx,
 outNz,
 openings = [],
 wallLenFt = null,
 ) {
 if (wainH < 0.25) return;
 const ax = Number(a.x) || 0;
 const az = Number(a.z) || 0;
 const bx = Number(b.x) || 0;
 const bz = Number(b.z) || 0;
 const span =
 wallLenFt != null ? wallLenFt : Math.hypot(bx - ax, bz - az) || 1;
 const dx = bx - ax;
 const dz = bz - az;
 const ux = dx / (Math.hypot(dx, dz) || 1);
 const uz = dz / (Math.hypot(dx, dz) || 1);
 const runsAlongX = Math.abs(dx) >= Math.abs(dz);
 const stripOut = 0.1;
 const wainTopFt = wainH / FT;
 // Only place strip where solid wall exists at wainscot top (skip openings)
 const panels = this._wallSolidPanels(span, Math.max(wainTopFt + 0.5, 1), openings || []);
 const stripMat = this._metalMat(trimHex, { metalness: 0.85, roughness: 0.28 });
 for (const panel of panels) {
 if (panel.v0 > wainTopFt + 0.02 || panel.v1 < wainTopFt - 0.02) continue;
 const plen = panel.u1 - panel.u0;
 if (plen < 0.08) continue;
 const uMid = (panel.u0 + panel.u1) / 2;
 const cx = (ax + ux * uMid) * FT + outNx * stripOut;
 const cz = (az + uz * uMid) * FT + outNz * stripOut;
 const strip = new THREE.Mesh(
 new THREE.BoxGeometry(
 runsAlongX ? plen * FT : 0.24,
 0.1,
 runsAlongX ? 0.24 : plen * FT,
 ),
 stripMat,
 );
 strip.position.set(cx, wainH, cz);
 strip.castShadow = true;
 group.add(strip);
 }
 }

 /**
   * Rectangular wainscot on lean end face (depth run): flush base + proud overlay.
   */
 _addLeanEndWainscotRect(
 group,
 a,
 b,
 wainH,
 wainMat,
 outNx,
 outNz,
 alongDepthX,
 depthFt,
 ) {
 if (wainH < 0.25) return;
 const ax = Number(a.x) || 0;
 const az = Number(a.z) || 0;
 const bx = Number(b.x) || 0;
 const bz = Number(b.z) || 0;
 const span = depthFt || Math.hypot(bx - ax, bz - az) || 1;
 const mx = ((ax + bx) / 2) * FT;
 const mz = ((az + bz) / 2) * FT;
 const runsAlongX = alongDepthX != null ? alongDepthX : Math.abs(bx - ax) >= Math.abs(bz - az);
 // Flush base (same plane as end wall)
 const base = new THREE.Mesh(
 new THREE.BoxGeometry(
 runsAlongX ? span * FT : 0.18,
 wainH,
 runsAlongX ? 0.18 : span * FT,
 ),
 wainMat,
 );
 base.position.set(mx, wainH / 2, mz);
 base.castShadow = true;
 base.receiveShadow = true;
 group.add(base);
 // Proud overlay (matches main 0.04' out, 0.2' thick)
 const proud = new THREE.Mesh(
 new THREE.BoxGeometry(
 runsAlongX ? span * FT : 0.2,
 wainH,
 runsAlongX ? 0.2 : span * FT,
 ),
 wainMat,
 );
 proud.position.set(mx + outNx * 0.04, wainH / 2, mz + outNz * 0.04);
 proud.castShadow = true;
 proud.receiveShadow = true;
 group.add(proud);
 }

 /**
   * Vertical ag-panel ribs on a lean outer wall (matches main-building rib look).
   * a→b along wall, constant height. hostWall = attach wall (left/right/front/back).
   * openings: skip rib segments inside door/window rectangles (same as main).
   * yMinFt/yMaxFt: clip rib height range (ft) — used so red ribs stop at wainscot top.
   */
 _addLeanFaceRibs(
 group,
 a,
 b,
 height,
 hostWall,
 hex,
 openings = [],
 yMinFt = 0,
 yMaxFt = null,
 ) {
 if (!this.showMetal || height < 0.25) return;
 const ax = a.x * FT;
 const az = a.z * FT;
 const bx = b.x * FT;
 const bz = b.z * FT;
 const dx = bx - ax;
 const dz = bz - az;
 const span = Math.hypot(dx, dz) || 1;
 const ux = dx / span;
 const uz = dz / span;
 // Outward normal from outer face
 let nx = 0;
 let nz = 0;
 if (hostWall === 'left') {
 nx = -1;
 } else if (hostWall === 'right') {
 nx = 1;
 } else if (hostWall === 'front') {
 nz = -1;
 } else {
 nz = 1;
 }
 const wallHft = height / FT;
 const yMax = yMaxFt != null ? yMaxFt : wallHft;
 if (yMax - yMinFt < 0.08) return;
 this._placeLeanVerticalRibs(
 group,
 ax,
 az,
 ux,
 uz,
 nx,
 nz,
 span,
 () => height,
 hex,
 openings,
 wallHft,
 yMinFt,
 yMax,
 );
 }

 /**
   * Vertical ribs on raked end wall — each rib height follows the roof line.
   * yMinFt: start ribs above this height (wainscot top) so lower band stays solid black.
   */
 _addLeanRakeRibs(group, inner, outer, hMain, hOuter, hex, hostWall, face, yMinFt = 0) {
 if (!this.showMetal) return;
 const ix = inner.x * FT;
 const iz = inner.z * FT;
 const ox = outer.x * FT;
 const oz = outer.z * FT;
 const dx = ox - ix;
 const dz = oz - iz;
 const run = Math.hypot(dx, dz) || 1;
 const ux = dx / run;
 const uz = dz / run;
 // Outward normal for end face
 let nx = -uz;
 let nz = ux;
 if (face === 'rightEnd') {
 nx = -nx;
 nz = -nz;
 }
 if (hostWall === 'left' || hostWall === 'right') {
 if (face === 'leftEnd') {
 nx = 0;
 nz = -1;
 } else {
 nx = 0;
 nz = 1;
 }
 } else if (hostWall === 'front' || hostWall === 'back') {
 if (face === 'leftEnd') {
 nx = -1;
 nz = 0;
 } else {
 nx = 1;
 nz = 0;
 }
 }
 this._placeLeanVerticalRibs(
 group,
 ix,
 iz,
 ux,
 uz,
 nx,
 nz,
 run,
 (t) => hMain + (hOuter - hMain) * t,
 hex,
 null,
 null,
 yMinFt,
 null,
 );
 }

 /**
   * Shared vertical rib placer for lean faces.
   * heightAt(t) with t in 0..1 along span.
   * When openings + wallHft provided, ribs are split around door/window rectangles.
   * yMinFt/yMaxFt clip vertical range (ft).
   *
   * Ribs are placed slightly INWARD (like main building) so proud wainscot
   * fully covers the lower band from the exterior — no red ribs through black.
   */
 _placeLeanVerticalRibs(
 group,
 ax,
 az,
 ux,
 uz,
 nx,
 nz,
 span,
 heightAt,
 hex,
 openings = null,
 wallHft = null,
 yMinFt = 0,
 yMaxFt = null,
 ) {
 const ribMetal = this.lite ? 0.08 : 0.85;
 const ribRough = this.lite ? 0.7 : 0.28;
 const majorMat = new THREE.MeshStandardMaterial({
 color: new THREE.Color(hex).offsetHSL(0, 0, 0.06),
 metalness: ribMetal,
 roughness: ribRough,
 });
 const minorMat = new THREE.MeshStandardMaterial({
 color: new THREE.Color(hex).offsetHSL(0, 0, 0.02),
 metalness: this.lite ? 0.06 : 0.8,
 roughness: this.lite ? 0.72 : 0.32,
 });
 const majorEvery = 3;
 const minorEvery = 0.75;
 // Orient rib depth along outward normal for correct silhouette; offset is inward.
 const basis = new THREE.Matrix4().makeBasis(
 new THREE.Vector3(ux, 0, uz),
 new THREE.Vector3(0, 1, 0),
 new THREE.Vector3(nx, 0, nz),
 );
 const quat = new THREE.Quaternion().setFromRotationMatrix(basis);
 const placeSeg = (d, v0, v1, major) => {
 // Clip to [yMinFt, yMaxFt]
 const lo = Math.max(v0, yMinFt || 0);
 const hi = yMaxFt != null ? Math.min(v1, yMaxFt) : v1;
 if (hi - lo < 0.08) return;
 const ht = (hi - lo) * FT;
 const cx = ax + ux * d;
 const cz = az + uz * d;
 // Match main: ribs sit just inside the exterior face so wainscot covers lower band
 const inOff = major ? 0.06 : 0.04;
 const thick = major ? 0.14 : 0.07;
 const deep = major ? 0.2 : 0.14;
 const mesh = new THREE.Mesh(
 new THREE.BoxGeometry(thick, ht * 0.98, deep),
 major ? majorMat : minorMat,
 );
 mesh.position.set(cx - nx * inOff, ((lo + hi) / 2) * FT, cz - nz * inOff);
 mesh.quaternion.copy(quat);
 mesh.castShadow = true;
 group.add(mesh);
 };
 const place = (d, major) => {
 const t = span > 0 ? d / span : 0;
 const hWorld = heightAt(t);
 if (hWorld < 0.4) return;
 const hFt = hWorld / FT;
 const along = d;
 if (openings && openings.length && wallHft != null) {
 for (const seg of this._ribVerticalSegments(wallHft, along, openings)) {
 const v1 = Math.min(seg.v1, hFt);
 const v0 = Math.min(seg.v0, v1);
 if (v1 - v0 > 0.08) placeSeg(d, v0, v1, major);
 }
 } else {
 placeSeg(d, 0, hFt, major);
 }
 };
 for (let d = 0; d <= span + 0.01; d += majorEvery) place(d, true);
 for (let d = minorEvery; d < span; d += minorEvery) {
 if (d % majorEvery < 0.1) continue;
 place(d, false);
 }
 }

 /**
   * Short ag-panel ribs on lean roof running DOWN the slope (depth direction).
   * Each rib is only ~depth long (e.g. 12'), never full building length — so a
   * bad orientation cannot produce an 80' spear sticking out of the lean.
   */
 _addLeanRoofSlopeRibs(group, i1, i2, o1, o2, hIn, hOut, roofHex) {
 if (!this.showMetal) return;
 const ribMat = this._metalMat(new THREE.Color(roofHex).offsetHSL(0, 0, 0.08).getHex(), {
 metalness: 0.9,
 roughness: 0.25,
 });
 // Length along the eave (building)
 const alongLen = Math.hypot(i2.x - i1.x, i2.z - i1.z) || 1;
 // Depth run (inner → outer)
 const ddx = o1.x - i1.x;
 const ddz = o1.z - i1.z;
 const depthRun = Math.hypot(ddx, ddz) || 1;
 // Rib length along slope
 const slopeLen = Math.hypot(depthRun, hOut - hIn) * FT;
 if (slopeLen < 0.5) return;

 // Place a rib every ~3' along the eave (major panel seams)
 const spacing = 3;
 const count = Math.max(2, Math.floor(alongLen / spacing) + 1);
 for (let i = 0; i <= count; i++) {
 const u = i / count;
 // Center of rib at mid-depth
 const ix = (i1.x + (i2.x - i1.x) * u) * FT;
 const iz = (i1.z + (i2.z - i1.z) * u) * FT;
 const ox = (o1.x + (o2.x - o1.x) * u) * FT;
 const oz = (o1.z + (o2.z - o1.z) * u) * FT;
 const mx = (ix + ox) / 2;
 const mz = (iz + oz) / 2;
 const my = (hIn + hOut) / 2 + 0.04;
 // Thin board along the slope only (local Z = length)
 const rib = new THREE.Mesh(
 new THREE.BoxGeometry(0.06, 0.04, slopeLen * 0.98),
 ribMat,
 );
 rib.position.set(mx, my, mz);
 // Align local Z with slope vector (inner→outer, including pitch)
 const slopeDir = new THREE.Vector3(ox - ix, hOut - hIn, oz - iz);
 if (slopeDir.lengthSq() > 1e-8) {
 rib.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), slopeDir.normalize());
 }
 group.add(rib);
 }
 }

 /**
   * Outer gable-end metal on a gable lean (SB: dark metal triangle on the lean front).
   * Fills peak → left eave corner → right eave corner on the outer face.
   * Open bay below eave line stays clear (posts only).
   */
 _addLeanOuterGableEndMetal(
 group,
 oLeft,
 oRight,
 oPeak,
 eaveY,
 ridgeY,
 metalHex,
 outNx,
 outNz,
 ) {
 const lx = (Number(oLeft.x) || 0) * FT;
 const lz = (Number(oLeft.z) || 0) * FT;
 const rx = (Number(oRight.x) || 0) * FT;
 const rz = (Number(oRight.z) || 0) * FT;
 const px = (Number(oPeak.x) || 0) * FT;
 const pz = (Number(oPeak.z) || 0) * FT;
 const yBot = Math.max(0.5, Number(eaveY) || 10);
 const yPeak = Math.max(yBot + 0.25, Number(ridgeY) || yBot + 1);
 if (yPeak - yBot < 0.2) return;

 let nx = Number(outNx) || 0;
 let nz = Number(outNz) || 0;
 const nLen = Math.hypot(nx, nz) || 1;
 nx /= nLen;
 nz /= nLen;
 const thick = 0.14;
 const half = thick / 2;
 // Slightly outward so face sits proud of posts / roof edge
 const ox = nx * (half + 0.04);
 const oz = nz * (half + 0.04);

 const span = Math.hypot(rx - lx, rz - lz) || 1;
 const mat = this._agPanelMat(
 metalHex,
 span,
 yPeak,
 this._wallPanelOpts({
 worldU0: 0,
 worldV0: 0,
 side: THREE.DoubleSide,
 metalness: 0.82,
 roughness: 0.3,
 normalStrength: 1.4,
 }),
 );

 // Local U along left→right base; V = height
 // Exterior face: triangle left-base, peak, right-base
 const positions = [];
 const uvs = [];
 const push = (x, y, z, u, v) => {
 positions.push(x, y, z);
 uvs.push(u, v);
 };
 // Outer face (outside of lean)
 push(lx + ox, yBot, lz + oz, 0, yBot / yPeak);
 push(px + ox, yPeak + 0.03, pz + oz, 0.5, 1);
 push(rx + ox, yBot, rz + oz, 1, yBot / yPeak);
 // Inner face (looking out from under lean)
 push(lx - ox, yBot, lz - oz, 0, yBot / yPeak);
 push(rx - ox, yBot, rz - oz, 1, yBot / yPeak);
 push(px - ox, yPeak + 0.03, pz - oz, 0.5, 1);

 const geo = new THREE.BufferGeometry();
 geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
 geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
 geo.setIndex([0, 1, 2, 3, 4, 5]);
 geo.computeVertexNormals();
 const mesh = new THREE.Mesh(geo, mat);
 mesh.castShadow = true;
 mesh.receiveShadow = true;
 group.add(mesh);

 // Vertical ag-panel ribs on the gable face (same cadence as main walls)
 const ribMat = this._metalMat(
 new THREE.Color(metalHex).offsetHSL(0, 0, 0.06).getHex(),
 { metalness: 0.85, roughness: 0.28, side: THREE.DoubleSide },
 );
 const steps = Math.max(2, Math.floor(span / (3 * FT)));
 for (let i = 1; i < steps; i++) {
 const t = i / steps;
 // Height of roof line at this station along the gable base (triangle)
 const yTop = yBot + (yPeak - yBot) * (1 - Math.abs(2 * t - 1));
 if (yTop - yBot < 0.35) continue;
 const x = lx + (rx - lx) * t + ox * 1.1;
 const z = lz + (rz - lz) * t + oz * 1.1;
 const ht = yTop - yBot;
 const rib = new THREE.Mesh(new THREE.BoxGeometry(0.08, ht * 0.96, 0.06), ribMat);
 rib.position.set(x, yBot + ht * 0.5, z);
 // Face ribs outward
 if (Math.abs(nx) > Math.abs(nz)) {
 rib.rotation.y = nx < 0 ? Math.PI / 2 : -Math.PI / 2;
 }
 rib.castShadow = false;
 group.add(rib);
 }
 }

 /**
   * Lean-to END wall (depth face at each gable end).
   *
   * Same ag-panel system as main walls: thick prism + world-aligned UVs so
   * vertical ribs continue in phase (3' modules, V = height/8).
   * Top edge follows the roof rake:
   *   height at main wall = hMain (e.g. 14')
   *   height at outer eave = hOuter (e.g. 10')
   * @param {number} [yBottom=0] — bottom of upper wall (wainscot top when wainscot on)
   * @param {number} [wallHex] — wall color for material (preferred over shared mat)
   */
 _addLeanEndWallRake(
 group,
 inner,
 outer,
 hMain,
 hOuter,
 mat,
 userData,
 yBottom = 0,
 wallHex = null,
 outNx = 0,
 outNz = 0,
 ) {
 const ix = (Number(inner.x) || 0) * FT;
 const iz = (Number(inner.z) || 0) * FT;
 const ox = (Number(outer.x) || 0) * FT;
 const oz = (Number(outer.z) || 0) * FT;
 const y0 = Math.max(0, Number(yBottom) || 0);

 // Nudge tops slightly into the roof plane (roof sits at h + 0.015)
 let hi = Math.max(0.5, Number(hMain) || 14) + 0.05;
 let ho = Math.max(0.5, Number(hOuter) || 10) + 0.05;
 const run = Math.hypot(ox - ix, oz - iz) || 1;
 if (Math.abs(hi - ho) < 0.4) {
 // Degenerate data would draw a rectangle under a pitched roof — force rake
 hi = Math.max(hi, ho + Math.max(run * (4 / 12), 2.5));
 }
 // Upper wall must clear wainscot
 if (hi <= y0 + 0.2) hi = y0 + 0.5;
 if (ho <= y0 + 0.2) ho = y0 + 0.5;

 const dx = ox - ix;
 const dz = oz - iz;
 const ux = dx / run;
 const uz = dz / run;
 // Outward normal: prefer explicit face normal when provided
 let nx = outNx;
 let nz = outNz;
 if (Math.hypot(nx, nz) < 0.5) {
 nx = -uz;
 nz = ux;
 const nl = Math.hypot(nx, nz) || 1;
 nx /= nl;
 nz /= nl;
 }

 const hMax = Math.max(hi, ho, y0 + 1);
 // Same wall panel material + continuous height phase as main building
 let m;
 if (wallHex != null) {
 m = this._agPanelMat(
 wallHex,
 run,
 hMax,
 this._wallPanelOpts({
 worldU0: 0,
 worldV0: 0,
 side: THREE.DoubleSide,
 }),
 );
 } else {
 m = mat?.clone?.() || mat;
 if (m) {
 m.side = THREE.DoubleSide;
 m.depthWrite = true;
 } else {
 m = new THREE.MeshStandardMaterial({
 color: 0xc4c0b8,
 metalness: 0.65,
 roughness: 0.4,
 side: THREE.DoubleSide,
 });
 }
 }

 // Build a thick trapezoid prism with proper per-vertex UVs (ExtrudeGeometry UVs are wrong).
 // Front face at +thick/2 along outward normal; back at -thick/2.
 const thick = 0.16 * FT;
 const half = thick / 2;
 // 4 corners along wall line (inner→outer at bottom/top)
 // Local along-parameter s: 0 at inner, run at outer
 // UV: u = s/run (0..1) × material rep = s/3; v = y/hMax (0..1) → y/8
 const corners = [
 { s: 0, y: y0 }, // 0 inner bottom
 { s: run, y: y0 }, // 1 outer bottom
 { s: run, y: ho }, // 2 outer top
 { s: 0, y: hi }, // 3 inner top
 ];
 const positions = [];
 const uvs = [];
 const indices = [];
 // Front (outward) then back (inward) — 8 verts
 for (const side of [1, -1]) {
 for (const c of corners) {
 const px = ix + ux * c.s + nx * half * side;
 const py = c.y;
 const pz = iz + uz * c.s + nz * half * side;
 positions.push(px, py, pz);
 uvs.push(c.s / run, c.y / hMax);
 }
 }
 // Front face 0-1-2-3
 indices.push(0, 1, 2, 0, 2, 3);
 // Back face 4-7-6-5 (reversed winding)
 indices.push(4, 7, 6, 4, 6, 5);
 // Edges for thickness silhouette
 // bottom 0-1-5-4
 indices.push(0, 1, 5, 0, 5, 4);
 // top 3-2-6-7
 indices.push(3, 2, 6, 3, 6, 7);
 // inner 0-3-7-4
 indices.push(0, 3, 7, 0, 7, 4);
 // outer 1-5-6-2
 indices.push(1, 5, 6, 1, 6, 2);

 const geo = new THREE.BufferGeometry();
 geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
 geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
 geo.setIndex(indices);
 geo.computeVertexNormals();

 const mesh = new THREE.Mesh(geo, m);
 mesh.castShadow = true;
 mesh.receiveShadow = true;
 mesh.userData = userData || {};
 group.add(mesh);
 }

 /**
   * Lean OUTER eave drip fascia — same as main building eave fascia.
   * Vertical face, long axis along outer posts (lean length), proud of metal edge.
   * opts.outNx/outNz = unit outward (main wall → outer posts).
   */
 _addLeanOuterEaveFascia(group, a, b, yTop, trimHex, opts = {}) {
 const ax = Number(a.x) || 0;
 const az = Number(a.z) || 0;
 const bx = Number(b.x) || 0;
 const bz = Number(b.z) || 0;
 const dx = (bx - ax) * FT;
 const dz = (bz - az) * FT;
 const len = Math.hypot(dx, dz);
 if (len < 0.12) return;
 let ox = Number(opts.outNx) || 0;
 let oz = Number(opts.outNz) || 0;
 const oLen = Math.hypot(ox, oz) || 1;
 ox /= oLen;
 oz /= oLen;
 // Match main eave drip (scene.js _addRoofPerimeterTrim)
 const T = 0.12;
 const fasciaH = 0.36;
 const mat = this._metalMat(trimHex, {
 metalness: 0.52,
 roughness: 0.44,
 clearcoat: 0.22,
 side: THREE.DoubleSide,
 });
 // Local: X = thickness (outward), Y = vertical drip, Z = along eave
 const fascia = new THREE.Mesh(new THREE.BoxGeometry(T, fasciaH, len * 1.02), mat);
 // Proud of outer metal edge so face is visible (not buried in roof)
 const midX = ((ax + bx) / 2) * FT + ox * (T * 0.55);
 const midZ = ((az + bz) / 2) * FT + oz * (T * 0.55);
 fascia.position.set(midX, yTop - fasciaH * 0.42, midZ);
 // rotation.y only — keeps face vertical (this is the "rotate correctly" fix)
 fascia.rotation.y = Math.atan2(dx, dz);
 fascia.castShadow = true;
 group.add(fascia);
 }

 /**
   * Lean RAKE eave fascia along one end (attach → outer posts).
   * Must sit OUTSIDE the lean end (opts.endNx/endNz) so the black drip is
   * visible and meets the high-edge fascia at the main wall — not buried
   * inside the roof (which caused the missing/wrong eave trim look).
   */
 _addLeanRakeFasciaEdge(group, inner, outer, yIn, yOut, trimHex, opts = {}) {
 const ax = Number(inner.x) || 0;
 const az = Number(inner.z) || 0;
 const bx = Number(outer.x) || 0;
 const bz = Number(outer.z) || 0;
 const dx = (bx - ax) * FT;
 const dy = yOut - yIn;
 const dz = (bz - az) * FT;
 const len = Math.hypot(dx, dy, dz);
 if (len < 0.12) return;

 let ex = Number(opts.endNx) || 0;
 let ez = Number(opts.endNz) || 0;
 const eLen = Math.hypot(ex, ez);
 if (eLen < 1e-6) {
 // Fallback: horizontal normal from plan slope × world up
 ex = -dz;
 ez = dx;
 const f = Math.hypot(ex, ez) || 1;
 ex /= f;
 ez /= f;
 } else {
 ex /= eLen;
 ez /= eLen;
 }

 const T = 0.12;
 const fasciaH = 0.34;
 const mat = this._metalMat(trimHex, {
 metalness: 0.52,
 roughness: 0.44,
 clearcoat: 0.22,
 side: THREE.DoubleSide,
 });
 // Long axis along roof edge (slope). Drip hangs down; face points end-outward.
 const fascia = new THREE.Mesh(new THREE.BoxGeometry(T, fasciaH, len * 0.99), mat);
 const midX = ((ax + bx) / 2) * FT + ex * (T * 0.55);
 const midZ = ((az + bz) / 2) * FT + ez * (T * 0.55);
 const midY = (yIn + yOut) / 2 - fasciaH * 0.35;
 fascia.position.set(midX, midY, midZ);

 // Basis: localZ = along slope edge, localX = end-outward (horizontal), localY = up-ish
 const along = new THREE.Vector3(dx, dy, dz);
 if (along.lengthSq() < 1e-10) return;
 along.normalize();
 const out = new THREE.Vector3(ex, 0, ez);
 // Re-orthogonalize out against along (keep mostly horizontal outward)
 out.addScaledVector(along, -out.dot(along));
 if (out.lengthSq() < 1e-8) {
 out.set(-along.z, 0, along.x);
 }
 out.normalize();
 const up = new THREE.Vector3().crossVectors(along, out).normalize();
 // Prefer up pointing skyward
 if (up.y < 0) {
 up.negate();
 out.negate();
 }
 const m = new THREE.Matrix4().makeBasis(out, up, along);
 fascia.quaternion.setFromRotationMatrix(m);
 fascia.castShadow = true;
 group.add(fascia);
 }

 /**
   * Lean roof edge fascia (legacy helper).
   */
 _addLeanEdgeFascia(group, a, b, yTop, trimHex, opts = {}) {
 const y0 = opts.y0 != null ? opts.y0 : yTop != null ? yTop : 0;
 const y1 = opts.y1 != null ? opts.y1 : yTop != null ? yTop : 0;
 if (Math.abs(y1 - y0) < 0.02) {
 this._addLeanOuterEaveFascia(group, a, b, y0, trimHex, opts);
 } else {
 this._addLeanRakeFasciaEdge(group, a, b, y0, y1, trimHex, opts);
 }
 }

 /** @deprecated use _addLeanOuterEaveFascia */
 _addLeanFasciaStrip(group, a, b, yTop, _isSideWall, trimHex) {
 this._addLeanOuterEaveFascia(group, a, b, yTop + 0.08, trimHex, {});
 }

 /** Diagonal rake fascia along end-wall top (under roof rake). */
 _addLeanRakeFascia(group, inner, outer, hInner, hOuter, trimHex) {
 this._addLeanRakeFasciaEdge(group, inner, outer, hInner + 0.06, hOuter + 0.06, trimHex);
 }

 /**
   * Concrete slab under lean-to footprint (inset slightly from posts).
   * Visible in 3D when lt.hasSlab is true.
   */
 _addLeanSlab(group, pkg, lt, b) {
 const i1 = pkg.innerStart;
 const i2 = pkg.innerEnd;
 const o1 = pkg.outerStart;
 const o2 = pkg.outerEnd;
 if (!i1 || !i2 || !o1 || !o2) return;

 // Inset pad from outer post line so exterior doesn't read as a sidewalk apron
 const inset = 0.35;
 const midIx = (i1.x + i2.x) / 2;
 const midIz = (i1.z + i2.z) / 2;
 const midOx = (o1.x + o2.x) / 2;
 const midOz = (o1.z + o2.z) / 2;
 // Unit outward (inner → outer) and along eave
 let ox = midOx - midIx;
 let oz = midOz - midIz;
 const oLen = Math.hypot(ox, oz) || 1;
 ox /= oLen;
 oz /= oLen;
 let ax = i2.x - i1.x;
 let az = i2.z - i1.z;
 const aLen = Math.hypot(ax, az) || 1;
 ax /= aLen;
 az /= aLen;

 const p = (q, alongSign, outSign) => ({
 x: q.x + ax * alongSign * inset + ox * outSign * inset,
 z: q.z + az * alongSign * inset + oz * outSign * inset,
 });
 // Corners: inner line inset toward outer; outer line inset toward inner
 // along: shrink ends; out: pull off outer posts / off main wall slightly
 const cI1 = p(i1, +1, +0.4); // toward outer a bit off main wall
 const cI2 = p(i2, -1, +0.4);
 const cO1 = p(o1, +1, -1);
 const cO2 = p(o2, -1, -1);

 const thkIn = Number(lt.slabThicknessIn) || Number(b?.slabThicknessIn) || 4;
 const slabThk = Math.max(0.08, (thkIn / 12) * FT * 0.85);
 const mat = new THREE.MeshStandardMaterial({
 color: 0x8e969e,
 roughness: 0.78,
 metalness: 0.02,
 });

 // Build as a thin box oriented on the lean plan (not axis-aligned for front/back leans)
 const cx = (cI1.x + cI2.x + cO1.x + cO2.x) / 4;
 const cz = (cI1.z + cI2.z + cO1.z + cO2.z) / 4;
 const along = Math.hypot(cI2.x - cI1.x, cI2.z - cI1.z);
 const deep = Math.hypot(cO1.x - cI1.x, cO1.z - cI1.z);
 if (along < 0.5 || deep < 0.5) return;

 const slab = new THREE.Mesh(
 new THREE.BoxGeometry(deep * FT, slabThk, along * FT),
 mat,
 );
 // Local X = depth (inner→outer), local Z = along eave
 const depthDir = new THREE.Vector3(ox, 0, oz);
 const alongDir = new THREE.Vector3(ax, 0, az);
 const basis = new THREE.Matrix4().makeBasis(
 depthDir,
 new THREE.Vector3(0, 1, 0),
 alongDir,
 );
 slab.quaternion.setFromRotationMatrix(basis);
 // Top of slab near grade (slightly below posts)
 slab.position.set(cx * FT, -slabThk / 2 - 0.01, cz * FT);
 slab.receiveShadow = true;
 slab.castShadow = false;
 group.add(slab);
 }

 /** Lean-to posts from framing package (open lean / frame view). */
 _addLeanPosts(group, pkg, b, lt) {
 const postMat = new THREE.MeshStandardMaterial({
 color: 0xc4a06a,
 roughness: 0.72,
 metalness: 0.02,
 emissive: 0x2a1808,
 emissiveIntensity: 0.1,
 });
 const postSize = 0.55;
 const posts = pkg.posts || [];
 // Always ensure corner posts exist even if package is empty
 const corners = [
 pkg.outerStart,
 pkg.outerEnd,
 // outer mid-line posts come from package; corners guaranteed
 ].filter(Boolean);

 // Gable lean (SB): peak sits ON main roof; outer posts track lean side eave
 let defaultH = Number(lt.eaveHeight) || 10;
 if ((lt.roofStyle || 'shed') === 'gable') {
 const leanLen = Number(pkg.length) || Number(lt.length) || 12;
 const halfW = leanLen / 2 || 1;
 const rise = halfW * ((Number(lt.pitch) || 3) / 12);
 // Peak ~1.4' above main eave (further onto roof slope); outer eave = peak - rise
 const peakApprox = (Number(b.eaveHeight) || 12) + 1.4;
 defaultH = Math.max(defaultH, peakApprox - rise);
 }

 const seen = new Set();
 const place = (x, z, hFt) => {
 const key = `${x.toFixed(2)},${z.toFixed(2)}`;
 if (seen.has(key)) return;
 seen.add(key);
 const h = Math.max(0.5, (hFt != null ? hFt : defaultH) * FT);
 const mesh = new THREE.Mesh(new THREE.BoxGeometry(postSize, h, postSize), postMat);
 mesh.position.set(x * FT, h / 2, z * FT);
 mesh.castShadow = true;
 mesh.receiveShadow = true;
 group.add(mesh);
 };

 for (const p of posts) {
 place(p.x, p.z, Math.max(p.heightAboveGrade || 0, defaultH));
 }
 // Corner guarantee
 for (const c of corners) {
 place(c.x, c.z, defaultH);
 }
 }

 /** Outer eave carrier beam on lean-to (frame view only). */
 _addLeanOuterBearer(group, outerStart, outerEnd, eaveY, _isSide) {
 const ax = Number(outerStart.x) || 0;
 const az = Number(outerStart.z) || 0;
 const bx = Number(outerEnd.x) || 0;
 const bz = Number(outerEnd.z) || 0;
 const dx = (bx - ax) * FT;
 const dz = (bz - az) * FT;
 const len = Math.hypot(dx, dz);
 if (len < 0.2) return;
 const mat = new THREE.MeshStandardMaterial({
 color: 0xc4a06a,
 roughness: 0.75,
 metalness: 0.02,
 });
 const beam = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, len), mat);
 beam.position.set(((ax + bx) / 2) * FT, eaveY + 0.08, ((az + bz) / 2) * FT);
 const dir = new THREE.Vector3(dx, 0, dz);
 if (dir.lengthSq() > 1e-10) {
 beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.normalize());
 }
 beam.castShadow = true;
 group.add(beam);
 }

 /** Purlin visuals under lean roof (frame view only) — wood tone, not neon blue. */
 _addLeanPurlins(group, i1, i2, o1, o2, attachH, outerH, depthFt, lengthFt) {
 const mat = new THREE.MeshStandardMaterial({
 color: 0xc4a882,
 roughness: 0.72,
 metalness: 0.02,
 });
 const rows = Math.max(3, Math.min(8, Math.ceil(depthFt / 2) + 1));
 for (let r = 1; r < rows; r++) {
 const t = r / rows;
 const ax = i1.x + (o1.x - i1.x) * t;
 const az = i1.z + (o1.z - i1.z) * t;
 const bx = i2.x + (o2.x - i2.x) * t;
 const bz = i2.z + (o2.z - i2.z) * t;
 const y = attachH + (outerH - attachH) * t - 0.14;
 const dx = (bx - ax) * FT;
 const dz = (bz - az) * FT;
 const len = Math.hypot(dx, dz);
 if (len < 0.2) continue;
 // Local Z = along purlin (eave direction) — never axis-guess BoxGeometry
 const purlin = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, len), mat);
 purlin.position.set(((ax + bx) / 2) * FT, y, ((az + bz) / 2) * FT);
 const dir = new THREE.Vector3(dx, 0, dz);
 if (dir.lengthSq() > 1e-10) {
 purlin.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.normalize());
 }
 purlin.castShadow = false;
 group.add(purlin);
 }
 }

 /**
   * Lean high-edge eave trim → main building (root fix for leak joint).
   *
   * This is the piece that was wrong: it must be a **vertical eave-style fascia**
   * along the attach line (// main wall), NOT a flat strip on the lean roof.
   * It hangs under the lean high roof edge and extends **up the main wall** to
   * meet the main building eave fascia — continuous black trim seal (SB).
   *
   * Defaults for no-leak metal connection (inches):
   *   upturnIn  3.5  — cover up main wall toward main eave
   *   dropIn    4.0  — hang below lean roof plane (drip face)
   *   lapIn     2.5  — small roof-side return under lean metal edge
   */
 _addLeanTransitionFlash(group, i1, i2, yRoof, _isSideWall, trimHex = 0x2a2a2a, opts = {}) {
 const ax = Number(i1.x) || 0;
 const az = Number(i1.z) || 0;
 const bx = Number(i2.x) || 0;
 const bz = Number(i2.z) || 0;
 const dx = (bx - ax) * FT;
 const dz = (bz - az) * FT;
 const len = Math.hypot(dx, dz);
 if (len < 0.1) return;

 const upturn = (Number(opts.upturnIn) || 3.5) / 12;
 const drop = (Number(opts.dropIn) || 4.0) / 12;
 const lap = (Number(opts.lapIn) || 2.5) / 12;
 const T = 0.1; // fascia thickness (ft) — same language as main eave fascia

 const wall = opts.wall || (_isSideWall ? 'left' : 'front');
 let ox = 0;
 let oz = 0;
 if (wall === 'left') ox = -1;
 else if (wall === 'right') ox = 1;
 else if (wall === 'front') oz = -1;
 else oz = 1;

 const mat = this._metalMat(trimHex, {
 metalness: 0.52,
 roughness: 0.44,
 clearcoat: 0.22,
 side: THREE.DoubleSide,
 });
 // Yaw keeps local Z along attach (// main wall / main eave) and local Y world-up
 // → vertical drip face (rotated correctly as eave trim, not flat on roof)
 const yaw = Math.atan2(dx, dz);
 const midX = ((ax + bx) / 2) * FT;
 const midZ = ((az + bz) / 2) * FT;

 // Top of this fascia meets underside of main eave fascia when possible
 const mainEaveY = opts.mainEaveY != null ? opts.mainEaveY : yRoof + upturn;
 const topY = Math.min(yRoof + upturn, mainEaveY - 0.02);
 const botY = yRoof - drop;
 const faceH = Math.max(0.28, topY - botY);
 const midY = (topY + botY) / 2;

 // Vertical eave fascia along attach — connects lean high edge to main building
 const face = new THREE.Mesh(new THREE.BoxGeometry(T, faceH, len * 1.01), mat);
 face.position.set(
 midX + ox * (T * 0.35),
 midY,
 midZ + oz * (T * 0.35),
 );
 face.rotation.y = yaw;
 face.castShadow = true;
 group.add(face);

 // Small horizontal return under lean roof metal (seals water onto lean panels)
 const ret = new THREE.Mesh(new THREE.BoxGeometry(lap, T * 0.7, len * 1.005), mat);
 ret.position.set(
 midX + ox * (lap * 0.5 + T * 0.2),
 yRoof - T * 0.15,
 midZ + oz * (lap * 0.5 + T * 0.2),
 );
 ret.rotation.y = yaw;
 ret.castShadow = false;
 group.add(ret);
 }

 /**
   * SB gable lean on main roof — clean ridge + valleys (NO under-eave T-bar).
   *
   * Peak of lean sits ON the main roof metal. Ridge runs outer → peak.
   * Valleys follow lean roof edges where they meet the main roof surface.
   */
 _addGableLeanMainRoofSeal(group, p) {
 const {
 tI1,
 tI2,
 attachMid,
 tipMid,
 outerMid,
 eaveY,
 cornerY,
 peakY,
 outerPeakY,
 roofTop,
 outNx,
 outNz,
 axN,
 azN,
 trimHex,
 length,
 } = p;

 const mat = this._metalMat(trimHex, {
 metalness: 0.5,
 roughness: 0.44,
 clearcoat: 0.2,
 side: THREE.DoubleSide,
 });

 // ── Continuous ridge cap: outer peak → peak ON main roof ──
 {
 const a = {
 x: outerMid.x,
 z: outerMid.z,
 y: (outerPeakY != null ? outerPeakY : peakY) + 0.12,
 };
 const bpt = { x: attachMid.x, z: attachMid.z, y: peakY + 0.12 };
 const dx = (bpt.x - a.x) * FT;
 const dy = bpt.y - a.y;
 const dz = (bpt.z - a.z) * FT;
 const len = Math.hypot(dx, dy, dz);
 if (len > 0.2) {
 // Main ridge body
 const ridge = new THREE.Mesh(
 new THREE.BoxGeometry(0.5, 0.14, len * 0.995),
 mat,
 );
 ridge.position.set(
 ((a.x + bpt.x) / 2) * FT,
 (a.y + bpt.y) / 2,
 ((a.z + bpt.z) / 2) * FT,
 );
 const dir = new THREE.Vector3(dx, dy, dz);
 if (dir.lengthSq() > 1e-8) {
 ridge.quaternion.setFromUnitVectors(
 new THREE.Vector3(0, 0, 1),
 dir.normalize(),
 );
 }
 ridge.castShadow = true;
 group.add(ridge);
 // Peak crease
 const crease = new THREE.Mesh(
 new THREE.BoxGeometry(0.14, 0.09, len * 0.99),
 mat,
 );
 crease.position.set(
 ridge.position.x,
 ridge.position.y + 0.08,
 ridge.position.z,
 );
 crease.quaternion.copy(ridge.quaternion);
 group.add(crease);
 }

 // Small pad ON main roof at peak (not a wide T-bar)
 const pad = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.1, 0.55), mat);
 pad.position.set(attachMid.x * FT, peakY + 0.14, attachMid.z * FT);
 {
 const rdx = (outerMid.x - attachMid.x) * FT;
 const rdz = (outerMid.z - attachMid.z) * FT;
 const rd = new THREE.Vector3(rdx, 0, rdz);
 if (rd.lengthSq() > 1e-8) {
 pad.quaternion.setFromUnitVectors(
 new THREE.Vector3(0, 0, 1),
 rd.normalize(),
 );
 }
 }
 pad.castShadow = true;
 group.add(pad);
 }

 // ── Valley flash: lean roof edges that sit on main roof ──
 // From each eave-tip corner up to the peak (on main roof surface)
 for (const [corner, yC] of [
 [tI1, cornerY != null ? cornerY : eaveY],
 [tI2, cornerY != null ? cornerY : eaveY],
 ]) {
 const dx = (attachMid.x - corner.x) * FT;
 const dy = peakY - yC;
 const dz = (attachMid.z - corner.z) * FT;
 const len = Math.hypot(dx, dy, dz);
 if (len < 0.2) continue;
 const valley = new THREE.Mesh(
 new THREE.BoxGeometry(0.28, 0.1, len * 0.98),
 mat,
 );
 valley.position.set(
 ((corner.x + attachMid.x) / 2) * FT,
 (yC + peakY) / 2 + 0.08,
 ((corner.z + attachMid.z) / 2) * FT,
 );
 const slopeDir = new THREE.Vector3(dx, dy, dz);
 if (slopeDir.lengthSq() > 1e-8) {
 valley.quaternion.setFromUnitVectors(
 new THREE.Vector3(0, 0, 1),
 slopeDir.normalize(),
 );
 }
 valley.castShadow = true;
 group.add(valley);
 }

 // ── Short eave-tip edge flash where lean corners meet main roof edge ──
 if (tipMid && tI1 && tI2) {
 const alongX = (tI2.x - tI1.x) * FT;
 const alongZ = (tI2.z - tI1.z) * FT;
 const span = Math.hypot(alongX, alongZ) || (length || 8) * FT;
 // Narrow flash only (not a wide under-roof T)
 const edge = new THREE.Mesh(
 new THREE.BoxGeometry(0.35, 0.1, span * 0.5),
 mat,
 );
 edge.position.set(
 tipMid.x * FT,
 (roofTop != null ? roofTop : peakY) + 0.12,
 tipMid.z * FT,
 );
 {
 const out = new THREE.Vector3(outNx, 0, outNz).normalize();
 const along = new THREE.Vector3(alongX, 0, alongZ);
 if (along.lengthSq() < 1e-8) along.set(-out.z, 0, out.x);
 along.normalize();
 edge.quaternion.setFromRotationMatrix(
 new THREE.Matrix4().makeBasis(out, new THREE.Vector3(0, 1, 0), along),
 );
 }
 edge.castShadow = true;
 group.add(edge);
 }

 void axN;
 void azN;
 void eaveY;
 }

 /**
   * Lean-to openings use the same premium door/window visual as the main building.
   */
 _addLeanOpening(group, b, o) {
 const pos = this._leanOpeningWorldPos(b, o, 0.22);
 if (!pos) return;
 this._mountOpeningVisual(group, b, o, {
 position: pos.position,
 rotationY: pos.rotationY,
 wallLength: pos.wallLength,
 host: o.host,
 face: o.face || 'outer',
 wall: pos.wall,
 });
 }

 /**
   * World position + outward rotation for an opening on a lean-to face.
   * Local +Z of the opening group faces exterior (same convention as main).
   */
 _leanOpeningWorldPos(b, o, outFromWall = 0.22) {
 const framing = generateFraming(b);
 const pkg = framing.leanPackages.find((p) => p.lean.id === o.host);
 if (!pkg) return null;
 const lt = pkg.lean;
 const face = o.face || 'outer';
 const sill = Number(o.sillHeight) || 0;
 const oh = Math.max(0.5, Number(o.height) || 7);
 const ow = Math.max(0.5, Number(o.width) || 3);
 const y = (sill + oh / 2) * FT;
 const mid = (Number(o.offset) || 0) + ow / 2;
 const out = outFromWall;

 let wallX = 0;
 let wallZ = 0;
 let nx = 0;
 let nz = 0;
 let rotationY = 0;
 let wallLen = pkg.length;

 if (face === 'outer') {
 wallLen = pkg.length;
 const t = mid / Math.max(pkg.length, 0.01);
 wallX = pkg.outerStart.x + (pkg.outerEnd.x - pkg.outerStart.x) * t;
 wallZ = pkg.outerStart.z + (pkg.outerEnd.z - pkg.outerStart.z) * t;
 // Outer face points away from main building
 if (lt.wall === 'left') {
 nx = -1;
 nz = 0;
 rotationY = -Math.PI / 2;
 } else if (lt.wall === 'right') {
 nx = 1;
 nz = 0;
 rotationY = Math.PI / 2;
 } else if (lt.wall === 'front') {
 nx = 0;
 nz = -1;
 rotationY = Math.PI;
 } else {
 nx = 0;
 nz = 1;
 rotationY = 0;
 }
 } else if (face === 'leftEnd') {
 // End at lean start (innerStart→outerStart); offset runs main→outer along depth
 wallLen = pkg.depth;
 const t = mid / Math.max(pkg.depth, 0.01);
 wallX = pkg.innerStart.x + (pkg.outerStart.x - pkg.innerStart.x) * t;
 wallZ = pkg.innerStart.z + (pkg.outerStart.z - pkg.innerStart.z) * t;
 if (lt.wall === 'left' || lt.wall === 'right') {
 // leftEnd ≈ lower-Z end of side lean
 nx = 0;
 nz = -1;
 rotationY = Math.PI;
 } else {
 // front/back lean: leftEnd ≈ lower-X end
 nx = -1;
 nz = 0;
 rotationY = -Math.PI / 2;
 }
 } else {
 // rightEnd
 wallLen = pkg.depth;
 const t = mid / Math.max(pkg.depth, 0.01);
 wallX = pkg.innerEnd.x + (pkg.outerEnd.x - pkg.innerEnd.x) * t;
 wallZ = pkg.innerEnd.z + (pkg.outerEnd.z - pkg.innerEnd.z) * t;
 if (lt.wall === 'left' || lt.wall === 'right') {
 nx = 0;
 nz = 1;
 rotationY = 0;
 } else {
 nx = 1;
 nz = 0;
 rotationY = Math.PI / 2;
 }
 }

 return {
 position: new THREE.Vector3((wallX + nx * out) * FT, y, (wallZ + nz * out) * FT),
 rotationY,
 wallLength: wallLen,
 wall: lt.wall,
 };
 }

 /**
   * Trusses, purlins, and eave carriers — fully INSIDE the building envelope
   * so they never stick out through exterior metal. Visible from interior /
   * through openings and open walls only.
   */
 _addInteriorRoofStructure(group, b) {
 const framing = generateFraming(b);
 const rise = roofRise(b);
 const W = b.width * FT;
 const L = b.length * FT;
 const H = b.eaveHeight * FT;

 // Inset from all exterior faces so lumber stays behind wall/roof metal
 const insetX = 0.55; // off eave walls
 const insetZ = 0.65; // off gable ends (no end truss flush with gable metal)
 const underRoof = 0.28; // below roof plane

 const trussMat = new THREE.MeshStandardMaterial({
 color: 0xd4b896,
 roughness: 0.72,
 metalness: 0.02,
 emissive: 0x1a1008,
 emissiveIntensity: 0.06,
 // Don't cast shadows onto exterior metal (reads as "outside" lines)
 // shadow still ok on interior
 });
 const purlinMat = new THREE.MeshStandardMaterial({
 color: 0xc4a882,
 roughness: 0.7,
 metalness: 0.02,
 });
 const bearerMat = new THREE.MeshStandardMaterial({
 color: 0xc49a6c,
 roughness: 0.68,
 metalness: 0.02,
 });

 const xL = insetX;
 const xR = W - insetX;
 const z0 = insetZ;
 const z1 = L - insetZ;
 const runL = Math.max(1, z1 - z0);

 // Eave truss carriers — inside wall line, under eave
 const bearerH = 0.26;
 const bearerD = 0.2;
 for (const x of [xL, xR]) {
 const bearer = new THREE.Mesh(
 new THREE.BoxGeometry(bearerD, bearerH, runL),
 bearerMat,
 );
 bearer.position.set(x, H - 0.05, L / 2);
 bearer.castShadow = false;
 bearer.receiveShadow = true;
 group.add(bearer);
 }

 // Trusses — never at exact gable plane; inset along length
 const count = Math.max(2, framing.trusses?.count || 2);
 for (let i = 0; i < count; i++) {
 // Map stations into [z0, z1] so end trusses stay inside gable metal
 const t = count === 1 ? 0.5 : i / (count - 1);
 const z = z0 + t * (z1 - z0);
 if ((b.roofStyle || 'gable') === 'gable') {
 const ridgeY = H + rise - underRoof;
 const eaveY = H - 0.04;
 // Top chords stop short of walls
 this._woodBeam(group, xL, eaveY, z, W / 2, ridgeY, z, trussMat, 0.13, 0.18);
 this._woodBeam(group, W / 2, ridgeY, z, xR, eaveY, z, trussMat, 0.13, 0.18);
 // Bottom chord
 this._woodBeam(group, xL + 0.05, eaveY, z, xR - 0.05, eaveY, z, trussMat, 0.11, 0.16);
 // Webs
 this._woodBeam(
 group,
 W * 0.28,
 eaveY,
 z,
 W / 2,
 H + rise * 0.5 - underRoof,
 z,
 trussMat,
 0.08,
 0.1,
 );
 this._woodBeam(
 group,
 W * 0.72,
 eaveY,
 z,
 W / 2,
 H + rise * 0.5 - underRoof,
 z,
 trussMat,
 0.08,
 0.1,
 );
 this._woodBeam(group, W / 2, eaveY, z, W / 2, ridgeY, z, trussMat, 0.09, 0.09);
 } else {
 const yHigh = H + rise - underRoof;
 const yLow = H - 0.04;
 this._woodBeam(group, xL, yHigh, z, xR, yLow, z, trussMat, 0.13, 0.18);
 this._woodBeam(group, xL + 0.05, H - 0.04, z, xR - 0.05, H - 0.04, z, trussMat, 0.11, 0.14);
 }
 }

 // Purlins — well under roof skin, short of gable ends, inset from eaves
 // t=0 near eave (inset), t=1 near ridge — never at outer metal edge
 const purlinSp = (b.purlinSpacingIn || 24) / 12;
 const halfRun = W / 2 - insetX;
 const rows =
 framing.purlins?.rowsPerSide || Math.max(3, Math.ceil(halfRun / purlinSp) + 1);
 const sides = (b.roofStyle || 'gable') === 'mono' ? 1 : 2;
 const purlinLen = runL * 0.98;
 for (let side = 0; side < sides; side++) {
 for (let r = 1; r < rows; r++) {
 const t = r / Math.max(1, rows - 1); // 0 eave → 1 ridge; start at r=1
 let x;
 let y;
 if ((b.roofStyle || 'gable') === 'mono') {
 x = xL + t * (xR - xL);
 y = H + rise * (1 - t) - underRoof;
 } else {
 const mid = W / 2;
 // left slope: eave at xL → ridge mid; right slope: eave xR → ridge mid
 x = side === 0 ? xL + t * (mid - xL) : xR - t * (xR - mid);
 y = H + t * rise - underRoof;
 }
 const purlin = new THREE.Mesh(
 new THREE.BoxGeometry(0.12, 0.1, purlinLen),
 purlinMat,
 );
 purlin.position.set(x, y, L / 2);
 if ((b.roofStyle || 'gable') === 'gable') {
 const ang = Math.atan2(rise, W / 2);
 purlin.rotation.z = side === 0 ? ang : -ang;
 } else {
 purlin.rotation.z = -Math.atan2(rise, W);
 }
 purlin.castShadow = false;
 purlin.receiveShadow = true;
 group.add(purlin);
 }
 }
 }

 /**
   * Wall frame: posts, girts, optional skirt.
   * Roof structure is drawn separately via _addInteriorRoofStructure.
   * @param {{ openWallPostsOnly?: boolean, skipRoofStructure?: boolean }} [opts]
   */
 _addFraming(group, b, opts = {}) {
 const framing = generateFraming(b);
 const rise = roofRise(b);
 const W = b.width;
 const L = b.length;
 const H = b.eaveHeight;
 const openOnly = !!opts.openWallPostsOnly;

 // Distinct colors for frame parts (brighter when Frame view is on)
 const postMat = new THREE.MeshStandardMaterial({
 color: 0xc4a06a,
 roughness: 0.75,
 metalness: 0.02,
 emissive: 0x2a1808,
 emissiveIntensity: 0.08,
 });
 const gablePostMat = new THREE.MeshStandardMaterial({
 color: 0xd4b07a,
 roughness: 0.75,
 metalness: 0.02,
 });
 const jambMat = new THREE.MeshStandardMaterial({
 color: 0xe8b060,
 roughness: 0.65,
 metalness: 0.05,
 emissive: 0x3a2000,
 emissiveIntensity: 0.18,
 });
 const girtMat = new THREE.MeshStandardMaterial({
 color: 0x8fd4a0,
 roughness: 0.7,
 metalness: 0.02,
 emissive: 0x0a2810,
 emissiveIntensity: 0.15,
 });

 // ── Posts (6x6 visual ~0.5') — main only; lean posts always drawn in _addLeanTo ──
 const postSize = 0.55;
 for (const p of framing.mainPosts || []) {
 // Skin-only + open walls: only posts that touch an open face
 if (openOnly) {
 const walls = p.walls || [];
 if (!walls.some((w) => isWallOpen(b, w))) continue;
 }
 const h = Math.max(0.5, (p.heightAboveGrade || H) * FT);
 let mat = postMat;
 if (p.openingJamb) mat = jambMat;
 else if (p.role === 'gable' || p.role === 'peak') mat = gablePostMat;
 const mesh = new THREE.Mesh(new THREE.BoxGeometry(postSize, h, postSize), mat);
 mesh.position.set(p.x * FT, h / 2, p.z * FT);
 mesh.castShadow = true;
 mesh.userData = { kind: 'post', openingJamb: !!p.openingJamb };
 group.add(mesh);
 }

 // Skin-only open-wall view: posts only
 if (openOnly) return;

 // ── Girts (horizontal) — only on closed walls ──
 const girtW = 0.2;
 const girtH = 0.18;
 const girtWalls = framing.girts?.walls || ['front', 'back', 'left', 'right'];
 const girtSet = new Set(girtWalls);
 for (const y of framing.girts.levels || []) {
 if (girtSet.has('front') || girtSet.has('back')) {
 for (const z of [0, L]) {
 const wall = z === 0 ? 'front' : 'back';
 if (!girtSet.has(wall)) continue;
 const girt = new THREE.Mesh(new THREE.BoxGeometry(W, girtH, girtW), girtMat);
 girt.position.set(W / 2, y, z);
 girt.castShadow = true;
 group.add(girt);
 }
 }
 if (girtSet.has('left') || girtSet.has('right')) {
 for (const x of [0, W]) {
 const wall = x === 0 ? 'left' : 'right';
 if (!girtSet.has(wall)) continue;
 const girt = new THREE.Mesh(new THREE.BoxGeometry(girtW, girtH, L), girtMat);
 girt.position.set(x, y, L / 2);
 girt.castShadow = true;
 group.add(girt);
 }
 }
 }

 // Roof structure already drawn by _addInteriorRoofStructure when skipRoofStructure
 if (!opts.skipRoofStructure) {
 this._addInteriorRoofStructure(group, b);
 }

 // Skirt boards only when framing view (not as exterior concrete curb)
 if (this.showFraming && !this.showMetal) {
 const skirtMat = new THREE.MeshStandardMaterial({ color: 0x5a4030, roughness: 0.9 });
 for (const [x1, z1, x2, z2] of [
 [0, 0, W, 0],
 [0, L, W, L],
 [0, 0, 0, L],
 [W, 0, W, L],
 ]) {
 const dx = x2 - x1;
 const dz = z2 - z1;
 const len = Math.hypot(dx, dz);
 const skirt = new THREE.Mesh(new THREE.BoxGeometry(len, 0.28, 0.14), skirtMat);
 skirt.position.set((x1 + x2) / 2, 0.2, (z1 + z2) / 2);
 if (Math.abs(dz) > Math.abs(dx)) skirt.rotation.y = Math.PI / 2;
 group.add(skirt);
 }
 }
 }

 /** Place a wood beam between two points (world ft). */
 _woodBeam(group, x1, y1, z1, x2, y2, z2, mat, thickness = 0.15, depth = 0.2) {
 const a = new THREE.Vector3(x1, y1, z1);
 const c = new THREE.Vector3(x2, y2, z2);
 const dir = new THREE.Vector3().subVectors(c, a);
 const len = dir.length();
 if (len < 0.01) return;
 const beam = new THREE.Mesh(
 new THREE.BoxGeometry(thickness, depth, len),
 mat,
 );
 beam.position.copy(a).add(c).multiplyScalar(0.5);
 // orient local Z along dir
 const quat = new THREE.Quaternion();
 quat.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().normalize());
 beam.quaternion.copy(quat);
 // No cast shadow — exterior metal would show truss “shadow lines” outside
 beam.castShadow = false;
 beam.receiveShadow = true;
 group.add(beam);
 }

 _addDimLabels(group, b, W, L, H) {
 const makeLabel = (text, x, y, z) => {
 const canvas = document.createElement('canvas');
 canvas.width = 512;
 canvas.height = 128;
 const ctx = canvas.getContext('2d');
 ctx.clearRect(0, 0, 512, 128);
 // pill background
 ctx.fillStyle = 'rgba(18, 12, 24, 0.82)';
 roundRect(ctx, 16, 24, 480, 80, 16);
 ctx.fill();
 ctx.strokeStyle = 'rgba(232, 135, 26, 0.85)';
 ctx.lineWidth = 4;
 roundRect(ctx, 16, 24, 480, 80, 16);
 ctx.stroke();
 ctx.fillStyle = '#f5b942';
 ctx.font = 'bold 48px Segoe UI, Arial, sans-serif';
 ctx.textAlign = 'center';
 ctx.textBaseline = 'middle';
 ctx.fillText(text, 256, 64);
 const tex = new THREE.CanvasTexture(canvas);
 setTextureColorSpace(tex, true);
 const spr = new THREE.Sprite(
 new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }),
 );
 spr.scale.set(12, 3, 1);
 spr.position.set(x, y, z);
 group.add(spr);
 this._labelSprites.push(spr);
 };

 makeLabel(`Front ${b.width}'`, W / 2, 1.2, -4.5);
 makeLabel(`Side ${b.length}'`, W + 5, 1.2, L / 2);
 makeLabel(`Eave ${b.eaveHeight}'`, -4.5, H / 2, L / 2);
 makeLabel(`${b.pitch}/12`, W / 2, H + roofRise(b) + 3.5, L / 2);
 }

 /* ───────────── Interaction (unchanged logic) ───────────── */

 _ndc(event) {
 const rect = this.canvas.getBoundingClientRect();
 this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
 this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
 }

 /**
   * Left-edge offset (ft) along the wall for an opening of `width`, centered on click.
   * Handles both unrotated skin pick boxes (eave walls use local Z) and rotated
   * full-wall pick planes (local X along the wall).
   */
 _offsetOnWall(wallMesh, point, width) {
 const local = wallMesh.worldToLocal(point.clone());
 const wallLen = Number(wallMesh.userData.wallLength) || 0;
 const wall = wallMesh.userData.wall;
 const yaw = wallMesh.rotation?.y || 0;
 const rotated = Math.abs(yaw) > 0.05;
 // Rotated pick walls & front/back skin picks: along-wall is local X
 // Unrotated left/right skin picks: along-wall is local Z
 let along;
 if (rotated || wall === 'front' || wall === 'back') {
 along = local.x + wallLen / 2;
 } else if (wall === 'left' || wall === 'right') {
 along = local.z + wallLen / 2;
 } else {
 along =
 Math.abs(local.x) >= Math.abs(local.z)
 ? local.x + wallLen / 2
 : local.z + wallLen / 2;
 }
 let offset = along - width / 2;
 offset = Math.max(0, Math.min(Math.max(0, wallLen - width), offset));
 return Math.round(offset * 10) / 10;
 }

 _onPointerDown(event) {
 if (event.button !== 0) return;
 this._ndc(event);
 this.raycaster.setFromCamera(this.pointer, this.camera);

 if (this.mode === 'move-opening') {
 const openHits = this.raycaster.intersectObjects(this.openingMeshes, false);
 if (openHits.length) {
 const mesh = openHits[0].object;
 const ud = mesh.userData;
 this.selectedOpeningId = ud.openingId;
 const wallMesh = this.pickables.find(
 (w) =>
 w.userData.buildingId === ud.buildingId &&
 w.userData.host === (ud.host || 'main') &&
 (ud.host === 'main' || !ud.host
 ? w.userData.wall === ud.wall
 : w.userData.face === ud.face),
 );
 this._drag = {
 buildingId: ud.buildingId,
 openingId: ud.openingId,
 wallMesh: wallMesh || null,
 width: ud.width,
 host: ud.host || 'main',
 face: ud.face || 'main',
 wall: ud.wall,
 };
 if (this.controls) this.controls.enabled = false;
 this.canvas.style.cursor = 'grabbing';
 this.canvas.setPointerCapture?.(event.pointerId);
 if (this.handlers.onOpeningClick) this.handlers.onOpeningClick(ud);
 this.rebuild();
 return;
 }
 }

 if (this.mode === 'open-wall') {
 // Main wall OR enclosed lean-to face
 const hits = this.raycaster.intersectObjects(this.pickables, false);
 let ud = null;
 for (const h of hits) {
 const d = h.object?.userData;
 if (!d || d.kind !== 'wall') continue;
 // Main: host main/missing. Lean: host is lean id + face
 if (!d.host || d.host === 'main') {
 if (!d.wall) continue;
 ud = d;
 break;
 }
 // Lean-to face
 if (d.leanToId || d.host) {
 if (!d.face) continue;
 ud = d;
 break;
 }
 }
 if (!ud) {
 if (this.handlers.onOpenWallClick) {
 this.handlers.onOpenWallClick({ buildingId: null, wall: null, miss: true });
 }
 return;
 }
 if (this.handlers.onOpenWallClick) {
 const isLean = ud.host && ud.host !== 'main';
 this.handlers.onOpenWallClick({
 buildingId: ud.buildingId,
 wall: ud.wall,
 leanToId: isLean ? ud.leanToId || ud.host : null,
 face: isLean ? ud.face : null,
 });
 }
 return;
 }

 if (this.mode === 'place-opening' && this.placeOpeningDraft) {
 const hits = this.raycaster.intersectObjects(this.pickables, false);
 if (!hits.length) return;
 const hit = hits[0];
 const ud = hit.object.userData;
 if (ud.kind !== 'wall') return;
 // Block placing openings on open drive-through walls (main or lean)
 if (ud.openWall) return;
 const draft = this.placeOpeningDraft;
 const offset = this._offsetOnWall(hit.object, hit.point, draft.width);
 if (this.handlers.onWallClick) {
 this.handlers.onWallClick({
 buildingId: ud.buildingId,
 wall: ud.wall,
 offset,
 type: draft.type,
 width: draft.width,
 height: draft.height,
 sillHeight: draft.sillHeight ?? 0,
 host: ud.host || 'main',
 face: ud.face || 'main',
 });
 }
 return;
 }

 if (this.mode === 'place-prop' && this.placePropDraft) {
 const targets = this._groundPick ? [this._groundPick] : [];
 const hits = this.raycaster.intersectObjects(targets, false);
 if (!hits.length) return;
 const pt = hits[0].point;
 if (this.handlers.onGroundClick) {
 this.handlers.onGroundClick({
 x: Math.round(pt.x * 10) / 10,
 z: Math.round(pt.z * 10) / 10,
 type: this.placePropDraft.type,
 });
 }
 return;
 }

 // Click a prop to select (orbit mode)
 if (this.mode === 'orbit' && this.propPickables.length) {
 const hits = this.raycaster.intersectObjects(this.propPickables, true);
 if (hits.length) {
 let obj = hits[0].object;
 while (obj && obj.userData?.kind !== 'prop' && obj.parent) obj = obj.parent;
 const propId = obj?.userData?.propId || hits[0].object.userData?.propId;
 if (propId && this.handlers.onPropClick) {
 this.handlers.onPropClick({ propId });
 }
 }
 }
 }

 _onPointerMove(event) {
 if (!this._drag) return;
 this._ndc(event);
 this.raycaster.setFromCamera(this.pointer, this.camera);
 let wallMesh = this._drag.wallMesh;
 const hits = this.raycaster.intersectObjects(this.pickables, false);
 if (hits.length) {
 const h = hits[0];
 if (
 h.object.userData.buildingId === this._drag.buildingId &&
 h.object.userData.host === this._drag.host &&
 (this._drag.host === 'main'
 ? h.object.userData.wall === this._drag.wall
 : h.object.userData.face === this._drag.face)
 ) {
 wallMesh = h.object;
 this._drag.wallMesh = wallMesh;
 }
 }
 if (!wallMesh) return;
 const planeHits = this.raycaster.intersectObject(wallMesh, false);
 if (!planeHits.length) return;
 const offset = this._offsetOnWall(wallMesh, planeHits[0].point, this._drag.width);
 const mesh = this.openingMeshes.find((m) => m.userData.openingId === this._drag.openingId);
 if (mesh && this.project) {
 const b = this.project.buildings.find((x) => x.id === this._drag.buildingId);
 const o = b?.openings?.find((x) => x.id === this._drag.openingId);
 if (o && (!o.host || o.host === 'main')) {
 const pos = this._openingWorldPos(b, { ...o, offset });
 mesh.position.copy(pos.position);
 }
 }
 this._drag.pendingOffset = offset;
 if (this.handlers.onOpeningMove) {
 this.handlers.onOpeningMove({
 buildingId: this._drag.buildingId,
 openingId: this._drag.openingId,
 offset,
 live: true,
 });
 }
 }

 _onPointerUp(event) {
 if (!this._drag) return;
 const d = this._drag;
 this._drag = null;
 if (this.controls) this.controls.enabled = this.mode === 'orbit' || true;
 this.canvas.style.cursor = this.mode === 'move-opening' ? 'grab' : 'default';
 try {
 this.canvas.releasePointerCapture?.(event.pointerId);
 } catch (_) {}
 if (d.pendingOffset != null && this.handlers.onOpeningMove) {
 this.handlers.onOpeningMove({
 buildingId: d.buildingId,
 openingId: d.openingId,
 offset: d.pendingOffset,
 live: false,
 });
 }
 }
}

function roundRect(ctx, x, y, w, h, r) {
 ctx.beginPath();
 ctx.moveTo(x + r, y);
 ctx.arcTo(x + w, y, x + w, y + h, r);
 ctx.arcTo(x + w, y + h, x, y + h, r);
 ctx.arcTo(x, y + h, x, y, r);
 ctx.arcTo(x, y, x + w, y, r);
 ctx.closePath();
}
