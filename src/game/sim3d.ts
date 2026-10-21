import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

import {
  WARHEAD_SPECS,
  type CameraMode,
  type ControlSettings,
  type FlightInput,
  type ImpactReport,
  type MissionDef,
  type ProjectedTargetHUD,
  type RadarBlip,
  type RadioLine,
  type ReplayCameraAngle,
  type ReplayFrame,
  type ReplayStatus,
  type SortieReplayRecord,
  type TargetBlueprint,
  type TelemetryData,
  type WarheadType,
} from './types';
import {
  buildEnvironment,
  buildGeranWingmanModel,
  buildSkyAndClouds,
  buildTargetModel,
  buildTerrainTextures,
  buildTrainingGateModel,
  getTerrainHeight,
  MaterialManager,
  type BuiltTargetVisual,
  type SkySystem,
} from './models';
import { soundFX } from './sound';
import { sanitizeFlightInput, sanitizeSensitivity, smoothAxis } from './controlMath';
import { classifyWindowStrike, closestPointOnSegment, getWindowWorldPoint } from './windowStrike';

interface TargetEntity {
  bp: TargetBlueprint;
  visual: BuiltTargetVisual;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  heading: number;
  destroyed: boolean;
  smokePopped: boolean; // сработала ли система отстрела дымовых гранат «Туча» у танка
  patrolIdx: number;
  fireCooldown: number;
  burstLeft: number;
  burstTimer: number;
  ewDomeMesh?: THREE.Mesh;
}

interface GateEntity {
  id: string;
  label: string;
  pos: THREE.Vector3;
  mesh: THREE.Group;
  passed: boolean;
}

interface SamMissile {
  mesh: THREE.Group;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  lostLock: boolean;
  smokeTimer: number;
}

interface TracerBullet {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
}

interface Particle3D {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  growSpeed: number;
  gravity: number;
  fadeOpacity: boolean;
  baseOpacity: number;
  alignToVel?: boolean;
  billboard?: boolean;
  spin?: number;
  spinSpeed?: number;
}

interface PersistentFireSite {
  targetId?: string;
  sortieIndex: number;
  flightTimeCreated: number;
  pos: THREE.Vector3;
  big: boolean;
  timer: number;
}

const CALLSIGNS = ['Г-204', 'Г-205', 'Г-206', 'Г-207', 'Г-208', 'Г-209'];

export class GeranSimulation {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private bloomPass: UnrealBloomPass;
  private gradePass!: ShaderPass;
  private bloomFlash = 0;
  private gradeTime = 0;

  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private mm: MaterialManager;
  private sky!: SkySystem;
  private terrainTextures: Record<CameraMode, THREE.CanvasTexture>;
  private terrainMat!: THREE.MeshStandardMaterial;
  private environmentTexture!: THREE.DataTexture;
  private sunDirection = new THREE.Vector3(0.35, 0.55, -0.75).normalize();
  private shadowFocus = new THREE.Vector3();

  private ambientLight!: THREE.AmbientLight;
  private hemisphereLight!: THREE.HemisphereLight;
  private dirLight!: THREE.DirectionalLight;
  private impactFlashLight!: THREE.PointLight;
  private horizonFlashLight!: THREE.PointLight;
  private horizonFlashTimer = 4.5;
  private noseProbeGroup!: THREE.Group;

  private mission: MissionDef;
  private cameraMode: CameraMode = 'flir';
  private zoom: 1 | 2.5 = 1;
  private currentWarhead: WarheadType = 'of50';

  // Состояние звена БПЛА
  public droneIndex = 0;
  public dronesRemaining: number;
  private isFlying = false;
  private isReconMode = false;
  private reconOrbitAngle = 0;
  private reconFocus = new THREE.Vector3();

  // Состояние текущего БПЛА в полете
  private dronePos = new THREE.Vector3();
  private droneQuat = new THREE.Quaternion();
  private yaw = 0;
  private pitch = -0.14;
  private roll = 0;
  private speedMps = 53;
  private hullIntegrity = 100;
  private fuelPercent = 96;
  private flightTime = 0;
  private shakeIntensity = 0;

  // Сюжетные триггеры радиоэфира в полете
  private midRadioSent = false;
  private samRadioCooldown = 0;

  // Только пассивная индикация цели у перекрестия; автонаведения/автозахвата нет.
  private centerTargetId: string | null = null;
  private smoothedYawCmd = 0;
  private smoothedPitchCmd = 0;

  // 3D-модель нашего собственного борта «Герань-2М» (отображается во внешних камерах Повтора!)
  private playerDroneModel!: {
    root: THREE.Group;
    propeller: THREE.Group;
  };

  // Ведомый БПЛА «Герань-2М» из нашей волны
  private wingman!: {
    root: THREE.Group;
    propeller: THREE.Group;
    pos: THREE.Vector3;
    targetPos: THREE.Vector3;
    active: boolean;
  };

  // === ЗАПИСЬ И ВОСПРОИЗВЕДЕНИЕ 3D-ПОВТОРА («ЧЁРНЫЙ ЯЩИК») ===
  private replays: SortieReplayRecord[] = [];
  private recordingFrames: ReplayFrame[] = [];
  private recordSampleTimer = 0;
  private destroyedBeforeCurrentSortie: string[] = [];
  private savedLiveTargetsSnapshot: Array<{
    id: string;
    x: number;
    y: number;
    z: number;
    heading: number;
    destroyed: boolean;
  }> = [];

  private isReplayMode = false;
  private activeReplay: SortieReplayRecord | null = null;
  private replayTime = 0;
  private replayPlaying = true;
  private replaySpeed: 0.25 | 0.5 | 1 = 1;
  private replayAngle: ReplayCameraAngle = 'chase';
  private replayShowTrail = true;
  private replayImpactTriggered = false;
  private replayShake = 0;
  private replayTrailLine: THREE.Line | null = null;
  private replayTracerPool: THREE.Mesh[] = [];
  private replaySamPool: THREE.Mesh[] = [];
  private wingtipVortexTimer = 0;

  // Объекты, учебные кольца и эффекты 3D-мира
  private targets: TargetEntity[] = [];
  private gates: GateEntity[] = [];
  private samMissiles: SamMissile[] = [];
  private tracers: TracerBullet[] = [];
  private particles: Particle3D[] = [];
  private fireSites: PersistentFireSite[] = [];

  private sphereGeo = new THREE.IcosahedronGeometry(1, 1);
  private particlePlaneGeo = new THREE.PlaneGeometry(1, 1);
  private particleTexture!: THREE.CanvasTexture;
  private ringGeo = new THREE.RingGeometry(0.82, 1.0, 28);
  private sparkGeo = new THREE.BoxGeometry(0.18, 0.18, 2.2);
  private tracerGeo = new THREE.BoxGeometry(0.28, 0.28, 5.8);

  private onImpactCallback: (report: ImpactReport) => void;
  private onTelemetryCallback: (data: TelemetryData) => void;
  private onRadioCallback: (line: RadioLine) => void;
  private onGatePassedCallback?: (passed: number, total: number) => void;
  private onReplayStatusCallback?: (status: ReplayStatus) => void;
  private telemetryAccum = 0;

  constructor(
    container: HTMLElement,
    mission: MissionDef,
    initialMode: CameraMode,
    onImpact: (report: ImpactReport) => void,
    onTelemetry: (data: TelemetryData) => void,
    onRadio: (line: RadioLine) => void,
    onGatePassed?: (passed: number, total: number) => void,
    onReplayStatus?: (status: ReplayStatus) => void
  ) {
    this.container = container;
    this.mission = mission;
    this.cameraMode = initialMode;
    this.dronesRemaining = mission.dronesCount;
    this.onImpactCallback = onImpact;
    this.onTelemetryCallback = onTelemetry;
    this.onRadioCallback = onRadio;
    this.onGatePassedCallback = onGatePassed;
    this.onReplayStatusCallback = onReplayStatus;

    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, w / h, 0.55, 3900);

