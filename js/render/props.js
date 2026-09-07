/**
 * Stylized site props for sales staging — people, animals, vehicles.
 * Procedural Three.js meshes (no external model files).
 */

import * as THREE from 'three';

function mat(color, opts = {}) {
 return new THREE.MeshStandardMaterial({
 color,
 roughness: opts.roughness ?? 0.72,
 metalness: opts.metalness ?? 0.05,
 flatShading: opts.flat ?? false,
 });
}

function addBox(parent, w, h, d, color, x, y, z, opts = {}) {
 const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, opts));
 m.position.set(x, y, z);
 m.castShadow = true;
 m.receiveShadow = true;
 if (opts.ry) m.rotation.y = opts.ry;
 if (opts.rx) m.rotation.x = opts.rx;
 if (opts.rz) m.rotation.z = opts.rz;
 parent.add(m);
 return m;
}

function addCyl(parent, rTop, rBot, h, color, x, y, z, opts = {}) {
 const m = new THREE.Mesh(
 new THREE.CylinderGeometry(rTop, rBot, h, opts.seg || 10),
 mat(color, opts),
 );
 m.position.set(x, y, z);
 m.castShadow = true;
 m.receiveShadow = true;
 if (opts.rx) m.rotation.x = opts.rx;
 if (opts.rz) m.rotation.z = opts.rz;
 if (opts.ry) m.rotation.y = opts.ry;
 parent.add(m);
 return m;
}

function addSphere(parent, r, color, x, y, z, opts = {}) {
 const m = new THREE.Mesh(
 new THREE.SphereGeometry(r, opts.seg || 12, opts.segY || 10),
 mat(color, opts),
 );
 m.position.set(x, y, z);
 m.castShadow = true;
 parent.add(m);
 return m;
}

/** Adult figure facing +Z. height ~5.8–6 ft. */
function buildPerson(kind = 'man') {
 const g = new THREE.Group();
 const isWoman = kind === 'woman';
 const skin = isWoman ? 0xe8c4a8 : 0xd4a574;
 const shirt = isWoman ? 0x6b4c9a : 0x2c5aa0;
 const pants = isWoman ? 0x3a3a48 : 0x2a3540;
 const hair = isWoman ? 0x3b2218 : 0x1a1410;
 const scaleY = isWoman ? 0.94 : 1;
 const shoulder = isWoman ? 0.42 : 0.5;

 // Legs
 addCyl(g, 0.1, 0.12, 1.55, pants, -0.14, 0.78, 0);
 addCyl(g, 0.1, 0.12, 1.55, pants, 0.14, 0.78, 0);
 // Shoes
 addBox(g, 0.22, 0.12, 0.38, 0x222226, -0.14, 0.06, 0.06);
 addBox(g, 0.22, 0.12, 0.38, 0x222226, 0.14, 0.06, 0.06);
 // Torso
 addBox(g, shoulder * 2, isWoman ? 1.15 : 1.25, 0.32, shirt, 0, 2.15 * scaleY, 0);
 // Arms
 const armY = 2.2 * scaleY;
 addCyl(g, 0.08, 0.09, 1.15, shirt, -shoulder - 0.06, armY - 0.2, 0, { rz: 0.12 });
 addCyl(g, 0.08, 0.09, 1.15, shirt, shoulder + 0.06, armY - 0.2, 0, { rz: -0.12 });
 // Hands
 addSphere(g, 0.09, skin, -shoulder - 0.12, armY - 0.75, 0.05, { seg: 8 });
 addSphere(g, 0.09, skin, shoulder + 0.12, armY - 0.75, 0.05, { seg: 8 });
 // Neck + head
 addCyl(g, 0.1, 0.12, 0.22, skin, 0, 2.85 * scaleY, 0, { seg: 8 });
 addSphere(g, isWoman ? 0.28 : 0.3, skin, 0, 3.2 * scaleY, 0.02);
 // Hair
 if (isWoman) {
 addSphere(g, 0.3, hair, 0, 3.28 * scaleY, -0.04, { seg: 10 });
 addBox(g, 0.22, 0.55, 0.18, hair, 0, 2.95 * scaleY, -0.22);
 } else {
 addSphere(g, 0.28, hair, 0, 3.35 * scaleY, -0.02, { seg: 10 });
 addBox(g, 0.5, 0.12, 0.42, hair, 0, 3.38 * scaleY, 0);
 }
 // Simple face dots (eyes)
 addSphere(g, 0.035, 0x1a1a1a, -0.09, 3.22 * scaleY, 0.26, { seg: 6 });
 addSphere(g, 0.035, 0x1a1a1a, 0.09, 3.22 * scaleY, 0.26, { seg: 6 });

 g.scale.setScalar(1);
 return g;
}

