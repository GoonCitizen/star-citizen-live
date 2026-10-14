'use strict';

/**
 * Browser entry for the lazy 3D explorer (galaxy / system / body scales).
 * Built to assets/scripts/universe-explorer.js — not inlined into the SPA.
 */

const THREE = require('three');
const { OrbitControls } = require('three/examples/jsm/controls/OrbitControls.js');

function bodyColour (type) {
  const t = String(type || '').toUpperCase();
  if (t === 'STAR') return 0xf5d76e;
  if (t === 'PLANET') return 0x6ea8fe;
  if (t === 'SATELLITE') return 0x9aa3b2;
  if (t === 'JUMPPOINT') return 0xc084fc;
  return 0x88a0b8;
}

function bodyRadius (type, r) {
  const t = String(type || '').toUpperCase();
  if (t === 'STAR') return 1.4;
  if (t === 'PLANET') return 0.55;
  if (t === 'SATELLITE') return 0.28;
  return Math.max(0.18, Math.min(0.7, (Number(r) || 3) / 12));
}

function latLonToVector3 (lat, lon, radius) {
  const latR = (Number(lat) || 0) * Math.PI / 180;
  const lonR = (Number(lon) || 0) * Math.PI / 180;
  const x = radius * Math.cos(latR) * Math.sin(lonR);
  const y = radius * Math.sin(latR);
  const z = radius * Math.cos(latR) * Math.cos(lonR);
  return new THREE.Vector3(x, y, z);
}

/**
 * @param {HTMLElement} container
 * @param {object} opts
 */
