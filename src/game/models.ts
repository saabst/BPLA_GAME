import * as THREE from 'three';
import type { CameraMode, MissionDef, TargetBlueprint, TargetKind } from './types';
import { getWindowSpec, HQ_BUILDING_DIMENSIONS } from './windowStrike';

export interface DualModeEntry {
  mat: THREE.MeshStandardMaterial | THREE.MeshBasicMaterial;
  eoColor: THREE.Color;
  eoEmissive: THREE.Color;
  flirVal: number; // 0..1 (0 = холодный черный, 1 = раскаленный белый WHOT)
  synthColor: THREE.Color;
  synthEmissive: THREE.Color;
  roughness: number;
  metalness: number;
  envMapIntensity: number;
}

function createSurfaceDetailTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(size, size);
  let seed = 91337;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967295;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const grain =
        118 +
        Math.sin(x * 0.11 + y * 0.043) * 18 +
        Math.cos(y * 0.09 - x * 0.031) * 14 +
        (rnd() - 0.5) * 72;
      const v = Math.max(0, Math.min(255, Math.round(grain)));
      const i = (y * size + x) * 4;
      image.data[i] = v;
      image.data[i + 1] = v;
      image.data[i + 2] = v;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);

  // Лёгкие потёки/царапины поверх зерна — на броне и бетоне это читается как износ.
  ctx.globalAlpha = 0.16;
  ctx.strokeStyle = '#2b2b2b';
  for (let i = 0; i < 46; i++) {
    ctx.beginPath();
    const x = rnd() * size;
    const y = rnd() * size;
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rnd() - 0.5) * 34, y + rnd() * 52);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2.5, 2.5);
  tex.anisotropy = 4;
  return tex;
}

export class MaterialManager {
  public entries: DualModeEntry[] = [];
  public wireOverlays: THREE.Object3D[] = [];
  private surfaceDetailTex = createSurfaceDetailTexture();

  public create(
    eoHex: number,
    flirVal: number,
    synthHex: number,
    eoEmissiveHex = 0x000000,
    synthEmissiveHex?: number
  ): THREE.MeshStandardMaterial {
    // Тёплые/металлические поверхности получают чуть больше блика; земля и резина остаются матовыми.
    const metalness = flirVal > 0.62 ? 0.34 : flirVal > 0.45 ? 0.2 : 0.07;
    const roughness = flirVal > 0.62 ? 0.58 : 0.82;
    const envMapIntensity = 0.55;

    const mat = new THREE.MeshStandardMaterial({
      color: eoHex,
      emissive: eoEmissiveHex,
      emissiveIntensity: eoEmissiveHex === 0x000000 ? 0 : 1,
      roughness,
      metalness,
      envMapIntensity,
      bumpMap: this.surfaceDetailTex,
      bumpScale: 0.28,
      roughnessMap: this.surfaceDetailTex,
    });
    this.entries.push({
      mat,
      eoColor: new THREE.Color(eoHex),
      eoEmissive: new THREE.Color(eoEmissiveHex),
      flirVal,
      synthColor: new THREE.Color(synthHex),
      synthEmissive: new THREE.Color(synthEmissiveHex ?? synthHex).multiplyScalar(0.38),
      roughness,
      metalness,
      envMapIntensity,
    });
    return mat;
  }

  public applyMode(mode: CameraMode, isNight: boolean) {
    for (const e of this.entries) {
      const standard = e.mat instanceof THREE.MeshStandardMaterial ? e.mat : null;
      if (mode === 'flir') {
        const v = Math.max(0.03, Math.min(1, e.flirVal));
        const c = new THREE.Color(v * 0.94, v * 0.99, v * 0.95);
        e.mat.color.copy(c);
        if (standard) {
          const glow = v > 0.68 ? (v - 0.46) * 1.9 : v * 0.24;
          standard.emissive.setRGB(glow * 0.96, glow, glow * 0.96);
          standard.emissiveIntensity = 1;
          standard.roughness = 1;
          standard.metalness = 0;
          standard.envMapIntensity = 0;
          standard.bumpScale = 0.05;
        }
      } else if (mode === 'bhot') {
        // Инверсная полярность «Горячий чёрный» (BHOT): холодный фон белый, горячие двигатели и броня — угольно-чёрные!
        const inv = Math.max(0.02, Math.min(0.96, 1.0 - e.flirVal * 0.96));
        const isSuperHot = e.flirVal > 0.72;
        const c = isSuperHot
          ? new THREE.Color(0.02, 0.025, 0.025)
          : new THREE.Color(inv * 0.86, inv * 0.89, inv * 0.88);
        e.mat.color.copy(c);
        if (standard) {
          const g = isSuperHot ? 0.0 : inv * 0.3;
          standard.emissive.setRGB(g, g * 1.02, g);
          standard.emissiveIntensity = 1;
          standard.roughness = 1;
          standard.metalness = 0;
          standard.envMapIntensity = 0;
          standard.bumpScale = 0.05;
        }
      } else if (mode === 'synth') {
        e.mat.color.copy(e.synthColor);
        if (standard) {
          standard.emissive.copy(e.synthEmissive);
          standard.emissiveIntensity = 1;
          standard.roughness = 0.62;
          standard.metalness = 0.05;
          standard.envMapIntensity = 0.08;
          standard.bumpScale = 0.03;
        }
      } else {
        e.mat.color.copy(e.eoColor);
        if (isNight) {
          // Не затемняем albedo вручную слишком сильно: ночь создаёт свет/экспозиция, а PBR сохраняет объём.
          e.mat.color.multiplyScalar(0.72);
        }
        if (standard) {
          standard.emissive.copy(e.eoEmissive);
          standard.emissiveIntensity = e.eoEmissive.getHex() === 0 ? 0 : 1.35;
          standard.roughness = e.roughness;
          standard.metalness = e.metalness;
          standard.envMapIntensity = e.envMapIntensity;
          standard.bumpScale = 0.28;
        }
      }
      e.mat.needsUpdate = true;
    }

    for (const w of this.wireOverlays) {
      w.visible = mode === 'synth';
    }
  }

  public dispose() {
    for (const e of this.entries) {
      e.mat.dispose();
    }
    this.surfaceDetailTex.dispose();
    this.entries = [];
    this.wireOverlays = [];
  }
}

/** Детерминированная высота рельефа в любой точке (x, z) */
export function getTerrainHeight(x: number, z: number, mission: MissionDef): number {
  const roadDist = Math.abs(x - Math.sin(mission.roadAngle ?? 0) * z * 0.15);
  const roadFlatten = Math.min(1, Math.max(0, (roadDist - 32) / 90));

  let riverDip = 0;
  if (mission.riverZ !== undefined) {
    const dz = Math.abs(z - mission.riverZ);
    if (dz < 55) {
      const bridgeClear = Math.abs(x) < 16 ? 0.25 : 1.0;
      riverDip = -Math.cos((dz / 55) * (Math.PI * 0.5)) * 7.5 * bridgeClear;
    }
  }

  let h =
    Math.sin(x * 0.0042 + 0.7) * Math.cos(z * 0.0038 - 0.4) * 18 +
    Math.sin(x * 0.011 - z * 0.008) * 6.5 +
    Math.cos(x * 0.024 + z * 0.021) * 1.8;

  if (mission.hasAirfield) {
    const inAirfield = Math.max(Math.abs(x) / 290, Math.abs(z + 320) / 430);
    if (inAirfield < 1.35) {
      const k = Math.max(0, Math.min(1, (inAirfield - 0.85) / 0.5));
      h *= k;
    }
  } else {
    const centerFactor = Math.min(1, Math.hypot(x * 0.8, (z + 200) * 0.65) / 380);
    h *= 0.22 + 0.78 * centerFactor;
  }

  return h * (0.18 + 0.82 * roadFlatten) + riverDip;
}