function buildDog() {
 const g = new THREE.Group();
 const fur = 0x8b6914;
 const dark = 0x5a4210;
 // Body
 addBox(g, 0.55, 0.45, 1.1, fur, 0, 0.85, 0);
 // Head
 addBox(g, 0.38, 0.35, 0.42, fur, 0, 1.0, 0.7);
 addBox(g, 0.22, 0.16, 0.28, dark, 0, 0.88, 0.95); // snout
 addSphere(g, 0.05, 0x111111, 0, 0.9, 1.1, { seg: 6 }); // nose
 // Ears
 addBox(g, 0.12, 0.28, 0.08, dark, -0.16, 1.22, 0.62, { rz: 0.25 });
 addBox(g, 0.12, 0.28, 0.08, dark, 0.16, 1.22, 0.62, { rz: -0.25 });
 // Legs
 for (const [x, z] of [
 [-0.18, 0.35],
 [0.18, 0.35],
 [-0.18, -0.35],
 [0.18, -0.35],
 ]) {
 addCyl(g, 0.06, 0.07, 0.55, fur, x, 0.3, z, { seg: 6 });
 }
 // Tail
 addCyl(g, 0.04, 0.05, 0.45, dark, 0, 1.05, -0.6, { rx: 0.9, seg: 6 });
 // Collar
 addCyl(g, 0.2, 0.2, 0.06, 0xc02828, 0, 1.05, 0.48, { seg: 10 });
 return g;
}

function buildHorse() {
 const g = new THREE.Group();
 const coat = 0x6b4423;
 const mane = 0x2a1810;
 const dark = 0x1a120c;
 // Body
 addBox(g, 1.1, 1.15, 2.2, coat, 0, 3.0, 0);
 // Neck
 addBox(g, 0.45, 1.0, 0.7, coat, 0, 3.7, 1.15, { rx: -0.35 });
 // Head
 addBox(g, 0.4, 0.45, 0.85, coat, 0, 4.35, 1.55);
 addBox(g, 0.28, 0.25, 0.4, coat, 0, 4.2, 2.05); // muzzle
 // Mane
 addBox(g, 0.12, 0.7, 0.9, mane, 0, 4.1, 1.1);
 // Ears
 addBox(g, 0.1, 0.25, 0.08, coat, -0.12, 4.7, 1.35);
 addBox(g, 0.1, 0.25, 0.08, coat, 0.12, 4.7, 1.35);
 // Legs
 const legH = 2.4;
 for (const [x, z] of [
 [-0.35, 0.7],
 [0.35, 0.7],
 [-0.35, -0.75],
 [0.35, -0.75],
 ]) {
 addCyl(g, 0.1, 0.12, legH, coat, x, legH / 2, z, { seg: 8 });
 addBox(g, 0.18, 0.12, 0.28, dark, x, 0.08, z + 0.04);
 }
 // Tail
 addCyl(g, 0.08, 0.14, 1.1, mane, 0, 2.9, -1.25, { rx: 0.5, seg: 8 });
 return g;
}