function mount (container, opts = {}) {
  const height = Number(opts.height) || 360;
  const mapBase = opts.mapBase || '/services/star-citizen';
  const assetBase = opts.assetBase || '/assets/map';
  let system = String(opts.system || 'STANTON').toUpperCase();
  let bodyToken = opts.body || null;
  let scale = opts.scale || (bodyToken ? 'body' : 'system');
  const onSelect = typeof opts.onSelect === 'function' ? opts.onSelect : null;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070c);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 500);
  camera.position.set(0, 8, 14);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  container.innerHTML = '';
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 1.2;
  controls.maxDistance = 120;

  const ambient = new THREE.AmbientLight(0x8899bb, 0.55);
  scene.add(ambient);
  const key = new THREE.PointLight(0xfff2cc, 1.4, 120);
  key.position.set(0, 0, 0);
  scene.add(key);

  const root = new THREE.Group();
  scene.add(root);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  /** @type {THREE.Object3D[]} */
  let pickables = [];
  const textureLoader = new THREE.TextureLoader();

  function resize () {
    const w = Math.max(1, container.clientWidth || 320);
    const h = Math.max(1, height);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = h + 'px';
  }

  function disposeObject (ch) {
    if (ch.geometry) ch.geometry.dispose();
    if (ch.material) {
      const mats = Array.isArray(ch.material) ? ch.material : [ch.material];
      mats.forEach((m) => {
        if (m.map) m.map.dispose();
        m.dispose();
      });
    }
  }

  function clearBodies () {
    while (root.children.length) {
      const ch = root.children[0];
      root.remove(ch);
      disposeObject(ch);
    }
    pickables = [];
  }

  function applySky (tintHex, textureUrl) {
    if (textureUrl) {
      textureLoader.load(textureUrl, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        scene.background = tex;
      }, undefined, () => {
        scene.background = new THREE.Color(tintHex || 0x05070c);
      });
    } else {
      scene.background = new THREE.Color(tintHex || 0x05070c);
    }
  }

  async function loadGalaxy () {
    clearBodies();
    applySky(0x080a12, assetBase + '/tiles/starfield-02.png');
    const res = await fetch(mapBase + '/locations/map?view=galaxy', { cache: 'no-store' });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || res.statusText);
    const layout = j.data || j;
    for (const e of layout.edges || []) {
      const g = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3((e.x1 - 0.5) * 24, 0, (e.y1 - 0.5) * 24),
        new THREE.Vector3((e.x2 - 0.5) * 24, 0, (e.y2 - 0.5) * 24)
      ]);
      const line = new THREE.Line(g, new THREE.LineBasicMaterial({
        color: 0x5878a8,
        transparent: true,
        opacity: 0.45
      }));
      root.add(line);
    }
    for (const s of layout.systems || []) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.45, 16, 12),
        new THREE.MeshStandardMaterial({
          color: 0xf5d76e,
          emissive: 0xf5d76e,
          emissiveIntensity: 0.5
        })
      );
      mesh.position.set((s.nx - 0.5) * 24, 0, (s.ny - 0.5) * 24);
      mesh.userData = {
        name: s.name || s.code,
        code: s.code,
        type: 'SYSTEM',
        kind: 'system'
      };
      root.add(mesh);
      pickables.push(mesh);
    }
    controls.target.set(0, 0, 0);
    camera.position.set(0, 18, 28);
    controls.update();
  }

  async function loadSystem (code) {
    system = String(code || 'STANTON').toUpperCase();
    clearBodies();
    let tint = 0x0b0e14;
    let starfield = assetBase + '/tiles/starfield-01.png';
    try {
      const manRes = await fetch(assetBase + '/manifest.json', { cache: 'force-cache' });
      if (manRes.ok) {
        const man = await manRes.json();
        const sys = (man.systems && man.systems[system]) || {};
        const def = man.defaults || {};
        const tintStr = sys.tint || def.tint;
        if (tintStr) tint = new THREE.Color(tintStr).getHex();
        const sf = sys.starfield || def.starfield;
        if (sf) starfield = assetBase + '/' + String(sf).replace(/^\/+/, '');
      }
    } catch (_) {}
    applySky(tint, starfield);

    const params = new URLSearchParams();
    params.set('system', system);
    params.set('hotspots', '0');
    const res = await fetch(mapBase + '/locations/map?' + params.toString(), { cache: 'no-store' });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || res.statusText);
    const layout = j.data || j;
    const bodies = layout.bodies || [];

    let maxR = 0.5;
    for (const b of bodies) {
      const nx = Number(b.nx);
      const ny = Number(b.ny);
      if (!Number.isFinite(nx) || !Number.isFinite(ny)) continue;
      maxR = Math.max(maxR, Math.hypot((nx - 0.5) * 20, (ny - 0.5) * 20));
    }
    const sc = 10 / Math.max(maxR, 1);

    for (const b of bodies) {
      const nx = Number(b.nx);
      const ny = Number(b.ny);
      if (!Number.isFinite(nx) || !Number.isFinite(ny)) continue;
      const isStar = String(b.type).toUpperCase() === 'STAR';
      const mat = new THREE.MeshStandardMaterial({
        color: bodyColour(b.type),
        emissive: isStar ? 0xf5d76e : 0x000000,
        emissiveIntensity: isStar ? 0.85 : 0,
        roughness: 0.55,
        metalness: 0.15
      });
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(bodyRadius(b.type, b.r), 24, 18),
        mat
      );
      mesh.position.set((nx - 0.5) * 20 * sc, 0, (ny - 0.5) * 20 * sc);
      mesh.userData = {
        name: b.name || b.code,
        code: b.code,
        type: b.type,
        kind: 'body',
        slug: b.slug || null,
        surfaceTile: b.surfaceTile || null
      };
      if (b.surfaceTile) {
        const url = assetBase + '/' + String(b.surfaceTile).replace(/^\/+/, '');
        textureLoader.load(url, (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          mat.map = tex;
          if (!isStar) mat.color.set(0xffffff);
          mat.needsUpdate = true;
        });
      }
      root.add(mesh);
      pickables.push(mesh);
    }

    controls.target.set(0, 0, 0);
    camera.position.set(0, 6 + sc * 2, 12 + sc * 3);
    controls.update();
  }

  async function loadBody (code, token) {
    system = String(code || 'STANTON').toUpperCase();
    bodyToken = token;
    clearBodies();
    applySky(0x05070c, assetBase + '/tiles/starfield-01.png');

    const params = new URLSearchParams();
    params.set('view', 'body');
    params.set('system', system);
    params.set('body', token);
    const res = await fetch(mapBase + '/locations/map?' + params.toString(), { cache: 'no-store' });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || res.statusText);
    const layout = j.data || j;
    if (!layout.body) throw new Error('body not found');

    const radius = layout.body.type === 'STAR' ? 3.2 : 2.6;
    const mat = new THREE.MeshStandardMaterial({
      color: 0x888888,
      roughness: 0.7,
      metalness: 0.1,
      emissive: layout.body.type === 'STAR' ? 0xf5d76e : 0x000000,
      emissiveIntensity: layout.body.type === 'STAR' ? 0.7 : 0
    });
    const globe = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 36), mat);
    globe.userData = {
      name: layout.body.name,
      code: layout.body.code,
      type: layout.body.type,
      kind: 'body'
    };
    root.add(globe);
    pickables.push(globe);

    if (layout.surfaceTile) {
      const url = assetBase + '/' + String(layout.surfaceTile).replace(/^\/+/, '');
      textureLoader.load(url, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        mat.map = tex;
        mat.color.set(0xffffff);
        mat.needsUpdate = true;
      });
    }

    for (const p of layout.pois || []) {
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(0.06, 10, 8),
        new THREE.MeshStandardMaterial({
          color: p.hotspot ? 0xd29922 : 0x3fb950,
          emissive: p.hotspot ? 0xd29922 : 0x3fb950,
          emissiveIntensity: 0.4
        })
      );
      marker.position.copy(latLonToVector3(p.latitude, p.longitude, radius + 0.08));
      marker.userData = {
        name: p.name,
        slug: p.slug,
        type: p.type,
        kind: 'poi'
      };
      root.add(marker);
      pickables.push(marker);
    }

    for (const s of layout.satellites || []) {
      const moon = new THREE.Mesh(
        new THREE.SphereGeometry(0.22, 16, 12),
        new THREE.MeshStandardMaterial({ color: 0xc8d0e0, roughness: 0.6 })
      );
      moon.position.set((s.nx - 0.5) * 8, 0.2, (s.ny - 0.5) * 8);
      moon.userData = {
        name: s.name,
        code: s.code,
        type: 'SATELLITE',
        kind: 'body',
        slug: s.slug || null
      };
      root.add(moon);
      pickables.push(moon);
    }

    controls.target.set(0, 0, 0);
    camera.position.set(0, radius * 1.2, radius * 3.2);
    controls.minDistance = radius * 1.15;
    controls.update();
  }

  async function loadView () {
    if (scale === 'galaxy') return loadGalaxy();
    if (scale === 'body' && bodyToken) return loadBody(system, bodyToken);
    return loadSystem(system);
  }

  function onPointer (ev) {
    if (!onSelect || !pickables.length) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(pickables, false);
    if (!hits.length) return;
    const obj = hits[0].object;
    const ud = obj.userData || {};
    const payload = {
      slug: ud.slug || null,
      name: ud.name || ud.code,
      token: ud.code || ud.name,
      code: ud.code || null,
      type: ud.type || null,
      kind: ud.kind || 'body'
    };
    const tOrbital = String(ud.type || '').toUpperCase();
    const shouldZoom = ud.kind === 'body' &&
      (tOrbital === 'STAR' || tOrbital === 'PLANET' || tOrbital === 'SATELLITE' || tOrbital === 'MOON');
    if (shouldZoom && scale === 'system') {
      const target = obj.position.clone();
      const startCam = camera.position.clone();
      const startTgt = controls.target.clone();
      const endTgt = target.clone();
      const endCam = target.clone().add(new THREE.Vector3(0, 1.2, 3.2));
      const t0 = performance.now();
      const dur = 380;
      function anim (now) {
        const u = Math.min(1, (now - t0) / dur);
        const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
        camera.position.lerpVectors(startCam, endCam, e);
        controls.target.lerpVectors(startTgt, endTgt, e);
        controls.update();
        if (u < 1) requestAnimationFrame(anim);
        else onSelect(payload);
      }
      requestAnimationFrame(anim);
      return;
    }
    onSelect(payload);
  }

  renderer.domElement.addEventListener('click', onPointer);

  let raf = 0;
  let alive = true;
  function tick () {
    if (!alive) return;
    raf = requestAnimationFrame(tick);
    controls.update();
    renderer.render(scene, camera);
  }

  const onResize = () => resize();
  window.addEventListener('resize', onResize);
  resize();
  tick();

  const loadP = loadView().catch((err) => {
    console.warn('[UniverseExplorer]', err);
  });

  return {
    setSystem (code) {
      system = String(code || 'STANTON').toUpperCase();
      bodyToken = null;
      scale = 'system';
      controls.minDistance = 1.2;
      return loadSystem(system);
    },
    setScale (next) {
      scale = next.scale || scale;
      if (next.system) system = String(next.system).toUpperCase();
      bodyToken = next.body != null ? next.body : bodyToken;
      controls.minDistance = 1.2;
      return loadView();
    },
    ready: loadP,
    dispose () {
      alive = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      renderer.domElement.removeEventListener('click', onPointer);
      clearBodies();
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    }
  };
}

const api = { mount, THREE };
if (typeof window !== 'undefined') {
  window.GoonUniverseExplorer = api;
}

module.exports = api;
