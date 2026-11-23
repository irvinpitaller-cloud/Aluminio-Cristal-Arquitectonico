import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  TypologyDefinition,
  BrandComparison,
  ACABADOS_ALUMINIO,
  OPCIONES_CRISTAL,
} from '../data/aluminumData';
import {
  RotateCcw,
  BrickWall,
  ChevronDown,
  ChevronUp,
  X,
  MoveHorizontal,
  DoorOpen,
} from 'lucide-react';

export interface DespieceInfo {
  componenteId?: string;
  nombre: string;
  tipo: string;
  cantidad: number;
  longitudMm: number;
  alturaMm?: number;
  unidad: string;
  formula: string;
}

interface Visor3DProps {
  typology: TypologyDefinition;
  ancho: number; // mm
  alto: number; // mm
  marca: string;
  brandData?: BrandComparison;
  acabadoId: string;
  cristalId: string;
  despiece: DespieceInfo[];
}

interface PartUserData {
  name: string;
  code: string;
  brand: string;
  material: string;
  desc: string;
  dim: string;
}

interface SlidingTarget {
  group: THREE.Group;
  initialX: number;
  maxDeltaX: number;
}

interface HingedTarget {
  pivot: THREE.Group;
  maxAngleRad: number;
}

// Reusable scratch helpers outside loop (zero GC in render loop)
const _highlightColor = new THREE.Color(0x38bdf8);
const _targetCamPos = new THREE.Vector3();
const _targetCtrlPos = new THREE.Vector3();

function detectSoftwareWebGL(): { supported: boolean; isSoftware: boolean } {
  try {
    const testCanvas = document.createElement('canvas');
    const gl =
      (testCanvas.getContext('webgl2') as WebGL2RenderingContext | null) ||
      (testCanvas.getContext('webgl') as WebGLRenderingContext | null);
    if (!gl) {
      return { supported: false, isSoftware: true };
    }
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    const isSoftware = /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    return { supported: true, isSoftware };
  } catch {
    return { supported: false, isSoftware: true };
  }
}

function disposeMaterial(mat: THREE.Material) {
  const rec = mat as unknown as Record<string, unknown>;
  for (const key of Object.keys(rec)) {
    const val = rec[key];
    if (val && typeof val === 'object' && 'isTexture' in val && (val as THREE.Texture).isTexture) {
      (val as THREE.Texture).dispose();
    }
  }
  mat.dispose();
}

function disposeNode(root: THREE.Object3D | null) {
  if (!root) return;
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();

  root.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      if (mesh.geometry) geometries.add(mesh.geometry);
      if (mesh.material) {
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((m) => materials.add(m));
        } else {
          materials.add(mesh.material);
        }
      }
    }
  });

  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => disposeMaterial(m));
  if (root.parent) root.parent.remove(root);
}

function createWoodGrainTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#6d3514';
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 64; i++) {
      const y = i * 4;
      const shade = 40 + Math.sin(i * 0.45) * 18 + ((i * 17) % 15);
      ctx.fillStyle = `rgba(${Math.round(45 + shade * 0.6)}, ${Math.round(20 + shade * 0.3)}, 8, 0.38)`;
      ctx.fillRect(0, y, 256, 2 + (i % 3));
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = Math.min(4, maxAnisotropy);
  return tex;
}

function createMosquitoScreenTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, 64, 64);
    ctx.strokeStyle = 'rgba(30, 41, 59, 0.72)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 64; i += 8) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, 64);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(64, i);
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(14, 18);
  tex.anisotropy = Math.min(4, maxAnisotropy);
  return tex;
}

function createContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createRadialGradient(64, 64, 8, 64, 64, 62);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0.52)');
    grad.addColorStop(0.55, 'rgba(0, 0, 0, 0.18)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export const Visor3D: React.FC<Visor3DProps> = ({
  typology,
  ancho,
  alto,
  marca,
  brandData,
  acabadoId,
  cristalId,
  despiece,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);

  // Interactive HUD state
  const [webglError, setWebglError] = useState<boolean>(false);
  const [openPercent, setOpenPercent] = useState<number>(0);
  const [showWall, setShowWall] = useState<boolean>(true);
  const [controlsCollapsed, setControlsCollapsed] = useState<boolean>(false);
  const [selectedPart, setSelectedPart] = useState<PartUserData | null>(null);

  // Three.js mutable refs (no React re-render overhead)
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const isSoftwareGlRef = useRef<boolean>(false);

  const windowGroupRef = useRef<THREE.Group | null>(null);
  const envWallGroupRef = useRef<THREE.Group | null>(null);
  const contactShadowRef = useRef<THREE.Mesh | null>(null);

  const slidingTargetsRef = useRef<SlidingTarget[]>([]);
  const hingedTargetsRef = useRef<HingedTarget[]>([]);

  const targetOpenRef = useRef<number>(0);
  const currentOpenRef = useRef<number>(0);
  const cameraAnimatingRef = useRef<boolean>(false);
  const defaultCameraRef = useRef<{ pos: THREE.Vector3; target: THREE.Vector3 }>({
    pos: new THREE.Vector3(2.4, 1.4, 3.6),
    target: new THREE.Vector3(0, 1.1, 0),
  });

  const selectedMeshRef = useRef<{
    mesh: THREE.Mesh;
    originalMaterial: THREE.Material | THREE.Material[];
  } | null>(null);

  const requestRenderRef = useRef<() => void>(() => {});
  const showWallRef = useRef<boolean>(showWall);
  showWallRef.current = showWall;

  const isFixedTypology = typology.svgType === 'fija';
  const isDoorTypology =
    typology.svgType === 'puerta_batiente' || typology.svgType === 'puerta_ligera';

  // Helper to clear current highlight cleanly
  const clearSelection = () => {
    const sel = selectedMeshRef.current;
    if (sel) {
      if (Array.isArray(sel.mesh.material)) {
        sel.mesh.material.forEach((m) => m.dispose());
      } else {
        sel.mesh.material.dispose();
      }
      sel.mesh.material = sel.originalMaterial;
      selectedMeshRef.current = null;
    }
    setSelectedPart(null);
  };

  // --- 1. Initialize WebGL Scene once ---
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const probe = detectSoftwareWebGL();
    if (!probe.supported) {
      setWebglError(true);
      return;
    }
    isSoftwareGlRef.current = probe.isSoftware;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !probe.isSoftware,
        powerPreference: 'high-performance',
      });
    } catch {
      setWebglError(true);
      return;
    }

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.setPixelRatio(probe.isSoftware ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = !probe.isSoftware;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';

    const initialW = container.clientWidth || 460;
    const initialH = container.clientHeight || 380;
    renderer.setSize(initialW, initialH, false);
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b1220);
    scene.fog = new THREE.Fog(0x0b1220, 8, 24);
    sceneRef.current = scene;

    // Studio reflection environment for realistic metallic aluminum & glass
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    const envRT = pmremGenerator.fromScene(roomEnv, 0.04);
    scene.environment = envRT.texture;
    roomEnv.dispose();
    pmremGenerator.dispose();

    const camera = new THREE.PerspectiveCamera(42, initialW / initialH, 0.1, 60);
    camera.position.copy(defaultCameraRef.current.pos);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !probe.isSoftware;
    controls.dampingFactor = 0.08;
    controls.minDistance = 0.9;
    controls.maxDistance = 12;
    controls.maxPolarAngle = Math.PI / 2 - 0.02;
    controls.target.copy(defaultCameraRef.current.target);
    controlsRef.current = controls;

    // Studio 3-point + warm/cool rig
    const hemiLight = new THREE.HemisphereLight(0xcbe4ff, 0x1e293b, 0.75);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff3de, 1.85);
    keyLight.position.set(3.5, 5.5, 4.2);
    keyLight.castShadow = !probe.isSoftware;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.left = -3.5;
    keyLight.shadow.camera.right = 3.5;
    keyLight.shadow.camera.top = 3.5;
    keyLight.shadow.camera.bottom = -1.5;
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 16;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x7dd3fc, 0.7);
    rimLight.position.set(-3.2, 2.8, -3.0);
    scene.add(rimLight);

    // Grounded studio floor & subtle architectural grid
    const floorGeo = new THREE.PlaneGeometry(24, 24);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x111827,
      roughness: 0.9,
      metalness: 0.05,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const gridHelper = new THREE.GridHelper(16, 32, 0x334155, 0x1e293b);
    gridHelper.position.y = 0.003;
    scene.add(gridHelper);

    // Contact shadow plane directly under unit
    const shadowTex = createContactShadowTexture();
    const contactShadowGeo = new THREE.PlaneGeometry(2.6, 1.4);
    const contactShadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.55,
    });
    const contactShadow = new THREE.Mesh(contactShadowGeo, contactShadowMat);
    contactShadow.rotation.x = -Math.PI / 2;
    contactShadow.position.y = 0.006;
    scene.add(contactShadow);
    contactShadowRef.current = contactShadow;

    // On-demand render loop with software WebGL pacing and smooth exponential damping
    let frameId = 0;
    let disposed = false;
    let renderBusy = false;
    let renderDirty = false;
    let lastTime = performance.now();

    const afterDraw = (cb: () => void) => {
      try {
        const gl = renderer.getContext() as WebGL2RenderingContext;
        if (typeof gl.fenceSync === 'function') {
          const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
          gl.flush();
          const poll = () => {
            if (disposed) return;
            const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
            if (state === gl.UNSIGNALED) {
              frameId = window.setTimeout(poll, 5);
            } else {
              if (sync) gl.deleteSync(sync);
              frameId = window.setTimeout(cb, 80);
            }
          };
          frameId = window.setTimeout(poll, 5);
          return;
        }
      } catch {
        // Fallback if fenceSync unavailable
      }
      frameId = window.setTimeout(cb, 80);
    };

    const requestRender = () => {
      if (disposed) return;
      if (renderBusy) {
        renderDirty = true;
        return;
      }
      renderBusy = true;
      frameId = requestAnimationFrame((now) => {
        if (disposed) return;
        renderDirty = false;
        const delta = Math.min((now - lastTime) / 1000, 0.05);
        lastTime = now;

        let needsMoreFrames = false;

        // Smooth camera reset damping
        if (cameraAnimatingRef.current) {
          const lambda = 7;
          camera.position.x = THREE.MathUtils.damp(
            camera.position.x,
            defaultCameraRef.current.pos.x,
            lambda,
            delta
          );
          camera.position.y = THREE.MathUtils.damp(
            camera.position.y,
            defaultCameraRef.current.pos.y,
            lambda,
            delta
          );
          camera.position.z = THREE.MathUtils.damp(
            camera.position.z,
            defaultCameraRef.current.pos.z,
            lambda,
            delta
          );
          controls.target.x = THREE.MathUtils.damp(
            controls.target.x,
            defaultCameraRef.current.target.x,
            lambda,
            delta
          );
          controls.target.y = THREE.MathUtils.damp(
            controls.target.y,
            defaultCameraRef.current.target.y,
            lambda,
            delta
          );
          controls.target.z = THREE.MathUtils.damp(
            controls.target.z,
            defaultCameraRef.current.target.z,
            lambda,
            delta
          );

          const distPos = camera.position.distanceTo(_targetCamPos.copy(defaultCameraRef.current.pos));
          const distTarget = controls.target.distanceTo(
            _targetCtrlPos.copy(defaultCameraRef.current.target)
          );
          if (distPos < 0.005 && distTarget < 0.005) {
            camera.position.copy(defaultCameraRef.current.pos);
            controls.target.copy(defaultCameraRef.current.target);
            cameraAnimatingRef.current = false;
          } else {
            needsMoreFrames = true;
          }
        }

        // Smooth opening/closing kinematics
        const openDiff = targetOpenRef.current - currentOpenRef.current;
        if (Math.abs(openDiff) > 0.0008) {
          currentOpenRef.current = THREE.MathUtils.damp(
            currentOpenRef.current,
            targetOpenRef.current,
            9,
            delta
          );
          needsMoreFrames = true;
        } else {
          currentOpenRef.current = targetOpenRef.current;
        }

        const t = currentOpenRef.current;
        for (const s of slidingTargetsRef.current) {
          s.group.position.x = s.initialX + t * s.maxDeltaX;
        }
        for (const h of hingedTargetsRef.current) {
          h.pivot.rotation.y = t * h.maxAngleRad;
        }

        const controlsUpdated = controls.update();
        if (controlsUpdated && controls.enableDamping) {
          needsMoreFrames = true;
        }

        renderer.render(scene, camera);

        const done = () => {
          renderBusy = false;
          if (disposed) return;
          if (renderDirty || needsMoreFrames) {
            requestRender();
          }
        };

        if (probe.isSoftware) afterDraw(done);
        else done();
      });
    };

    requestRenderRef.current = requestRender;

    const handleControlsChange = () => requestRender();
    const handleControlsStart = () => {
      cameraAnimatingRef.current = false;
      requestRender();
    };
    controls.addEventListener('change', handleControlsChange);
    controls.addEventListener('start', handleControlsStart);

    // Pointer click inspection (distinguish click vs orbit drag)
    const raycaster = new THREE.Raycaster();
    const pointerNdc = new THREE.Vector2();
    let downX = 0;
    let downY = 0;

    const onPointerDown = (e: PointerEvent) => {
      downX = e.clientX;
      downY = e.clientY;
    };

    const onPointerUp = (e: PointerEvent) => {
      const dist = Math.hypot(e.clientX - downX, e.clientY - downY);
      if (dist > 5 || !windowGroupRef.current) return;

      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(pointerNdc, camera);
      const hits = raycaster.intersectObjects(windowGroupRef.current.children, true);

      clearSelection();

      if (hits.length > 0) {
        let obj: THREE.Object3D | null = hits[0].object;
        while (obj && !(obj.userData && obj.userData.name) && obj.parent) {
          obj = obj.parent;
        }
        if (obj && (obj as THREE.Mesh).isMesh && obj.userData?.name) {
          const mesh = obj as THREE.Mesh;
          const origMat = mesh.material;
          const cloned = Array.isArray(origMat)
            ? origMat.map((m) => m.clone())
            : origMat.clone();

          const applyGlow = (m: THREE.Material) => {
            if ('emissive' in m) {
              const std = m as THREE.MeshStandardMaterial;
              std.emissive.copy(_highlightColor);
              std.emissiveIntensity = 0.45;
            }
          };

          if (Array.isArray(cloned)) cloned.forEach(applyGlow);
          else applyGlow(cloned);

          selectedMeshRef.current = { mesh, originalMaterial: origMat };
          mesh.material = cloned;
          setSelectedPart(obj.userData as PartUserData);
        }
      }
      requestRender();
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    // ResizeObserver with width/height > 0 guard
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
          renderer.setSize(width, height, false);
          requestRender();
        }
      }
    });
    resizeObserver.observe(container);

    // Pre-compile shaders on hardware GPU
    if (!probe.isSoftware) {
      renderer.compile(scene, camera);
    }
    requestRender();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      resizeObserver.disconnect();
      controls.removeEventListener('change', handleControlsChange);
      controls.removeEventListener('start', handleControlsStart);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);

      clearSelection();
      disposeNode(windowGroupRef.current);
      disposeNode(envWallGroupRef.current);
      disposeNode(floor);
      disposeNode(contactShadow);
      gridHelper.geometry.dispose();
      (gridHelper.material as THREE.Material).dispose();
      envRT.dispose();
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  // --- 2. Rebuild Parametric 3D Assembly & Contextual Wall ---
  useEffect(() => {
    const scene = sceneRef.current;
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!scene || !renderer || !camera || !controls) return;

    clearSelection();
    disposeNode(windowGroupRef.current);
    disposeNode(envWallGroupRef.current);
    slidingTargetsRef.current = [];
    hingedTargetsRef.current = [];

    const W = Math.max(0.4, ancho / 1000);
    const H = Math.max(0.4, alto / 1000);
    const isDoorOrBath =
      typology.svgType === 'puerta_batiente' ||
      typology.svgType === 'puerta_ligera' ||
      typology.svgType === 'cancel_bano';
    const holeBottomY = isDoorOrBath ? 0.0 : 0.72;
    const centerY = holeBottomY + H / 2;

    // --- Materials ---
    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const acabadoObj = ACABADOS_ALUMINIO.find((a) => a.id === acabadoId) || ACABADOS_ALUMINIO[1];
    const cristalObj = OPCIONES_CRISTAL.find((c) => c.id === cristalId) || OPCIONES_CRISTAL[0];

    let aluminumMat: THREE.MeshStandardMaterial;
    let aluminumDarkMat: THREE.MeshStandardMaterial;

    if (acabadoId === 'nogal') {
      const woodTex = createWoodGrainTexture(maxAniso);
      aluminumMat = new THREE.MeshStandardMaterial({
        map: woodTex,
        color: 0xffffff,
        metalness: 0.12,
        roughness: 0.56,
      });
      aluminumDarkMat = new THREE.MeshStandardMaterial({
        color: 0x451a03,
        metalness: 0.25,
        roughness: 0.52,
      });
    } else if (acabadoId === 'blanco') {
      aluminumMat = new THREE.MeshStandardMaterial({
        color: 0xf8fafc,
        metalness: 0.22,
        roughness: 0.34,
      });
      aluminumDarkMat = new THREE.MeshStandardMaterial({
        color: 0xcbd5e1,
        metalness: 0.3,
        roughness: 0.42,
      });
    } else if (acabadoId === 'natural') {
      aluminumMat = new THREE.MeshStandardMaterial({
        color: 0xd4dde7,
        metalness: 0.9,
        roughness: 0.24,
      });
      aluminumDarkMat = new THREE.MeshStandardMaterial({
        color: 0x94a3b8,
        metalness: 0.88,
        roughness: 0.32,
      });
    } else if (acabadoId === 'bronce') {
      aluminumMat = new THREE.MeshStandardMaterial({
        color: 0x5c2d16,
        metalness: 0.82,
        roughness: 0.3,
      });
      aluminumDarkMat = new THREE.MeshStandardMaterial({
        color: 0x3b1a09,
        metalness: 0.85,
        roughness: 0.36,
      });
    } else {
      // Negro Mate Anodizado
      aluminumMat = new THREE.MeshStandardMaterial({
        color: 0x1e2026,
        metalness: 0.65,
        roughness: 0.38,
      });
      aluminumDarkMat = new THREE.MeshStandardMaterial({
        color: 0x111318,
        metalness: 0.72,
        roughness: 0.45,
      });
    }

    // Glass tint & opacity mapped to catalog
    let glassColor = 0xa8d8ea;
    let glassOpacity = 0.28;
    if (cristalId === 'tintex_6mm') {
      glassColor = 0x2ca87a;
      glassOpacity = 0.38;
    } else if (cristalId === 'filtrasol_6mm') {
      glassColor = 0x3d4852;
      glassOpacity = 0.48;
    } else if (cristalId === 'templado_6mm') {
      glassColor = 0x8fd6ee;
      glassOpacity = 0.3;
    } else if (cristalId === 'stadip_acustico') {
      glassColor = 0x6cb8d4;
      glassOpacity = 0.42;
    } else if (cristalId === 'duovent_18mm') {
      glassColor = 0x86c9e0;
      glassOpacity = 0.34;
    }

    const glassMat = new THREE.MeshStandardMaterial({
      color: glassColor,
      metalness: 0.1,
      roughness: 0.08,
      transparent: true,
      opacity: glassOpacity,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    const hardwareMat = new THREE.MeshStandardMaterial({
      color: typology.svgType === 'cancel_bano' ? 0xe2e8f0 : 0x334155,
      metalness: 0.88,
      roughness: 0.22,
    });

    const rubberMat = new THREE.MeshStandardMaterial({
      color: 0x18181b,
      roughness: 0.9,
      metalness: 0.05,
    });

    const screenTex = createMosquitoScreenTexture(maxAniso);
    const screenMat = new THREE.MeshStandardMaterial({
      map: screenTex,
      color: 0xffffff,
      transparent: true,
      opacity: 0.82,
      side: THREE.DoubleSide,
      depthWrite: false,
      roughness: 0.85,
    });

    // Helper to look up calculated cut dimension from despieceActual
    const findCutDim = (keywords: string[], fallbackMm: string): string => {
      const match = despiece.find((d) =>
        keywords.some((k) => d.nombre.toLowerCase().includes(k.toLowerCase()))
      );
      if (!match) return fallbackMm;
      return match.alturaMm
        ? `${match.longitudMm} × ${match.alturaMm} ${match.unidad}`
        : `${match.longitudMm} ${match.unidad}`;
    };

    const isEurovent = marca === 'Eurovent';
    const isIndalum = marca === 'Indalum';
    const brandLabel = brandData ? `${marca} · ${brandData.linea}` : marca;

    const makePart = (
      geo: THREE.BufferGeometry,
      name: string,
      code: string,
      mat: THREE.Material,
      materialLabel: string,
      desc: string,
      dim: string
    ) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = !isSoftwareGlRef.current;
      mesh.receiveShadow = true;
      if (mat === glassMat || mat === screenMat) {
        mesh.renderOrder = 2;
        mesh.castShadow = false;
      }
      mesh.userData = {
        name,
        code,
        brand: mat === glassMat ? cristalObj.fabricante : brandLabel,
        material: materialLabel,
        desc,
        dim,
      } satisfies PartUserData;
      return mesh;
    };

    // --- Parametric Window / Door Group ---
    const windowGroup = new THREE.Group();
    windowGroup.position.set(0, centerY, 0);
    scene.add(windowGroup);
    windowGroupRef.current = windowGroup;

    const is3Inch = typology.serie.includes('3') || typology.serie === 'oxxo';
    const brandThicknessDelta = isEurovent ? 0.005 : isIndalum ? 0.002 : 0;
    const brandDepthDelta = isEurovent ? 0.014 : isIndalum ? 0.006 : 0;
    const profileT = (is3Inch ? 0.045 : 0.036) + brandThicknessDelta;
    const profileD =
      (typology.svgType === 'oxxo' || typology.svgType === 'tres_hojas'
        ? 0.076
        : is3Inch
        ? 0.068
        : 0.05) + brandDepthDelta;
    const leafFrameT = 0.034 + brandThicknessDelta * 0.6;
    const isDuovent = cristalId === 'duovent_18mm';

    const addGlassPane = (
      parent: THREE.Group,
      gw: number,
      gh: number,
      zOffset: number,
      label: string
    ) => {
      if (gw <= 0.02 || gh <= 0.02) return;
      const paneMatDesc = `${cristalObj.nombre} (${cristalObj.espesor})`;
      const dimStr = findCutDim(['cristal', 'vidrio', 'panel'], `${Math.round(gw * 1000)} × ${Math.round(gh * 1000)} mm`);
      if (isDuovent) {
        const gGeo = new THREE.BoxGeometry(gw, gh, 0.005);
        const p1 = makePart(gGeo, label, cristalObj.tipo, glassMat, paneMatDesc, cristalObj.descripcion, dimStr);
        p1.position.z = zOffset - 0.006;
        const p2 = makePart(gGeo, `${label} (Cámara Duovent)`, cristalObj.tipo, glassMat, paneMatDesc, cristalObj.descripcion, dimStr);
        p2.position.z = zOffset + 0.006;
        parent.add(p1, p2);
      } else {
        const gGeo = new THREE.BoxGeometry(gw, gh, 0.006);
        const pane = makePart(gGeo, label, cristalObj.tipo, glassMat, paneMatDesc, cristalObj.descripcion, dimStr);
        pane.position.z = zOffset;
        parent.add(pane);
      }
    };

    const addOuterFrame = (hasBottomRail: boolean) => {
      const sideH = hasBottomRail ? H - 2 * profileT : H - profileT;
      const sideY = hasBottomRail ? 0 : -profileT / 2;

      const rielSup = makePart(
        new THREE.BoxGeometry(W, profileT, profileD),
        'Cabezal / Riel Superior',
        typology.serie,
        aluminumDarkMat,
        `Aluminio ${acabadoObj.nombre}`,
        'Perfil estructural superior de anclaje y guía.',
        findCutDim(['cabezal', 'riel', 'bolsa', 'silla'], `${ancho} mm`)
      );
      rielSup.position.set(0, H / 2 - profileT / 2, 0);
      windowGroup.add(rielSup);

      if (hasBottomRail) {
        const rielInf = makePart(
          new THREE.BoxGeometry(W, profileT, profileD),
          'Riel Inferior / Escalonado',
          typology.serie,
          aluminumDarkMat,
          `Aluminio ${acabadoObj.nombre}`,
          'Riel inferior con drenajes y guía de rodamiento.',
          findCutDim(['riel', 'escalonado'], `${ancho} mm`)
        );
        rielInf.position.set(0, -H / 2 + profileT / 2, 0);
        windowGroup.add(rielInf);
      }

      const jambaGeo = new THREE.BoxGeometry(profileT, sideH, profileD);
      const jambaL = makePart(
        jambaGeo,
        'Jamba Vertical Izquierda',
        typology.serie,
        aluminumMat,
        `Aluminio ${acabadoObj.nombre}`,
        'Perfil lateral izquierdo de fijación al muro.',
        findCutDim(['jamba vertical', 'bolsa vertical', 'batiente', 'silla baño vertical'], `${alto} mm`)
      );
      jambaL.position.set(-W / 2 + profileT / 2, sideY, 0);
      windowGroup.add(jambaL);

      const jambaR = makePart(
        jambaGeo,
        'Jamba Vertical Derecha',
        typology.serie,
        aluminumMat,
        `Aluminio ${acabadoObj.nombre}`,
        'Perfil lateral derecho de fijación al muro.',
        findCutDim(['jamba vertical', 'bolsa vertical', 'batiente', 'silla baño vertical'], `${alto} mm`)
      );
      jambaR.position.set(W / 2 - profileT / 2, sideY, 0);
      windowGroup.add(jambaR);

      // Eurovent RPT thermal break polyamide strip visualization
      if (isEurovent) {
        const rptTop = makePart(
          new THREE.BoxGeometry(W - 0.004, 0.006, 0.012),
          'Puente Térmico Poliamida RPT',
          'RPT-24MM',
          rubberMat,
          'Poliamida 6.6 con Fibra de Vidrio',
          'Barrera aislante térmica y acústica integrada en perfil Eurovent.',
          `${ancho} × 24 mm`
        );
        rptTop.position.set(0, H / 2 - profileT - 0.001, 0);
        windowGroup.add(rptTop);
      }
    };

    const buildFramedLeaf = (
      lw: number,
      lh: number,
      isMovable: boolean,
      labelPrefix: string,
      includeLockSide?: 'left' | 'right'
    ): THREE.Group => {
      const leaf = new THREE.Group();
      const leafDepth = 0.026;
      const geoH = new THREE.BoxGeometry(lw, leafFrameT, leafDepth);
      const geoV = new THREE.BoxGeometry(leafFrameT, Math.max(0.05, lh - 2 * leafFrameT), leafDepth);

      const topBar = makePart(
        geoH,
        `Cabezal ${labelPrefix}`,
        'CAB-H',
        aluminumMat,
        `Aluminio ${acabadoObj.nombre}`,
        'Perfil horizontal superior de hoja.',
        findCutDim(['cabezal'], `${Math.round(lw * 1000)} mm`)
      );
      topBar.position.y = lh / 2 - leafFrameT / 2;
      leaf.add(topBar);

      const botBar = makePart(
        geoH,
        `Zoclo ${labelPrefix}`,
        'ZOC-H',
        aluminumMat,
        `Aluminio ${acabadoObj.nombre}`,
        'Perfil horizontal inferior portacarretillas.',
        findCutDim(['zoclo'], `${Math.round(lw * 1000)} mm`)
      );
      botBar.position.y = -lh / 2 + leafFrameT / 2;
      leaf.add(botBar);

      const leftBar = makePart(
        geoV,
        `Vertical Izq. ${labelPrefix}`,
        isMovable ? 'TRAS' : 'CERCO',
        aluminumMat,
        `Aluminio ${acabadoObj.nombre}`,
        'Perfil vertical de armado de hoja.',
        findCutDim(['cerco', 'traslape'], `${Math.round(lh * 1000)} mm`)
      );
      leftBar.position.x = -lw / 2 + leafFrameT / 2;
      leaf.add(leftBar);

      const rightBar = makePart(
        geoV,
        `Vertical Der. ${labelPrefix}`,
        isMovable ? 'CERCO' : 'TRAS',
        aluminumMat,
        `Aluminio ${acabadoObj.nombre}`,
        'Perfil vertical de encuentro/cierre.',
        findCutDim(['cerco', 'traslape'], `${Math.round(lh * 1000)} mm`)
      );
      rightBar.position.x = lw / 2 - leafFrameT / 2;
      leaf.add(rightBar);

      addGlassPane(
        leaf,
        lw - 2 * leafFrameT + 0.008,
        lh - 2 * leafFrameT + 0.008,
        0,
        `Cristal ${labelPrefix}`
      );

      if (isMovable) {
        const wheelGeo = new THREE.CylinderGeometry(0.011, 0.011, 0.014, 12);
        for (const s of [-1, 1]) {
          const wMesh = makePart(
            wheelGeo,
            'Carretilla Ajustable',
            'CAR-7152',
            rubberMat,
            'Nylon / Acero',
            'Rodamiento inferior de deslizamiento silencioso.',
            'Ø22 mm'
          );
          wMesh.rotation.x = Math.PI / 2;
          wMesh.position.set(s * (lw / 2 - 0.06), -lh / 2 + 0.012, 0);
          leaf.add(wMesh);
        }
      }

      if (includeLockSide) {
        const lockX = includeLockSide === 'right' ? lw / 2 - 0.018 : -lw / 2 + 0.018;
        const lockMesh = makePart(
          new THREE.BoxGeometry(0.018, 0.095, 0.032),
          'Cierre Embutido',
          'ACC-2026',
          hardwareMat,
          'Zamak / Acero',
          'Seguro automático de presión lateral.',
          '18 × 95 mm'
        );
        lockMesh.position.set(lockX, 0, 0.01);
        leaf.add(lockMesh);
      }

      return leaf;
    };

    const buildMosquitoLeaf = (mw: number, mh: number, zPos: number, initialX: number) => {
      const mosq = new THREE.Group();
      const mT = 0.022;
      const geoMH = new THREE.BoxGeometry(mw, mT, 0.014);
      const geoMV = new THREE.BoxGeometry(mT, Math.max(0.05, mh - 2 * mT), 0.014);

      const mDimH = findCutDim(['horizontal mosquitero'], `${Math.round(mw * 1000)} mm`);
      const mDimV = findCutDim(['vertical mosquitero'], `${Math.round(mh * 1000)} mm`);

      const t = makePart(geoMH, 'Marco Mosquitero Sup.', 'MOSQ-H', aluminumDarkMat, `Aluminio ${acabadoObj.nombre}`, 'Perfil perimetral para tela mosquitero.', mDimH);
      t.position.y = mh / 2 - mT / 2;
      const b = makePart(geoMH, 'Marco Mosquitero Inf.', 'MOSQ-H', aluminumDarkMat, `Aluminio ${acabadoObj.nombre}`, 'Perfil inferior de mosquitero.', mDimH);
      b.position.y = -mh / 2 + mT / 2;
      const l = makePart(geoMV, 'Marco Mosquitero Izq.', 'MOSQ-V', aluminumDarkMat, `Aluminio ${acabadoObj.nombre}`, 'Vertical izquierdo mosquitero.', mDimV);
      l.position.x = -mw / 2 + mT / 2;
      const r = makePart(geoMV, 'Marco Mosquitero Der.', 'MOSQ-V', aluminumDarkMat, `Aluminio ${acabadoObj.nombre}`, 'Vertical derecho mosquitero.', mDimV);
      r.position.x = mw / 2 - mT / 2;
      const tela = makePart(
        new THREE.PlaneGeometry(Math.max(0.05, mw - 2 * mT), Math.max(0.05, mh - 2 * mT)),
        'Tela Mosquitero Fibra',
        'TELA-MF',
        screenMat,
        'Fibra de vidrio recubierta PVC',
        'Malla mosquitero de alta visibilidad y ventilación.',
        `${Math.round(mw * 1000)} × ${Math.round(mh * 1000)} mm`
      );

      mosq.add(t, b, l, r, tela);
      mosq.position.set(initialX, 0, zPos);
      windowGroup.add(mosq);
    };

    // --- Switch by 7 Typology Geometry Families ---
    const innerW = W - 2 * profileT;
    const innerH = H - 2 * profileT;

    switch (typology.svgType) {
      case 'corrediza_2': {
        addOuterFrame(true);
        const leafW = innerW / 2 + 0.018;
        const leafH = innerH - 0.008;

        const fixedLeaf = buildFramedLeaf(leafW, leafH, false, 'Hoja Fija');
        fixedLeaf.position.set(-innerW / 4 - 0.004, 0, -0.014);
        windowGroup.add(fixedLeaf);

        const movableLeaf = buildFramedLeaf(leafW, leafH, true, 'Hoja Corrediza', 'right');
        const initX = innerW / 4 + 0.004;
        movableLeaf.position.set(initX, 0, 0.014);
        windowGroup.add(movableLeaf);

        slidingTargetsRef.current.push({
          group: movableLeaf,
          initialX: initX,
          maxDeltaX: -(innerW / 2 - 0.025),
        });

        if (typology.usaMosquitero) {
          buildMosquitoLeaf(leafW, leafH, -0.032, innerW / 4 + 0.004);
        }
        break;
      }

      case 'tres_hojas': {
        addOuterFrame(true);
        const leafW = innerW / 3 + 0.016;
        const leafH = innerH - 0.008;

        const hoja1 = buildFramedLeaf(leafW, leafH, false, 'Hoja 1 (Fija)');
        hoja1.position.set(-innerW / 3, 0, -0.022);
        windowGroup.add(hoja1);

        const initX2 = 0;
        const hoja2 = buildFramedLeaf(leafW, leafH, true, 'Hoja 2 (Telescópica)');
        hoja2.position.set(initX2, 0, 0);
        windowGroup.add(hoja2);

        const initX3 = innerW / 3;
        const hoja3 = buildFramedLeaf(leafW, leafH, true, 'Hoja 3 (Corrediza)', 'right');
        hoja3.position.set(initX3, 0, 0.022);
        windowGroup.add(hoja3);

        // Telescopic opening: hoja3 travels ~2/3 width, hoja2 travels ~1/3 width
        slidingTargetsRef.current.push(
          {
            group: hoja2,
            initialX: initX2,
            maxDeltaX: -(innerW / 3 - 0.018),
          },
          {
            group: hoja3,
            initialX: initX3,
            maxDeltaX: -((2 * innerW) / 3 - 0.036),
          }
        );
        break;
      }

      case 'oxxo': {
        addOuterFrame(true);
        const leafW = innerW / 4 + 0.014;
        const leafH = innerH - 0.008;

        const fijaL = buildFramedLeaf(leafW, leafH, false, 'Hoja Fija Izq.');
        fijaL.position.set((-3 * innerW) / 8, 0, -0.016);
        windowGroup.add(fijaL);

        const fijaR = buildFramedLeaf(leafW, leafH, false, 'Hoja Fija Der.');
        fijaR.position.set((3 * innerW) / 8, 0, -0.016);
        windowGroup.add(fijaR);

        const initXL = -innerW / 8;
        const movL = buildFramedLeaf(leafW, leafH, true, 'Corrediza Central Izq.', 'right');
        movL.position.set(initXL, 0, 0.014);
        windowGroup.add(movL);

        const initXR = innerW / 8;
        const movR = buildFramedLeaf(leafW, leafH, true, 'Corrediza Central Der.', 'left');
        movR.position.set(initXR, 0, 0.014);
        windowGroup.add(movR);

        slidingTargetsRef.current.push(
          {
            group: movL,
            initialX: initXL,
            maxDeltaX: -(innerW / 4 - 0.02),
          },
          {
            group: movR,
            initialX: initXR,
            maxDeltaX: innerW / 4 - 0.02,
          }
        );

        if (typology.usaMosquitero) {
          buildMosquitoLeaf(leafW, leafH, -0.036, -innerW / 8);
          buildMosquitoLeaf(leafW, leafH, -0.036, innerW / 8);
        }
        break;
      }

      case 'puerta_batiente':
      case 'puerta_ligera': {
        addOuterFrame(false);
        const doorW = innerW - 0.008;
        const doorH = H - profileT - 0.01;
        const leafDepth = 0.036;

        // Hinge pivot located on left inner jamb edge
        const pivot = new THREE.Group();
        pivot.position.set(-doorW / 2, -profileT / 2, 0.005);
        windowGroup.add(pivot);

        const doorLeaf = new THREE.Group();
        doorLeaf.position.set(doorW / 2, 0, 0);
        pivot.add(doorLeaf);

        const stileW = 0.055;
        const zocloH = 0.085;
        const interH = 0.055;

        const stileGeo = new THREE.BoxGeometry(stileW, doorH, leafDepth);
        const cercoL = makePart(stileGeo, 'Cerco Bisagra', 'CER-B', aluminumMat, `Aluminio ${acabadoObj.nombre}`, 'Larguero vertical lado bisagras.', findCutDim(['cerco'], `${alto} mm`));
        cercoL.position.x = -doorW / 2 + stileW / 2;
        const cercoR = makePart(stileGeo, 'Cerco Chapa', 'CER-C', aluminumMat, `Aluminio ${acabadoObj.nombre}`, 'Larguero vertical portachapa.', findCutDim(['cerco'], `${alto} mm`));
        cercoR.position.x = doorW / 2 - stileW / 2;

        const cab = makePart(new THREE.BoxGeometry(doorW - 2 * stileW, stileW, leafDepth), 'Cabezal Puerta', 'CAB-P', aluminumMat, `Aluminio ${acabadoObj.nombre}`, 'Travesaño superior de puerta.', findCutDim(['cabezal'], `${ancho} mm`));
        cab.position.y = doorH / 2 - stileW / 2;

        const zoc = makePart(new THREE.BoxGeometry(doorW - 2 * stileW, zocloH, leafDepth), 'Zoclo Inferior', 'ZOC-P', aluminumMat, `Aluminio ${acabadoObj.nombre}`, 'Zoclo inferior reforzado.', findCutDim(['zoclo'], `${ancho} mm`));
        zoc.position.y = -doorH / 2 + zocloH / 2;

        const inter = makePart(new THREE.BoxGeometry(doorW - 2 * stileW, interH, leafDepth), 'Travesaño Intermedio', 'INT-P', aluminumMat, `Aluminio ${acabadoObj.nombre}`, 'Perfil divisor horizontal intermedio.', findCutDim(['intermedio'], `${ancho} mm`));
        const midY = -doorH * 0.05;
        inter.position.y = midY;

        doorLeaf.add(cercoL, cercoR, cab, zoc, inter);

        // Upper glass panel
        const topPanelH = doorH / 2 - stileW - (midY + interH / 2);
        const topPanelY = midY + interH / 2 + topPanelH / 2;
        const topGroup = new THREE.Group();
        topGroup.position.y = topPanelY;
        addGlassPane(topGroup, doorW - 2 * stileW + 0.006, topPanelH + 0.004, 0, 'Cristal Superior Puerta');
        doorLeaf.add(topGroup);

        // Lower panel: glass for puerta_batiente, grooved duela slats for puerta_ligera
        const botPanelH = midY - interH / 2 - (-doorH / 2 + zocloH);
        const botPanelY = -doorH / 2 + zocloH + botPanelH / 2;
        if (typology.svgType === 'puerta_ligera') {
          const slats = 6;
          const slatH = botPanelH / slats;
          const slatW = doorW - 2 * stileW;
          for (let s = 0; s < slats; s++) {
            const sy = -doorH / 2 + zocloH + slatH * (s + 0.5);
            const slat = makePart(
              new THREE.BoxGeometry(slatW, slatH - 0.003, 0.022),
              'Panel Duela Ranurada',
              'DUELA-AL',
              s % 2 === 0 ? aluminumMat : aluminumDarkMat,
              `Duela Aluminio ${acabadoObj.nombre}`,
              'Duela machihembrada inferior de alta rigidez.',
              findCutDim(['duela'], `${Math.round(slatW * 1000)} × ${Math.round(botPanelH * 1000)} mm`)
            );
            slat.position.set(0, sy, 0);
            doorLeaf.add(slat);
          }
        } else {
          const botGroup = new THREE.Group();
          botGroup.position.y = botPanelY;
          addGlassPane(botGroup, doorW - 2 * stileW + 0.006, botPanelH + 0.004, 0, 'Cristal Inferior Puerta');
          doorLeaf.add(botGroup);
        }

        // Hinges (3)
        const hingeGeo = new THREE.CylinderGeometry(0.009, 0.009, 0.075, 10);
        for (const hy of [-doorH * 0.35, 0, doorH * 0.35]) {
          const hinge = makePart(hingeGeo, 'Bisagra Reforzada', 'BIS-3', hardwareMat, 'Acero Inoxidable', 'Bisagra de uso rudo para puerta abatible.', '75 mm');
          hinge.position.set(-doorW / 2, hy, leafDepth / 2);
          doorLeaf.add(hinge);
        }

        // Lever handle on both sides
        const handleBase = makePart(new THREE.BoxGeometry(0.032, 0.14, 0.012), 'Chapa de Manija', 'CHAPA-P', hardwareMat, 'Acero Satinado', 'Cerradura residencial con manija reversible.', '32 × 140 mm');
        handleBase.position.set(doorW / 2 - stileW / 2, -0.02, leafDepth / 2 + 0.006);
        const lever = makePart(new THREE.BoxGeometry(0.11, 0.016, 0.018), 'Manija Palanca', 'MAN-P', hardwareMat, 'Acero Satinado', 'Manija ergonómica de accionamiento.', '110 mm');
        lever.position.set(doorW / 2 - stileW / 2 - 0.04, 0.01, leafDepth / 2 + 0.028);
        doorLeaf.add(handleBase, lever);

        hingedTargetsRef.current.push({
          pivot,
          maxAngleRad: Math.PI * 0.46, // opens ~83 degrees toward viewer
        });
        break;
      }

      case 'cancel_bano': {
        // Minimal bath enclosure with top header bar, fixed glass, sliding tempered door & stainless handle
        const topRail = makePart(
          new THREE.BoxGeometry(W, 0.038, 0.038),
          'Riel Superior Semilujo',
          'BANO-CAB',
          hardwareMat,
          'Aluminio Anodizado / Inox',
          'Cabezal superior porta-carretillas de cancelería de baño.',
          findCutDim(['cabezal', 'silla'], `${ancho} mm`)
        );
        topRail.position.set(0, H / 2 - 0.019, 0);
        windowGroup.add(topRail);

        const uGeo = new THREE.BoxGeometry(0.022, H - 0.038, 0.024);
        const uLeft = makePart(uGeo, 'Canal U Lateral Izq.', 'BANO-U', aluminumMat, `Aluminio ${acabadoObj.nombre}`, 'Canal perimetral antihumedad a muro.', `${alto} mm`);
        uLeft.position.set(-W / 2 + 0.011, -0.019, -0.01);
        const uRight = makePart(uGeo, 'Canal U Lateral Der.', 'BANO-U', aluminumMat, `Aluminio ${acabadoObj.nombre}`, 'Canal de recibo y sellado magnético.', `${alto} mm`);
        uRight.position.set(W / 2 - 0.011, -0.019, 0.012);
        windowGroup.add(uLeft, uRight);

        const panelW = W / 2 + 0.015;
        const panelH = H - 0.055;

        const fixedBath = new THREE.Group();
        fixedBath.position.set(-W / 4, -0.02, -0.01);
        addGlassPane(fixedBath, panelW, panelH, 0, 'Panel Fijo Templado');
        windowGroup.add(fixedBath);

        const slidingBath = new THREE.Group();
        const initBathX = W / 4;
        slidingBath.position.set(initBathX, -0.02, 0.014);
        addGlassPane(slidingBath, panelW, panelH, 0, 'Puerta Corrediza Templada');

        // Exposed stainless rollers & towel bar handle
        const rGeo = new THREE.CylinderGeometry(0.016, 0.016, 0.012, 14);
        for (const rx of [-panelW * 0.34, panelW * 0.34]) {
          const roller = makePart(rGeo, 'Carretilla Expuesta Inox', 'INOX-CAR', hardwareMat, 'Acero Inoxidable 304', 'Rodamiento superior visto de alta resistencia.', 'Ø32 mm');
          roller.rotation.x = Math.PI / 2;
          roller.position.set(rx, panelH / 2 - 0.025, 0.008);
          slidingBath.add(roller);
        }

        const jaladera = makePart(
          new THREE.CylinderGeometry(0.009, 0.009, 0.42, 12),
          'Jaladera Tubular H',
          'JAL-H',
          hardwareMat,
          'Acero Inoxidable 304',
          'Jaladera vertical tipo toallero para cancel templado.',
          '420 mm'
        );
        jaladera.position.set(-panelW / 2 + 0.08, 0, 0.025);
        slidingBath.add(jaladera);

        windowGroup.add(slidingBath);
        slidingTargetsRef.current.push({
          group: slidingBath,
          initialX: initBathX,
          maxDeltaX: -(W / 2 - 0.04),
        });
        break;
      }

      case 'fija':
      default: {
        addOuterFrame(true);
        const fixedPane = new THREE.Group();
        addGlassPane(fixedPane, innerW + 0.006, innerH + 0.006, 0, 'Cristal Fijo Integral');
        windowGroup.add(fixedPane);
        break;
      }
    }

    // Apply current aperture value immediately to new geometry
    const t = isFixedTypology ? 0 : currentOpenRef.current;
    if (isFixedTypology) {
      targetOpenRef.current = 0;
      currentOpenRef.current = 0;
      setOpenPercent(0);
    } else {
      for (const s of slidingTargetsRef.current) {
        s.group.position.x = s.initialX + t * s.maxDeltaX;
      }
      for (const h of hingedTargetsRef.current) {
        h.pivot.rotation.y = t * h.maxAngleRad;
      }
    }

    // --- Dynamic Contextual Wall around the exact opening (W x H) ---
    const wallGroup = new THREE.Group();
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0xd6d3cd,
      roughness: 0.92,
      metalness: 0.02,
    });
    const wallD = 0.14;
    const marginSide = Math.max(0.55, W * 0.25);
    const wallW = W + marginSide * 2;
    const topWallH = 0.55;
    const wallH = holeBottomY + H + topWallH;

    const sideWallGeo = new THREE.BoxGeometry(marginSide, wallH, wallD);
    const leftWall = new THREE.Mesh(sideWallGeo, wallMat);
    leftWall.position.set(-W / 2 - marginSide / 2, wallH / 2, 0);
    leftWall.castShadow = !isSoftwareGlRef.current;
    leftWall.receiveShadow = true;

    const rightWall = new THREE.Mesh(sideWallGeo, wallMat);
    rightWall.position.set(W / 2 + marginSide / 2, wallH / 2, 0);
    rightWall.castShadow = !isSoftwareGlRef.current;
    rightWall.receiveShadow = true;

    const topWall = new THREE.Mesh(new THREE.BoxGeometry(W, topWallH, wallD), wallMat);
    topWall.position.set(0, holeBottomY + H + topWallH / 2, 0);
    topWall.castShadow = !isSoftwareGlRef.current;
    topWall.receiveShadow = true;

    wallGroup.add(leftWall, rightWall, topWall);

    if (holeBottomY > 0.01) {
      const bottomWall = new THREE.Mesh(new THREE.BoxGeometry(W, holeBottomY, wallD), wallMat);
      bottomWall.position.set(0, holeBottomY / 2, 0);
      bottomWall.castShadow = !isSoftwareGlRef.current;
      bottomWall.receiveShadow = true;
      wallGroup.add(bottomWall);
    }

    // Subtle interior baseboard plinth
    const plinth = new THREE.Mesh(
      new THREE.BoxGeometry(wallW, 0.08, wallD + 0.015),
      new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.7 })
    );
    plinth.position.set(0, 0.04, 0);
    if (holeBottomY === 0) {
      // Only add side plinths for doors
      plinth.scale.x = 0;
    } else {
      wallGroup.add(plinth);
    }

    wallGroup.visible = showWallRef.current;
    scene.add(wallGroup);
    envWallGroupRef.current = wallGroup;

    // Resize contact shadow under unit
    if (contactShadowRef.current) {
      contactShadowRef.current.scale.set(Math.max(1, W * 0.65), 1, 1);
    }

    // Auto-frame camera smoothly based on W and H
    const maxDim = Math.max(W, H);
    const fovRad = THREE.MathUtils.degToRad(camera.fov);
    const fitDist = Math.max(2.1, (maxDim / 2 / Math.tan(fovRad / 2)) * 1.45);
    defaultCameraRef.current.target.set(0, centerY, 0);
    defaultCameraRef.current.pos.set(fitDist * 0.55, centerY + fitDist * 0.14, fitDist * 0.92);

    camera.position.copy(defaultCameraRef.current.pos);
    controls.target.copy(defaultCameraRef.current.target);
    controls.update();

    requestRenderRef.current();
  }, [typology, ancho, alto, marca, brandData, acabadoId, cristalId, despiece, isFixedTypology]);

  // Wall toggle synchronization
  useEffect(() => {
    if (envWallGroupRef.current) {
      envWallGroupRef.current.visible = showWall;
      requestRenderRef.current();
    }
  }, [showWall]);

  const handleSliderChange = (val: number) => {
    setOpenPercent(val);
    targetOpenRef.current = val / 100;
    requestRenderRef.current();
  };

  const handleToggleOpen = () => {
    const next = openPercent > 50 ? 0 : 100;
    handleSliderChange(next);
  };

  const handleResetCamera = () => {
    cameraAnimatingRef.current = true;
    requestRenderRef.current();
  };

  if (webglError) {
    return (
      <div className="w-full h-[380px] sm:h-[420px] flex flex-col items-center justify-center bg-slate-950 text-center p-6 rounded-xl border border-slate-800">
        <p className="text-sm font-semibold text-slate-200">
          Visor 3D no disponible en este navegador
        </p>
        <p className="text-xs text-slate-400 mt-1 max-w-xs">
          Tu dispositivo no tiene aceleración WebGL activa. Cambia a la vista &quot;Plano 2D&quot;
          para consultar las cotas proporcionales.
        </p>
      </div>
    );
  }

  return (
    <div className="relative w-full h-[380px] sm:h-[420px] overflow-hidden rounded-xl bg-slate-950 select-none">
      {/* Isolated WebGL Canvas Container */}
      <div ref={mountRef} className="w-full h-full cursor-grab active:cursor-grabbing" />

      {/* Top-Left Compact Telemetry Badge (Unobtrusive) */}
      <div className="absolute top-3 left-3 pointer-events-none flex flex-col gap-1.5 max-w-[78%]">
        <div className="inline-flex flex-wrap items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-950/90 border border-slate-800 text-[11px] font-mono text-slate-300 shadow-md">
          <span className="text-sky-400 font-bold">{ancho} × {alto} mm</span>
          <span className="text-slate-600">|</span>
          <span className="text-emerald-300 font-semibold">{marca}</span>
          {brandData && brandData.espesorParedMm > 0 && (
            <span className="text-slate-400 text-[10px]">({brandData.espesorParedMm}mm)</span>
          )}
        </div>
        {!selectedPart && (
          <div className="px-2.5 py-1 rounded-md bg-slate-950/80 border border-slate-800/80 text-[10px] text-slate-400">
            Arrastra para rotar · Clic en cualquier pieza para ver ficha técnica
          </div>
        )}
      </div>

      {/* Top-Left Inspector Chip when a 3D piece is clicked (never blocks center) */}
      {selectedPart && (
        <div className="absolute top-12 left-3 z-20 w-64 rounded-lg bg-slate-950/95 border border-sky-500/60 p-3 shadow-xl text-xs">
          <div className="flex items-start justify-between gap-2 border-b border-slate-800 pb-1.5 mb-2">
            <div>
              <div className="font-bold text-sky-400 leading-tight">{selectedPart.name}</div>
              <div className="text-[10px] font-mono text-amber-300">{selectedPart.code}</div>
            </div>
            <button
              type="button"
              onClick={() => {
                clearSelection();
                requestRenderRef.current();
              }}
              className="text-slate-400 hover:text-white p-0.5 cursor-pointer"
              title="Cerrar ficha"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="space-y-1 text-[11px]">
            <div className="flex justify-between gap-2">
              <span className="text-slate-500">Marca:</span>
              <span className="text-emerald-300 font-medium text-right">{selectedPart.brand}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-500">Material:</span>
              <span className="text-slate-200 font-medium text-right">{selectedPart.material}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-500">Medida taller:</span>
              <span className="text-sky-400 font-mono font-bold text-right">{selectedPart.dim}</span>
            </div>
            <p className="text-[10px] text-slate-400 pt-1 leading-snug">{selectedPart.desc}</p>
          </div>
        </div>
      )}

      {/* Collapsible Unified Bottom Control Dock */}
      <div className="absolute bottom-2.5 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center w-[calc(100%-1.25rem)] max-w-[460px]">
        <button
          type="button"
          onClick={() => setControlsCollapsed((v) => !v)}
          className="px-2.5 py-0.5 rounded-t-md bg-slate-900/95 border border-b-0 border-slate-700/80 text-[10px] font-medium text-slate-300 hover:text-white flex items-center gap-1 cursor-pointer"
        >
          {controlsCollapsed ? (
            <>
              <ChevronUp className="w-3 h-3" />
              <span>Controles 3D</span>
            </>
          ) : (
            <>
              <ChevronDown className="w-3 h-3" />
              <span>Ocultar controles</span>
            </>
          )}
        </button>

        {!controlsCollapsed && (
          <div className="w-full rounded-xl bg-slate-950/95 border border-slate-800 px-3 py-2 shadow-xl flex flex-wrap items-center justify-between gap-2">
            {/* Opening / Hinge Control */}
            {!isFixedTypology ? (
              <div className="flex items-center gap-2 flex-1 min-w-[175px]">
                <button
                  type="button"
                  onClick={handleToggleOpen}
                  className="px-2 py-1 rounded-md bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/40 text-sky-300 text-[11px] font-semibold flex items-center gap-1 cursor-pointer shrink-0"
                  title={isDoorTypology ? 'Abrir o cerrar puerta' : 'Abrir o cerrar hoja'}
                >
                  {isDoorTypology ? (
                    <DoorOpen className="w-3.5 h-3.5" />
                  ) : (
                    <MoveHorizontal className="w-3.5 h-3.5" />
                  )}
                  <span>{openPercent > 50 ? 'Cerrar' : 'Abrir'}</span>
                </button>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={openPercent}
                  onChange={(e) => handleSliderChange(Number(e.target.value))}
                  aria-label="Porcentaje de apertura"
                  className="w-full accent-sky-400 cursor-pointer h-1.5"
                />
                <span className="font-mono text-[11px] text-sky-400 font-bold w-8 text-right shrink-0">
                  {openPercent}%
                </span>
              </div>
            ) : (
              <div className="text-[11px] text-slate-400 font-mono px-1">
                Sistema fijo (sin apertura)
              </div>
            )}

            {/* Wall & Reset Actions */}
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => setShowWall((v) => !v)}
                className={`px-2 py-1 rounded-md border text-[11px] font-medium flex items-center gap-1 cursor-pointer transition-colors ${
                  showWall
                    ? 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
                    : 'bg-sky-500/15 border-sky-500/40 text-sky-300'
                }`}
                title="Mostrar u ocultar muro de referencia"
              >
                <BrickWall className="w-3.5 h-3.5" />
                <span>{showWall ? 'Muro' : 'Sin muro'}</span>
              </button>

              <button
                type="button"
                onClick={handleResetCamera}
                className="p-1.5 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white cursor-pointer"
                title="Restablecer vista de cámara"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