function buildCow() {
 const g = new THREE.Group();
 const hide = 0xf2efe8;
 const spot = 0x2a2a2e;
 const pink = 0xe8a090;
 // Body
 addBox(g, 1.35, 1.3, 2.4, hide, 0, 2.6, 0);
 // Spots
 addBox(g, 0.55, 0.5, 0.7, spot, -0.35, 2.85, 0.3);
 addBox(g, 0.45, 0.4, 0.55, spot, 0.4, 2.55, -0.5);
 addBox(g, 0.35, 0.35, 0.4, spot, 0.2, 3.0, 0.8);
 // Head
 addBox(g, 0.7, 0.65, 0.7, hide, 0, 3.0, 1.45);
 addBox(g, 0.45, 0.35, 0.45, pink, 0, 2.75, 1.9);
 // Ears
 addBox(g, 0.35, 0.12, 0.2, hide, -0.45, 3.25, 1.4);
 addBox(g, 0.35, 0.12, 0.2, hide, 0.45, 3.25, 1.4);
 // Horns (small)
 addCyl(g, 0.04, 0.05, 0.28, 0xe8e0d0, -0.22, 3.45, 1.5, { rz: 0.4, seg: 6 });
 addCyl(g, 0.04, 0.05, 0.28, 0xe8e0d0, 0.22, 3.45, 1.5, { rz: -0.4, seg: 6 });
 // Legs
 for (const [x, z] of [
 [-0.4, 0.75],
 [0.4, 0.75],
 [-0.4, -0.8],
 [0.4, -0.8],
 ]) {
 addCyl(g, 0.12, 0.14, 1.85, hide, x, 0.95, z, { seg: 8 });
 addBox(g, 0.22, 0.12, 0.28, 0x3a3028, x, 0.08, z + 0.02);
 }
 // Udder
 addSphere(g, 0.28, pink, 0, 1.85, -0.15, { seg: 8 });
 // Tail
 addCyl(g, 0.04, 0.05, 0.9, spot, 0, 2.9, -1.3, { rx: 0.35, seg: 6 });
 return g;
}