    // HalfFloat + MSAA render target: Bloom не «съедает» тонкие провода, антенны и края крыла.
    const composerTarget = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      samples: 4,
    });
    this.composer = new EffectComposer(this.renderer, composerTarget);
    const renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(renderPass);

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(Math.max(256, Math.floor(w * 0.65)), Math.max(256, Math.floor(h * 0.65))),
      0.38,
      0.55,
      0.72
    );
    this.composer.addPass(this.bloomPass);

    // Финальный кинематографичный/сенсорный грейд до OutputPass (в линейном HDR-пространстве).
    this.gradePass = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        uTime: { value: 0 },
        uGrain: { value: 0.045 },
        uVignette: { value: 0.38 },
        uChromatic: { value: 0.0007 },
        uSaturation: { value: 0.96 },
        uContrast: { value: 1.08 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float uTime;
        uniform float uGrain;
        uniform float uVignette;
        uniform float uChromatic;
        uniform float uSaturation;
        uniform float uContrast;
        varying vec2 vUv;

        float hash12(vec2 p) {
          vec3 p3 = fract(vec3(p.xyx) * 0.1031);
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.x + p3.y) * p3.z);
        }

        void main() {
          vec2 centered = vUv - 0.5;
          float radius2 = dot(centered, centered);
          vec2 chromaOffset = centered * uChromatic * (0.35 + radius2 * 2.2);
          vec3 col;
          col.r = texture2D(tDiffuse, vUv + chromaOffset).r;
          col.g = texture2D(tDiffuse, vUv).g;
          col.b = texture2D(tDiffuse, vUv - chromaOffset).b;

          float luminance = dot(col, vec3(0.2126, 0.7152, 0.0722));
          col = mix(vec3(luminance), col, uSaturation);
          col = (col - 0.5) * uContrast + 0.5;

          float vignette = smoothstep(0.92, 0.18, radius2 * 1.65);
          col *= mix(1.0 - uVignette, 1.0, vignette);

          float grain = hash12(vUv * vec2(1920.0, 1080.0) + fract(uTime) * 371.0) - 0.5;
          col += grain * uGrain * (0.35 + 0.65 * (1.0 - clamp(luminance, 0.0, 1.0)));
          gl_FragColor = vec4(max(col, 0.0), 1.0);
        }
      `,
    });
    this.composer.addPass(this.gradePass);
    this.composer.addPass(new OutputPass());

    this.mm = new MaterialManager();
    this.particleTexture = this.createParticleTexture();
    this.terrainTextures = buildTerrainTextures();

    this.setupLighting();
    this.sky = buildSkyAndClouds(this.scene);
    this.terrainMat = buildEnvironment(this.scene, mission, this.mm, this.terrainTextures);
    this.spawnTargets();
    this.spawnTrainingGates();
    this.buildNoseProbe();

    // 3D-модель нашего собственного борта «Герань-2М» (масштаб 1.15 для выразительного реплея!)
    this.playerDroneModel = buildGeranWingmanModel(this.mm, 1.15);
    this.playerDroneModel.root.visible = false;
    this.scene.add(this.playerDroneModel.root);

    // Ведомый БПЛА роя
    const wm = buildGeranWingmanModel(this.mm, 1.45);
    wm.root.visible = false;
    this.scene.add(wm.root);
    this.wingman = {
      root: wm.root,
      propeller: wm.propeller,
      pos: new THREE.Vector3(),
      targetPos: new THREE.Vector3(240, 0, -510),
      active: false,
    };

    // Пулы мешей трассеров и ракет для воспроизведения в повторе
    const replayTrMat = new THREE.MeshBasicMaterial({
      color: 0xff8822,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    for (let i = 0; i < 16; i++) {
      const m = new THREE.Mesh(this.tracerGeo, replayTrMat);
      m.visible = false;
      this.scene.add(m);
      this.replayTracerPool.push(m);
    }
    const replaySamGeo = new THREE.ConeGeometry(0.5, 4.8, 7);
    replaySamGeo.rotateX(Math.PI / 2);
    const replaySamMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(replaySamGeo, replaySamMat);
      m.visible = false;
      this.scene.add(m);
      this.replaySamPool.push(m);
    }

    this.configureShadowFlags(this.scene);
    this.applyCameraMode(this.cameraMode);

    window.addEventListener('resize', this.handleResize);
  }

  private createParticleTexture(): THREE.CanvasTexture {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, size, size);

    let seed = 24681357;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967295;
    };

    for (let i = 0; i < 34; i++) {
      const x = size / 2 + (rnd() - 0.5) * size * 0.52;
      const y = size / 2 + (rnd() - 0.5) * size * 0.52;
      const r = 13 + rnd() * 34;
      const g = ctx.createRadialGradient(x, y, 1, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.24)');
      g.addColorStop(0.45, 'rgba(235,235,235,0.12)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Жёсткий альфа-фоллофф к краям, чтобы квадрат спрайта никогда не был виден.
    const mask = ctx.createRadialGradient(size / 2, size / 2, size * 0.16, size / 2, size / 2, size * 0.5);
    mask.addColorStop(0, 'rgba(0,0,0,0)');
    mask.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = mask;
    ctx.fillRect(0, 0, size, size);
    ctx.globalCompositeOperation = 'source-over';

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  private createBillboardParticle(
    color: number,
    opacity: number,
    blending: THREE.Blending = THREE.NormalBlending
  ): THREE.Mesh {
    const mat = new THREE.MeshBasicMaterial({
      map: this.particleTexture,
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      blending,
      side: THREE.DoubleSide,
    });
    return new THREE.Mesh(this.particlePlaneGeo, mat);
  }

  private setupLighting() {
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.22);
    this.scene.add(this.ambientLight);

    this.hemisphereLight = new THREE.HemisphereLight(0xbfd4e6, 0x3d4632, 0.55);
    this.scene.add(this.hemisphereLight);

    this.dirLight = new THREE.DirectionalLight(0xffeedd, 2.2);
    this.dirLight.position.set(320, 520, -340);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.set(window.innerWidth > 760 ? 2048 : 1024, window.innerWidth > 760 ? 2048 : 1024);
    this.dirLight.shadow.camera.near = 40;
    this.dirLight.shadow.camera.far = 980;
    this.dirLight.shadow.camera.left = -190;
    this.dirLight.shadow.camera.right = 190;
    this.dirLight.shadow.camera.top = 190;
    this.dirLight.shadow.camera.bottom = -190;
    this.dirLight.shadow.bias = -0.00045;
    this.dirLight.shadow.normalBias = 1.15;
    this.scene.add(this.dirLight);
    this.scene.add(this.dirLight.target);

    // Процедурная equirect-среда для PBR-отражений: небо сверху, дымка у горизонта и тёмная земля снизу.
    const envData = new Uint8Array(64 * 32 * 4);
    this.environmentTexture = new THREE.DataTexture(envData, 64, 32, THREE.RGBAFormat);
    this.environmentTexture.mapping = THREE.EquirectangularReflectionMapping;
    this.environmentTexture.colorSpace = THREE.SRGBColorSpace;
    this.environmentTexture.needsUpdate = true;
    this.scene.environment = this.environmentTexture;
    this.scene.environmentIntensity = 0.45;
    this.updateEnvironmentTexture(0x32587e, 0x94aab6, 0x2f382a);

    this.impactFlashLight = new THREE.PointLight(0xffaa44, 0, 380);
    this.scene.add(this.impactFlashLight);

    this.horizonFlashLight = new THREE.PointLight(0xff7722, 0, 950);
    this.horizonFlashLight.position.set(0, 85, -1450);
    this.scene.add(this.horizonFlashLight);
  }

  private updateEnvironmentTexture(topHex: number, horizonHex: number, groundHex: number) {
    const top = new THREE.Color(topHex);
    const horizon = new THREE.Color(horizonHex);
    const ground = new THREE.Color(groundHex);
    const data = this.environmentTexture.image.data as Uint8Array;
    const tmp = new THREE.Color();

    for (let y = 0; y < 32; y++) {
      const v = y / 31;
      if (v < 0.5) {
        tmp.copy(ground).lerp(horizon, Math.pow(v / 0.5, 0.7));
      } else {
        tmp.copy(horizon).lerp(top, Math.pow((v - 0.5) / 0.5, 0.75));
      }
      for (let x = 0; x < 64; x++) {
        const i = (y * 64 + x) * 4;
        data[i] = Math.round(THREE.MathUtils.clamp(tmp.r, 0, 1) * 255);
        data[i + 1] = Math.round(THREE.MathUtils.clamp(tmp.g, 0, 1) * 255);
        data[i + 2] = Math.round(THREE.MathUtils.clamp(tmp.b, 0, 1) * 255);
        data[i + 3] = 255;
      }
    }
    this.environmentTexture.needsUpdate = true;
  }

  private getSunDirectionForTime(): THREE.Vector3 {
    switch (this.mission.timeOfDay) {
      case 'dawn':
        return new THREE.Vector3(-0.58, 0.17, -0.8).normalize();
      case 'day':
        return new THREE.Vector3(0.42, 0.78, -0.46).normalize();
      case 'dusk':
        return new THREE.Vector3(0.66, 0.14, -0.74).normalize();
      case 'night':
        return new THREE.Vector3(-0.28, 0.56, -0.62).normalize();
    }
  }

  private configureShadowFlags(root: THREE.Object3D) {
    root.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      if (obj.name === 'sky-dome' || obj.name === 'cloud-sprite' || obj.name === 'river-water') {
        obj.castShadow = false;
        obj.receiveShadow = obj.name === 'river-water';
        return;
      }
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      const transparent = materials.some((m) => (m as THREE.Material).transparent);
      if (transparent) {
        obj.castShadow = false;
        return;
      }
      obj.castShadow = obj.name !== 'terrain';
      obj.receiveShadow = true;
    });
  }

  private updateSunAndShadowCamera(highGraphics: boolean) {
    const focus = this.isFlying
      ? this.dronePos
      : this.isReplayMode && this.playerDroneModel.root.visible
        ? this.playerDroneModel.root.position
        : this.isReconMode
          ? this.reconFocus
          : this.camera.position;

    // Привязка к 4-метровой сетке убирает «плавание» теней при движении камеры.
    this.shadowFocus.set(
      Math.round(focus.x / 4) * 4,
      Math.max(0, focus.y),
      Math.round(focus.z / 4) * 4
    );
    this.dirLight.position.copy(this.shadowFocus).addScaledVector(this.sunDirection, 420);
    this.dirLight.target.position.copy(this.shadowFocus);
    this.dirLight.target.updateMatrixWorld();
    this.dirLight.castShadow = highGraphics && this.cameraMode === 'eo';
  }

  private buildNoseProbe() {
    this.noseProbeGroup = new THREE.Group();
    const probeMat = new THREE.MeshBasicMaterial({ color: 0x151a1c });
    const cowlGeo = new THREE.ConeGeometry(0.18, 0.5, 8);
    cowlGeo.rotateX(-Math.PI / 2);
    const cowl = new THREE.Mesh(cowlGeo, probeMat);
    cowl.position.set(0, -0.34, -0.68);

    const pitotGeo = new THREE.CylinderGeometry(0.008, 0.012, 0.34, 6);
    pitotGeo.rotateX(Math.PI / 2);
    const pitot = new THREE.Mesh(pitotGeo, probeMat);
    pitot.name = 'nose-probe';
    pitot.position.set(0.14, -0.29, -0.78);

    this.noseProbeGroup.add(cowl);
    this.noseProbeGroup.add(pitot);
    this.camera.add(this.noseProbeGroup);
    this.scene.add(this.camera);
  }

  private spawnTargets() {
    const showSpotlights =
      this.mission.timeOfDay === 'night' ||
      this.mission.timeOfDay === 'dusk' ||
      this.mission.timeOfDay === 'dawn';

    for (const bp of this.mission.targets) {
      const visual = buildTargetModel(bp.kind, bp.isPrimary, this.mm, showSpotlights, bp);
      const y = getTerrainHeight(bp.x, bp.z, this.mission);
      const pos = new THREE.Vector3(bp.x, y, bp.z);
      visual.root.position.copy(pos);
      const heading = bp.rotation ?? 0;
      visual.root.rotation.y = heading;
      this.scene.add(visual.root);

      let ewDomeMesh: THREE.Mesh | undefined;
      if (bp.kind === 'ew' && bp.ewRadius) {
        const domeGeo = new THREE.SphereGeometry(bp.ewRadius, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.5);
        const domeMat = new THREE.MeshBasicMaterial({
          color: 0xffaa00,
          wireframe: true,
          transparent: true,
          opacity: 0.07,
        });
        ewDomeMesh = new THREE.Mesh(domeGeo, domeMat);
        ewDomeMesh.position.copy(pos);
        this.scene.add(ewDomeMesh);
      }

      this.targets.push({
        bp,
        visual,
        pos,
        vel: new THREE.Vector3(),
        heading,
        destroyed: false,
        smokePopped: false,
        patrolIdx: 1,
        fireCooldown: bp.kind === 'sam' ? 4.5 : 1.5 + Math.random() * 2,
        burstLeft: 0,
        burstTimer: 0,
        ewDomeMesh,
      });
    }
  }

  /** Мировая точка, которую оператор должен держать в перекрестии для данной цели. */
  private getTargetAimPoint(t: TargetEntity): THREE.Vector3 {
    if (t.bp.kind === 'hq_window') {
      const p = getWindowWorldPoint(t.pos, t.heading, t.bp);
      return new THREE.Vector3(p.x, p.y, p.z);
    }
    return t.pos.clone().add(new THREE.Vector3(0, t.visual.aimHeightOffset, 0));
  }

  private spawnTrainingGates() {
    if (!this.mission.trainingGates) return;
    for (const g of this.mission.trainingGates) {
      const gy = getTerrainHeight(g.x, g.z, this.mission);
      const pos = new THREE.Vector3(g.x, gy + g.agl, g.z);
      const mesh = buildTrainingGateModel();
      mesh.position.copy(pos);
      this.scene.add(mesh);
      this.gates.push({
        id: g.id,
        label: g.label,
        pos,
        mesh,
        passed: false,
      });
    }
  }

  public applyCameraMode(mode: CameraMode) {
    this.cameraMode = mode;
    const tod = this.mission.timeOfDay;
    const isNight = tod === 'night';

    this.terrainMat.map = this.terrainTextures[mode];
    this.terrainMat.vertexColors = mode === 'eo';
    this.terrainMat.bumpScale = mode === 'eo' ? 0.65 : mode === 'synth' ? 0.03 : 0.08;
    this.terrainMat.roughness = mode === 'eo' ? 0.96 : 1;
    this.terrainMat.envMapIntensity = mode === 'eo' ? 0.18 : 0;
    this.terrainMat.needsUpdate = true;
    this.mm.applyMode(mode, isNight);

    this.sunDirection.copy(this.getSunDirectionForTime());
    this.sky.uniforms.sunDirection.value.copy(this.sunDirection);

    const setGrade = (grain: number, vignette: number, chroma: number, saturation: number, contrast: number) => {
      const u = this.gradePass.uniforms as Record<string, { value: number }>;
      u.uGrain.value = grain;
      u.uVignette.value = vignette;
      u.uChromatic.value = chroma;
      u.uSaturation.value = saturation;
      u.uContrast.value = contrast;
    };

    if (mode === 'flir') {
      this.scene.fog = new THREE.FogExp2(0x181e1b, 0.00046);
      this.sky.uniforms.topColor.value.setHex(0x090d0c);
      this.sky.uniforms.horizonColor.value.setHex(0x222926);
      this.sky.uniforms.glowColor.value.setHex(0x3b4440);
      this.sky.cloudMat.color.setHex(0x6e7874);
      this.sky.cloudMat.opacity = 0.34;
      this.sky.uniforms.sunColor.value.setHex(0xdfe9e4);
      this.sky.uniforms.sunIntensity.value = 0.08;
      this.sky.uniforms.starAmount.value = 0;
      this.sky.uniforms.hazeStrength.value = 0.35;
      this.ambientLight.color.setHex(0xd8e2dc);
      this.ambientLight.intensity = 0.48;
      this.hemisphereLight.color.setHex(0xd8e2dc);
      this.hemisphereLight.groundColor.setHex(0x171b19);
      this.hemisphereLight.intensity = 0.55;
      this.dirLight.color.setHex(0xffffff);
      this.dirLight.intensity = 0.85;
      this.dirLight.castShadow = false;
      this.scene.environmentIntensity = 0;
      this.renderer.toneMappingExposure = 1.0;
      this.updateEnvironmentTexture(0x090d0c, 0x222926, 0x050706);
      setGrade(0.055, 0.42, 0.00035, 0.92, 1.1);
    } else if (mode === 'bhot') {
      this.scene.fog = new THREE.FogExp2(0xc4ccca, 0.00048);
      this.sky.uniforms.topColor.value.setHex(0xa8b2b0);
      this.sky.uniforms.horizonColor.value.setHex(0xd5ddda);
      this.sky.uniforms.glowColor.value.setHex(0x7c8683);
      this.sky.cloudMat.color.setHex(0x88928f);
      this.sky.cloudMat.opacity = 0.32;
      this.sky.uniforms.sunColor.value.setHex(0x222624);
      this.sky.uniforms.sunIntensity.value = 0.06;
      this.sky.uniforms.starAmount.value = 0;
      this.sky.uniforms.hazeStrength.value = 0.22;
      this.ambientLight.color.setHex(0xffffff);
      this.ambientLight.intensity = 0.62;
      this.hemisphereLight.color.setHex(0xffffff);
      this.hemisphereLight.groundColor.setHex(0x555c59);
      this.hemisphereLight.intensity = 0.65;
      this.dirLight.color.setHex(0xe8eeec);
      this.dirLight.intensity = 0.5;
      this.dirLight.castShadow = false;
      this.scene.environmentIntensity = 0;
      this.renderer.toneMappingExposure = 0.92;
      this.updateEnvironmentTexture(0xa8b2b0, 0xd5ddda, 0x777f7b);
      setGrade(0.045, 0.34, 0.0003, 0.9, 1.08);
    } else if (mode === 'synth') {
      this.scene.fog = new THREE.FogExp2(0x051017, 0.00042);
      this.sky.uniforms.topColor.value.setHex(0x02070c);
      this.sky.uniforms.horizonColor.value.setHex(0x07202b);
      this.sky.uniforms.glowColor.value.setHex(0x00a888);
      this.sky.cloudMat.color.setHex(0x00d8a8);
      this.sky.cloudMat.opacity = 0.14;
      this.sky.uniforms.sunColor.value.setHex(0x00ffc8);
      this.sky.uniforms.sunIntensity.value = 0.2;
      this.sky.uniforms.starAmount.value = 0.08;
      this.sky.uniforms.hazeStrength.value = 0.5;
      this.ambientLight.color.setHex(0x88ffee);
      this.ambientLight.intensity = 0.48;
      this.hemisphereLight.color.setHex(0x74ffe2);
      this.hemisphereLight.groundColor.setHex(0x04141a);
      this.hemisphereLight.intensity = 0.55;
      this.dirLight.color.setHex(0x00ffc8);
      this.dirLight.intensity = 0.75;
      this.dirLight.castShadow = false;
      this.scene.environmentIntensity = 0.04;
      this.renderer.toneMappingExposure = 1.0;
      this.updateEnvironmentTexture(0x02070c, 0x07202b, 0x02090b);
      setGrade(0.028, 0.36, 0.0016, 1.12, 1.08);
    } else {
      const palettes: Record<
        MissionDef['timeOfDay'],
        { top: number; hor: number; glow: number; fog: number }
      > = {
        dawn: { top: 0x24344c, hor: 0x8d7268, glow: 0xff944d, fog: 0x766868 },
        day: { top: 0x32587e, hor: 0x94aab6, glow: 0xfff0d0, fog: 0x869ba6 },
        dusk: { top: 0x1a2038, hor: 0x6e474b, glow: 0xff6a33, fog: 0x523e49 },
        night: { top: 0x050912, hor: 0x101a29, glow: 0x1d314a, fog: 0x0b121d },
      };
      const p = palettes[tod];
      this.scene.fog = new THREE.FogExp2(p.fog, isNight ? 0.00068 : tod === 'day' ? 0.00038 : 0.0005);
      this.sky.uniforms.topColor.value.setHex(p.top);
      this.sky.uniforms.horizonColor.value.setHex(p.hor);
      this.sky.uniforms.glowColor.value.setHex(p.glow);
      this.sky.uniforms.sunColor.value.setHex(
        isNight ? 0xbdd3ff : tod === 'day' ? 0xfff3d6 : tod === 'dawn' ? 0xffb277 : 0xff7a3c
      );
      this.sky.uniforms.sunIntensity.value = isNight ? 0.22 : tod === 'day' ? 1.35 : 1.05;
      this.sky.uniforms.starAmount.value = isNight ? 0.9 : 0;
      this.sky.uniforms.hazeStrength.value = tod === 'day' ? 0.42 : isNight ? 0.22 : 0.78;
      this.sky.cloudMat.color.setHex(
        isNight ? 0x223042 : tod === 'dusk' ? 0xd99b84 : tod === 'dawn' ? 0xf0c9b4 : 0xf4f8fb
      );
      this.sky.cloudMat.opacity = isNight ? 0.25 : tod === 'day' ? 0.58 : 0.5;
      this.ambientLight.color.setHex(isNight ? 0x3d5172 : 0xdde6ea);
      this.ambientLight.intensity = isNight ? 0.18 : 0.2;
      this.hemisphereLight.color.setHex(p.top);
      this.hemisphereLight.groundColor.setHex(isNight ? 0x111a16 : 0x44503a);
      this.hemisphereLight.intensity = isNight ? 0.34 : tod === 'day' ? 0.72 : 0.55;
      this.dirLight.color.setHex(
        isNight ? 0xbdd3ff : tod === 'dawn' || tod === 'dusk' ? 0xffb277 : 0xfff5e4
      );
      this.dirLight.intensity = isNight ? 0.42 : tod === 'day' ? 2.85 : 2.05;
      this.scene.environmentIntensity = isNight ? 0.16 : tod === 'day' ? 0.5 : 0.36;
      this.renderer.toneMappingExposure = isNight ? 0.92 : tod === 'day' ? 1.08 : 1.12;
      this.updateEnvironmentTexture(p.top, p.hor, isNight ? 0x0c120f : 0x35402f);
      setGrade(
        isNight ? 0.028 : 0.016,
        isNight ? 0.46 : 0.31,
        0.0011,
        tod === 'dusk' ? 1.08 : 1.04,
        1.045
      );
    }

    for (const t of this.targets) {
      if (t.ewDomeMesh) {
        (t.ewDomeMesh.material as THREE.MeshBasicMaterial).opacity =
          mode === 'synth' ? 0.14 : mode === 'flir' || mode === 'bhot' ? 0.04 : 0.0;
      }
    }
  }

  public setZoom(zoom: 1 | 2.5) {
    this.zoom = zoom;
    const isFpv = this.isFlying || (this.isReplayMode && this.replayAngle === 'fpv');
    this.camera.fov = zoom === 2.5 ? 26 : 62;
    this.noseProbeGroup.visible = zoom === 1 && isFpv;
    this.camera.updateProjectionMatrix();
  }

  public setWarhead(warhead: WarheadType) {
    this.currentWarhead = warhead;
  }

  /** Запускает очередной БПЛА «Герань-2М» из ударной волны с выбранной БЧ */
  public launchNextDrone(warhead?: WarheadType): boolean {
    if (this.dronesRemaining <= 0) return false;
    if (warhead) this.currentWarhead = warhead;

    this.stopReplayInternal();

    this.droneIndex = this.mission.dronesCount - this.dronesRemaining + 1;
    this.dronesRemaining -= 1;

    const hasUnpassedGates = this.gates.some((g) => !g.passed);
    if (this.mission.isTutorial && !hasUnpassedGates) {
      this.dronePos.set(0, 210, 820);
    } else {
      const offsetX = this.mission.isTutorial ? 0 : ((this.droneIndex - 1) % 3 - 1) * 55;
      this.dronePos.set(
        this.mission.spawnPos.x + offsetX,
        this.mission.spawnPos.y,
        this.mission.spawnPos.z
      );
    }

    const nextGate = this.gates.find((g) => !g.passed);
    if (nextGate) {
      const dx = nextGate.pos.x - this.dronePos.x;
      const dz = nextGate.pos.z - this.dronePos.z;
      this.yaw = Math.atan2(-dx, -dz);
      const horizDist = Math.hypot(dx, dz);
      this.pitch = Math.atan2(nextGate.pos.y - this.dronePos.y, horizDist);
    } else {
      const alivePrimary = this.targets.filter((t) => t.bp.isPrimary && !t.destroyed);
      const focusList = alivePrimary.length > 0 ? alivePrimary : this.targets.filter((t) => !t.destroyed);
      if (focusList.length > 0) {
        const avg = new THREE.Vector3();
        for (const f of focusList) avg.add(this.getTargetAimPoint(f));
        avg.divideScalar(focusList.length);
        const dx = avg.x - this.dronePos.x;
        const dz = avg.z - this.dronePos.z;
        this.yaw = Math.atan2(-dx, -dz);
        const horizDist = Math.hypot(dx, dz);
        this.pitch = Math.max(-0.22, Math.atan2(avg.y - this.dronePos.y, horizDist) * 0.85);
      } else {
        this.yaw = this.mission.spawnHeading;
        this.pitch = -0.14;
      }
    }

    this.roll = 0;
    this.speedMps = 53.5;
    this.hullIntegrity = 100;
    this.fuelPercent = 96;
    this.flightTime = 0;
    this.shakeIntensity = 0;
    this.centerTargetId = null;
    this.smoothedYawCmd = 0;
    this.smoothedPitchCmd = 0;

    // Сброс и старт записи «Чёрного ящика» для данного вылета!
    this.recordingFrames = [];
    this.recordSampleTimer = 0;
    this.destroyedBeforeCurrentSortie = this.targets
      .filter((t) => t.destroyed)
      .map((t) => t.bp.id);

    for (const m of this.samMissiles) this.scene.remove(m.mesh);
    this.samMissiles = [];

    if (!this.mission.isTutorial) {
      const fwd = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
      const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
      this.wingman.pos
        .copy(this.dronePos)
        .addScaledVector(fwd, 52)
        .addScaledVector(right, 16)
        .add(new THREE.Vector3(0, -5, 0));
      const decoyX = this.droneIndex % 2 === 1 ? 245 : -255;
      const decoyZ = -515;
      this.wingman.targetPos.set(decoyX, getTerrainHeight(decoyX, decoyZ, this.mission) + 4, decoyZ);
      this.wingman.active = true;
      this.wingman.root.visible = true;
      this.wingman.root.position.copy(this.wingman.pos);
    } else {
      this.wingman.active = false;
      this.wingman.root.visible = false;
    }

    this.playerDroneModel.root.visible = false;
    this.isReconMode = false;
    this.isFlying = true;
    this.setZoom(1);
    const euler = new THREE.Euler(this.pitch, this.yaw, this.roll, 'YXZ');
    this.droneQuat.setFromEuler(euler);
    this.updateCameraTransform();
    this.captureReplaySample(); // кадр 0.00 с

    soundFX.startFlightAudio();

    if (this.droneIndex === 1) {
      this.onRadioCallback(this.mission.radioIntro);
    }
    return true;
  }

  public skipTrainingGates() {
    for (const g of this.gates) {
      g.passed = true;
      g.mesh.visible = false;
    }
    this.onGatePassedCallback?.(this.gates.length, this.gates.length);
  }

  public selfDetonate() {
    if (!this.isFlying) return;
    this.triggerDetonation('aborted');
  }

  public getReplays(): SortieReplayRecord[] {
    return this.replays;
  }

  public getStats() {
    const primaryTotal = this.targets.filter((t) => t.bp.isPrimary).length;
    const primaryDestroyed = this.targets.filter((t) => t.bp.isPrimary && t.destroyed).length;
    const secondaryDestroyed = this.targets.filter((t) => !t.bp.isPrimary && t.destroyed).length;
    return {
      primaryTotal,
      primaryDestroyed,
      secondaryDestroyed,
      dronesRemaining: this.dronesRemaining,
      allPrimaryDone: primaryDestroyed >= primaryTotal,
    };
  }

  // ============================================================================
  // УПРАВЛЕНИЕ 3D-ПОВТОРОМ («ЧЁРНЫЙ ЯЩИК / ВИДЕОАРХИВ ОК»)
  // ============================================================================

  /** Включает режим 3D-повтора выбранного вылета (по умолчанию — последние 9 секунд перед ударом!) */
  public startReplay(replayIndex?: number, lastSecondsOnly = true): boolean {
    const rec =
      replayIndex !== undefined
        ? this.replays.find((r) => r.index === replayIndex) ?? this.replays[this.replays.length - 1]
        : this.replays[this.replays.length - 1];
    if (!rec || rec.frames.length === 0) return false;

    // Если еще не сохраняли актуальный снимок мира после боя — сохраняем
    if (!this.isReplayMode) {
      this.savedLiveTargetsSnapshot = this.targets.map((t) => ({
        id: t.bp.id,
        x: t.pos.x,
        y: t.pos.y,
        z: t.pos.z,
        heading: t.heading,
        destroyed: t.destroyed,
      }));
    }

    this.activeReplay = rec;
    this.isReplayMode = true;
    this.isReconMode = false;
    this.isFlying = false;
    this.wingman.root.visible = false;
    this.replayPlaying = true;
    this.replayImpactTriggered = false;
    this.replayShake = 0;

    // Полностью очищаем дым, пламя и осколки от только что произошедшего взрыва, чтобы цель до удара была целой и чистой!
    this.clearTransientParticles();

    // Стартуем за 8.5 сек до момента детонации (самый сок атаки!), либо с начала если вылет был коротким
    this.replayTime = lastSecondsOnly ? Math.max(0, rec.impactTime - 8.5) : 0;

    // Строим светящуюся 3D-траекторию полета БПЛА в небе!
    this.rebuildReplayTrailLine(rec);
    this.applyReplayWorldAtTime(this.replayTime);
    soundFX.stopStaticNoise();
    soundFX.startFlightAudio();

    return true;
  }

  /** Мгновенно удаляет все текущие частицы взрыва/пожара/дыма (для чистого старта или перемотки повтора) */
  private clearTransientParticles() {
    for (const p of this.particles) {
      this.scene.remove(p.mesh);
      (p.mesh.material as THREE.Material).dispose();
    }
    this.particles = [];
    this.impactFlashLight.intensity = 0;
    this.bloomFlash = 0;
  }

  /** Проверяет, должен ли данный очаг пожара гореть и дымить в текущий момент времени */
  private isFireSiteActiveNow(site: PersistentFireSite): boolean {
    if (!this.isReplayMode || !this.activeReplay) return true;
    const rec = this.activeReplay;

    if (site.targetId) {
      if (rec.destroyedBeforeIds.includes(site.targetId)) return true;
      if (rec.destroyedDuringIds.includes(site.targetId)) {
        return this.replayTime >= rec.impactTime;
      }
      return false; // эта цель была уничтожена в более позднем вылете волны
    }

    return (
      site.sortieIndex < rec.index ||
      (site.sortieIndex === rec.index && this.replayTime >= site.flightTimeCreated)
    );
  }

  private rebuildReplayTrailLine(rec: SortieReplayRecord) {
    if (this.replayTrailLine) {
      this.scene.remove(this.replayTrailLine);
      this.replayTrailLine.geometry.dispose();
      (this.replayTrailLine.material as THREE.Material).dispose();
      this.replayTrailLine = null;
    }

    const pts = rec.frames.map((f) => new THREE.Vector3(f.px, f.py, f.pz));
    pts.push(new THREE.Vector3(rec.impactPoint.x, rec.impactPoint.y, rec.impactPoint.z));
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({
      color: 0x00ffc8,
      transparent: true,
      opacity: 0.65,
    });
    this.replayTrailLine = new THREE.Line(geo, mat);
    this.replayTrailLine.visible = this.replayShowTrail;
    this.scene.add(this.replayTrailLine);
  }

  public setReplayPlaying(playing: boolean) {
    this.replayPlaying = playing;
    if (!playing) {
      soundFX.stopFlightAudio();
    } else if (this.activeReplay && this.replayTime < this.activeReplay.impactTime) {
      soundFX.startFlightAudio();
    }
  }

  public setReplaySpeed(speed: 0.25 | 0.5 | 1) {
    this.replaySpeed = speed;
  }

  public setReplayAngle(angle: ReplayCameraAngle) {
    this.replayAngle = angle;
    if (angle === 'fpv') {
      this.setZoom(this.zoom);
    } else {
      this.noseProbeGroup.visible = false;
      this.camera.fov = angle === 'target_pov' ? 54 : angle === 'chase' ? 58 : 42;
      this.camera.updateProjectionMatrix();
    }
    if (this.activeReplay) {
      this.applyReplayWorldAtTime(this.replayTime);
    }
  }

  public toggleReplayTrail(): boolean {
    this.replayShowTrail = !this.replayShowTrail;
    if (this.replayTrailLine) {
      this.replayTrailLine.visible = this.replayShowTrail;
    }
    return this.replayShowTrail;
  }

  public seekReplay(timeSec: number) {
    if (!this.activeReplay) return;
    const rec = this.activeReplay;
    const prevTime = this.replayTime;
    const clamped = Math.max(0, Math.min(rec.totalDuration, timeSec));
    const wasTriggered = this.replayImpactTriggered;
    this.replayTime = clamped;

    if (clamped < rec.impactTime) {
      if (wasTriggered || Math.abs(clamped - prevTime) > 0.5) {
        // При перемотке ДО момента удара мгновенно убираем весь огонь, дым и старые следы!
        this.clearTransientParticles();
      }
      if (wasTriggered && this.replayPlaying) {
        soundFX.startFlightAudio();
      }
      this.replayImpactTriggered = false;
    } else if (!wasTriggered) {
      this.replayImpactTriggered = true;
      const impVec = new THREE.Vector3(rec.impactPoint.x, rec.impactPoint.y, rec.impactPoint.z);
      this.spawnExplosion3D(impVec, rec.secondaryDetonation, rec.thermiteFire);
      soundFX.stopFlightAudio();
    }
    this.applyReplayWorldAtTime(clamped);
  }

  public restartReplayFromFullStart() {
    this.seekReplay(0);
    this.setReplayPlaying(true);
  }

  public jumpReplayToTerminalDive() {
    if (!this.activeReplay) return;
    this.seekReplay(Math.max(0, this.activeReplay.impactTime - 7.5));
    this.setReplayPlaying(true);
  }

  /** Выходит из режима 3D-повтора и возвращает актуальное состояние поля боя */
  public stopReplay() {
    this.stopReplayInternal();
    this.isReconMode = true;
    this.noseProbeGroup.visible = false;
    this.camera.fov = 42;
    this.camera.updateProjectionMatrix();
  }

  private stopReplayInternal() {
    if (!this.isReplayMode) return;
    this.isReplayMode = false;
    this.activeReplay = null;
    this.playerDroneModel.root.visible = false;
    soundFX.stopFlightAudio();

    if (this.replayTrailLine) {
      this.scene.remove(this.replayTrailLine);
      this.replayTrailLine.geometry.dispose();
      (this.replayTrailLine.material as THREE.Material).dispose();
      this.replayTrailLine = null;
    }
    for (const m of this.replayTracerPool) m.visible = false;
    for (const m of this.replaySamPool) m.visible = false;

    this.clearTransientParticles();

    // Восстанавливаем истинное состояние всех целей на карте и свежий дым над реально пораженными целями
    for (const snap of this.savedLiveTargetsSnapshot) {
      const t = this.targets.find((x) => x.bp.id === snap.id);
      if (!t) continue;
      t.pos.set(snap.x, snap.y, snap.z);
      t.heading = snap.heading;
      t.destroyed = snap.destroyed;
      t.visual.root.position.copy(t.pos);
      t.visual.root.rotation.y = t.heading;
      t.visual.intactGroup.visible = !snap.destroyed;
      t.visual.wreckGroup.visible = snap.destroyed;
      if (t.ewDomeMesh) {
        t.ewDomeMesh.visible = !snap.destroyed;
      }
      if (snap.destroyed) {
        this.spawnSmokePuff(t.pos.clone().add(new THREE.Vector3(0, 4, 0)), 4.2, 0x1e1e20, 4.5);
      }
    }
  }

  private captureReplaySample() {
    const headingDeg = (((-this.yaw * 180) / Math.PI) % 360 + 360) % 360;
    const groundY = getTerrainHeight(this.dronePos.x, this.dronePos.z, this.mission);

    this.recordingFrames.push({
      t: this.flightTime,
      px: this.dronePos.x,
      py: this.dronePos.y,
      pz: this.dronePos.z,
      qx: this.droneQuat.x,
      qy: this.droneQuat.y,
      qz: this.droneQuat.z,
      qw: this.droneQuat.w,
      speedKmh: Math.round(this.speedMps * 3.6),
      aglM: Math.max(0, Math.round(this.dronePos.y - groundY)),
      rollDeg: Math.round((this.roll * 180) / Math.PI),
      pitchDeg: Math.round((this.pitch * 180) / Math.PI),
      headingDeg: Math.round(headingDeg),
      centerTargetId: this.centerTargetId,
      zoom: this.zoom,
      targetStates: this.targets.map((t) => ({
        id: t.bp.id,
        x: t.pos.x,
        y: t.pos.y,
        z: t.pos.z,
        heading: t.heading,
      })),
      samPositions: this.samMissiles.slice(0, 3).map((m) => ({
        x: m.pos.x,
        y: m.pos.y,
        z: m.pos.z,
        vx: m.vel.x,
        vy: m.vel.y,
        vz: m.vel.z,
      })),
      tracerPositions: this.tracers.slice(0, 16).map((tr) => ({
        x: tr.pos.x,
        y: tr.pos.y,
        z: tr.pos.z,
        vx: tr.vel.x,
        vy: tr.vel.y,
        vz: tr.vel.z,
      })),
    });
  }

  /** Обновляет 3D-мир и камеру в режиме просмотра повтора */
  private updateReplayPlayback(realDt: number) {
    const rec = this.activeReplay;
    if (!rec) return;

    const scaledDt = this.replayPlaying ? realDt * this.replaySpeed : 0;
    this.replayTime += scaledDt;

    if (this.replayTime >= rec.totalDuration) {
      // Автоматический повтор петли с последних 8.5 сек — с полной очисткой огня и дыма прошлого дубля!
      this.clearTransientParticles();
      this.replayTime = Math.max(0, rec.impactTime - 8.5);
      this.replayImpactTriggered = false;
      if (this.replayPlaying) soundFX.startFlightAudio();
    }

    // Проверка пересечения момента детонации БЧ!
    if (this.replayTime >= rec.impactTime && !this.replayImpactTriggered) {
      this.replayImpactTriggered = true;
      this.replayShake = 1.0;
      const impVec = new THREE.Vector3(rec.impactPoint.x, rec.impactPoint.y, rec.impactPoint.z);
      this.spawnExplosion3D(impVec, rec.secondaryDetonation, rec.thermiteFire);
      this.bloomFlash = rec.secondaryDetonation ? 1.15 : 0.8;
      soundFX.stopFlightAudio();
      soundFX.playDistantDetonation(rec.secondaryDetonation, this.replaySpeed);
    }

    this.replayShake = Math.max(0, this.replayShake - realDt * 1.8);
    this.applyReplayWorldAtTime(this.replayTime, scaledDt);
  }

  private applyReplayWorldAtTime(t: number, scaledDt = 0) {
    const rec = this.activeReplay;
    if (!rec || rec.frames.length === 0) return;

    const frames = rec.frames;
    const clampedFlightT = Math.min(t, rec.impactTime);

    // Бинарный поиск пары соседних кадров для плавной 60-FPS интерполяции даже в 0.25x слоу-мо!
    let lo = 0;
    let hi = frames.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (frames[mid].t <= clampedFlightT) lo = mid;
      else hi = mid;
    }

    const fA = frames[lo];
    const fB = frames[hi];
    const span = Math.max(0.0001, fB.t - fA.t);
    const alpha = Math.max(0, Math.min(1, (clampedFlightT - fA.t) / span));

    const interpPos = new THREE.Vector3(
      fA.px + (fB.px - fA.px) * alpha,
      fA.py + (fB.py - fA.py) * alpha,
      fA.pz + (fB.pz - fA.pz) * alpha
    );
    const qA = new THREE.Quaternion(fA.qx, fA.qy, fA.qz, fA.qw);
    const qB = new THREE.Quaternion(fB.qx, fB.qy, fB.qz, fB.qw);
    const interpQuat = qA.clone().slerp(qB, alpha);

    const beforeImpact = t < rec.impactTime;

    // 1. Состояние и координаты всех целей до / после момента попадания
    for (const target of this.targets) {
      const sA = fA.targetStates.find((s) => s.id === target.bp.id);
      const sB = fB.targetStates.find((s) => s.id === target.bp.id);
      if (sA && sB) {
        const tx = sA.x + (sB.x - sA.x) * alpha;
        const ty = sA.y + (sB.y - sA.y) * alpha;
        const tz = sA.z + (sB.z - sA.z) * alpha;
        target.visual.root.position.set(tx, ty, tz);
        target.visual.root.rotation.y = sA.heading + (sB.heading - sA.heading) * alpha;
      }
      if (target.bp.kind === 'radar' && target.visual.rotatingPart) {
        target.visual.rotatingPart.rotation.y += scaledDt * 1.45;
      }

      const wasAlreadyDead = rec.destroyedBeforeIds.includes(target.bp.id);
      const killedInThisSortie = rec.destroyedDuringIds.includes(target.bp.id);
      const showDestroyed = wasAlreadyDead || (!beforeImpact && killedInThisSortie);

      target.visual.intactGroup.visible = !showDestroyed;
      target.visual.wreckGroup.visible = showDestroyed;
      if (target.ewDomeMesh) {
        target.ewDomeMesh.visible = !showDestroyed;
      }
      if (target.bp.kind === 'aa_gun' && !showDestroyed && beforeImpact && target.visual.rotatingPart) {
        const dx = interpPos.x - target.visual.root.position.x;
        const dz = interpPos.z - target.visual.root.position.z;
        target.visual.rotatingPart.rotation.y = Math.atan2(-dx, -dz) - target.visual.root.rotation.y;
      }
    }

    // 2. Визуализация 3D-планера нашего БПЛА «Герань-2М» и его винта + вихрей с крыла!
    const showExternalDrone = beforeImpact && this.replayAngle !== 'fpv';
    this.playerDroneModel.root.visible = showExternalDrone;
    if (showExternalDrone) {
      this.playerDroneModel.root.position.copy(interpPos);
      this.playerDroneModel.root.quaternion.copy(interpQuat);
      this.playerDroneModel.propeller.rotation.z += scaledDt * 58;

      // Белые инверсионные жгуты с законцовок дельта-крыла в пикировании!
      this.wingtipVortexTimer -= scaledDt;
      if (this.wingtipVortexTimer <= 0 && scaledDt > 0) {
        this.wingtipVortexTimer = 0.035;
        for (const side of [-1.5, 1.5]) {
          const tip = new THREE.Vector3(side, 0.12, 1.35)
            .applyQuaternion(interpQuat)
            .add(interpPos);
          this.spawnSmokePuff(tip, 0.24, 0xd8f4f0, 0.45);
        }
      }
    }

    // 3. Отрисовка трассеров ЗСУ и ракет ЗРК из записи
    for (let i = 0; i < this.replayTracerPool.length; i++) {
      const mesh = this.replayTracerPool[i];
      const tr = beforeImpact ? fA.tracerPositions[i] : undefined;
      if (tr) {
        mesh.visible = true;
        mesh.position.set(tr.x, tr.y, tr.z);
        mesh.lookAt(tr.x + tr.vx, tr.y + tr.vy, tr.z + tr.vz);
      } else {
        mesh.visible = false;
      }
    }
    for (let i = 0; i < this.replaySamPool.length; i++) {
      const mesh = this.replaySamPool[i];
      const sm = beforeImpact ? fA.samPositions[i] : undefined;
      if (sm) {
        mesh.visible = true;
        mesh.position.set(sm.x, sm.y, sm.z);
        mesh.lookAt(sm.x + sm.vx, sm.y + sm.vy, sm.z + sm.vz);
      } else {
        mesh.visible = false;
      }
    }

    // 4. Звук мотора в повторе (с учетом скорости/замедления!)
    const interpSpeedKmh = Math.round(fA.speedKmh + (fB.speedKmh - fA.speedKmh) * alpha);
    const interpAgl = Math.round(fA.aglM + (fB.aglM - fA.aglM) * alpha);
    if (beforeImpact && this.replayPlaying) {
      soundFX.updateFlightAudio(interpSpeedKmh * (0.55 + 0.45 * this.replaySpeed), 0, false, false);
    }

    // 5. Выставление выбранного ракурса 3D-камеры повтора!
    const shakeX = (Math.random() - 0.5) * this.replayShake * 2.2;
    const shakeY = (Math.random() - 0.5) * this.replayShake * 2.2;

    if (this.replayAngle === 'fpv') {
      if (beforeImpact) {
        this.noseProbeGroup.visible = fA.zoom === 1;
        this.camera.fov = fA.zoom === 2.5 ? 26 : 62;
        this.camera.updateProjectionMatrix();
        this.camera.position.copy(interpPos);
        this.camera.quaternion.copy(interpQuat);
      } else {
        // После детонации в режиме FPV переводим взгляд на панораму взрыва сверху-сбоку
        this.noseProbeGroup.visible = false;
        this.camera.fov = 52;
        this.camera.updateProjectionMatrix();
        this.camera.position.set(
          rec.impactPoint.x + 55 + shakeX,
          rec.impactPoint.y + 42 + shakeY,
          rec.impactPoint.z + 75
        );
        this.camera.lookAt(rec.impactPoint.x, rec.impactPoint.y + 4, rec.impactPoint.z);
      }
    } else if (this.replayAngle === 'chase') {
      this.noseProbeGroup.visible = false;
      if (beforeImpact) {
        // Камера преследования сразу за толкающим винтом и дельта-крылом нашей «Герани-2М»!
        const offset = new THREE.Vector3(2.4, 2.35, 9.2).applyQuaternion(interpQuat);
        const camPos = interpPos.clone().add(offset);
        const minGround = getTerrainHeight(camPos.x, camPos.z, this.mission) + 1.8;
        if (camPos.y < minGround) camPos.y = minGround;

        const lookAhead = new THREE.Vector3(0, 0, -24).applyQuaternion(interpQuat).add(interpPos);
        this.camera.position.copy(camPos);
        this.camera.lookAt(lookAhead);
      } else {
        // В момент удара камера преследования пролетает по инерции чуть выше эпицентра взрыва!
        const postT = t - rec.impactTime;
        this.camera.position.set(
          rec.impactPoint.x + 18 + postT * 6 + shakeX,
          rec.impactPoint.y + 16 + postT * 7 + shakeY,
          rec.impactPoint.z + 34 - postT * 5
        );
        this.camera.lookAt(rec.impactPoint.x, rec.impactPoint.y + 3, rec.impactPoint.z);
      }
    } else if (this.replayAngle === 'target_pov') {
      // Драматичный взгляд С ЗЕМЛИ У ЦЕЛИ вверх на пикирующий БПЛА «Герань-2М»!
      this.noseProbeGroup.visible = false;
      const anchor = new THREE.Vector3(
        rec.watchTargetPos.x + 24,
        getTerrainHeight(rec.watchTargetPos.x + 24, rec.watchTargetPos.z + 30, this.mission) + 3.4,
        rec.watchTargetPos.z + 30
      );
      this.camera.position.set(anchor.x + shakeX, anchor.y + shakeY, anchor.z);
      if (beforeImpact) {
        // Плавный перевод взгляда с неба (где летит дрон) на саму цель перед столкновением
        const distToHit = interpPos.distanceTo(new THREE.Vector3(rec.watchTargetPos.x, rec.watchTargetPos.y, rec.watchTargetPos.z));
        const blend = Math.max(0, Math.min(1, 1 - distToHit / 120));
        const lookPt = interpPos
          .clone()
          .lerp(new THREE.Vector3(rec.watchTargetPos.x, rec.watchTargetPos.y + 2.5, rec.watchTargetPos.z), blend * 0.45);
        this.camera.lookAt(lookPt);
      } else {
        this.camera.lookAt(rec.impactPoint.x, rec.impactPoint.y + 4.5, rec.impactPoint.z);
      }
    } else {
      // Камера высотного БПЛА-разведчика «ОРЛАН-30»
      this.noseProbeGroup.visible = false;
      const focus = beforeImpact
        ? interpPos.clone().lerp(new THREE.Vector3(rec.impactPoint.x, rec.impactPoint.y, rec.impactPoint.z), 0.35)
        : new THREE.Vector3(rec.impactPoint.x, rec.impactPoint.y, rec.impactPoint.z);
      const orb = t * 0.25;
      this.camera.position.set(
        focus.x + Math.sin(orb) * 145 + shakeX,
        focus.y + 108 + shakeY,
        focus.z + Math.cos(orb) * 145
      );
      this.camera.lookAt(focus);
    }

    this.onReplayStatusCallback?.({
      callsign: rec.callsign,
      warhead: rec.warhead,
      currentTime: t,
      impactTime: rec.impactTime,
      totalDuration: rec.totalDuration,
      playing: this.replayPlaying,
      speed: this.replaySpeed,
      angle: this.replayAngle,
      showTrail: this.replayShowTrail,
      speedKmh: beforeImpact ? interpSpeedKmh : 0,
      aglM: beforeImpact ? interpAgl : 0,
      impactTriggered: !beforeImpact,
    });
  }

  // ============================================================================
  // БОЕВОЙ ЦИКЛ СИМУЛЯЦИИ
  // ============================================================================

  private computeEWInterference(): number {
    let maxEW = 0;
    for (const t of this.targets) {
      if (t.destroyed || t.bp.kind !== 'ew' || !t.bp.ewRadius) continue;
      const d = this.dronePos.distanceTo(t.pos);
      if (d < t.bp.ewRadius) {
        const raw = 1 - d / t.bp.ewRadius;
        maxEW = Math.max(maxEW, Math.min(0.94, Math.pow(raw, 1.35) * 1.05));
      }
    }
    const spec = WARHEAD_SPECS[this.currentWarhead];
    return maxEW * (1 - spec.ewResistance);
  }

  public step(dt: number, input: FlightInput, settings: ControlSettings) {
    const clampedDt = Math.min(dt, 0.05);
    const particleDt = this.isReplayMode
      ? this.replayPlaying
        ? clampedDt * this.replaySpeed
        : 0
      : clampedDt;

    this.updateAtmosphereAndFrontline(particleDt);

    if (this.isReplayMode) {
      this.updateReplayPlayback(clampedDt);
      this.updateParticlesAndFires(particleDt);
    } else {
      this.updateWingman(clampedDt);
      this.updateTrainingGates(clampedDt);
      this.updateMovingTargetsAndDefenses(clampedDt);
      this.updateSamMissiles(clampedDt);
      this.updateTracers(clampedDt);
      this.updateParticlesAndFires(clampedDt);

      if (this.isFlying) {
        this.updateDroneFlight(clampedDt, input, settings);
      } else if (this.isReconMode) {
        this.updateReconCamera(clampedDt);
      }
    }

    if (this.impactFlashLight.intensity > 0) {
      this.impactFlashLight.intensity = Math.max(0, this.impactFlashLight.intensity - particleDt * 14);
    }
    if (this.bloomFlash > 0) {
      this.bloomFlash = Math.max(0, this.bloomFlash - clampedDt * 1.35);
    }

    this.gradeTime += clampedDt;
    (this.gradePass.uniforms as Record<string, { value: number }>).uTime.value = this.gradeTime;
    this.updateSunAndShadowCamera(settings.highGraphics);
    this.sky.dome.position.set(this.camera.position.x, 0, this.camera.position.z);

    if (settings.highGraphics) {
      const baseStrength =
        this.cameraMode === 'synth'
          ? 0.56
          : this.cameraMode === 'flir'
          ? 0.44
          : this.cameraMode === 'bhot'
          ? 0.24
          : 0.34;
      this.bloomPass.strength = baseStrength + this.bloomFlash;
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  private updateAtmosphereAndFrontline(dt: number) {
    this.sky.cloudGroup.position.z += dt * 4.5;
    if (this.sky.cloudGroup.position.z > 520) {
      this.sky.cloudGroup.position.z -= 520;
    }

    if (this.horizonFlashLight.intensity > 0) {
      this.horizonFlashLight.intensity = Math.max(0, this.horizonFlashLight.intensity - dt * 18);
    }

    if (!this.mission.isTutorial && dt > 0) {
      this.horizonFlashTimer -= dt;
      if (this.horizonFlashTimer <= 0) {
        this.horizonFlashTimer = 3.5 + Math.random() * 5.5;
        const fx = (Math.random() - 0.5) * 1900;
        const fz = -1350 - Math.random() * 450;
        this.horizonFlashLight.position.set(fx, 65, fz);
        this.horizonFlashLight.intensity = 16;

        this.spawnSmokePuff(
          new THREE.Vector3(fx, 28, fz),
          14,
          this.cameraMode === 'flir' ? 0xffffff : this.cameraMode === 'bhot' ? 0x111111 : 0xff7a22,
          0.65
        );
        if (!this.isReplayMode) {
          soundFX.playDistantArtillery();
        }
      }
    }
  }

  private updateTrainingGates(dt: number) {
    if (this.gates.length === 0) return;

    let firstActiveIdx = -1;
    for (let i = 0; i < this.gates.length; i++) {
      const g = this.gates[i];
      if (g.passed) continue;
      if (firstActiveIdx === -1) firstActiveIdx = i;

      g.mesh.visible = true;
      g.mesh.children[0].rotation.z += dt * 0.65;
      g.mesh.children[1].rotation.z -= dt * 1.3;
      const scalePulse = i === firstActiveIdx ? 1 + Math.sin(performance.now() * 0.005) * 0.05 : 0.85;
      g.mesh.scale.setScalar(scalePulse);
    }

    if (firstActiveIdx !== -1 && this.isFlying) {
      const activeGate = this.gates[firstActiveIdx];
      const dist = this.dronePos.distanceTo(activeGate.pos);
      if (
        dist < 56 ||
        (this.dronePos.z < activeGate.pos.z - 25 &&
          Math.hypot(this.dronePos.x - activeGate.pos.x, this.dronePos.y - activeGate.pos.y) < 190)
      ) {
        activeGate.passed = true;
        activeGate.mesh.visible = false;
        soundFX.playGatePass();
        this.bloomFlash = 0.35;
        const passedCount = this.gates.filter((x) => x.passed).length;
        this.onGatePassedCallback?.(passedCount, this.gates.length);
      }
    }
  }

  private updateDroneFlight(dt: number, input: FlightInput, settings: ControlSettings) {
    this.flightTime += dt;
    this.fuelPercent = Math.max(0, 96 - this.flightTime * 0.65);
    if (this.samRadioCooldown > 0) this.samRadioCooldown -= dt;

    const spec = WARHEAD_SPECS[this.currentWarhead];
    const ew = this.computeEWInterference();
    const safeInput = sanitizeFlightInput(input);

    const gravityAccel = -Math.sin(this.pitch) * 14.5;
    let targetSpeed = 54 + gravityAccel * 1.15;
    let throttleMode: TelemetryData['throttle'] = 'cruise';
    if (safeInput.boost) {
      targetSpeed = spec.maxBoostMps;
      throttleMode = 'boost';
    } else if (safeInput.airbrake) {
      targetSpeed = 40.5;
      throttleMode = 'brake';
    }
    targetSpeed = Math.max(38, Math.min(96, targetSpeed));
    this.speedMps += (targetSpeed - this.speedMps) * Math.min(1, dt * 2.4);

    // Только ручное пилотирование: вход проходит санитизацию и кадрово-независимый фильтр рулей.
    const sens = sanitizeSensitivity(settings.sensitivity);
    const rawPitchCmd = settings.invertPitch ? -safeInput.pitch : safeInput.pitch;
    const rawYawCmd = safeInput.yawRoll;
    this.smoothedYawCmd = smoothAxis(this.smoothedYawCmd, rawYawCmd, dt, 11);
    this.smoothedPitchCmd = smoothAxis(this.smoothedPitchCmd, rawPitchCmd, dt, 9.5);
    const yawCmd = this.smoothedYawCmd;
    const pitchCmd = this.smoothedPitchCmd;

    const ewDriftYaw = ew > 0.4 ? Math.sin(this.flightTime * 5.3) * (ew - 0.4) * 0.16 : 0;
    const ewDriftPitch = ew > 0.4 ? Math.cos(this.flightTime * 4.1) * (ew - 0.4) * 0.1 : 0;

    this.yaw -= (yawCmd * 1.05 * sens + ewDriftYaw) * dt;
    this.pitch += (pitchCmd * 0.88 * sens + ewDriftPitch) * dt;
    this.pitch = Math.max(-1.22, Math.min(0.72, this.pitch));

    const targetRoll = -yawCmd * 0.82;
    this.roll += (targetRoll - this.roll) * Math.min(1, dt * 5.2);

    const prevDronePos = this.dronePos.clone();
    const euler = new THREE.Euler(this.pitch, this.yaw, this.roll, 'YXZ');
    this.droneQuat.setFromEuler(euler);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.droneQuat);
    this.dronePos.addScaledVector(forward, this.speedMps * dt);

    if (Math.abs(this.dronePos.x) > 1950 || this.dronePos.z < -1650 || this.dronePos.z > 2350) {
      const back = new THREE.Vector3(0, 180, -250).sub(this.dronePos);
      this.yaw = Math.atan2(-back.x, -back.z);
    }

    this.shakeIntensity = Math.max(0, this.shakeIntensity - dt * 2.6);
    this.updateCameraTransform();

    // Лёгкое расширение FOV на форсаже усиливает ощущение скорости без fisheye-искажения прицела.
    const speedT = THREE.MathUtils.clamp((this.speedMps - 54) / 38, 0, 1);
    const desiredFov = (this.zoom === 2.5 ? 26 : 62) + speedT * (this.zoom === 2.5 ? 1.5 : 4.5);
    if (Math.abs(this.camera.fov - desiredFov) > 0.05) {
      this.camera.fov += (desiredFov - this.camera.fov) * Math.min(1, dt * 5);
      this.camera.updateProjectionMatrix();
    }

    // Сэмпл «Чёрного ящика» каждые 0.05 с
    this.recordSampleTimer += dt;
    if (this.recordSampleTimer >= 0.05) {
      this.recordSampleTimer = 0;
      this.captureReplaySample();
    }

    const groundY = getTerrainHeight(this.dronePos.x, this.dronePos.z, this.mission);
    const agl = this.dronePos.y - groundY;

    if (!this.midRadioSent && this.mission.radioMid && !this.mission.isTutorial) {
      const nearAny = this.targets.some((t) => !t.destroyed && this.dronePos.distanceTo(t.pos) < 920);
      if (nearAny) {
        this.midRadioSent = true;
        this.onRadioCallback(this.mission.radioMid);
      }
    }

    // Отстрел дымовых гранат «Туча» экипажем вражеского танка при пикировании на него!
    // Столкновения проверяются по отрезку prev->next, чтобы на высокой скорости не было туннелирования сквозь цель/окно.
    for (const t of this.targets) {
      if (t.destroyed) continue;
      const targetCenter = this.getTargetAimPoint(t);
      const d = this.dronePos.distanceTo(targetCenter);

      if (t.bp.kind === 'tank' && !t.smokePopped && d < 185) {
        t.smokePopped = true;
        for (let s = -2; s <= 2; s++) {
          const ang = t.heading + s * 0.34;
          const puffPos = t.pos
            .clone()
            .add(new THREE.Vector3(-Math.sin(ang) * 11, 3.6, -Math.cos(ang) * 11));
          this.spawnSmokePuff(puffPos, 3.2, 0xe8eeec, 3.4);
        }
        soundFX.playFlakBurst();
      }

      if (t.bp.kind === 'hq_window') {
        const strike = classifyWindowStrike(prevDronePos, this.dronePos, t.pos, t.heading, t.bp);
        if (strike.kind !== 'none' && strike.impactPoint) {
          this.dronePos.set(strike.impactPoint.x, strike.impactPoint.y, strike.impactPoint.z);
          if (strike.kind === 'window') {
            this.triggerDetonation('window_hit', t, strike.distanceToWindowM);
          } else {
            this.triggerDetonation('facade_hit', undefined, strike.distanceToWindowM, t.bp.id);
          }
          return;
        }
        continue;
      }

      const closest = closestPointOnSegment(targetCenter, prevDronePos, this.dronePos);
      if (closest.distance <= t.visual.hitRadius) {
        this.dronePos.set(closest.point.x, closest.point.y, closest.point.z);
        this.triggerDetonation('direct_hit', t);
        return;
      }
    }

    if (agl <= 1.1) {
      this.dronePos.y = groundY + 0.8;
      this.triggerDetonation('ground_impact');
      return;
    }

    const projected = this.computeProjectedTargets(dt, ew);
    const lowAltStealth = agl < spec.stealthCeilingM;

    // Предупреждение ССОЗ («ОПАСНО ЗЕМЛЯ!»), если низко пикируем и рядом нет цели атаки
    let nearestAimDist = Number.POSITIVE_INFINITY;
    for (const t of this.targets) {
      if (!t.destroyed) {
        nearestAimDist = Math.min(nearestAimDist, this.dronePos.distanceTo(this.getTargetAimPoint(t)));
      }
    }
    const groundPullUpWarning = agl < 22 && this.pitch < -0.06 && nearestAimDist > 240;

    let nearestSamDist: number | null = null;
    for (const m of this.samMissiles) {
      if (m.lostLock) continue;
      const md = m.pos.distanceTo(this.dronePos);
      if (nearestSamDist === null || md < nearestSamDist) nearestSamDist = md;
    }

    soundFX.updateFlightAudio(
      this.speedMps * 3.6,
      ew,
      nearestSamDist !== null,
      groundPullUpWarning
    );

    this.telemetryAccum += dt;
    if (this.telemetryAccum >= 0.05) {
      this.telemetryAccum = 0;
      const centerObj = this.targets.find((t) => t.bp.id === this.centerTargetId && !t.destroyed);
      const centerDist = centerObj ? this.dronePos.distanceTo(this.getTargetAimPoint(centerObj)) : null;
      const tti = centerDist !== null ? Number((centerDist / Math.max(25, this.speedMps)).toFixed(1)) : null;
      const headingDeg = (((-this.yaw * 180) / Math.PI) % 360 + 360) % 360;

      const cosY = Math.cos(this.yaw);
      const sinY = Math.sin(this.yaw);
      const radarRange = 1800;
      const radarBlips: RadarBlip[] = [];

      for (const g of this.gates) {
        if (g.passed) continue;
        const dx = g.pos.x - this.dronePos.x;
        const dz = g.pos.z - this.dronePos.z;
        const rightLocal = (dx * cosY - dz * sinY) / radarRange;
        const fwdLocal = (-dx * sinY - dz * cosY) / radarRange;
        const len = Math.hypot(rightLocal, fwdLocal);
        const clampScale = len > 0.94 ? 0.94 / len : 1;
        radarBlips.push({
          relX: rightLocal * clampScale,
          relForward: fwdLocal * clampScale,
          isPrimary: false,
          destroyed: false,
          isGate: true,
        });
      }

      for (const t of this.targets) {
        const dx = t.pos.x - this.dronePos.x;
        const dz = t.pos.z - this.dronePos.z;
        const rightLocal = (dx * cosY - dz * sinY) / radarRange;
        const fwdLocal = (-dx * sinY - dz * cosY) / radarRange;
        const len = Math.hypot(rightLocal, fwdLocal);
        const clampScale = len > 0.94 ? 0.94 / len : 1;
        radarBlips.push({
          relX: rightLocal * clampScale,
          relForward: fwdLocal * clampScale,
          isPrimary: t.bp.isPrimary,
          destroyed: t.destroyed,
        });
      }

      for (const m of this.samMissiles) {
        if (m.lostLock) continue;
        const dx = m.pos.x - this.dronePos.x;
        const dz = m.pos.z - this.dronePos.z;
        const rightLocal = (dx * cosY - dz * sinY) / radarRange;
        const fwdLocal = (-dx * sinY - dz * cosY) / radarRange;
        const len = Math.hypot(rightLocal, fwdLocal);
        const clampScale = len > 0.94 ? 0.94 / len : 1;
        radarBlips.push({
          relX: rightLocal * clampScale,
          relForward: fwdLocal * clampScale,
          isPrimary: false,
          destroyed: false,
          isMissile: true,
        });
      }

      this.onTelemetryCallback({
        callsign: CALLSIGNS[(this.droneIndex - 1) % CALLSIGNS.length],
        droneIndex: this.droneIndex,
        totalDrones: this.mission.dronesCount,
        warhead: this.currentWarhead,
        speedKmh: Math.round(this.speedMps * 3.6),
        altitudeM: Math.max(0, Math.round(this.dronePos.y + 42)),
        aglM: Math.max(0, Math.round(agl)),
        pitchDeg: Math.round((this.pitch * 180) / Math.PI),
        rollDeg: Math.round((this.roll * 180) / Math.PI),
        headingDeg: Math.round(headingDeg),
        throttle: throttleMode,
        fuelPercent: Math.round(this.fuelPercent),
        signalQuality: Math.max(4, Math.round((1 - ew * 0.92) * 99)),
        ewInterference: ew,
        lowAltStealth,
        stealthCeilingM: spec.stealthCeilingM,
        groundPullUpWarning,
        centerTargetName: centerObj ? centerObj.bp.name : null,
        centerTargetDist: centerDist !== null ? Math.round(centerDist) : null,
        timeToImpactSec: tti,
        controlYaw: this.smoothedYawCmd,
        controlPitch: this.smoothedPitchCmd,
        samWarning: nearestSamDist !== null,
        samNearestDist: nearestSamDist !== null ? Math.round(nearestSamDist) : null,
        flakWarning: this.shakeIntensity > 0.15,
        zoom: this.zoom,
        cameraMode: this.cameraMode,
        projectedTargets: projected,
        radarBlips,
        flightTimeSec: this.flightTime,
        hullIntegrity: Math.max(0, Math.round(this.hullIntegrity)),
        gatesPassed: this.gates.filter((x) => x.passed).length,
        gatesTotal: this.gates.length,
      });
    }
  }

  private updateWingman(dt: number) {
    if (!this.wingman.active) return;
    this.wingman.propeller.rotation.z += dt * 42;

    if (this.flightTime < 8.5 && this.isFlying) {
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.droneQuat);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.droneQuat);
      const desired = this.dronePos
        .clone()
        .addScaledVector(fwd, 48 + Math.sin(this.flightTime * 1.4) * 4)
        .addScaledVector(right, 15 + Math.cos(this.flightTime * 1.1) * 2.5)
        .add(new THREE.Vector3(0, -4.5 + Math.sin(this.flightTime * 2.1) * 1.2, 0));

      this.wingman.pos.lerp(desired, Math.min(1, dt * 4.5));
      this.wingman.root.position.copy(this.wingman.pos);
      this.wingman.root.quaternion.copy(this.droneQuat);
      this.wingman.root.rotateZ(Math.sin(this.flightTime * 2.3) * 0.12);
    } else {
      const toTarget = this.wingman.targetPos.clone().sub(this.wingman.pos);
      const dist = toTarget.length();
      if (dist < 8) {
        this.wingman.active = false;
        this.wingman.root.visible = false;
        this.spawnExplosion3D(this.wingman.targetPos, false, false);
        this.fireSites.push({
          sortieIndex: this.replays.length,
          flightTimeCreated: this.flightTime,
          pos: this.wingman.targetPos.clone(),
          big: false,
          timer: 0,
        });
        soundFX.playFlakBurst();
        return;
      }
      toTarget.normalize();
      this.wingman.pos.addScaledVector(toTarget, 78 * dt);
      this.wingman.root.position.copy(this.wingman.pos);
      this.wingman.root.lookAt(this.wingman.pos.clone().sub(toTarget));
    }
  }

  private updateCameraTransform() {
    this.camera.position.copy(this.dronePos);
    if (this.shakeIntensity > 0.005 || this.speedMps > 70) {
      const vib = this.shakeIntensity * 0.65 + (this.speedMps > 70 ? 0.035 : 0);
      this.camera.position.x += (Math.random() - 0.5) * vib;
      this.camera.position.y += (Math.random() - 0.5) * vib;
    }
    this.camera.quaternion.copy(this.droneQuat);
  }

  private computeProjectedTargets(_dt: number, _ew: number): ProjectedTargetHUD[] {
    void _dt;
    void _ew;
    const out: ProjectedTargetHUD[] = [];
    let bestId: string | null = null;
    let bestCenterDist = 0.16;

    const tempV = new THREE.Vector3();
    for (const t of this.targets) {
      tempV.copy(this.getTargetAimPoint(t));
      const worldDist = this.dronePos.distanceTo(tempV);
      tempV.project(this.camera);

      const inFront = tempV.z > 0 && tempV.z < 1;
      const sx = (tempV.x + 1) * 0.5;
      const sy = (-tempV.y + 1) * 0.5;

      if (!t.destroyed && inFront) {
        const cDist = Math.hypot(sx - 0.5, sy - 0.5);
        if (cDist < bestCenterDist) {
          bestCenterDist = cDist;
          bestId = t.bp.id;
        }
      }

      out.push({
        id: t.bp.id,
        name: t.bp.name,
        codeName: t.bp.codeName,
        kind: t.bp.kind,
        isPrimary: t.bp.isPrimary,
        destroyed: t.destroyed,
        screenX: sx,
        screenY: sy,
        inFront,
        distance: Math.round(worldDist),
        inCrosshair: false,
        isWindowTarget: t.bp.kind === 'hq_window',
      });
    }

    // Только индикация для HUD/TTI и обучения. Никакого изменения yaw/pitch здесь нет.
    this.centerTargetId = bestId;
    for (const item of out) {
      if (item.id === bestId) item.inCrosshair = true;
    }

    const nextGate = this.gates.find((g) => !g.passed);
    if (nextGate) {
      tempV.copy(nextGate.pos);
      const gDist = this.dronePos.distanceTo(tempV);
      tempV.project(this.camera);
      out.push({
        id: nextGate.id,
        name: nextGate.label,
        codeName: nextGate.label,
        kind: 'radar',
        isPrimary: false,
        destroyed: false,
        screenX: (tempV.x + 1) * 0.5,
        screenY: (-tempV.y + 1) * 0.5,
        inFront: tempV.z > 0 && tempV.z < 1,
        distance: Math.round(gDist),
        inCrosshair: false,
        isTrainingGate: true,
      });
    }

    if (this.wingman.active) {
      tempV.copy(this.wingman.pos);
      const wDist = this.dronePos.distanceTo(tempV);
      tempV.project(this.camera);
      if (tempV.z > 0 && tempV.z < 1) {
        out.push({
          id: 'friendly_wingman',
          name: 'ВЕДОМЫЙ БПЛА',
          codeName: '◇ РОЙ-2',
          kind: 'aircraft',
          isPrimary: false,
          destroyed: false,
          screenX: (tempV.x + 1) * 0.5,
          screenY: (-tempV.y + 1) * 0.5,
          inFront: true,
          distance: Math.round(wDist),
          inCrosshair: false,
          isFriendlyWingman: true,
        });
      }
    }

    return out;
  }

  private updateMovingTargetsAndDefenses(dt: number) {
    const spec = WARHEAD_SPECS[this.currentWarhead];
    const droneGroundY = getTerrainHeight(this.dronePos.x, this.dronePos.z, this.mission);
    const droneAGL = this.dronePos.y - droneGroundY;
    const hasActiveRadar = this.targets.some((t) => !t.destroyed && (t.bp.kind === 'radar' || t.bp.kind === 'sam'));

    for (const t of this.targets) {
      if (t.destroyed) continue;

      if (t.bp.patrolPath && t.bp.patrolPath.length >= 2 && t.bp.moveSpeed) {
        const dest = t.bp.patrolPath[t.patrolIdx];
        const dx = dest.x - t.pos.x;
        const dz = dest.z - t.pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 4) {
          t.patrolIdx = (t.patrolIdx + 1) % t.bp.patrolPath.length;
        } else {
          const vx = (dx / dist) * t.bp.moveSpeed;
          const vz = (dz / dist) * t.bp.moveSpeed;
          t.vel.set(vx, 0, vz);
          t.pos.x += vx * dt;
          t.pos.z += vz * dt;
          t.pos.y = getTerrainHeight(t.pos.x, t.pos.z, this.mission);
          if (this.mission.riverZ !== undefined && Math.abs(t.pos.z - this.mission.riverZ) < 56 && Math.abs(t.pos.x) < 12) {
            t.pos.y = Math.max(t.pos.y, 1.9);
          }
          t.heading = Math.atan2(-vx, -vz);
          t.visual.root.position.copy(t.pos);
          t.visual.root.rotation.y = t.heading;
        }
      }

      if (t.bp.kind === 'radar' && t.visual.rotatingPart) {
        t.visual.rotatingPart.rotation.y += dt * 1.45;
      }

      if (t.bp.kind === 'aa_gun' && !this.mission.isTutorial) {
        if (this.isFlying && t.visual.rotatingPart) {
          const toDroneX = this.dronePos.x - t.pos.x;
          const toDroneZ = this.dronePos.z - t.pos.z;
          const aimYaw = Math.atan2(-toDroneX, -toDroneZ) - t.heading;
          t.visual.rotatingPart.rotation.y += (aimYaw - t.visual.rotatingPart.rotation.y) * Math.min(1, dt * 2.5);
        } else if (t.visual.rotatingPart) {
          t.visual.rotatingPart.rotation.y = Math.sin(performance.now() * 0.0007 + t.pos.x) * 1.1;
        }

        if (this.isFlying) {
          const distToDrone = t.pos.distanceTo(this.dronePos);
          if (distToDrone < 880) {
            t.fireCooldown -= dt;
            if (t.fireCooldown <= 0 && t.burstLeft <= 0) {
              t.burstLeft = 6;
              t.fireCooldown = 2.6 + Math.random() * 1.4;
            }
            if (t.burstLeft > 0) {
              t.burstTimer -= dt;
              if (t.burstTimer <= 0) {
                t.burstTimer = 0.13;
                t.burstLeft -= 1;
                this.spawnAATracer(t);
              }
            }
          }
        }
      }

      if (t.bp.kind === 'sam' && this.isFlying && hasActiveRadar && !this.mission.isTutorial) {
        const distToDrone = t.pos.distanceTo(this.dronePos);
        if (distToDrone < 1450 && distToDrone > 180 && droneAGL > spec.stealthCeilingM) {
          t.fireCooldown -= dt;
          if (t.fireCooldown <= 0 && this.samMissiles.length < 2) {
            t.fireCooldown = 9.5;
            this.launchSamInterceptor(t);
          }
        }
      }
    }
  }

  private spawnAATracer(aa: TargetEntity) {
    const start = aa.pos.clone().add(new THREE.Vector3(0, 3.2, 0));
    const dist = start.distanceTo(this.dronePos);
    const travelTime = dist / 260;

    const spread = 14 + dist * 0.025;
    const aimPoint = this.dronePos
      .clone()
      .add(new THREE.Vector3((Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread));

    const dir = aimPoint.sub(start).normalize();
    const tracerMat = new THREE.MeshBasicMaterial({
      color: this.cameraMode === 'flir' ? 0xffffff : this.cameraMode === 'bhot' ? 0x050505 : 0xff7722,
      transparent: true,
      opacity: 0.96,
      blending: this.cameraMode === 'bhot' ? THREE.NormalBlending : THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(this.tracerGeo, tracerMat);
    mesh.position.copy(start);
    mesh.lookAt(start.clone().add(dir));
    this.scene.add(mesh);

    this.tracers.push({
      mesh,
      pos: start,
      vel: dir.multiplyScalar(275),
      life: Math.min(3.2, travelTime + 0.55),
    });
  }

  private launchSamInterceptor(sam: TargetEntity) {
    const group = new THREE.Group();
    const bodyGeo = new THREE.ConeGeometry(0.45, 4.6, 7);
    bodyGeo.rotateX(Math.PI / 2);
    const bodyMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    group.add(body);

    const flameGeo = new THREE.SphereGeometry(1.15, 8, 6);
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xffb844 });
    const flame = new THREE.Mesh(flameGeo, flameMat);
    flame.position.z = 2.6;
    group.add(flame);

    const start = sam.pos.clone().add(new THREE.Vector3(0, 5.5, 0));
    group.position.copy(start);
    this.scene.add(group);

    this.spawnSmokePuff(start, 4.5, 0xd8d8d8, 2.2);

    const ceiling = WARHEAD_SPECS[this.currentWarhead].stealthCeilingM;
    if (this.samRadioCooldown <= 0) {
      this.samRadioCooldown = 14;
      this.onRadioCallback({
        speaker: 'КП «ГРАНИТ»',
        role: 'Предупреждение СПО',
        text: `Кедр, фашики пустили зенитную ракету! Срочно прижми борт ниже ${ceiling} метров к земле или ломай вираж!`,
        tone: 'warn',
      });
    }

    this.samMissiles.push({
      mesh: group,
      pos: start,
      vel: new THREE.Vector3(0, 88, 0),
      life: 11.5,
      lostLock: false,
      smokeTimer: 0,
    });
  }

  private updateSamMissiles(dt: number) {
    const ceiling = WARHEAD_SPECS[this.currentWarhead].stealthCeilingM;
    const droneGroundY = getTerrainHeight(this.dronePos.x, this.dronePos.z, this.mission);
    const droneAGL = this.dronePos.y - droneGroundY;

    for (let i = this.samMissiles.length - 1; i >= 0; i--) {
      const m = this.samMissiles[i];
      m.life -= dt;

      if (this.isFlying && !m.lostLock) {
        const dist = m.pos.distanceTo(this.dronePos);
        if (droneAGL < ceiling || (dist < 130 && Math.abs(this.roll) > 0.52)) {
          m.lostLock = true;
        } else {
          const desired = this.dronePos.clone().sub(m.pos).normalize().multiplyScalar(142);
          m.vel.lerp(desired, Math.min(1, dt * 2.4));
        }

        if (dist < 9.5 && !m.lostLock) {
          this.spawnExplosion3D(this.dronePos, false, false);
          this.scene.remove(m.mesh);
          this.samMissiles.splice(i, 1);
          this.triggerDetonation('shot_down');
          return;
        }
      }

      m.pos.addScaledVector(m.vel, dt);
      m.mesh.position.copy(m.pos);
      m.mesh.lookAt(m.pos.clone().add(m.vel));

      m.smokeTimer -= dt;
      if (m.smokeTimer <= 0) {
        m.smokeTimer = 0.045;
        this.spawnSmokePuff(m.pos, 1.7, 0xe8ecee, 1.8);
      }

      if (m.life <= 0 || m.pos.y > 1200) {
        this.scene.remove(m.mesh);
        this.samMissiles.splice(i, 1);
      }
    }
  }

  private updateTracers(dt: number) {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i];
      tr.life -= dt;
      tr.pos.addScaledVector(tr.vel, dt);
      tr.mesh.position.copy(tr.pos);

      if (this.isFlying) {
        const d = tr.pos.distanceTo(this.dronePos);
        if (d < 13) {
          this.spawnSmokePuff(tr.pos, 2.6, 0x222222, 1.5);
          soundFX.playFlakBurst();
          this.shakeIntensity = Math.min(1.0, this.shakeIntensity + 0.55);
          this.bloomFlash = Math.max(this.bloomFlash, 0.22);
          this.hullIntegrity -= 18;
          this.scene.remove(tr.mesh);
          (tr.mesh.material as THREE.Material).dispose();
          this.tracers.splice(i, 1);

          if (this.hullIntegrity <= 0) {
            this.triggerDetonation('shot_down');
            return;
          }
          continue;
        }
      }

      if (tr.life <= 0) {
        this.spawnSmokePuff(tr.pos, 2.0, 0x2b2b2b, 1.1);
        this.scene.remove(tr.mesh);
        (tr.mesh.material as THREE.Material).dispose();
        this.tracers.splice(i, 1);
      }
    }
  }

  private triggerDetonation(
    reason: 'direct_hit' | 'window_hit' | 'facade_hit' | 'ground_impact' | 'shot_down' | 'aborted',
    directTarget?: TargetEntity,
    windowMissDistanceM: number | null = null,
    facadeTargetId?: string
  ) {
    // Доводим точку контакта носового обтекателя вплотную к корпусу/окну цели для идеального кадра в Слоу-мо
    if ((reason === 'direct_hit' || reason === 'window_hit') && directTarget) {
      const targetCenter =
        directTarget.bp.kind === 'hq_window'
          ? this.getTargetAimPoint(directTarget)
          : directTarget.pos
              .clone()
              .add(new THREE.Vector3(0, directTarget.visual.aimHeightOffset * 0.75, 0));
      const d = this.dronePos.distanceTo(targetCenter);
      if (d > 2.4) {
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.droneQuat);
        const stepIn = Math.min(d - 2.2, 11);
        this.dronePos.addScaledVector(fwd, stepIn);
        this.flightTime += stepIn / Math.max(40, this.speedMps);
      }
    }

    // Финальный кадр «Чёрного ящика» ровно в момент физического касания носа БПЛА с целью
    this.captureReplaySample();

    this.isFlying = false;
    const impactPos = this.dronePos.clone();
    const spec = WARHEAD_SPECS[this.currentWarhead];

    soundFX.triggerImpactStatic();

    const destroyedNames: string[] = [];
    const destroyedIdsThisSortie: string[] = [];
    let secondaryDetonation = false;

    if (
      reason === 'direct_hit' ||
      reason === 'window_hit' ||
      reason === 'facade_hit' ||
      reason === 'ground_impact'
    ) {
      for (const t of this.targets) {
        if (t.destroyed) continue;
        // Штабное здание засчитывается только при точном проходе через окно, а не от близкого взрыва по фасаду/земле.
        if (t.bp.kind === 'hq_window' && !(reason === 'window_hit' && t === directTarget)) continue;
        if (facadeTargetId && t.bp.id === facadeTargetId) continue;

        const dist = impactPos.distanceTo(t.pos);
        if (t === directTarget || dist <= t.visual.hitRadius + spec.blastRadius * 0.65) {
          this.destroyTargetEntity(t);
          destroyedNames.push(t.bp.name);
          destroyedIdsThisSortie.push(t.bp.id);
          if (t.bp.kind === 'fuel' || t.bp.kind === 'supply_truck' || t.bp.kind === 'sam') {
            secondaryDetonation = true;
          }
        }
      }

      if (secondaryDetonation) {
        for (const t of this.targets) {
          if (t.destroyed) continue;
          if (t.bp.kind === 'hq_window') continue;
          if (facadeTargetId && t.bp.id === facadeTargetId) continue;
          if (impactPos.distanceTo(t.pos) <= spec.secondaryRadius) {
            this.destroyTargetEntity(t);
            destroyedNames.push(`${t.bp.name} (вторичная детонация)`);
            destroyedIdsThisSortie.push(t.bp.id);
          }
        }
      }
    }

    const isThermite = this.currentWarhead === 'thermite';
    this.spawnExplosion3D(impactPos, secondaryDetonation, isThermite);
    this.bloomFlash = secondaryDetonation ? 1.15 : isThermite ? 0.92 : 0.72;

    let nearestDist = 9999;
    let watchTarget: TargetEntity | undefined =
      directTarget ?? this.targets.find((t) => t.bp.id === facadeTargetId);
    for (const t of this.targets) {
      const d = Math.round(impactPos.distanceTo(this.getTargetAimPoint(t)));
      if (t.bp.isPrimary) {
        nearestDist = Math.min(nearestDist, d);
      }
      if (!watchTarget || d < impactPos.distanceTo(this.getTargetAimPoint(watchTarget))) {
        watchTarget = t;
      }
    }

    let outcome: ImpactReport['outcome'] = 'missed_ground';
    let title = 'ДЕТОНАЦИЯ ВНЕ ЦЕЛИ';
    let subtitle = `Промах (${nearestDist} м от ближайшего объекта). Подготовьте коррекцию для следующего борта.`;

    if (reason === 'window_hit' && destroyedNames.length > 0) {
      outcome = 'window_hit';
      title = 'ТОЧНО В ОКНО ШТАБА!';
      subtitle = `Хирургический удар подтверждён: отклонение от центра окна ${(
        windowMissDistanceM ?? 0
      ).toFixed(1)} м. Поражено: ${destroyedNames.join(', ')}`;
    } else if (reason === 'facade_hit') {
      outcome = 'facade_hit';
      title = 'ПОПАДАНИЕ ПО ФАСАДУ — ЦЕЛЬ УЦЕЛЕЛА';
      subtitle =
        `Борт врезался в здание в ${(windowMissDistanceM ?? nearestDist).toFixed(1)} м от центра отмеченного окна. ` +
        'Для засчитывания цели держите перекрестие точно в светящемся проёме и не включайте форсаж слишком поздно.' +
        (destroyedNames.length > 0 ? ` Сопутствующие потери: ${destroyedNames.join(', ')}.` : '');
    } else if (destroyedNames.length > 0) {
      outcome = directTarget ? 'direct_hit' : 'splash_hit';
      title = secondaryDetonation
        ? 'ЦЕЛЬ УНИЧТОЖЕНА // ВТОРИЧНАЯ ДЕТОНАЦИЯ!'
        : isThermite
        ? 'ТЕРМИТНЫЙ ПРОЖИГ // ЦЕЛЬ СОЖЖЕНА!'
        : 'ЦЕЛЬ ПОРАЖЕНА ПРЯМЫМ ПОПАДАНИЕМ!';
      subtitle = `Поражено: ${destroyedNames.join(', ')}`;
    } else if (reason === 'shot_down') {
      outcome = 'shot_down';
      title = 'БОРТ СБИТ ОГНЁМ ПВО';
      subtitle = 'Потеря связи из-за критического поражения планера зенитным огнем. Используйте малую высоту и маневр!';
    } else if (reason === 'aborted') {
      outcome = 'aborted';
      title = 'САМОЛИКВИДАЦИЯ БОРТА';
      subtitle = 'Подрыв БЧ выполнен по команде оператора.';
    }

    // Сохраняем полную запись вылета в архив «Чёрный ящик»!
    const callsign = CALLSIGNS[(this.droneIndex - 1) % CALLSIGNS.length];
    const replayIdx = this.replays.length;
    const watchPos = watchTarget
      ? { x: watchTarget.pos.x, y: watchTarget.pos.y, z: watchTarget.pos.z }
      : { x: impactPos.x, y: impactPos.y, z: impactPos.z };

    this.replays.push({
      index: replayIdx,
      callsign,
      warhead: this.currentWarhead,
      frames: this.recordingFrames.slice(),
      impactTime: Math.max(0.2, this.flightTime),
      totalDuration: Math.max(0.2, this.flightTime) + 3.6,
      impactPoint: { x: impactPos.x, y: impactPos.y, z: impactPos.z },
      watchTargetPos: watchPos,
      destroyedBeforeIds: this.destroyedBeforeCurrentSortie.slice(),
      destroyedDuringIds: destroyedIdsThisSortie,
      secondaryDetonation,
      thermiteFire: isThermite,
      summaryLabel:
        destroyedNames.length > 0
          ? `${callsign} (${spec.code}) → ✓ ${destroyedNames[0]}`
          : `${callsign} (${spec.code}) → ✕ ${title}`,
    });

    const groundAtImpact = getTerrainHeight(impactPos.x, impactPos.z, this.mission);
    this.reconFocus.set(impactPos.x, Math.max(groundAtImpact, impactPos.y * 0.25), impactPos.z);
    this.reconOrbitAngle = this.yaw + 0.55;
    this.isReconMode = true;
    this.noseProbeGroup.visible = false;
    this.camera.fov = 42;
    this.camera.updateProjectionMatrix();

    this.onImpactCallback({
      outcome,
      title,
      subtitle,
      destroyedTargets: destroyedNames,
      secondaryDetonation,
      windowMissDistanceM:
        windowMissDistanceM !== null ? Number(windowMissDistanceM.toFixed(1)) : null,
      impactPoint: { x: impactPos.x, y: impactPos.y, z: impactPos.z },
      distanceToNearestPrimary: nearestDist,
      replayIndex: replayIdx,
    });
  }

  private destroyTargetEntity(t: TargetEntity) {
    t.destroyed = true;
    t.visual.intactGroup.visible = false;
    t.visual.wreckGroup.visible = true;
    if (t.ewDomeMesh) {
      t.ewDomeMesh.visible = false;
    }
    this.fireSites.push({
      targetId: t.bp.id,
      sortieIndex: this.replays.length,
      flightTimeCreated: this.flightTime,
      pos: t.pos.clone(),
      big:
        this.currentWarhead === 'thermite' ||
        t.bp.kind === 'fuel' ||
        t.bp.kind === 'supply_truck' ||
        t.bp.kind === 'aircraft',
      timer: 0,
    });
  }

  private spawnExplosion3D(origin: THREE.Vector3, huge: boolean, thermite = false) {
    const scaleMul = huge ? 1.85 : thermite ? 1.35 : 1.0;
    const isBhot = this.cameraMode === 'bhot';

    this.impactFlashLight.position.copy(origin).add(new THREE.Vector3(0, 12, 0));
    this.impactFlashLight.intensity = huge ? 26 : 16;

    const core = this.createBillboardParticle(
      isBhot ? 0x050505 : this.cameraMode === 'flir' ? 0xffffff : thermite ? 0xfff2a6 : 0xffd266,
      0.98,
      isBhot ? THREE.NormalBlending : THREE.AdditiveBlending
    );
    core.position.copy(origin);
    core.scale.setScalar(8.5 * scaleMul);
    this.scene.add(core);
    this.particles.push({
      mesh: core,
      vel: new THREE.Vector3(0, 6 * scaleMul, 0),
      life: 1.15 * scaleMul,
      maxLife: 1.15 * scaleMul,
      growSpeed: 26 * scaleMul,
      gravity: 0,
      fadeOpacity: true,
      baseOpacity: 0.98,
      billboard: true,
      spin: Math.random() * Math.PI,
      spinSpeed: 0.45,
    });

    for (const ringMul of [1.0, 0.55]) {
      const shockMat = new THREE.MeshBasicMaterial({
        color: isBhot ? 0x1a1a1a : 0xffffff,
        transparent: true,
        opacity: 0.85 * ringMul,
        side: THREE.DoubleSide,
      });
      const shock = new THREE.Mesh(this.ringGeo, shockMat);
      shock.rotation.x = -Math.PI / 2;
      shock.position.set(origin.x, origin.y + 1.2, origin.z);
      shock.scale.setScalar(4);
      this.scene.add(shock);
      this.particles.push({
        mesh: shock,
        vel: new THREE.Vector3(0, 0, 0),
        life: 1.35,
        maxLife: 1.35,
        growSpeed: 96 * scaleMul * ringMul,
        gravity: 0,
        fadeOpacity: true,
        baseOpacity: 0.85 * ringMul,
      });
    }

    const fireballCount = huge ? 26 : 16;
    for (let i = 0; i < fireballCount; i++) {
      const isFire = i % 2 === 0;
      const col = isBhot
        ? isFire
          ? 0x080808
          : 0x555c59
        : this.cameraMode === 'flir'
        ? isFire
          ? 0xffffff
          : 0x99a09d
        : isFire
        ? thermite
          ? 0xff8811
          : 0xff5a14
        : 0x22201f;
      const pMesh = this.createBillboardParticle(
        col,
        isFire ? 0.86 : 0.62,
        isFire && !isBhot ? THREE.AdditiveBlending : THREE.NormalBlending
      );
      pMesh.position.copy(origin).add(
        new THREE.Vector3(
          (Math.random() - 0.5) * 8 * scaleMul,
          Math.random() * 5 * scaleMul,
          (Math.random() - 0.5) * 8 * scaleMul
        )
      );
      pMesh.scale.setScalar((5.5 + Math.random() * 8.5) * scaleMul);
      this.scene.add(pMesh);

      const ang = Math.random() * Math.PI * 2;
      const spd = (8 + Math.random() * 26) * scaleMul;
      this.particles.push({
        mesh: pMesh,
        vel: new THREE.Vector3(Math.cos(ang) * spd, (12 + Math.random() * 30) * scaleMul, Math.sin(ang) * spd),
        life: 2.2 + Math.random() * 2.4,
        maxLife: 4.6,
        growSpeed: 8.5 * scaleMul,
        gravity: isFire ? -3.5 : 1.4,
        fadeOpacity: true,
        baseOpacity: isFire ? 0.86 : 0.62,
        billboard: true,
        spin: Math.random() * Math.PI * 2,
        spinSpeed: (Math.random() - 0.5) * 1.4,
      });
    }

    // Разлетающиеся раскаленные искры / термитные капли
    const sparkCount = thermite ? 46 : huge ? 34 : 20;
    for (let s = 0; s < sparkCount; s++) {
      const spMat = new THREE.MeshBasicMaterial({
        color: isBhot ? 0x050505 : this.cameraMode === 'flir' ? 0xffffff : thermite ? 0xffe066 : 0xffbb33,
        transparent: true,
        opacity: 1.0,
      });
      const spMesh = new THREE.Mesh(this.sparkGeo, spMat);
      spMesh.position.copy(origin).add(new THREE.Vector3(0, 1.5, 0));
      this.scene.add(spMesh);

      const ang = Math.random() * Math.PI * 2;
      const spd = (24 + Math.random() * 56) * scaleMul;
      const vy = (20 + Math.random() * 46) * scaleMul;
      this.particles.push({
        mesh: spMesh,
        vel: new THREE.Vector3(Math.cos(ang) * spd, vy, Math.sin(ang) * spd),
        life: 1.8 + Math.random() * 1.6,
        maxLife: 3.4,
        growSpeed: 0,
        gravity: 21,
        fadeOpacity: true,
        baseOpacity: 1.0,
        alignToVel: true,
      });
    }
  }

  private spawnSmokePuff(pos: THREE.Vector3, size: number, hex: number, duration: number) {
    const brightFire = hex === 0xff6210 || hex === 0xff7a22;
    const mesh = this.createBillboardParticle(
      this.cameraMode === 'flir' && hex < 0x555555 ? 0x626865 : hex,
      brightFire ? 0.78 : 0.54,
      brightFire && this.cameraMode !== 'bhot' ? THREE.AdditiveBlending : THREE.NormalBlending
    );
    mesh.position.copy(pos);
    mesh.scale.setScalar(size * 2.35);
    this.scene.add(mesh);

    this.particles.push({
      mesh,
      vel: new THREE.Vector3((Math.random() - 0.5) * 3, 5 + Math.random() * 5, (Math.random() - 0.5) * 3),
      life: duration,
      maxLife: duration,
      growSpeed: size * 1.9,
      gravity: -1.2,
      fadeOpacity: true,
      baseOpacity: brightFire ? 0.78 : 0.54,
      billboard: true,
      spin: Math.random() * Math.PI * 2,
      spinSpeed: (Math.random() - 0.5) * 0.9,
    });
  }

  private updateParticlesAndFires(dt: number) {
    if (dt <= 0) return;

    for (const site of this.fireSites) {
      // В режиме Повтора очаг пожара не горит и не дымит до самой секунды попадания БПЛА!
      if (!this.isFireSiteActiveNow(site)) continue;

      site.timer -= dt;
      if (site.timer <= 0) {
        site.timer = site.big ? 0.16 : 0.26;
        const matchedTarget = site.targetId
          ? this.targets.find((t) => t.bp.id === site.targetId)
          : undefined;
        const originPos = matchedTarget ? matchedTarget.visual.root.position : site.pos;

        this.spawnSmokePuff(
          originPos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 4, 2.2, (Math.random() - 0.5) * 4)),
          site.big ? 3.6 : 2.2,
          this.cameraMode === 'bhot' ? 0x080808 : this.cameraMode === 'flir' ? 0xffffff : 0xff6210,
          1.1
        );
        const smoke = this.createBillboardParticle(
          this.cameraMode === 'bhot' ? 0x4b524f : this.cameraMode === 'flir' ? 0x767d79 : 0x202124,
          0.58
        );
        smoke.position.copy(originPos).add(new THREE.Vector3((Math.random() - 0.5) * 5, 5, (Math.random() - 0.5) * 5));
        smoke.scale.setScalar(site.big ? 10.5 : 7.2);
        this.scene.add(smoke);
        this.particles.push({
          mesh: smoke,
          vel: new THREE.Vector3(3.5 + (Math.random() - 0.5) * 2.5, site.big ? 21 : 16, -2.0),
          life: 6.5,
          maxLife: 6.5,
          growSpeed: site.big ? 5.2 : 3.7,
          gravity: 0,
          fadeOpacity: true,
          baseOpacity: 0.58,
          billboard: true,
          spin: Math.random() * Math.PI * 2,
          spinSpeed: (Math.random() - 0.5) * 0.55,
        });
      }
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        (p.mesh.material as THREE.Material).dispose();
        this.particles.splice(i, 1);
        continue;
      }
      p.vel.y -= p.gravity * dt;
      if (p.billboard) {
        // Воздушное сопротивление клубов дыма: быстрый разлёт быстро превращается в медленный подъём и снос ветром.
        const drag = Math.max(0, 1 - dt * 1.15);
        p.vel.x = p.vel.x * drag + 1.15 * dt;
        p.vel.z = p.vel.z * drag - 0.35 * dt;
      }
      p.mesh.position.addScaledVector(p.vel, dt);
      if (p.alignToVel) {
        p.mesh.lookAt(p.mesh.position.clone().add(p.vel));
      }
      if (p.billboard) {
        p.spin = (p.spin ?? 0) + (p.spinSpeed ?? 0) * dt;
        p.mesh.lookAt(this.camera.position);
        p.mesh.rotateZ(p.spin);
      }
      if (p.growSpeed !== 0) {
        p.mesh.scale.addScalar(p.growSpeed * dt);
      }
      if (p.fadeOpacity) {
        (p.mesh.material as THREE.MeshBasicMaterial).opacity =
          Math.max(0, (p.life / p.maxLife) * p.baseOpacity);
      }
    }
  }

  private updateReconCamera(dt: number) {
    this.reconOrbitAngle += dt * 0.22;
    const radius = 155;
    const height = 118;
    this.camera.position.set(
      this.reconFocus.x + Math.sin(this.reconOrbitAngle) * radius,
      this.reconFocus.y + height,
      this.reconFocus.z + Math.cos(this.reconOrbitAngle) * radius
    );
    this.camera.lookAt(this.reconFocus.x, this.reconFocus.y + 4, this.reconFocus.z);
  }

  public handleResize = () => {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloomPass.setSize(Math.max(256, Math.floor(w * 0.65)), Math.max(256, Math.floor(h * 0.65)));
  };

  public dispose() {
    window.removeEventListener('resize', this.handleResize);
    soundFX.stopFlightAudio();
    soundFX.stopStaticNoise();
    if (this.replayTrailLine) {
      this.replayTrailLine.geometry.dispose();
      (this.replayTrailLine.material as THREE.Material).dispose();
    }
    this.mm.dispose();
    this.sky.cloudTex.dispose();
    this.sky.cloudMat.dispose();
    this.environmentTexture.dispose();
    this.particleTexture.dispose();
    Object.values(this.terrainTextures).forEach((t) => t.dispose());
    this.sphereGeo.dispose();
    this.particlePlaneGeo.dispose();
    this.ringGeo.dispose();
    this.sparkGeo.dispose();
    this.tracerGeo.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