/** Создает детализированные текстуры ТВД (поля, борозды, грунтовки, воронки артподготовки) */
export function buildTerrainTextures(): Record<CameraMode, THREE.CanvasTexture> {
  // Фиксированный массив воронок и пятен, чтобы в ТВ и ТПВ они совпадали!
  const craters: Array<{ x: number; y: number; r: number }> = [];
  let seed = 1337;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  for (let i = 0; i < 42; i++) {
    craters.push({ x: rnd() * 1024, y: rnd() * 1024, r: 5 + rnd() * 11 });
  }

  const makeTex = (mode: CameraMode) => {
    const size = 1024;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    if (mode === 'eo') {
      ctx.fillStyle = '#3d492f';
      ctx.fillRect(0, 0, size, size);
      const patches = [
        [0, 0, 512, 340, '#495637'],
        [512, 0, 512, 420, '#5c5b3b'],
        [0, 340, 440, 380, '#34412a'],
        [440, 420, 584, 340, '#4f5839'],
        [0, 720, 520, 304, '#585237'],
        [520, 760, 504, 264, '#39462d'],
      ] as const;
      for (const [x, y, w, h, col] of patches) {
        ctx.fillStyle = col;
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = 'rgba(20, 26, 15, 0.24)';
        ctx.lineWidth = 2;
        for (let i = x; i < x + w; i += 9) {
          ctx.beginPath();
          ctx.moveTo(i, y);
          ctx.lineTo(i, y + h);
          ctx.stroke();
        }
        // Межи полей
        ctx.strokeStyle = '#2b3421';
        ctx.lineWidth = 4;
        ctx.strokeRect(x, y, w, h);
      }
      for (let i = 0; i < 5500; i++) {
        const px = Math.random() * size;
        const py = Math.random() * size;
        ctx.fillStyle = Math.random() > 0.5 ? 'rgba(105,116,74,0.22)' : 'rgba(20,26,15,0.24)';
        ctx.fillRect(px, py, 3, 3);
      }
      // Воронки от снарядов на полях сражений
      for (const c of craters) {
        const grad = ctx.createRadialGradient(c.x, c.y, 1, c.x, c.y, c.r);
        grad.addColorStop(0, 'rgba(18, 16, 13, 0.88)');
        grad.addColorStop(0.55, 'rgba(58, 50, 37, 0.65)');
        grad.addColorStop(1, 'rgba(58, 50, 37, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
        ctx.fill();
      }
      // Раскатанные танковые колеи
      ctx.strokeStyle = '#635a45';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(0, 512);
      ctx.bezierCurveTo(320, 485, 680, 545, 1024, 512);
      ctx.stroke();
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(260, 0);
      ctx.bezierCurveTo(310, 360, 240, 710, 290, 1024);
      ctx.stroke();
    } else if (mode === 'flir') {
      ctx.fillStyle = '#161a18';
      ctx.fillRect(0, 0, size, size);
      const patches = [
        [0, 0, 512, 340, '#1e2320'],
        [512, 0, 512, 420, '#292e2b'],
        [0, 340, 440, 380, '#131614'],
        [440, 420, 584, 340, '#222724'],
        [0, 720, 520, 304, '#2c312d'],
        [520, 760, 504, 264, '#191d1a'],
      ] as const;
      for (const [x, y, w, h, col] of patches) {
        ctx.fillStyle = col;
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = 'rgba(255,255,255,0.038)';
        ctx.lineWidth = 2;
        for (let i = x; i < x + w; i += 10) {
          ctx.beginPath();
          ctx.moveTo(i, y);
          ctx.lineTo(i, y + h);
          ctx.stroke();
        }
        ctx.strokeStyle = '#0e110f';
        ctx.lineWidth = 4;
        ctx.strokeRect(x, y, w, h);
      }
      for (let i = 0; i < 4800; i++) {
        const px = Math.random() * size;
        const py = Math.random() * size;
        ctx.fillStyle = Math.random() > 0.5 ? 'rgba(215,228,220,0.065)' : 'rgba(0,0,0,0.28)';
        ctx.fillRect(px, py, 3, 3);
      }
      // Тепловые следы воронок на пашне
      for (const c of craters) {
        const grad = ctx.createRadialGradient(c.x, c.y, 1, c.x, c.y, c.r);
        grad.addColorStop(0, 'rgba(95, 102, 98, 0.55)');
        grad.addColorStop(0.55, 'rgba(35, 40, 37, 0.45)');
        grad.addColorStop(1, 'rgba(20, 24, 22, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = '#484f4b';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(0, 512);
      ctx.bezierCurveTo(320, 485, 680, 545, 1024, 512);
      ctx.stroke();
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(260, 0);
      ctx.bezierCurveTo(310, 360, 240, 710, 290, 1024);
      ctx.stroke();
    } else if (mode === 'bhot') {
      // BHOT («Горячий чёрный»): холодные поля светло-серые, дороги и воронки тёмно-угольные
      ctx.fillStyle = '#cfd6d2';
      ctx.fillRect(0, 0, size, size);
      const patches = [
        [0, 0, 512, 340, '#c2c9c5'],
        [512, 0, 512, 420, '#b5bdb8'],
        [0, 340, 440, 380, '#d6deda'],
        [440, 420, 584, 340, '#bfc7c3'],
        [0, 720, 520, 304, '#b2bab6'],
        [520, 760, 504, 264, '#cbd3cf'],
      ] as const;
      for (const [x, y, w, h, col] of patches) {
        ctx.fillStyle = col;
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = 'rgba(0,0,0,0.06)';
        ctx.lineWidth = 2;
        for (let i = x; i < x + w; i += 10) {
          ctx.beginPath();
          ctx.moveTo(i, y);
          ctx.lineTo(i, y + h);
          ctx.stroke();
        }
        ctx.strokeStyle = '#9aa39e';
        ctx.lineWidth = 4;
        ctx.strokeRect(x, y, w, h);
      }
      for (const c of craters) {
        const grad = ctx.createRadialGradient(c.x, c.y, 1, c.x, c.y, c.r);
        grad.addColorStop(0, 'rgba(35, 38, 37, 0.72)');
        grad.addColorStop(0.55, 'rgba(120, 128, 124, 0.45)');
        grad.addColorStop(1, 'rgba(180, 188, 184, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = '#6f7773';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(0, 512);
      ctx.bezierCurveTo(320, 485, 680, 545, 1024, 512);
      ctx.stroke();
    } else {
      ctx.fillStyle = '#050e13';
      ctx.fillRect(0, 0, size, size);

      ctx.strokeStyle = 'rgba(0, 230, 185, 0.14)';
      ctx.lineWidth = 1;
      for (let i = 0; i <= size; i += 32) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, size);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, i);
        ctx.lineTo(size, i);
        ctx.stroke();
      }

      ctx.strokeStyle = 'rgba(0, 255, 200, 0.4)';
      ctx.lineWidth = 2;
      for (let i = 0; i <= size; i += 256) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, size);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, i);
        ctx.lineTo(size, i);
        ctx.stroke();
      }
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(6, 6);
    tex.anisotropy = 8;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  };

  return {
    eo: makeTex('eo'),
    flir: makeTex('flir'),
    bhot: makeTex('bhot'),
    synth: makeTex('synth'),
  };
}

/** Атмосферный купол неба с солнцем/луной, звёздами, зарёй и многослойными облаками */
export interface SkySystem {
  dome: THREE.Mesh;
  uniforms: {
    topColor: { value: THREE.Color };
    horizonColor: { value: THREE.Color };
    glowColor: { value: THREE.Color };
    sunDirection: { value: THREE.Vector3 };
    sunColor: { value: THREE.Color };
    sunIntensity: { value: number };
    starAmount: { value: number };
    hazeStrength: { value: number };
  };
  cloudGroup: THREE.Group;
  cloudMat: THREE.MeshBasicMaterial;
  cloudTex: THREE.CanvasTexture;
}