/** Chevy-style 2500 crew cab + flatbed, Duramax diesel vibe. Units: feet. */
function buildChevy2500Flatbed() {
 const g = new THREE.Group();
 // Colors — silver/body, black accents, chrome, red taillight
 const body = 0xc8ccd0; // silver
 const dark = 0x1a1c20;
 const chrome = 0xd0d4d8;
 const glass = 0x6a8aa8;
 const bed = 0x3a3e44;
 const accent = 0x8b1e1e; // bowtie-ish red accent

 // —— Wheels (SRW front, DRW rear) ——
 const wheel = (x, z, dual = false) => {
 const make = (ox) => {
 const wh = new THREE.Group();
 const tire = new THREE.Mesh(
 new THREE.CylinderGeometry(0.72, 0.72, 0.38, 16),
 mat(0x1a1a1a, { roughness: 0.9 }),
 );
 tire.rotation.z = Math.PI / 2;
 tire.castShadow = true;
 wh.add(tire);
 const rim = new THREE.Mesh(
 new THREE.CylinderGeometry(0.42, 0.42, 0.4, 12),
 mat(chrome, { metalness: 0.85, roughness: 0.25 }),
 );
 rim.rotation.z = Math.PI / 2;
 wh.add(rim);
 wh.position.set(x + ox, 0.72, z);
 g.add(wh);
 };
 if (dual) {
 make(-0.22);
 make(0.22);
 } else {
 make(0);
 }
 };
 // Track width ~6.5', wheelbase ~ long bed + cab
 wheel(-3.05, 3.4, false);
 wheel(3.05, 3.4, false);
 wheel(-3.15, -2.6, true); // dual rear
 wheel(3.15, -2.6, true);

 // —— Chassis rails ——
 addBox(g, 0.22, 0.28, 14.5, 0x2a2c30, -1.1, 1.0, 0.2, { metalness: 0.4, roughness: 0.6 });
 addBox(g, 0.22, 0.28, 14.5, 0x2a2c30, 1.1, 1.0, 0.2, { metalness: 0.4, roughness: 0.6 });

 // —— Flatbed (rear) ——
 // Deck
 addBox(g, 7.0, 0.18, 8.2, bed, 0, 1.55, -3.0, { metalness: 0.35, roughness: 0.55 });
 // Side rails
 addBox(g, 0.15, 0.55, 8.2, 0x4a5058, -3.45, 1.85, -3.0, { metalness: 0.5 });
 addBox(g, 0.15, 0.55, 8.2, 0x4a5058, 3.45, 1.85, -3.0, { metalness: 0.5 });
 // Headache rack
 addBox(g, 7.0, 2.0, 0.15, 0x4a5058, 0, 2.7, 1.05, { metalness: 0.45 });
 // Crossbars on rack
 for (let i = 0; i < 3; i++) {
 addBox(g, 0.1, 1.7, 0.1, chrome, -2 + i * 2, 2.6, 1.05, { metalness: 0.7 });
 }
 // Stake pockets look
 for (const z of [-6.5, -5, -3.5, -2, -0.5]) {
 addBox(g, 0.2, 0.25, 0.2, dark, -3.45, 1.55, z);
 addBox(g, 0.2, 0.25, 0.2, dark, 3.45, 1.55, z);
 }
 // Mud flaps
 addBox(g, 0.9, 0.9, 0.08, 0x111111, -3.0, 1.0, -6.9);
 addBox(g, 0.9, 0.9, 0.08, 0x111111, 3.0, 1.0, -6.9);

 // —— Cab (crew) ——
 // Lower body / doors
 addBox(g, 6.6, 1.6, 5.6, body, 0, 2.15, 3.5, { metalness: 0.55, roughness: 0.35 });
 // Hood
 addBox(g, 6.4, 0.55, 2.8, body, 0, 2.55, 6.6, { metalness: 0.55, roughness: 0.32 });
 // Cab roof
 addBox(g, 6.2, 0.2, 4.4, body, 0, 4.05, 3.3, { metalness: 0.5, roughness: 0.35 });
 // A-pillars / greenhouse
 addBox(g, 6.1, 1.5, 0.12, glass, 0, 3.35, 5.4, {
 metalness: 0.3,
 roughness: 0.15,
 });
 // Side glass
 addBox(g, 0.1, 1.35, 4.0, glass, -3.25, 3.25, 3.4, { metalness: 0.25, roughness: 0.12 });
 addBox(g, 0.1, 1.35, 4.0, glass, 3.25, 3.25, 3.4, { metalness: 0.25, roughness: 0.12 });
 // Rear cab glass
 addBox(g, 5.8, 1.3, 0.1, glass, 0, 3.25, 1.15, { metalness: 0.25, roughness: 0.12 });
 // Grille
 addBox(g, 4.2, 0.95, 0.15, dark, 0, 2.15, 8.05, { metalness: 0.4 });
 // Chrome bar
 addBox(g, 4.0, 0.12, 0.08, chrome, 0, 2.15, 8.12, { metalness: 0.9, roughness: 0.2 });
 // Bowtie area (red accent plate)
 addBox(g, 0.7, 0.35, 0.08, accent, 0, 2.15, 8.14, { metalness: 0.5, roughness: 0.4 });
 // Bumper
 addBox(g, 6.8, 0.45, 0.5, chrome, 0, 1.15, 8.15, { metalness: 0.85, roughness: 0.25 });
 // Headlights
 addBox(g, 1.1, 0.4, 0.2, 0xf0f4ff, -2.4, 2.2, 8.1, { metalness: 0.4, roughness: 0.2 });
 addBox(g, 1.1, 0.4, 0.2, 0xf0f4ff, 2.4, 2.2, 8.1, { metalness: 0.4, roughness: 0.2 });
 // Side steps
 addBox(g, 0.35, 0.12, 4.5, chrome, -3.45, 1.15, 3.5, { metalness: 0.7 });
 addBox(g, 0.35, 0.12, 4.5, chrome, 3.45, 1.15, 3.5, { metalness: 0.7 });
 // Mirrors
 addBox(g, 0.15, 0.35, 0.55, dark, -3.5, 3.0, 5.5);
 addBox(g, 0.15, 0.35, 0.55, dark, 3.5, 3.0, 5.5);
 // Tail lights on bed
 addBox(g, 0.55, 0.35, 0.12, 0xc02020, -3.0, 1.85, -7.1);
 addBox(g, 0.55, 0.35, 0.12, 0xc02020, 3.0, 1.85, -7.1);
 // Exhaust tip (diesel)
 addCyl(g, 0.12, 0.12, 0.5, chrome, 2.8, 0.85, -7.0, {
 rx: Math.PI / 2,
 metalness: 0.8,
 seg: 8,
 });
 // Badge strip “2500 / DURAMAX” feel
 addBox(g, 1.4, 0.18, 0.06, chrome, 2.2, 1.7, 8.05, { metalness: 0.75 });

 // Center of truck near cab/bed junction for easier placement
 g.position.y = 0;
 return g;
}

/**
 * @param {string} type — SITE_PROP_TYPES key
 * @returns {THREE.Group}
 */
export function buildSitePropMesh(type) {
 switch (type) {
 case 'woman':
 return buildPerson('woman');
 case 'dog':
 return buildDog();
 case 'horse':
 return buildHorse();
 case 'cow':
 return buildCow();
 case 'truck_chevy_2500':
 return buildChevy2500Flatbed();
 case 'man':
 default:
 return buildPerson('man');
 }
}