export function buildSkyAndClouds(scene: THREE.Scene): SkySystem {
  const uniforms = {
    topColor: { value: new THREE.Color(0x0b1012) },
    horizonColor: { value: new THREE.Color(0x232927) },
    glowColor: { value: new THREE.Color(0x3a423f) },
    sunDirection: { value: new THREE.Vector3(0.35, 0.55, -0.75).normalize() },
    sunColor: { value: new THREE.Color(0xfff1cf) },
    sunIntensity: { value: 1.0 },
    starAmount: { value: 0.0 },
    hazeStrength: { value: 0.55 },
  };

  const skyGeo = new THREE.SphereGeometry(3300, 40, 22);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms,
    vertexShader: `
      varying vec3 vDirection;
      void main() {
        vDirection = normalize(position);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      uniform vec3 glowColor;
      uniform vec3 sunDirection;
      uniform vec3 sunColor;
      uniform float sunIntensity;
      uniform float starAmount;
      uniform float hazeStrength;
      varying vec3 vDirection;

      float hash13(vec3 p) {
        p = fract(p * 0.1031);
        p += dot(p, p.zyx + 31.32);
        return fract((p.x + p.y) * p.z);
      }

      void main() {
        vec3 d = normalize(vDirection);
        float elevation = clamp(d.y, -1.0, 1.0);
        float h = clamp(elevation * 1.5, 0.0, 1.0);
        vec3 col = mix(horizonColor, topColor, pow(h, 0.58));

        // Атмосферная дымка у горизонта и тёплая полоса зари
        float horizonHaze = pow(clamp(1.0 - abs(elevation), 0.0, 1.0), 7.0);
        col += glowColor * horizonHaze * hazeStrength;

        vec3 sunDir = normalize(sunDirection);
        float sunAmount = max(dot(d, sunDir), 0.0);
        float sunDisc = smoothstep(0.9992, 0.99975, sunAmount);
        float sunHalo = pow(sunAmount, 180.0) * 0.75 + pow(sunAmount, 18.0) * 0.22;
        float forwardScatter = pow(sunAmount, 4.0) * horizonHaze * 0.55;
        col += sunColor * (sunDisc * 3.2 + sunHalo + forwardScatter) * sunIntensity;

        // Звёзды видны только в верхней полусфере и не «плывут» вместе с камерой
        if (starAmount > 0.01 && elevation > 0.04) {
          vec3 cell = floor(d * 170.0);
          float star = step(0.9972, hash13(cell));
          float twinkle = 0.65 + 0.35 * hash13(cell + 17.0);
          col += vec3(0.85, 0.92, 1.0) * star * twinkle * starAmount * smoothstep(0.04, 0.35, elevation);
        }

        // Ниже горизонта не даём куполу спорить с туманом и дальними холмами
        col = mix(col, horizonColor, smoothstep(0.0, -0.18, elevation) * 0.75);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  const dome = new THREE.Mesh(skyGeo, skyMat);
  dome.name = 'sky-dome';
  dome.renderOrder = -100;
  scene.add(dome);

  // Мягкая текстура кучево-слоистого облака
  const cSize = 256;
  const cCanvas = document.createElement('canvas');
  cCanvas.width = cSize;
  cCanvas.height = cSize;
  const ctx = cCanvas.getContext('2d')!;
  ctx.clearRect(0, 0, cSize, cSize);
  for (let i = 0; i < 18; i++) {
    const cx = 65 + Math.random() * 126;
    const cy = 65 + Math.random() * 126;
    const r = 34 + Math.random() * 52;
    const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, r);
    g.addColorStop(0, 'rgba(255,255,255,0.28)');
    g.addColorStop(0.55, 'rgba(220,230,235,0.11)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const cloudTex = new THREE.CanvasTexture(cCanvas);
  cloudTex.colorSpace = THREE.SRGBColorSpace;
  cloudTex.anisotropy = 4;

  const cloudMat = new THREE.MeshBasicMaterial({
    map: cloudTex,
    color: 0x9aa8a4,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const cloudGroup = new THREE.Group();
  cloudGroup.name = 'cloud-layer';
  const cloudGeo = new THREE.PlaneGeometry(520, 520);
  cloudGeo.rotateX(-Math.PI / 2);

  // Два слоя: низкая разорванная облачность и далёкие крупные массивы. Детерминированные позиции без Math.random в кадре.
  for (let i = 0; i < 44; i++) {
    const m = new THREE.Mesh(cloudGeo, cloudMat);
    m.name = 'cloud-sprite';
    const farLayer = i >= 30;
    const ang = (i / 44) * Math.PI * 2 + Math.sin(i * 1.37) * 0.12;
    const rad = farLayer ? 1500 + ((i * 173) % 950) : 320 + ((i * 211) % 1650);
    m.position.set(
      Math.cos(ang) * rad,
      (farLayer ? 560 : 405) + (i % 5) * 31,
      Math.sin(ang) * rad - 150
    );
    m.rotation.y = (i * 0.7) % Math.PI;
    const s = farLayer ? 2.3 + (i % 4) * 0.55 : 0.75 + (i % 5) * 0.25;
    m.scale.set(s, 1, s * 0.78);
    m.renderOrder = farLayer ? -90 : -80;
    cloudGroup.add(m);
  }
  scene.add(cloudGroup);

  return { dome, uniforms, cloudGroup, cloudMat, cloudTex };
}

/** Добавляет стильный электронный wireframe-контур вокруг меша для режима SYNTH */
function addWireframeEdge(mesh: THREE.Mesh, hexColor: number, mm: MaterialManager) {
  const edges = new THREE.EdgesGeometry(mesh.geometry, 24);
  const lineMat = new THREE.LineBasicMaterial({
    color: hexColor,
    transparent: true,
    opacity: 0.88,
  });
  const wire = new THREE.LineSegments(edges, lineMat);
  wire.visible = false;
  mesh.add(wire);
  mm.wireOverlays.push(wire);
}

/** 3D-кольцо воздушного коридора для учебного полигона */
export function buildTrainingGateModel(): THREE.Group {
  const g = new THREE.Group();

  const outerMat = new THREE.MeshBasicMaterial({
    color: 0x00ffc8,
    transparent: true,
    opacity: 0.9,
  });
  const innerMat = new THREE.MeshBasicMaterial({
    color: 0xffb833,
    transparent: true,
    opacity: 0.75,
  });
  const pillarMat = new THREE.MeshBasicMaterial({
    color: 0x00ffc8,
    transparent: true,
    opacity: 0.22,
  });

  const outerRing = new THREE.Mesh(new THREE.TorusGeometry(28, 0.9, 8, 28), outerMat);
  g.add(outerRing);

  const innerRing = new THREE.Mesh(new THREE.TorusGeometry(19, 0.45, 6, 6), innerMat);
  g.add(innerRing);

  // Четыре тактические засечки по сторонам света
  for (let i = 0; i < 4; i++) {
    const tick = new THREE.Mesh(new THREE.BoxGeometry(1.1, 6.5, 1.1), outerMat);
    const a = (i * Math.PI) / 2;
    tick.position.set(Math.cos(a) * 28, Math.sin(a) * 28, 0);
    tick.rotation.z = a + Math.PI / 2;
    g.add(tick);
  }

  // Световой вертикальный луч привязки к земле
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 220, 6), pillarMat);
  beam.position.y = -138;
  g.add(beam);

  return g;
}

export interface BuiltTargetVisual {
  root: THREE.Group;
  intactGroup: THREE.Group;
  wreckGroup: THREE.Group;
  rotatingPart?: THREE.Object3D;
  spotlightCone?: THREE.Mesh;
  hitRadius: number;
  aimHeightOffset: number;
  /** Локальная точка прицеливания для окна штабного здания. */
  aimPointLocal?: { x: number; y: number; z: number };
}

/** Строит детализированную 3D-модель реального военного объекта противника и его остова */
export function buildTargetModel(
  kind: TargetKind,
  isPrimary: boolean,
  mm: MaterialManager,
  showSpotlight: boolean,
  blueprint?: Pick<TargetBlueprint, 'window'>
): BuiltTargetVisual {
  const root = new THREE.Group();
  const intact = new THREE.Group();
  const wreck = new THREE.Group();
  wreck.visible = false;
  root.add(intact);
  root.add(wreck);

  const wireCol = isPrimary ? 0xff3b5c : 0xffaa00;

  // Палитра техники корпуса «Чёрный Клин» (серо-оливковый камуфляж + белые кресты корпуса)
  const armorGrayGreen = mm.create(0x3a4338, 0.56, 0x261219);
  const armorDark = mm.create(0x232724, 0.44, 0x180e14);
  const hotEngine = mm.create(0x302b28, 0.99, 0xff4455, 0x240b00, 0xff2244);
  const rubberTire = mm.create(0x191b1c, 0.5, 0x14181f);
  const concreteMat = mm.create(0x767873, 0.35, 0x122229);
  const tankWhite = mm.create(0xbcc0bb, 0.66, 0x1a2630);
  const hazardRed = mm.create(0xa82922, 0.78, 0xff3355);
  const radarMetal = mm.create(0x5c665d, 0.75, 0x2a1c12);
  const sandEarth = mm.create(0x5c533e, 0.3, 0x0e1d1c);
  const glassDark = mm.create(0x1e333e, 0.42, 0x00ffc8);
  const insigniaCrossMat = mm.create(0xe2e4dc, 0.76, 0xff4466);
  const beaconRedMat = new THREE.MeshBasicMaterial({ color: 0xff2a2a });

  const addPart = (
    parent: THREE.Group,
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    rx = 0,
    ry = 0,
    rz = 0,
    withEdge = true
  ) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    parent.add(m);
    if (withEdge) addWireframeEdge(m, wireCol, mm);
    return m;
  };

  /** Опознавательный тактический крест корпуса «Чёрный Клин» на броне / кузовах врага */
  const addEnemyCross = (parent: THREE.Group, x: number, y: number, z: number, rotY = 0, scale = 1) => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = rotY;
    const hBar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.24 * scale, 0.95 * scale), insigniaCrossMat);
    const vBar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.95 * scale, 0.24 * scale), insigniaCrossMat);
    g.add(hBar);
    g.add(vBar);
    parent.add(g);
  };

  let rotatingPart: THREE.Object3D | undefined;
  let spotlightCone: THREE.Mesh | undefined;
  let hitRadius = 8;
  let aimHeightOffset = 2.6;
  let aimPointLocal: BuiltTargetVisual['aimPointLocal'];

  const buildTruckChassis = (length: number, axles: number) => {
    addPart(intact, new THREE.BoxGeometry(2.8, 0.8, length), armorDark, 0, 1.1, 0);
    addPart(intact, new THREE.BoxGeometry(2.75, 1.85, 2.5), armorGrayGreen, 0, 2.1, -length / 2 + 1.35);
    addPart(intact, new THREE.BoxGeometry(2.4, 0.7, 0.15), glassDark, 0, 2.45, -length / 2 + 0.08, 0, 0, 0, false);
    addPart(intact, new THREE.BoxGeometry(2.2, 0.9, 1.9), hotEngine, 0, 1.55, -length / 2 + 2.4, 0, 0, 0, false);
    const wheelGeo = new THREE.CylinderGeometry(0.68, 0.68, 0.52, 10);
    for (let i = 0; i < axles; i++) {
      const wz = -length / 2 + 1.4 + (i * (length - 2.6)) / Math.max(1, axles - 1);
      addPart(intact, wheelGeo, rubberTire, -1.44, 0.68, wz, 0, 0, Math.PI / 2, false);
      addPart(intact, wheelGeo, rubberTire, 1.44, 0.68, wz, 0, 0, Math.PI / 2, false);
    }
  };

  switch (kind) {
    case 'tank': {
      hitRadius = 7.6;
      aimHeightOffset = 2.0;
      // Гусеничные ленты + 6 пар опорных катков
      addPart(intact, new THREE.BoxGeometry(0.82, 0.98, 7.3), rubberTire, -1.55, 0.58, 0);
      addPart(intact, new THREE.BoxGeometry(0.82, 0.98, 7.3), rubberTire, 1.55, 0.58, 0);
      const roadWheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.9, 9);
      for (let w = 0; w < 6; w++) {
        const wz = -2.65 + w * 1.06;
        addPart(intact, roadWheelGeo, armorDark, -1.56, 0.44, wz, 0, 0, Math.PI / 2, false);
        addPart(intact, roadWheelGeo, armorDark, 1.56, 0.44, wz, 0, 0, Math.PI / 2, false);
      }
      // Бронекорпус и бортовые экраны с крестами «Чёрного Клина»
      addPart(intact, new THREE.BoxGeometry(3.6, 1.15, 7.0), armorGrayGreen, 0, 1.28, 0);
      addEnemyCross(intact, -1.83, 1.32, -0.4, 0, 0.85);
      addEnemyCross(intact, 1.83, 1.32, -0.4, 0, 0.85);
      // Раскаленная решетка МТО в корме и топливные бочки
      addPart(intact, new THREE.BoxGeometry(2.55, 0.28, 2.2), hotEngine, 0, 1.9, 2.1);
      addPart(intact, new THREE.CylinderGeometry(0.42, 0.42, 1.3, 8), armorDark, -0.8, 1.55, 3.68, 0, 0, Math.PI / 2, false);
      addPart(intact, new THREE.CylinderGeometry(0.42, 0.42, 1.3, 8), armorDark, 0.8, 1.55, 3.68, 0, 0, Math.PI / 2, false);

      // Клиновидная башня тяжелого танка
      const turret = new THREE.Group();
      turret.position.set(0, 2.2, -0.25);
      intact.add(turret);
      const tMain = new THREE.Mesh(new THREE.BoxGeometry(2.85, 0.95, 3.6), armorGrayGreen);
      turret.add(tMain);
      addWireframeEdge(tMain, wireCol, mm);
      addEnemyCross(turret, -1.45, 0.02, 0.2, 0, 0.72);
      addEnemyCross(turret, 1.45, 0.02, 0.2, 0, 0.72);

      // Длинноствольное 120-мм орудие с эжектором
      const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.17, 5.6, 8), armorDark);
      gun.rotation.x = Math.PI / 2;
      gun.position.set(0, 0.08, -3.9);
      turret.add(gun);
      addWireframeEdge(gun, wireCol, mm);

      // Командирский панорамный прицел и штыревая антенна
      addPart(intact, new THREE.CylinderGeometry(0.32, 0.35, 0.48, 8), armorDark, 0.72, 2.85, 0.25, 0, 0, 0, false);
      addPart(intact, new THREE.CylinderGeometry(0.025, 0.035, 2.6, 4), radarMetal, -1.1, 3.8, 1.1, 0, 0, 0, false);
      break;
    }

    case 'supply_truck': {
      hitRadius = 7.8;
      aimHeightOffset = 2.4;
      buildTruckChassis(8.6, 3);
      addPart(intact, new THREE.BoxGeometry(2.85, 2.35, 5.5), sandEarth, 0, 2.65, 1.35);
      addPart(intact, new THREE.BoxGeometry(2.9, 0.35, 1.2), hazardRed, 0, 2.4, 1.35, 0, 0, 0, false);
      addEnemyCross(intact, -1.45, 2.85, 1.35, 0, 1.0);
      addEnemyCross(intact, 1.45, 2.85, 1.35, 0, 1.0);
      break;
    }

    case 'sam': {
      hitRadius = 9.5;
      aimHeightOffset = 3.4;
      addPart(intact, new THREE.CylinderGeometry(9.5, 11.2, 1.1, 10), sandEarth, 0, 0.4, 0, 0, 0, 0, false);
      buildTruckChassis(11.4, 4);
      addPart(intact, new THREE.BoxGeometry(5.6, 0.35, 0.5), armorDark, 0, 0.5, -1.5, 0, 0, 0, false);
      addPart(intact, new THREE.BoxGeometry(5.6, 0.35, 0.5), armorDark, 0, 0.5, 3.8, 0, 0, 0, false);
      addPart(intact, new THREE.BoxGeometry(2.8, 1.7, 2.6), hotEngine, 0, 2.35, -1.6);
      addEnemyCross(intact, -1.42, 2.4, -1.6, 0, 0.85);
      addEnemyCross(intact, 1.42, 2.4, -1.6, 0, 0.85);

      const launcher = new THREE.Group();
      launcher.position.set(0, 2.5, 2.4);
      launcher.rotation.x = 0.68;
      intact.add(launcher);
      const offsets = [
        [-0.72, 0.65],
        [0.72, 0.65],
        [-0.72, -0.65],
        [0.72, -0.65],
      ];
      for (const [ox, oy] of offsets) {
        const tube = new THREE.Mesh(new THREE.BoxGeometry(1.18, 1.18, 6.8), armorGrayGreen);
        tube.position.set(ox, oy, 0);
        launcher.add(tube);
        addWireframeEdge(tube, wireCol, mm);
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.52, 0.25, 8), hazardRed);
        cap.rotation.x = Math.PI / 2;
        cap.position.set(ox, oy, -3.45);
        launcher.add(cap);
      }
      break;
    }

    case 'radar': {
      hitRadius = 9.0;
      aimHeightOffset = 4.2;
      addPart(intact, new THREE.CylinderGeometry(8.5, 11.5, 1.8, 10), sandEarth, 0, 0.8, 0, 0, 0, 0, false);
      const baseGroup = new THREE.Group();
      baseGroup.position.y = 1.6;
      intact.add(baseGroup);

      const kung = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.5, 7.6), armorGrayGreen);
      kung.position.set(0, 1.6, 0);
      baseGroup.add(kung);
      addWireframeEdge(kung, wireCol, mm);
      addEnemyCross(baseGroup, -1.63, 1.7, 0, 0, 0.95);
      addEnemyCross(baseGroup, 1.63, 1.7, 0, 0, 0.95);

      const gen = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.8, 3.2), hotEngine);
      gen.position.set(3.8, 1.0, 1.2);
      baseGroup.add(gen);
      addWireframeEdge(gen, wireCol, mm);

      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.85, 4.6, 6), armorDark);
      mast.position.set(0, 4.6, 0.5);
      baseGroup.add(mast);

      const dishPivot = new THREE.Group();
      dishPivot.position.set(0, 8.7, 0.5);
      intact.add(dishPivot);

      const arrayPanel = new THREE.Mesh(new THREE.BoxGeometry(7.6, 3.7, 0.55), radarMetal);
      arrayPanel.rotation.x = -0.22;
      dishPivot.add(arrayPanel);
      addWireframeEdge(arrayPanel, wireCol, mm);

      const emitter = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.9, 2.4), hotEngine);
      emitter.position.set(0, -0.3, -1.2);
      dishPivot.add(emitter);

      // Красный сигнальный огонь на вершине полотна РЛС
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 6), beaconRedMat);
      beacon.position.set(0, 2.15, 0);
      dishPivot.add(beacon);

      rotatingPart = dishPivot;
      break;
    }

    case 'ew': {
      hitRadius = 8.8;
      aimHeightOffset = 3.8;
      buildTruckChassis(9.4, 3);
      addPart(intact, new THREE.BoxGeometry(2.95, 2.5, 6.0), armorGrayGreen, 0, 2.75, 1.2);
      addEnemyCross(intact, -1.5, 2.8, 1.2, 0, 0.95);
      addEnemyCross(intact, 1.5, 2.8, 1.2, 0, 0.95);
      addPart(intact, new THREE.BoxGeometry(2.4, 0.7, 2.6), hotEngine, 0, 4.15, 0.6);
      addPart(intact, new THREE.CylinderGeometry(0.22, 0.35, 9.2, 6), armorDark, 0, 6.8, 2.6);
      addPart(intact, new THREE.SphereGeometry(0.95, 10, 8), tankWhite, 0, 11.4, 2.6);
      addPart(intact, new THREE.BoxGeometry(5.6, 0.22, 0.22), radarMetal, 0, 9.8, 2.6);
      addPart(intact, new THREE.BoxGeometry(0.22, 0.22, 5.6), radarMetal, 0, 9.2, 2.6);
      // Сигнальный маяк излучения на топе мачты РЭБ
      addPart(intact, new THREE.SphereGeometry(0.34, 8, 6), beaconRedMat, 0, 12.55, 2.6, 0, 0, 0, false);
      addPart(intact, new THREE.ConeGeometry(1.3, 2.2, 6), armorDark, -4.2, 1.1, -1.5, 0, 0, 0, false);
      addPart(intact, new THREE.SphereGeometry(1.1, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.5), radarMetal, -4.2, 2.4, -1.5, 0.9, 0, 0);
      break;
    }

    case 'fuel': {
      hitRadius = 14.5;
      aimHeightOffset = 4.5;
      addPart(intact, new THREE.BoxGeometry(28, 0.5, 24), concreteMat, 0, 0.25, 0, 0, 0, 0, false);
      addPart(intact, new THREE.BoxGeometry(29, 1.8, 1.2), sandEarth, 0, 0.9, -12, 0, 0, 0, false);
      addPart(intact, new THREE.BoxGeometry(29, 1.8, 1.2), sandEarth, 0, 0.9, 12, 0, 0, 0, false);
      addPart(intact, new THREE.BoxGeometry(1.2, 1.8, 24), sandEarth, -14, 0.9, 0, 0, 0, 0, false);
      addPart(intact, new THREE.BoxGeometry(1.2, 1.8, 24), sandEarth, 14, 0.9, 0, 0, 0, 0, false);

      const tankPositions = [
        [-6.5, -4.5],
        [6.5, -4.5],
        [-6.5, 5.5],
      ];
      for (const [tx, tz] of tankPositions) {
        addPart(intact, new THREE.CylinderGeometry(4.4, 4.4, 8.2, 14), tankWhite, tx, 4.35, tz);
        addPart(intact, new THREE.ConeGeometry(4.55, 1.4, 14), tankWhite, tx, 9.15, tz, 0, 0, 0, false);
        addPart(intact, new THREE.CylinderGeometry(4.46, 4.46, 0.85, 14), hazardRed, tx, 6.2, tz, 0, 0, 0, false);
        addPart(intact, new THREE.BoxGeometry(0.45, 8.6, 0.45), armorDark, tx + 4.45, 4.5, tz, 0, 0, 0, false);
      }
      addPart(intact, new THREE.BoxGeometry(5.5, 3.2, 5.5), hotEngine, 6.5, 1.85, 5.5);
      addPart(intact, new THREE.CylinderGeometry(0.32, 0.32, 13, 8), hazardRed, 0, 1.4, 0.5, 0, 0, Math.PI / 2, false);
      break;
    }

    case 'bunker': {
      hitRadius = 13.5;
      aimHeightOffset = 3.2;
      addPart(intact, new THREE.CylinderGeometry(11.5, 16.5, 4.8, 8), sandEarth, 0, 2.4, 0, 0, Math.PI / 8);
      addPart(intact, new THREE.BoxGeometry(14.5, 4.2, 13.5), concreteMat, 0, 2.3, 0);
      addPart(intact, new THREE.BoxGeometry(6.8, 3.6, 5.0), concreteMat, 0, 1.8, -8.2);
      addPart(intact, new THREE.BoxGeometry(4.4, 2.8, 0.4), armorDark, 0, 1.5, -10.75);
      addPart(intact, new THREE.CylinderGeometry(0.85, 0.85, 2.6, 8), hotEngine, -3.8, 5.5, 2.2);
      addPart(intact, new THREE.CylinderGeometry(0.85, 0.85, 2.6, 8), hotEngine, 3.8, 5.5, 2.2);
      addPart(intact, new THREE.CylinderGeometry(0.28, 0.5, 9.5, 6), radarMetal, -5.2, 8.8, -2.5);
      addPart(intact, new THREE.SphereGeometry(0.3, 8, 6), beaconRedMat, -5.2, 13.7, -2.5, 0, 0, 0, false);
      addPart(intact, new THREE.SphereGeometry(1.7, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.45), tankWhite, 4.2, 5.6, -2.8, 0.75, 0.4, 0);
      addPart(intact, new THREE.BoxGeometry(2.3, 1.7, 5.0), armorGrayGreen, -6.2, 0.95, -11.5, 0, 0.35, 0);
      break;
    }

    case 'aircraft': {
      hitRadius = 11.0;
      aimHeightOffset = 2.2;
      addPart(intact, new THREE.BoxGeometry(22, 0.25, 24), concreteMat, 0, 0.12, 0, 0, 0, 0, false);
      addPart(intact, new THREE.BoxGeometry(2.4, 3.2, 22), sandEarth, -10.5, 1.6, 0, 0, 0, 0, false);
      addPart(intact, new THREE.BoxGeometry(2.4, 3.2, 22), sandEarth, 10.5, 1.6, 0, 0, 0, 0, false);
      addPart(intact, new THREE.BoxGeometry(23, 3.2, 2.4), sandEarth, 0, 1.6, 10.5, 0, 0, 0, false);

      const jetMat = mm.create(0x46515c, 0.62, 0x1d2536);
      addPart(intact, new THREE.CylinderGeometry(0.85, 1.15, 11.5, 8), jetMat, 0, 1.85, 0.5, Math.PI / 2, 0, 0);
      addPart(intact, new THREE.ConeGeometry(0.85, 4.6, 8), armorDark, 0, 1.85, -7.5, -Math.PI / 2, 0, 0);
      addPart(intact, new THREE.SphereGeometry(0.72, 8, 6), glassDark, 0, 2.45, -3.6, 0, 0, 0, false);

      const wingShape = new THREE.Shape();
      wingShape.moveTo(0, -3.2);
      wingShape.lineTo(6.6, 2.6);
      wingShape.lineTo(6.6, 4.4);
      wingShape.lineTo(0, 3.6);
      wingShape.lineTo(-6.6, 4.4);
      wingShape.lineTo(-6.6, 2.6);
      wingShape.closePath();
      const wingGeo = new THREE.ExtrudeGeometry(wingShape, { depth: 0.22, bevelEnabled: false });
      addPart(intact, wingGeo, jetMat, 0, 1.85, 0.2, Math.PI / 2, 0, 0);

      // Подвесные авиабомбы и ракеты под крылом
      for (const px of [-3.6, -2.2, 2.2, 3.6]) {
        addPart(intact, new THREE.CylinderGeometry(0.22, 0.22, 2.8, 7), hazardRed, px, 1.42, 1.4, Math.PI / 2, 0, 0, false);
      }

      addPart(intact, new THREE.BoxGeometry(0.18, 2.6, 2.5), jetMat, -1.35, 3.1, 4.4, 0, 0, -0.2);
      addPart(intact, new THREE.BoxGeometry(0.18, 2.6, 2.5), jetMat, 1.35, 3.1, 4.4, 0, 0, 0.2);
      addPart(intact, new THREE.CylinderGeometry(0.58, 0.48, 1.8, 8), hotEngine, -0.72, 1.85, 6.4, Math.PI / 2, 0, 0);
      addPart(intact, new THREE.CylinderGeometry(0.58, 0.48, 1.8, 8), hotEngine, 0.72, 1.85, 6.4, Math.PI / 2, 0, 0);
      addPart(intact, new THREE.BoxGeometry(2.1, 1.6, 4.2), hotEngine, -5.8, 0.9, -4.5, 0, 0.4, 0);
      break;
    }

    case 'hq_window': {
      const spec = getWindowSpec(blueprint ?? {});
      const { width, height, depth } = HQ_BUILDING_DIMENSIONS;
      hitRadius = 16;
      aimHeightOffset = spec.height;
      aimPointLocal = { x: spec.localX, y: spec.height, z: spec.localZ };

      const brickMat = mm.create(0x777064, 0.38, 0x14242e);
      const warmWindowMat = mm.create(0xffbd5c, 0.96, 0xff3b5c, 0x7a3d08, 0xff2244);
      const targetFrameMat = new THREE.MeshBasicMaterial({ color: 0xff2438 });

      // Фундамент/двор штаба и главный 4-этажный корпус
      addPart(intact, new THREE.BoxGeometry(width + 8, 0.35, depth + 9), concreteMat, 0, 0.18, 1.5, 0, 0, 0, false);
      addPart(intact, new THREE.BoxGeometry(width, height, depth), brickMat, 0, height / 2, 0);
      addPart(intact, new THREE.BoxGeometry(width + 1.2, 0.8, depth + 1.2), concreteMat, 0, height + 0.4, 0);

      // Межэтажные плиты фасада
      for (const fy of [3.9, 7.7, 11.5]) {
        addPart(intact, new THREE.BoxGeometry(width + 0.25, 0.28, depth + 0.25), concreteMat, 0, fy, 0, 0, 0, 0, false);
      }

      // Сетка обычных окон на южном фасаде; одно окно заменяется светящейся целью
      const cols = [-12, -6, 0, 6, 12];
      const rows = [3.1, 6.9, 10.6, 13.5];
      let winIndex = 0;
      for (const wy of rows) {
        for (const wx of cols) {
          winIndex += 1;
          const isTargetCell = Math.abs(wx - spec.localX) < 0.1 && Math.abs(wy - spec.height) < 0.1;
          if (isTargetCell) continue;
          const lit = winIndex % 4 === 0;
          addPart(
            intact,
            new THREE.BoxGeometry(2.1, 1.7, 0.16),
            lit ? warmWindowMat : glassDark,
            wx,
            wy,
            depth / 2 + 0.09,
            0,
            0,
            0,
            false
          );
        }
      }

      // Окно-цель: тёплое свечение кабинета, рама-переплёт и красные уголки целеуказания разведки
      addPart(
        intact,
        new THREE.BoxGeometry(spec.widthM, spec.heightM, 0.22),
        warmWindowMat,
        spec.localX,
        spec.height,
        depth / 2 + 0.12,
        0,
        0,
        0,
        false
      );
      addPart(intact, new THREE.BoxGeometry(0.14, spec.heightM, 0.3), armorDark, spec.localX, spec.height, depth / 2 + 0.16, 0, 0, 0, false);
      addPart(intact, new THREE.BoxGeometry(spec.widthM, 0.14, 0.3), armorDark, spec.localX, spec.height, depth / 2 + 0.16, 0, 0, 0, false);
      const fx = spec.widthM / 2 + 0.35;
      const fy = spec.heightM / 2 + 0.35;
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          addPart(intact, new THREE.BoxGeometry(0.85, 0.14, 0.14), targetFrameMat, spec.localX + sx * fx, spec.height + sy * fy, depth / 2 + 0.24, 0, 0, 0, false);
          addPart(intact, new THREE.BoxGeometry(0.14, 0.85, 0.14), targetFrameMat, spec.localX + sx * (fx + 0.35), spec.height + sy * (fy - 0.35), depth / 2 + 0.24, 0, 0, 0, false);
        }
      }

      // Парадный вход, мешки с песком, генератор и антенны штаба
      addPart(intact, new THREE.BoxGeometry(5.2, 3.2, 1.4), concreteMat, 0, 1.6, depth / 2 + 0.7, 0, 0, 0, false);
      addPart(intact, new THREE.BoxGeometry(2.5, 2.4, 0.18), armorDark, 0, 1.25, depth / 2 + 1.45, 0, 0, 0, false);
      for (const sx of [-8, -4, 4, 8]) {
        addPart(intact, new THREE.BoxGeometry(2.7, 1.05, 1.15), sandEarth, sx, 0.55, depth / 2 + 2.3, 0, sx * 0.03, 0, false);
      }
      addPart(intact, new THREE.BoxGeometry(3.2, 2.0, 2.1), hotEngine, width / 2 + 2.2, 1.0, 3.5, 0, 0.25, 0, false);
      addPart(intact, new THREE.CylinderGeometry(0.16, 0.28, 8.5, 6), radarMetal, -width / 2 + 3, height + 4.8, -2, 0, 0, 0, false);
      addPart(intact, new THREE.SphereGeometry(1.25, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.45), tankWhite, width / 2 - 3.5, height + 1.8, -2.5, 0.7, -0.4, 0, false);
      break;
    }

    case 'aa_gun': {
      hitRadius = 7.2;
      aimHeightOffset = 2.2;
      addPart(intact, new THREE.CylinderGeometry(5.6, 6.6, 0.95, 10), sandEarth, 0, 0.45, 0, 0, 0, 0, false);
      addPart(intact, new THREE.BoxGeometry(3.1, 1.25, 6.2), armorGrayGreen, 0, 1.05, 0);
      addPart(intact, new THREE.BoxGeometry(2.1, 0.3, 1.8), hotEngine, 0, 1.72, -1.8, 0, 0, 0, false);

      const aaTurret = new THREE.Group();
      aaTurret.position.set(0, 2.15, 0.3);
      intact.add(aaTurret);

      const tBody = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.1, 2.3), armorDark);
      aaTurret.add(tBody);
      addWireframeEdge(tBody, wireCol, mm);

      const b1 = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 3.8, 6), radarMetal);
      b1.position.set(-0.65, 0.95, -1.45);
      b1.rotation.x = -0.88;
      aaTurret.add(b1);

      const b2 = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 3.8, 6), radarMetal);
      b2.position.set(0.65, 0.95, -1.45);
      b2.rotation.x = -0.88;
      aaTurret.add(b2);

      if (showSpotlight) {
        const coneGeo = new THREE.ConeGeometry(18, 290, 12, 1, true);
        coneGeo.translate(0, -145, 0);
        const coneMat = new THREE.MeshBasicMaterial({
          color: 0xdff6ff,
          transparent: true,
          opacity: 0.09,
          side: THREE.DoubleSide,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });
        const cone = new THREE.Mesh(coneGeo, coneMat);
        cone.position.set(0, 1.1, -0.5);
        cone.rotation.x = Math.PI - 0.68;
        aaTurret.add(cone);
        spotlightCone = cone;
      }

      rotatingPart = aaTurret;
      break;
    }
  }

  // === МОДЕЛЬ УНИЧТОЖЕННОГО ОБЪЕКТА (ВОРОНКА + ОБГОРЕВШИЙ ОСТОВ + ЯРКИЕ УГЛИ) ===
  const scorchedMat = mm.create(0x131313, 0.88, 0x331100);
  const emberMat = mm.create(0xff5e0e, 1.0, 0xff6600, 0xff4500, 0xff5500);

  const crater = new THREE.Mesh(new THREE.CircleGeometry(hitRadius * 1.5, 16), scorchedMat);
  crater.rotation.x = -Math.PI / 2;
  crater.position.y = 0.14;
  wreck.add(crater);

  for (let i = 0; i < 7; i++) {
    const chunk = new THREE.Mesh(
      new THREE.BoxGeometry(
        1.6 + (i % 3) * 1.4,
        0.9 + (i % 2) * 0.9,
        2.2 + ((i + 1) % 3) * 1.3
      ),
      i % 2 === 0 ? scorchedMat : emberMat
    );
    const ang = (i / 7) * Math.PI * 2;
    const rad = i === 0 ? 0 : 2.2 + (i % 3) * 1.8;
    chunk.position.set(Math.cos(ang) * rad, 0.55 + (i === 0 ? 0.5 : 0), Math.sin(ang) * rad);
    chunk.rotation.set(0.25 * i, ang, -0.18 * i);
    wreck.add(chunk);
  }

  return {
    root,
    intactGroup: intact,
    wreckGroup: wreck,
    rotatingPart,
    spotlightCone,
    hitRadius,
    aimHeightOffset,
    aimPointLocal,
  };
}

/** Строит все окружение ТВД: рельеф, шоссе, мост, хутор, окопы, ЛЭП с проводами, аэродром и посадки */
export function buildEnvironment(
  scene: THREE.Scene,
  mission: MissionDef,
  mm: MaterialManager,
  terrainTextures: Record<CameraMode, THREE.CanvasTexture>
): THREE.MeshStandardMaterial {
  // 1. 3D-рельеф местности 4600 x 4600 м (детальная сетка + вершинная вариация почвы/склонов)
  const terrainGeo = new THREE.PlaneGeometry(4600, 4600, 190, 190);
  terrainGeo.rotateX(-Math.PI / 2);
  const posAttr = terrainGeo.attributes.position;
  for (let i = 0; i < posAttr.count; i++) {
    const vx = posAttr.getX(i);
    const vz = posAttr.getZ(i);
    posAttr.setY(i, getTerrainHeight(vx, vz, mission));
  }
  terrainGeo.computeVertexNormals();

  const normalAttr = terrainGeo.attributes.normal;
  const colors = new Float32Array(posAttr.count * 3);
  for (let i = 0; i < posAttr.count; i++) {
    const vx = posAttr.getX(i);
    const vy = posAttr.getY(i);
    const vz = posAttr.getZ(i);
    const slope = 1 - Math.max(0, Math.min(1, normalAttr.getY(i)));
    const patchNoise =
      0.9 +
      Math.sin(vx * 0.017 + vz * 0.009) * 0.045 +
      Math.cos(vz * 0.013 - vx * 0.006) * 0.04 +
      Math.sin((vx + vz) * 0.071) * 0.025;
    const heightTint = Math.max(0.78, Math.min(1.08, 0.96 + vy * 0.0035));
    const base = patchNoise * heightTint;
    // Склоны чуть суше и теплее, низины — темнее и зеленее. Это работает как второй макро-слой поверх Canvas-текстуры.
    colors[i * 3] = Math.min(1.15, base * (1 + slope * 0.34));
    colors[i * 3 + 1] = Math.min(1.1, base * (1 + slope * 0.12));
    colors[i * 3 + 2] = Math.min(1.05, base * (1 - slope * 0.12));
  }
  terrainGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const terrainMat = new THREE.MeshStandardMaterial({
    map: terrainTextures.flir,
    bumpMap: terrainTextures.eo,
    bumpScale: 0.65,
    roughnessMap: terrainTextures.eo,
    roughness: 0.96,
    metalness: 0,
    envMapIntensity: 0.18,
    vertexColors: true,
  });
  const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
  terrainMesh.name = 'terrain';
  terrainMesh.receiveShadow = true;
  scene.add(terrainMesh);

  // Дальнее кольцо силуэтов холмов по горизонту
  const ridgeMat = mm.create(0x28322c, 0.14, 0x051820);
  for (let i = 0; i < 24; i++) {
    const ang = (i / 24) * Math.PI * 2;
    const dist = 2150;
    const hill = new THREE.Mesh(
      new THREE.ConeGeometry(280 + (i % 3) * 95, 75 + (i % 4) * 35, 6),
      ridgeMat
    );
    hill.position.set(Math.cos(ang) * dist, 18, Math.sin(ang) * dist);
    hill.scale.set(1.6, 1, 0.8);
    hill.rotation.y = ang;
    scene.add(hill);
  }

  // Материалы инфраструктуры
  const asphaltMat = mm.create(0x2e3135, 0.48, 0x0f252c);
  const roadLineMat = mm.create(0xc8cabf, 0.64, 0x00ffc8);
  const waterMat = mm.create(0x1c3542, 0.08, 0x041d2e);
  const buildingWall = mm.create(0x73746d, 0.39, 0x10212b);
  const villageWall = mm.create(0x9a9588, 0.44, 0x132833);
  const roofMetal = mm.create(0x524139, 0.52, 0x162b36);
  const trenchEarth = mm.create(0x4b4231, 0.34, 0x16241f);
  const warmWindowMat = mm.create(0xffb85c, 0.92, 0x00ffc8, 0x664010, 0x00c896);
  const foliageMat = mm.create(0x2b3c22, 0.22, 0x0a221d);
  const trunkMat = mm.create(0x3b2f23, 0.25, 0x0a1c19);
  const pylonMat = mm.create(0x5c6368, 0.44, 0x153540);
  const redLightMat = new THREE.MeshBasicMaterial({ color: 0xff3322 });
  const runwayLightMat = new THREE.MeshBasicMaterial({ color: 0xffd27d });
  // Вода и асфальт получают собственные PBR-акценты поверх общих настроек MaterialManager.
  waterMat.roughness = 0.16;
  waterMat.metalness = 0.04;
  waterMat.envMapIntensity = 1.35;
  asphaltMat.roughness = 0.72;
  asphaltMat.envMapIntensity = 0.38;

  // 2. Главная автомобильная трасса (рокадное шоссе) вдоль оси Z
  const roadSegments = 96;
  const zMin = -1350;
  const zMax = 2150;
  const roadGeo = new THREE.PlaneGeometry(13.5, (zMax - zMin) / roadSegments + 1.5);
  roadGeo.rotateX(-Math.PI / 2);

  for (let i = 0; i < roadSegments; i++) {
    const zc = zMin + ((i + 0.5) * (zMax - zMin)) / roadSegments;
    const xc = mission.hasAirfield ? -265 : Math.sin(mission.roadAngle ?? 0) * zc * 0.15;
    const yh = getTerrainHeight(xc, zc, mission) + 0.22;

    const seg = new THREE.Mesh(roadGeo, asphaltMat);
    seg.position.set(xc, yh, zc);
    scene.add(seg);

    if (i % 2 === 0) {
      const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 9), roadLineMat);
      dash.rotation.x = -Math.PI / 2;
      dash.position.set(xc, yh + 0.05, zc);
      scene.add(dash);
    }
  }

  // Поперечная подъездная дорога к позициям противника
  for (let x = -290; x <= 290; x += 28) {
    const zc = -280;
    const yh = getTerrainHeight(x, zc, mission) + 0.2;
    const crossSeg = new THREE.Mesh(new THREE.PlaneGeometry(30, 9.5), asphaltMat);
    crossSeg.rotation.x = -Math.PI / 2;
    crossSeg.position.set(x, yh, zc);
    scene.add(crossSeg);
  }

  // 3. Река и автомобильный железобетонный мост
  if (mission.riverZ !== undefined) {
    const water = new THREE.Mesh(new THREE.PlaneGeometry(4400, 92, 64, 4), waterMat);
    water.name = 'river-water';
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, -2.6, mission.riverZ);
    water.receiveShadow = true;
    scene.add(water);

    const deck = new THREE.Mesh(new THREE.BoxGeometry(17, 1.4, 118), buildingWall);
    deck.position.set(0, 1.2, mission.riverZ);
    scene.add(deck);
    addWireframeEdge(deck, 0x00ffc8, mm);

    // Перила моста и опоры
    for (const sideX of [-8.1, 8.1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.1, 118), roadLineMat);
      rail.position.set(sideX, 2.35, mission.riverZ);
      scene.add(rail);
    }
    for (const bz of [-36, 0, 36]) {
      const pier = new THREE.Mesh(new THREE.BoxGeometry(15, 8, 3.6), buildingWall);
      pier.position.set(0, -3.2, mission.riverZ + bz);
      scene.add(pier);
    }
  }

  // 4. Военный аэродром с сигнальными огнями ВПП (для финала кампании)
  if (mission.hasAirfield) {
    const runway = new THREE.Mesh(new THREE.PlaneGeometry(54, 860), asphaltMat);
    runway.rotation.x = -Math.PI / 2;
    runway.position.set(-15, 0.3, -320);
    scene.add(runway);

    for (let z = -720; z <= 80; z += 42) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 20), roadLineMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(-15, 0.38, z);
      scene.add(m);

      // Боковые посадочные огни ВПП (светятся за счет Bloom!)
      for (const lx of [-41, 11]) {
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.42, 6, 6), runwayLightMat);
        lamp.position.set(lx, 0.85, z);
        scene.add(lamp);
      }
    }
    for (const bx of [-18, -11, -4, 4, 11, 18]) {
      for (const bz of [88, -728]) {
        const zebra = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 26), roadLineMat);
        zebra.rotation.x = -Math.PI / 2;
        zebra.position.set(-15 + bx, 0.38, bz);
        scene.add(zebra);
      }
    }
    for (const tz of [-290, -470]) {
      const taxi = new THREE.Mesh(new THREE.PlaneGeometry(110, 18), asphaltMat);
      taxi.rotation.x = -Math.PI / 2;
      taxi.position.set(42, 0.28, tz);
      scene.add(taxi);
    }
    const tower = new THREE.Mesh(new THREE.BoxGeometry(14, 22, 14), buildingWall);
    tower.position.set(-85, 11, -340);
    scene.add(tower);
    addWireframeEdge(tower, 0x00ffc8, mm);

    const towerCab = new THREE.Mesh(new THREE.BoxGeometry(17, 5, 17), warmWindowMat);
    towerCab.position.set(-85, 24, -340);
    scene.add(towerCab);
    addWireframeEdge(towerCab, 0x00ffc8, mm);

    const towerBeacon = new THREE.Mesh(new THREE.SphereGeometry(0.7, 8, 6), redLightMat);
    towerBeacon.position.set(-85, 28, -340);
    scene.add(towerBeacon);
  }

  // 5. Сельский хутор у перекрестка + промзона + водонапорная башня
  const hamletHouses = [
    [-115, 730, 11, 4.8, 9, 0.08],
    [-138, 762, 10, 4.5, 8.5, -0.12],
    [-92, 775, 12, 5.0, 9.5, 0.25],
    [108, 910, 11, 4.6, 8.5, -0.05],
    [132, 945, 10.5, 4.5, 9, 0.18],
  ];
  for (const [hx, hz, w, h, d, rot] of hamletHouses) {
    const gy = getTerrainHeight(hx, hz, mission);
    const house = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), villageWall);
    house.position.set(hx, gy + h / 2 - 0.3, hz);
    house.rotation.y = rot;
    scene.add(house);
    addWireframeEdge(house, 0x00b894, mm);

    const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.66, 3.0, 4), roofMetal);
    roof.position.set(hx, gy + h + 1.15, hz);
    roof.rotation.y = rot + Math.PI / 4;
    scene.add(roof);

    // Светящееся теплое окно и печная труба
    const win = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.1, 0.2), warmWindowMat);
    win.position.set(hx, gy + 2.3, hz + d / 2 + 0.05);
    scene.add(win);
  }

  // Сельская водонапорная башня — отличный вертикальный ориентир на подлете!
  {
    const wx = -152;
    const wz = 700;
    const wy = getTerrainHeight(wx, wz, mission);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 2.1, 16, 8), buildingWall);
    stem.position.set(wx, wy + 8, wz);
    scene.add(stem);
    const tankTop = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.1, 5.5, 10), roofMetal);
    tankTop.position.set(wx, wy + 18, wz);
    scene.add(tankTop);
    addWireframeEdge(tankTop, 0x00ffc8, mm);
  }

  // Промзона / складские ангары
  const structureSpots = [
    [-210, 420, 34, 9, 16, 0.1],
    [-215, 390, 34, 9, 16, 0.1],
    [195, 560, 28, 11, 20, -0.3],
    [225, 180, 40, 10, 18, 0.0],
    [-260, -120, 30, 8, 15, 0.4],
    [250, -520, 38, 12, 22, 0.2],
  ];
  for (const [sx, sz, w, h, d, rot] of structureSpots) {
    const gy = getTerrainHeight(sx, sz, mission);
    const hall = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), buildingWall);
    hall.position.set(sx, gy + h / 2 - 0.5, sz);
    hall.rotation.y = rot;
    scene.add(hall);
    addWireframeEdge(hall, 0x00d8a8, mm);

    const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.62, 3.2, 4), roofMetal);
    roof.position.set(sx, gy + h + 1.1, sz);
    roof.rotation.y = rot + Math.PI / 4;
    scene.add(roof);
  }

  // 6. Полевые укрепления противника: зигзагообразная линия окопов, блиндаж и «зубы дракона»
  for (let side = -1; side <= 1; side += 2) {
    const baseTx = side * 92;
    const baseTz = 95;
    for (let seg = 0; seg < 6; seg++) {
      const tx = baseTx + seg * side * 12;
      const tz = baseTz + (seg % 2 === 0 ? -5 : 5);
      const ty = getTerrainHeight(tx, tz, mission);
      const trench = new THREE.Mesh(new THREE.BoxGeometry(14, 1.15, 2.6), trenchEarth);
      trench.position.set(tx, ty + 0.4, tz);
      trench.rotation.y = (seg % 2 === 0 ? 0.42 : -0.42) * side;
      scene.add(trench);
      addWireframeEdge(trench, 0xffaa00, mm);
    }
  }
  // Противотанковые надолбы «зубы дракона» у рубежа обороны
  const toothGeo = new THREE.ConeGeometry(1.1, 1.5, 4);
  for (let x = -72; x <= 72; x += 6.5) {
    if (Math.abs(x) < 9) continue; // проезд по шоссе
    const tz = 118;
    const ty = getTerrainHeight(x, tz, mission);
    const tooth = new THREE.Mesh(toothGeo, buildingWall);
    tooth.position.set(x, ty + 0.65, tz + (Math.abs(x) % 2) * 2.2);
    scene.add(tooth);
  }

  // 7. Высоковольтная линия электропередач (ЛЭП) с провисающими проводами и красными огнями
  const pylonGeo = new THREE.CylinderGeometry(0.45, 1.35, 24, 4);
  const crossArmGeo = new THREE.BoxGeometry(9.5, 0.45, 0.45);
  const wireMat = new THREE.LineBasicMaterial({ color: 0x455257, transparent: true, opacity: 0.65 });
  let prevTops: THREE.Vector3[] | null = null;

  for (let px = -520; px <= 520; px += 130) {
    const pz = 640;
    const py = getTerrainHeight(px, pz, mission);
    const tower = new THREE.Mesh(pylonGeo, pylonMat);
    tower.position.set(px, py + 11.5, pz);
    scene.add(tower);
    addWireframeEdge(tower, 0x00b894, mm);

    const arm = new THREE.Mesh(crossArmGeo, pylonMat);
    arm.position.set(px, py + 21, pz);
    scene.add(arm);

    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.42, 6, 6), redLightMat);
    beacon.position.set(px, py + 24.2, pz);
    scene.add(beacon);

    const currTops = [
      new THREE.Vector3(px - 4.4, py + 21, pz),
      new THREE.Vector3(px + 4.4, py + 21, pz),
    ];
    if (prevTops) {
      for (let wIdx = 0; wIdx < 2; wIdx++) {
        const pA = prevTops[wIdx];
        const pB = currTops[wIdx];
        const pts: THREE.Vector3[] = [];
        for (let s = 0; s <= 8; s++) {
          const t = s / 8;
          const v = new THREE.Vector3().lerpVectors(pA, pB, t);
          v.y -= Math.sin(t * Math.PI) * 3.4; // естественный провис провода
          pts.push(v);
        }
        const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
        scene.add(new THREE.Line(lineGeo, wireMat));
      }
    }
    prevTops = currTops;
  }

  // 8. Полезащитные лесополосы (InstancedMesh для идеальных 60 FPS на смартфонах)
  const treePositions: Array<{ x: number; y: number; z: number; s: number }> = [];
  for (let z = -1100; z <= 1850; z += 22) {
    for (const baseLineX of [-330, 320]) {
      if (Math.sin(z * 0.03) > -0.65) {
        const tx = baseLineX + Math.sin(z * 0.07) * 9;
        treePositions.push({
          x: tx,
          y: getTerrainHeight(tx, z, mission),
          z,
          s: 0.85 + ((Math.abs(z * 13) % 10) / 18),
        });
      }
    }
  }
  for (const rowZ of [1320, 860, 290, -760]) {
    for (let x = -480; x <= 480; x += 24) {
      if (Math.abs(x) < 68) continue;
      treePositions.push({
        x,
        y: getTerrainHeight(x, rowZ, mission),
        z: rowZ + Math.cos(x * 0.08) * 6,
        s: 0.8 + ((Math.abs(x * 7) % 10) / 20),
      });
    }
  }

  const crownGeo = new THREE.ConeGeometry(4.2, 11.5, 6);
  const trunkGeo = new THREE.CylinderGeometry(0.55, 0.75, 3.2, 5);
  const crowns = new THREE.InstancedMesh(crownGeo, foliageMat, treePositions.length);
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treePositions.length);

  const dummy = new THREE.Object3D();
  treePositions.forEach((tp, idx) => {
    dummy.position.set(tp.x, tp.y + 7.2 * tp.s, tp.z);
    dummy.scale.set(tp.s, tp.s, tp.s);
    dummy.rotation.y = (idx * 1.7) % (Math.PI * 2);
    dummy.updateMatrix();
    crowns.setMatrixAt(idx, dummy.matrix);

    dummy.position.set(tp.x, tp.y + 1.5 * tp.s, tp.z);
    dummy.updateMatrix();
    trunks.setMatrixAt(idx, dummy.matrix);
  });
  crowns.instanceMatrix.needsUpdate = true;
  trunks.instanceMatrix.needsUpdate = true;
  crowns.castShadow = true;
  crowns.receiveShadow = true;
  trunks.castShadow = true;
  trunks.receiveShadow = true;
  scene.add(crowns);
  scene.add(trunks);

  // 9. Камни, кустарник и обломки у обочин: мелкие ориентиры сильно усиливают ощущение скорости на бреющем полёте.
  let scatterSeed = 48151623;
  const scatterRnd = () => {
    scatterSeed = (scatterSeed * 1664525 + 1013904223) >>> 0;
    return scatterSeed / 4294967295;
  };
  const rockMat = mm.create(0x5d5b55, 0.3, 0x10222b);
  const bushMat = mm.create(0x2f4425, 0.2, 0x0a221d);
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  const bushGeo = new THREE.IcosahedronGeometry(1, 1);
  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, 210);
  const bushes = new THREE.InstancedMesh(bushGeo, bushMat, 190);

  const scatterDummy = new THREE.Object3D();
  let rockIdx = 0;
  let bushIdx = 0;
  for (let i = 0; i < 760 && (rockIdx < 210 || bushIdx < 190); i++) {
    const x = -1050 + scatterRnd() * 2100;
    const z = -1150 + scatterRnd() * 3000;
    if (Math.abs(x) < 34 || Math.abs(z + 280) < 22) continue;
    if (mission.riverZ !== undefined && Math.abs(z - mission.riverZ) < 62) continue;
    if (mission.hasAirfield && Math.abs(x + 15) < 95 && z > -790 && z < 130) continue;

    const y = getTerrainHeight(x, z, mission);
    if (i % 2 === 0 && rockIdx < 210) {
      const s = 0.45 + scatterRnd() * 1.65;
      scatterDummy.position.set(x, y + s * 0.28, z);
      scatterDummy.rotation.set(scatterRnd() * 0.7, scatterRnd() * Math.PI * 2, scatterRnd() * 0.7);
      scatterDummy.scale.set(s * (0.8 + scatterRnd() * 0.7), s * 0.62, s * (0.75 + scatterRnd() * 0.6));
      scatterDummy.updateMatrix();
      rocks.setMatrixAt(rockIdx++, scatterDummy.matrix);
    } else if (bushIdx < 190) {
      const s = 1.1 + scatterRnd() * 2.4;
      scatterDummy.position.set(x, y + s * 0.48, z);
      scatterDummy.rotation.set(0, scatterRnd() * Math.PI * 2, 0);
      scatterDummy.scale.set(s, s * 0.58, s * (0.75 + scatterRnd() * 0.35));
      scatterDummy.updateMatrix();
      bushes.setMatrixAt(bushIdx++, scatterDummy.matrix);
    }
  }
  rocks.count = rockIdx;
  bushes.count = bushIdx;
  rocks.instanceMatrix.needsUpdate = true;
  bushes.instanceMatrix.needsUpdate = true;
  rocks.castShadow = true;
  rocks.receiveShadow = true;
  bushes.castShadow = true;
  bushes.receiveShadow = true;
  scene.add(rocks);
  scene.add(bushes);

  return terrainMat;
}

/** Детализированная 3D-модель БПЛА «Герань-2М» (ночной карбоновый дельта-планер с ГСН, «Кометой-М» и толкающим винтом) */
export function buildGeranWingmanModel(
  mm: MaterialManager,
  scale = 1.45
): {
  root: THREE.Group;
  propeller: THREE.Group;
} {
  const root = new THREE.Group();
  const bodyMat = mm.create(0x23282d, 0.44, 0x0d262e);
  const darkPanelMat = mm.create(0x171a1e, 0.36, 0x091c24);
  const kometaDiskMat = mm.create(0x8d9490, 0.58, 0x00ffc8);
  const redStarMat = mm.create(0xc9242b, 0.68, 0xff3b5c);
  const seekerLensMat = mm.create(0x123842, 0.72, 0x00ffc8);
  const engineHotMat = mm.create(0x28201e, 1.0, 0xff4455, 0x2c0b00, 0xff2244);

  // Цилиндро-веретенообразный фюзеляж планера (длина 3.5 м, размах 2.5 м)
  const fus = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 2.7, 10), bodyMat);
  fus.rotation.x = Math.PI / 2;
  root.add(fus);
  addWireframeEdge(fus, 0x00ffc8, mm);

  // Носовой радиопрозрачный обтекатель + окно оптико-тепловизионной ГСН и трубка ПВД
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.88, 10), darkPanelMat);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -1.78;
  root.add(nose);

  const lens = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), seekerLensMat);
  lens.position.set(0, -0.05, -2.14);
  root.add(lens);

  const pitot = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.35, 6), kometaDiskMat);
  pitot.rotation.x = Math.PI / 2;
  pitot.position.set(0.08, -0.08, -2.28);
  root.add(pitot);

  // Модуль помехозащищённой спутниковой CRP-антенны «Комета-М» на спинке фюзеляжа
  const kometa = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.12, 0.05, 8), kometaDiskMat);
  kometa.position.set(0, 0.22, -0.45);
  root.add(kometa);

  // Характерное дельта-крыло «Герани» с корневыми наплывами
  const shape = new THREE.Shape();
  shape.moveTo(0, -1.05);
  shape.lineTo(0.36, -0.35);
  shape.lineTo(1.32, 0.9);
  shape.lineTo(1.32, 1.28);
  shape.lineTo(-1.32, 1.28);
  shape.lineTo(-1.32, 0.9);
  shape.lineTo(-0.36, -0.35);
  shape.closePath();
  const wingGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.06, bevelEnabled: false });
  const wing = new THREE.Mesh(wingGeo, bodyMat);
  wing.rotation.x = Math.PI / 2;
  wing.position.y = 0.03;
  root.add(wing);
  addWireframeEdge(wing, 0x00ffc8, mm);

  // Гвардейские опознавательные знаки Ру-войск на консолях крыла
  for (const sx of [-0.78, 0.78]) {
    const star = new THREE.Mesh(new THREE.CircleGeometry(0.19, 5), redStarMat);
    star.rotation.x = -Math.PI / 2;
    star.rotation.z = Math.PI / 10;
    star.position.set(sx, 0.045, 0.72);
    root.add(star);
  }

  // Концевые вертикальные шайбы-стабилизаторы с рулями направления
  for (const sx of [-1.32, 1.32]) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.52, 0.56), darkPanelMat);
    fin.position.set(sx, 0.14, 1.02);
    root.add(fin);
    addWireframeEdge(fin, 0x00ffc8, mm);
  }

  // Раскаленный двухтактный оппозитный двигатель МД-550 с цилиндрами и патрубками
  const eng = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.42, 8), engineHotMat);
  eng.rotation.x = Math.PI / 2;
  eng.position.z = 1.42;
  root.add(eng);

  const cylinders = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.16, 0.24), engineHotMat);
  cylinders.position.z = 1.42;
  root.add(cylinders);

  // Узел толкающего двухлопастного винта с полупрозрачным диском вращения
  const propGroup = new THREE.Group();
  propGroup.position.z = 1.69;

  const bladeMat = new THREE.MeshBasicMaterial({ color: 0xd8e0e2 });
  const blade = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.085, 0.025), bladeMat);
  propGroup.add(blade);

  const blurDiscMat = new THREE.MeshBasicMaterial({
    color: 0xcfe8e5,
    transparent: true,
    opacity: 0.2,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const blurDisc = new THREE.Mesh(new THREE.CircleGeometry(0.54, 16), blurDiscMat);
  propGroup.add(blurDisc);

  root.add(propGroup);
  root.scale.setScalar(scale);

  return { root, propeller: propGroup };
}
