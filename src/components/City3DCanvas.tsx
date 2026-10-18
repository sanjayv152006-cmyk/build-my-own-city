import React, { useState, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CITY_LOCATIONS } from '../data/locations';
import { CityLocationInfo, CityDefinition } from '../types/game';
import { soundService } from '../services/sound';

interface City3DCanvasProps {
  unlockedLocationIds: number[];
  newlyUnlockedId: number | null;
  focusedLocationId: number | null;
  onSelectLocation?: (id: number) => void;
  isNight?: boolean;
  cityDefinition?: CityDefinition;
  graphicsQuality?: 'low' | 'medium' | 'high';
}

export const City3DCanvas: React.FC<City3DCanvasProps> = ({
  unlockedLocationIds,
  newlyUnlockedId,
  focusedLocationId,
  onSelectLocation,
  isNight = false,
  cityDefinition,
  graphicsQuality = 'high',
}) => {
  const [hasWebGLError, setHasWebGLError] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const locationGroupsRef = useRef<Map<number, THREE.Group>>(new Map());
  const lockedMarkersRef = useRef<Map<number, THREE.Group>>(new Map());
  const animFrameRef = useRef<number | null>(null);

  // References for animated elements
  const movingVehiclesRef = useRef<{ mesh: THREE.Object3D; speed: number; axis: 'x' | 'z'; min: number; max: number; dir: number }[]>([]);
  const flyingPlaneRef = useRef<THREE.Object3D | null>(null);
  const rotatingTurbinesRef = useRef<THREE.Object3D[]>([]);
  const fountainParticlesRef = useRef<THREE.Points | null>(null);
  const cloudGroupRef = useRef<THREE.Group | null>(null);
  const sunLightRef = useRef<THREE.DirectionalLight | null>(null);
  const hemiLightRef = useRef<THREE.HemisphereLight | null>(null);

  // Camera flight targets
  const targetCamPos = useRef<THREE.Vector3>(new THREE.Vector3(0, 36, 68));
  const targetLookAt = useRef<THREE.Vector3>(new THREE.Vector3(0, 0, 5));
  const isTransitioningCam = useRef<boolean>(false);
  const safeUnlockedIds = Array.isArray(unlockedLocationIds) ? unlockedLocationIds : [];
  const unlockedLocationIdsRef = useRef<number[]>(safeUnlockedIds);
  unlockedLocationIdsRef.current = safeUnlockedIds;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // --- SCENE SETUP ---
    const scene = new THREE.Scene();
    sceneRef.current = scene;
    const skyColor = cityDefinition ? cityDefinition.skyColor : 0x7dd3fc;
    const fogColor = cityDefinition ? cityDefinition.fogColor : 0xbae6fd;
    scene.background = new THREE.Color(isNight ? 0x0f172a : skyColor);
    scene.fog = new THREE.FogExp2(isNight ? 0x0f172a : fogColor, 0.0075);

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    const isMobile = width < 768 || width / height < 1.0;

    const camera = new THREE.PerspectiveCamera(isMobile ? 50 : 45, width / height, 0.5, 500);
    const initialCamPos = isMobile ? new THREE.Vector3(0, 52, 96) : new THREE.Vector3(0, 38, 70);
    camera.position.copy(initialCamPos);
    targetCamPos.current.copy(initialCamPos);
    cameraRef.current = camera;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: graphicsQuality !== 'low', alpha: false });
    } catch (e) {
      console.warn('WebGL initialization failed, falling back to 2D view mode:', e);
      setHasWebGLError(true);
      return;
    }
    rendererRef.current = renderer;
    renderer.setSize(width, height);
    if (graphicsQuality === 'low') {
      renderer.setPixelRatio(1);
      renderer.shadowMap.enabled = false;
    } else if (graphicsQuality === 'medium') {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.BasicShadowMap;
    } else {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFShadowMap;
    }
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = isNight ? 0.8 : 1.15;
    container.appendChild(renderer.domElement);

    const handleContextLost = (e: Event) => {
      e.preventDefault();
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
    renderer.domElement.addEventListener('webglcontextlost', handleContextLost, false);

    let controls: OrbitControls;
    try {
      controls = new OrbitControls(camera, renderer.domElement);
    } catch (e) {
      console.warn('OrbitControls initialization error:', e);
      controls = {
        enableDamping: false,
        dampingFactor: 0.05,
        maxPolarAngle: Math.PI / 2,
        minDistance: 12,
        maxDistance: 150,
        target: new THREE.Vector3(0, 0, 5),
        update: () => {},
        dispose: () => {},
      } as unknown as OrbitControls;
    }
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.maxPolarAngle = Math.PI / 2.05; // don't go below ground
    controls.minDistance = 12;
    controls.maxDistance = 150;
    controls.target.set(0, 0, 5);
    controlsRef.current = controls;

    // --- LIGHTING ---
    const ambientLight = new THREE.AmbientLight(isNight ? 0x334155 : 0xffffff, isNight ? 0.6 : 0.7);
    scene.add(ambientLight);

    const hemiLight = new THREE.HemisphereLight(
      isNight ? 0x1e293b : 0xe0f2fe,
      isNight ? 0x0f172a : 0x334155,
      isNight ? 0.5 : 0.65
    );
    scene.add(hemiLight);
    hemiLightRef.current = hemiLight;

    const sunLight = new THREE.DirectionalLight(isNight ? 0x93c5fd : 0xfffaed, isNight ? 0.6 : 1.4);
    sunLight.position.set(40, 65, 35);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 10;
    sunLight.shadow.camera.far = 180;
    sunLight.shadow.camera.left = -60;
    sunLight.shadow.camera.right = 60;
    sunLight.shadow.camera.top = 60;
    sunLight.shadow.camera.bottom = -60;
    sunLight.shadow.bias = -0.0003;
    scene.add(sunLight);
    sunLightRef.current = sunLight;

    // --- PROCEDURAL GROUND & CONNECTED ROADS ---
    buildGroundAndRoads(scene, cityDefinition?.groundColor);

    // --- DECORATIVE CLOUDS ---
    const clouds = buildClouds();
    scene.add(clouds);
    cloudGroupRef.current = clouds;

    // --- BUILD ALL 10 ZONE GROUPS ---
    buildAllZones(scene, locationGroupsRef.current, lockedMarkersRef.current);

    // --- ANIMATED VEHICLES ON ROADS ---
    initMovingVehicles(scene, movingVehiclesRef.current);

    // --- ANIMATED AIRPLANE OVER AIRPORT ---
    const plane = buildAirplane();
    plane.position.set(-20, 22, 36);
    scene.add(plane);
    flyingPlaneRef.current = plane;

    // --- RAYCASTING FOR INTERACTION ---
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    const handlePointerDown = (event: MouseEvent) => {
      if (!onSelectLocation) return;
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);

      // Check hits on interactive objects with userData.locationId
      const intersects = raycaster.intersectObjects(scene.children, true);
      for (const hit of intersects) {
        let cur: THREE.Object3D | null = hit.object;
        while (cur && cur !== scene) {
          if (cur.userData && cur.userData.locationId) {
            const locId = cur.userData.locationId;
            // Only allow selection if the location is unlocked
            if (unlockedLocationIdsRef.current.includes(locId)) {
              soundService.playClick();
              onSelectLocation(locId);
            }
            return;
          }
          cur = cur.parent;
        }
      }
    };

    renderer.domElement.addEventListener('click', handlePointerDown);

    // --- RESIZE HANDLER ---
    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      const aspect = w / h;
      camera.aspect = aspect;
      const isMob = w < 768 || aspect < 1.0;
      camera.fov = isMob ? 50 : 45;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    window.addEventListener('resize', handleResize);

    // --- MAIN RENDER & ANIMATION LOOP ---
    const timer = new THREE.Timer();
    let planeAngle = 0;

    const animate = () => {
      animFrameRef.current = requestAnimationFrame(animate);
      timer.update();
      const delta = Math.min(timer.getDelta(), 0.1);
      const elapsedTime = timer.getElapsed();

      // Controls update
      controls.update();

      // Camera smooth fly-to transition
      if (isTransitioningCam.current) {
        camera.position.lerp(targetCamPos.current, 0.05);
        controls.target.lerp(targetLookAt.current, 0.05);
        if (
          camera.position.distanceTo(targetCamPos.current) < 0.2 &&
          controls.target.distanceTo(targetLookAt.current) < 0.2
        ) {
          isTransitioningCam.current = false;
        }
      }

      // Clouds gentle drift
      if (cloudGroupRef.current) {
        cloudGroupRef.current.rotation.y = elapsedTime * 0.015;
      }

      // Moving road vehicles
      movingVehiclesRef.current.forEach((veh) => {
        if (veh.axis === 'x') {
          veh.mesh.position.x += veh.speed * veh.dir * delta;
          if (veh.dir > 0 && veh.mesh.position.x > veh.max) {
            veh.mesh.position.x = veh.min;
          } else if (veh.dir < 0 && veh.mesh.position.x < veh.min) {
            veh.mesh.position.x = veh.max;
          }
        } else {
          veh.mesh.position.z += veh.speed * veh.dir * delta;
          if (veh.dir > 0 && veh.mesh.position.z > veh.max) {
            veh.mesh.position.z = veh.min;
          } else if (veh.dir < 0 && veh.mesh.position.z < veh.min) {
            veh.mesh.position.z = veh.max;
          }
        }
      });

      // Airplane flight circle
      if (flyingPlaneRef.current) {
        planeAngle += delta * 0.45;
        const radius = 24;
        flyingPlaneRef.current.position.x = -20 + Math.cos(planeAngle) * radius;
        flyingPlaneRef.current.position.z = 36 + Math.sin(planeAngle) * radius;
        flyingPlaneRef.current.position.y = 22 + Math.sin(elapsedTime * 1.5) * 1.5;
        flyingPlaneRef.current.rotation.y = -planeAngle - Math.PI / 2;
        flyingPlaneRef.current.rotation.z = -0.15; // banking turn
      }

      // Rotating turbine blades in smart city
      rotatingTurbinesRef.current.forEach((t) => {
        t.rotation.z += delta * 3.5;
      });

      // Animate locked marker floating bobbing
      lockedMarkersRef.current.forEach((grp) => {
        grp.position.y = 1.2 + Math.sin(elapsedTime * 2.5 + grp.userData.locationId) * 0.35;
        grp.rotation.y += delta * 0.8;
      });

      renderer.render(scene, camera);
    };

    animate();

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      window.removeEventListener('resize', handleResize);
      renderer.domElement.removeEventListener('click', handlePointerDown);
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
      controls.dispose();
      renderer.dispose();
      if (container && renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [isNight, cityDefinition?.id]);

  // Update visible/locked state of the 10 zones
  useEffect(() => {
    const safeIds = Array.isArray(unlockedLocationIds) ? unlockedLocationIds : [];
    locationGroupsRef.current.forEach((group, id) => {
      const isUnlocked = safeIds.includes(id);
      group.visible = isUnlocked;

      // Unlocking animation pop-up for newly unlocked
      if (isUnlocked && newlyUnlockedId === id) {
        group.scale.set(0.01, 0.01, 0.01);
        let progress = 0;
        const popInterval = setInterval(() => {
          progress += 0.08;
          const s = Math.min(1.0, progress * 1.1);
          group.scale.set(s, s, s);
          if (progress >= 1.0) {
            group.scale.set(1, 1, 1);
            clearInterval(popInterval);
          }
        }, 16);
      } else if (isUnlocked) {
        group.scale.set(1, 1, 1);
      }
    });

    lockedMarkersRef.current.forEach((marker, id) => {
      marker.visible = !safeIds.includes(id);
    });
  }, [unlockedLocationIds, newlyUnlockedId]);

  // Dynamically update graphics quality without breaking or recreating scene
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;

    if (graphicsQuality === 'low') {
      renderer.setPixelRatio(1);
      renderer.shadowMap.enabled = false;
    } else if (graphicsQuality === 'medium') {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.BasicShadowMap;
    } else {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFShadowMap;
    }
  }, [graphicsQuality]);

  // Focus camera on selected location or return to overview
  useEffect(() => {
    if (cameraRef.current && controlsRef.current) {
      const isMob = window.innerWidth < 768 || window.innerWidth / window.innerHeight < 1.0;
      if (focusedLocationId !== null) {
        const loc = CITY_LOCATIONS.find((l) => l.id === focusedLocationId);
        if (loc) {
          const [tx, ty, tz] = loc.cameraTarget;
          targetLookAt.current.set(tx, ty, tz);
          targetCamPos.current.set(
            tx + (isMob ? 16 : 14),
            ty + (isMob ? 20 : 16),
            tz + (isMob ? 30 : 24)
          );
          isTransitioningCam.current = true;
        }
      } else {
        // Overview camera view
        targetLookAt.current.set(0, 0, 5);
        targetCamPos.current.set(0, isMob ? 52 : 38, isMob ? 96 : 70);
        isTransitioningCam.current = true;
      }
    }
  }, [focusedLocationId]);

  if (hasWebGLError) {
    return (
      <div className="absolute inset-0 w-full h-full overflow-hidden select-none bg-gradient-to-b from-slate-900 via-sky-950 to-slate-950 flex flex-col items-center justify-center p-6 text-center">
        <div className="max-w-md p-6 rounded-3xl bg-slate-900/90 border border-slate-700/80 shadow-2xl backdrop-blur-md space-y-3">
          <div className="text-3xl">🏙️</div>
          <h3 className="text-lg font-black text-white">Smart City Adventure</h3>
          <p className="text-xs text-slate-300">
            {cityDefinition?.name ? `Welcome to ${cityDefinition.name}!` : 'Welcome to your smart metropolis!'}
          </p>
          <div className="text-[11px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 rounded-full inline-block">
            2D Safe View Mode Active • All Quizzes Operational
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 w-full h-full overflow-hidden cursor-grab active:cursor-grabbing select-none touch-none"
    />
  );
};

// ==========================================
// 3D SCENE PROCEDURAL BUILDERS
// ==========================================

const TERRAIN_Y = 0.0;
const ROAD_Y = 0.025;
const MARKING_Y = 0.032;
const CURB_Y = 0.025; // Curb box of height 0.05 centered at 0.025 -> bottom at 0.0, top at 0.05
const SURFACE_Y = 0.05; // Ground level for all zone structures and objects

function buildGroundAndRoads(scene: THREE.Scene, groundColorHex?: number) {
  // 1. Unified Single Ground Terrain (Flat at y = 0.0)
  const terrainGeo = new THREE.PlaneGeometry(164, 144, 1, 1);
  const terrainMat = new THREE.MeshStandardMaterial({
    color: groundColorHex ?? 0x22c55e,
    roughness: 0.85,
    metalness: 0.05,
    depthWrite: true,
  });
  const terrain = new THREE.Mesh(terrainGeo, terrainMat);
  terrain.rotation.x = -Math.PI / 2;
  terrain.position.y = TERRAIN_Y;
  terrain.receiveShadow = true;
  scene.add(terrain);

  // Solid perimeter sub-base beneath terrain positioned strictly below ground (top at y = -0.05) to eliminate any Z-fighting stripes
  const baseGeo = new THREE.BoxGeometry(164.5, 2.0, 144.5);
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.9 });
  const base = new THREE.Mesh(baseGeo, baseMat);
  base.position.y = -1.05;
  base.receiveShadow = true;
  scene.add(base);

  // 2. Seamless Connected Road Network (Consistent height at ROAD_Y, zero Z-fighting)
  const ROAD_W = 6.4; // Road width (3.2m lane each way)
  const HALF_W = ROAD_W / 2;

  // Grid coordinates for Avenues (East-West) and Streets (North-South)
  const EW_AVENUES = [-42, -12, 20, 52];
  const NS_STREETS = [-48, -24, 2, 28, 52];

  const roadMat = new THREE.MeshStandardMaterial({
    color: 0x242a38, // deep asphalt slate
    roughness: 0.8,
    metalness: 0.1,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  });

  const markingMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
    depthWrite: true,
  });

  // A. Intersection Junction Squares (Placed at exact ROAD_Y with 0.04 micro-overlap to eliminate subpixel seams)
  const junctions: { x: number; z: number; isCross: boolean }[] = [];

  // Avenues z = -42, -12, 20 have intersections with all 5 streets
  [-42, -12, 20].forEach((z) => {
    NS_STREETS.forEach((x) => {
      junctions.push({ x, z, isCross: true });
    });
  });

  // Avenue z = 52 has intersections with perimeter and central boulevard (-48, 2, 52)
  [-48, 2, 52].forEach((x) => {
    junctions.push({ x, z: 52, isCross: false });
  });

  junctions.forEach(({ x, z }) => {
    const junction = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W + 0.04, ROAD_W + 0.04), roadMat);
    junction.rotation.x = -Math.PI / 2;
    junction.position.set(x, ROAD_Y, z);
    junction.receiveShadow = true;
    scene.add(junction);

    // Pedestrian Crosswalk Markings at junction entrances (positioned cleanly at MARKING_Y)
    [-HALF_W - 0.7, HALF_W + 0.7].forEach((zOff) => {
      for (let i = -2; i <= 2; i++) {
        if (i === 0) continue;
        const zebra = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 1.2), markingMat);
        zebra.rotation.x = -Math.PI / 2;
        zebra.position.set(x + i * 0.9, MARKING_Y, z + zOff);
        scene.add(zebra);
      }
    });

    [-HALF_W - 0.7, HALF_W + 0.7].forEach((xOff) => {
      for (let i = -2; i <= 2; i++) {
        if (i === 0) continue;
        const zebra = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.45), markingMat);
        zebra.rotation.x = -Math.PI / 2;
        zebra.position.set(x + xOff, MARKING_Y, z + i * 0.9);
        scene.add(zebra);
      }
    });
  });

  // Helper to create an East-West road segment between two X coordinates
  const createEWSegment = (xStart: number, xEnd: number, z: number) => {
    const segLen = xEnd - xStart;
    if (segLen <= 0.1) return;
    const centerX = (xStart + xEnd) / 2;

    const seg = new THREE.Mesh(new THREE.PlaneGeometry(segLen + 0.04, ROAD_W), roadMat);
    seg.rotation.x = -Math.PI / 2;
    seg.position.set(centerX, ROAD_Y, z);
    seg.receiveShadow = true;
    scene.add(seg);

    // Directional dashed markings along X axis
    const dashLength = 2.0;
    const dashGap = 2.5;
    const markStart = xStart + 2.0;
    const markEnd = xEnd - 2.0;

    for (let dx = markStart; dx + dashLength <= markEnd; dx += dashLength + dashGap) {
      const mark = new THREE.Mesh(new THREE.PlaneGeometry(dashLength, 0.28), markingMat);
      mark.rotation.x = -Math.PI / 2;
      mark.position.set(dx + dashLength / 2, MARKING_Y, z);
      scene.add(mark);
    }
  };

  // Helper to create a North-South road segment between two Z coordinates
  const createNSSegment = (zStart: number, zEnd: number, x: number) => {
    const segLen = zEnd - zStart;
    if (segLen <= 0.1) return;
    const centerZ = (zStart + zEnd) / 2;

    const seg = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W, segLen + 0.04), roadMat);
    seg.rotation.x = -Math.PI / 2;
    seg.position.set(x, ROAD_Y, centerZ);
    seg.receiveShadow = true;
    scene.add(seg);

    // Directional dashed markings along Z axis
    const dashLength = 2.0;
    const dashGap = 2.5;
    const markStart = zStart + 2.0;
    const markEnd = zEnd - 2.0;

    for (let dz = markStart; dz + dashLength <= markEnd; dz += dashLength + dashGap) {
      const mark = new THREE.Mesh(new THREE.PlaneGeometry(0.28, dashLength), markingMat);
      mark.rotation.x = -Math.PI / 2;
      mark.position.set(x, MARKING_Y, dz + dashLength / 2);
      scene.add(mark);
    }
  };

  // B. East-West Road Segments along Avenues
  [-42, -12, 20].forEach((z) => {
    // Outer West
    createEWSegment(-72, NS_STREETS[0] - HALF_W, z);
    // Between consecutive streets
    for (let i = 0; i < NS_STREETS.length - 1; i++) {
      createEWSegment(NS_STREETS[i] + HALF_W, NS_STREETS[i + 1] - HALF_W, z);
    }
    // Outer East
    createEWSegment(NS_STREETS[NS_STREETS.length - 1] + HALF_W, 72, z);
  });

  // South Parkway Avenue (z = 52)
  createEWSegment(-72, -48 - HALF_W, 52);
  createEWSegment(-48 + HALF_W, 2 - HALF_W, 52);
  createEWSegment(2 + HALF_W, 52 - HALF_W, 52);
  createEWSegment(52 + HALF_W, 72, 52);

  // C. North-South Road Segments along Streets
  // Full-length streets (-48, 2, 52) that run from north to south borders
  [-48, 2, 52].forEach((x) => {
    // North outer
    createNSSegment(-62, -42 - HALF_W, x);
    // Row 1
    createNSSegment(-42 + HALF_W, -12 - HALF_W, x);
    // Row 2
    createNSSegment(-12 + HALF_W, 20 - HALF_W, x);
    // Row 3
    createNSSegment(20 + HALF_W, 52 - HALF_W, x);
    // South outer
    createNSSegment(52 + HALF_W, 62, x);
  });

  // Mid-sector streets (-24, 28) serving northern and middle districts and teeing into Avenue 20
  [-24, 28].forEach((x) => {
    // North outer
    createNSSegment(-62, -42 - HALF_W, x);
    // Row 1
    createNSSegment(-42 + HALF_W, -12 - HALF_W, x);
    // Row 2
    createNSSegment(-12 + HALF_W, 20 - HALF_W, x);
  });
}

function buildClouds(): THREE.Group {
  const group = new THREE.Group();
  const cloudMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.9,
    metalness: 0.0,
    transparent: true,
    opacity: 0.85,
  });

  const puffGeo = new THREE.DodecahedronGeometry(2.5, 1);

  const cloudConfigs = [
    { x: -50, y: 35, z: -40 },
    { x: 30, y: 40, z: -45 },
    { x: -35, y: 38, z: 20 },
    { x: 45, y: 36, z: 30 },
    { x: 5, y: 42, z: -10 },
  ];

  cloudConfigs.forEach((cfg) => {
    const cloud = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const puff = new THREE.Mesh(puffGeo, cloudMat);
      puff.position.set(
        (i - 2) * 2.2 + (Math.random() - 0.5) * 1,
        (Math.random() - 0.5) * 1.2,
        (Math.random() - 0.5) * 1.5
      );
      const s = 0.8 + Math.random() * 0.5;
      puff.scale.set(s, s * 0.7, s);
      cloud.add(puff);
    }
    cloud.position.set(cfg.x, cfg.y, cfg.z);
    group.add(cloud);
  });

  return group;
}

function initMovingVehicles(
  scene: THREE.Scene,
  list: { mesh: THREE.Object3D; speed: number; axis: 'x' | 'z'; min: number; max: number; dir: number }[]
) {
  const carColors = [0xef4444, 0x3b82f6, 0xf59e0b, 0x10b981, 0x8b5cf6, 0x06b6d4];

  // East-West traveling cars along genuine avenues (z = -42, -12, 20, 52)
  const ewAvenues = [-42, -12, 20, 52];
  ewAvenues.forEach((zRoad, idx) => {
    for (let c = 0; c < 2; c++) {
      const car = createCarModel(carColors[(idx * 2 + c) % carColors.length]);
      const dir = c === 0 ? 1 : -1;
      const laneOffset = dir > 0 ? 1.5 : -1.5;
      // Positioned at ROAD_Y so wheels touch the asphalt surface with zero floating or sinking
      car.position.set(-60 + c * 60, ROAD_Y, zRoad + laneOffset);
      if (dir < 0) car.rotation.y = Math.PI;
      scene.add(car);

      list.push({
        mesh: car,
        speed: 10 + Math.random() * 5,
        axis: 'x',
        min: -70,
        max: 70,
        dir,
      });
    }
  });

  // North-South traveling cars:
  // Grand Central Boulevard (x = 2) travels full length (-56 to 56)
  [-1, 1].forEach((dir, i) => {
    const car = createCarModel(carColors[(i + 1) % carColors.length]);
    const laneOffset = dir > 0 ? 1.5 : -1.5;
    car.position.set(2 + laneOffset, ROAD_Y, -30 + i * 40);
    car.rotation.y = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    scene.add(car);
    list.push({
      mesh: car,
      speed: 10,
      axis: 'z',
      min: -56,
      max: 56,
      dir,
    });
  });

  // Cross streets (x = -24, 28) serving northern/middle blocks (-50 to 18)
  [-24, 28].forEach((xRoad, idx) => {
    const car = createCarModel(carColors[(idx + 4) % carColors.length]);
    const dir = idx % 2 === 0 ? 1 : -1;
    const laneOffset = dir > 0 ? 1.5 : -1.5;
    car.position.set(xRoad + laneOffset, ROAD_Y, -35 + idx * 30);
    car.rotation.y = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    scene.add(car);

    list.push({
      mesh: car,
      speed: 9 + Math.random() * 4,
      axis: 'z',
      min: -50,
      max: 18,
      dir,
    });
  });
}

function createCarModel(colorHex: number): THREE.Group {
  const car = new THREE.Group();

  // Car chassis
  const bodyGeo = new THREE.BoxGeometry(3.2, 0.9, 1.8);
  const bodyMat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.4, metalness: 0.3 });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 0.55;
  body.castShadow = true;
  body.receiveShadow = true;
  car.add(body);

  // Cabin
  const cabinGeo = new THREE.BoxGeometry(1.9, 0.75, 1.5);
  const cabinMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.2 });
  const cabin = new THREE.Mesh(cabinGeo, cabinMat);
  cabin.position.set(-0.2, 1.25, 0);
  cabin.castShadow = true;
  car.add(cabin);

  // Wheels
  const wheelGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.4, 12);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.9 });
  wheelGeo.rotateX(Math.PI / 2);

  const wheelPositions = [
    [-1.0, 0.35, -0.9],
    [1.0, 0.35, -0.9],
    [-1.0, 0.35, 0.9],
    [1.0, 0.35, 0.9],
  ];

  wheelPositions.forEach(([wx, wy, wz]) => {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.position.set(wx, wy, wz);
    car.add(wheel);
  });

  // Headlights
  const lightGeo = new THREE.BoxGeometry(0.1, 0.2, 0.3);
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });
  const leftHeadlight = new THREE.Mesh(lightGeo, lightMat);
  leftHeadlight.position.set(1.6, 0.6, -0.6);
  const rightHeadlight = new THREE.Mesh(lightGeo, lightMat);
  rightHeadlight.position.set(1.6, 0.6, 0.6);
  car.add(leftHeadlight);
  car.add(rightHeadlight);

  return car;
}

function buildAirplane(): THREE.Group {
  const plane = new THREE.Group();
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
  const blueMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.4 });

  // Fuselage
  const fuselageGeo = new THREE.CylinderGeometry(0.7, 0.7, 7, 16);
  fuselageGeo.rotateZ(Math.PI / 2);
  const fuselage = new THREE.Mesh(fuselageGeo, whiteMat);
  fuselage.castShadow = true;
  plane.add(fuselage);

  // Nose cone
  const noseGeo = new THREE.ConeGeometry(0.7, 1.5, 16);
  noseGeo.rotateZ(-Math.PI / 2);
  const nose = new THREE.Mesh(noseGeo, blueMat);
  nose.position.x = 4.2;
  plane.add(nose);

  // Wings
  const wingGeo = new THREE.BoxGeometry(2.5, 0.15, 8.5);
  const wings = new THREE.Mesh(wingGeo, whiteMat);
  wings.position.set(0.5, 0, 0);
  wings.castShadow = true;
  plane.add(wings);

  // Tail fin
  const tailGeo = new THREE.BoxGeometry(1.2, 1.6, 0.2);
  const tail = new THREE.Mesh(tailGeo, blueMat);
  tail.position.set(-3.2, 1.0, 0);
  plane.add(tail);

  // Jet engines under wings
  const engineGeo = new THREE.CylinderGeometry(0.35, 0.35, 1.4, 12);
  engineGeo.rotateZ(Math.PI / 2);
  [-2.2, 2.2].forEach((zOff) => {
    const engine = new THREE.Mesh(engineGeo, blueMat);
    engine.position.set(0.4, -0.5, zOff);
    plane.add(engine);
  });

  plane.scale.set(0.9, 0.9, 0.9);
  return plane;
}

// ==========================================
// BUILD ALL 10 ZONE GROUPS
// ==========================================

function buildAllZones(
  scene: THREE.Scene,
  locationGroups: Map<number, THREE.Group>,
  lockedMarkers: Map<number, THREE.Group>
) {
  // Dimension and offset configurations for each city block plot to sit within streets without overlapping
  const ZONE_PLOTS: Record<number, { width: number; depth: number; offsetX: number; offsetZ: number; color: number }> = {
    1: { width: 16.2, depth: 21.6, offsetX: 0, offsetZ: 0, color: 0x334155 },
    2: { width: 17.6, depth: 21.6, offsetX: 0, offsetZ: 0, color: 0x334155 },
    3: { width: 17.6, depth: 21.6, offsetX: 0, offsetZ: 0, color: 0x334155 },
    4: { width: 16.2, depth: 21.6, offsetX: 0, offsetZ: 0, color: 0x334155 },
    5: { width: 16.2, depth: 23.6, offsetX: 0, offsetZ: 0, color: 0x15803d }, // Central Park verdant grass turf
    6: { width: 17.6, depth: 23.6, offsetX: 0, offsetZ: 0, color: 0x334155 },
    7: { width: 17.6, depth: 23.6, offsetX: 0, offsetZ: 0, color: 0x334155 },
    8: { width: 16.2, depth: 23.6, offsetX: 0, offsetZ: 0, color: 0x334155 },
    9: { width: 40.0, depth: 23.6, offsetX: -3.0, offsetZ: 0, color: 0x1e293b }, // Skyway airport asphalt tarmac
    10: { width: 40.0, depth: 23.6, offsetX: 5.0, offsetZ: 0, color: 0x0f172a }, // Smart city cyber plaza
  };

  CITY_LOCATIONS.forEach((loc) => {
    const group = new THREE.Group();
    group.position.set(loc.position3D[0], loc.position3D[1], loc.position3D[2]);
    group.userData = { locationId: loc.id, locationName: loc.name };

    // Zone ground plot curb platform:
    // Placed at CURB_Y (0.025) with thickness 0.05 -> sits directly on ground (0.0), top is at SURFACE_Y (0.05).
    // Rises just 0.025m above the asphalt roads, forming a neat sidewalk curb without overlapping roads.
    const cfg = ZONE_PLOTS[loc.id] ?? { width: 16.0, depth: 20.0, offsetX: 0, offsetZ: 0, color: 0x334155 };
    const plotGeo = new THREE.BoxGeometry(cfg.width, 0.05, cfg.depth);
    const plotMat = new THREE.MeshStandardMaterial({
      color: cfg.color,
      roughness: 0.85,
    });
    const plot = new THREE.Mesh(plotGeo, plotMat);
    plot.position.set(cfg.offsetX, CURB_Y, cfg.offsetZ);
    plot.receiveShadow = true;
    group.add(plot);

    // Build specific structures for each zone
    switch (loc.id) {
      case 1:
        buildResidentialArea(group);
        break;
      case 2:
        buildSchoolZone(group);
        break;
      case 3:
        buildHospitalZone(group);
        break;
      case 4:
        buildShoppingDistrict(group);
        break;
      case 5:
        buildCentralPark(group);
        break;
      case 6:
        buildPoliceStation(group);
        break;
      case 7:
        buildFireStation(group);
        break;
      case 8:
        buildSportsStadium(group);
        break;
      case 9:
        buildAirport(group);
        break;
      case 10:
        buildSmartCityCenter(group);
        break;
    }

    scene.add(group);
    locationGroups.set(loc.id, group);

    // Build locked marker for this zone
    const markerGroup = buildLockedMarker(loc);
    scene.add(markerGroup);
    lockedMarkers.set(loc.id, markerGroup);
  });
}

function buildLockedMarker(loc: (typeof CITY_LOCATIONS)[0]): THREE.Group {
  const group = new THREE.Group();
  group.position.set(loc.position3D[0], 1.5, loc.position3D[2]);
  group.userData = { locationId: loc.id };

  // Floating Lock Base Cylinder
  const cylGeo = new THREE.CylinderGeometry(2.5, 2.8, 0.5, 24);
  const cylMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    roughness: 0.5,
    metalness: 0.5,
    transparent: true,
    opacity: 0.9,
  });
  const cyl = new THREE.Mesh(cylGeo, cylMat);
  group.add(cyl);

  // Golden Padlock Icon Body
  const lockBodyGeo = new THREE.BoxGeometry(2.2, 2.0, 1.2);
  const lockBodyMat = new THREE.MeshStandardMaterial({
    color: 0xf59e0b,
    roughness: 0.3,
    metalness: 0.8,
  });
  const lockBody = new THREE.Mesh(lockBodyGeo, lockBodyMat);
  lockBody.position.y = 1.6;
  lockBody.castShadow = true;
  group.add(lockBody);

  // Padlock Shackle
  const torusGeo = new THREE.TorusGeometry(0.8, 0.22, 12, 24, Math.PI);
  const shackleMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    roughness: 0.2,
    metalness: 0.9,
  });
  const shackle = new THREE.Mesh(torusGeo, shackleMat);
  shackle.position.set(0, 2.5, 0);
  group.add(shackle);

  // Keyhole
  const keyholeGeo = new THREE.CylinderGeometry(0.2, 0.2, 1.3, 12);
  keyholeGeo.rotateX(Math.PI / 2);
  const keyholeMat = new THREE.MeshBasicMaterial({ color: 0x1e293b });
  const keyhole = new THREE.Mesh(keyholeGeo, keyholeMat);
  keyhole.position.set(0, 1.6, 0);
  group.add(keyhole);

  return group;
}

// ----------------------------------------------------
// ZONE 1: RESIDENTIAL AREA
// ----------------------------------------------------
function buildResidentialArea(group: THREE.Group) {
  // 4 Charming Houses sitting flush on SURFACE_Y
  const houseColors = [0xfbcfe8, 0xbbf7d0, 0xfef08a, 0xbfdbfe];
  const houseOffsets = [
    [-4.5, -4.5],
    [4.5, -4.5],
    [-4.5, 4.5],
    [4.5, 4.5],
  ];

  houseOffsets.forEach(([hx, hz], idx) => {
    const house = new THREE.Group();
    house.position.set(hx, SURFACE_Y, hz);

    // Walls
    const wallGeo = new THREE.BoxGeometry(4.2, 3.2, 4.2);
    const wallMat = new THREE.MeshStandardMaterial({
      color: houseColors[idx],
      roughness: 0.7,
    });
    const walls = new THREE.Mesh(wallGeo, wallMat);
    walls.position.y = 1.6;
    walls.castShadow = true;
    walls.receiveShadow = true;
    house.add(walls);

    // Pitched Roof
    const roofGeo = new THREE.ConeGeometry(3.6, 2.0, 4);
    roofGeo.rotateY(Math.PI / 4);
    const roofMat = new THREE.MeshStandardMaterial({
      color: 0xb91c1c, // terracotta red
      roughness: 0.6,
    });
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.y = 4.2;
    roof.castShadow = true;
    house.add(roof);

    // Chimney
    const chimGeo = new THREE.BoxGeometry(0.6, 1.4, 0.6);
    const chimMat = new THREE.MeshStandardMaterial({ color: 0x78716c });
    const chim = new THREE.Mesh(chimGeo, chimMat);
    chim.position.set(1.1, 4.2, 0.8);
    house.add(chim);

    // Front door
    const doorGeo = new THREE.PlaneGeometry(0.9, 1.8);
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x78350f });
    const door = new THREE.Mesh(doorGeo, doorMat);
    door.position.set(0, 0.9, 2.12);
    house.add(door);

    group.add(house);
  });

  // Trees and streetlights sitting on the surface
  const treePositions = [
    [-6.5, 0],
    [6.5, 0],
    [0, -7.5],
    [0, 7.5],
    [-6.5, -7.0],
    [6.5, 7.0],
  ];
  treePositions.forEach(([tx, tz]) => {
    group.add(createTree(tx, tz));
  });

  // Streetlights
  [
    [-6.0, -5.5],
    [6.0, 5.5],
  ].forEach(([sx, sz]) => {
    group.add(createStreetLight(sx, sz));
  });
}

// ----------------------------------------------------
// ZONE 2: SCHOOL ZONE
// ----------------------------------------------------
function buildSchoolZone(group: THREE.Group) {
  // Main School Building standing flush on SURFACE_Y
  const school = new THREE.Group();
  school.position.set(0, SURFACE_Y, -2.5);

  const mainGeo = new THREE.BoxGeometry(11, 4.5, 6.5);
  const mainMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.5 });
  const mainBldg = new THREE.Mesh(mainGeo, mainMat);
  mainBldg.position.y = 2.25;
  mainBldg.castShadow = true;
  mainBldg.receiveShadow = true;
  school.add(mainBldg);

  // Clock tower
  const towerGeo = new THREE.BoxGeometry(3, 7.5, 3);
  const towerMat = new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.4 });
  const tower = new THREE.Mesh(towerGeo, towerMat);
  tower.position.set(0, 5.0, 0);
  tower.castShadow = true;
  school.add(tower);

  // Clock face
  const clockGeo = new THREE.CylinderGeometry(0.8, 0.8, 0.1, 24);
  clockGeo.rotateX(Math.PI / 2);
  const clockMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const clock = new THREE.Mesh(clockGeo, clockMat);
  clock.position.set(0, 7.0, 1.55);
  school.add(clock);

  // Roof cap
  const capGeo = new THREE.ConeGeometry(2.3, 2.2, 4);
  capGeo.rotateY(Math.PI / 4);
  const capMat = new THREE.MeshStandardMaterial({ color: 0x1d4ed8 });
  const cap = new THREE.Mesh(capGeo, capMat);
  cap.position.set(0, 9.8, 0);
  school.add(cap);

  group.add(school);

  // Playground area (Front)
  // Basketball half-court placed right on SURFACE_Y with tiny 0.003 offset to prevent z-fighting
  const courtGeo = new THREE.PlaneGeometry(6.5, 5);
  const courtMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.6 });
  const court = new THREE.Mesh(courtGeo, courtMat);
  court.rotation.x = -Math.PI / 2;
  court.position.set(4, SURFACE_Y + 0.003, 4.5);
  group.add(court);

  // Playground Slide
  const slidePillar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.12, 2.5, 8),
    new THREE.MeshStandardMaterial({ color: 0xef4444 })
  );
  slidePillar.position.set(-5, SURFACE_Y + 1.25, 4);
  group.add(slidePillar);

  const slideSlope = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 0.1, 3.2),
    new THREE.MeshStandardMaterial({ color: 0xf59e0b })
  );
  slideSlope.rotation.x = -Math.PI / 4;
  slideSlope.position.set(-5, SURFACE_Y + 1.25, 5.2);
  group.add(slideSlope);

  // Yellow School Bus parked on the school bay with grounded wheels
  const bus = new THREE.Group();
  bus.position.set(-1.5, SURFACE_Y, 6);

  const busBody = new THREE.Mesh(
    new THREE.BoxGeometry(5.0, 1.6, 2.0),
    new THREE.MeshStandardMaterial({ color: 0xeab308, roughness: 0.4 })
  );
  busBody.position.y = 1.15;
  busBody.castShadow = true;
  bus.add(busBody);

  // Bus Wheels resting directly on the curb surface
  const wheelGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.4, 12);
  wheelGeo.rotateX(Math.PI / 2);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.9 });
  [
    [-1.5, 0.35, -1.0],
    [1.5, 0.35, -1.0],
    [-1.5, 0.35, 1.0],
    [1.5, 0.35, 1.0],
  ].forEach(([wx, wy, wz]) => {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.position.set(wx, wy, wz);
    bus.add(wheel);
  });

  group.add(bus);

  group.add(createTree(-7, -6));
  group.add(createTree(7, -6));
}

// ----------------------------------------------------
// ZONE 3: HOSPITAL ZONE
// ----------------------------------------------------
function buildHospitalZone(group: THREE.Group) {
  // Multi-wing Hospital Complex
  const hospMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.3 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.1, metalness: 0.7 });

  // Main Central Tower
  const tower = new THREE.Mesh(new THREE.BoxGeometry(8, 9, 7), hospMat);
  tower.position.set(0, SURFACE_Y + 4.5, -1);
  tower.castShadow = true;
  tower.receiveShadow = true;
  group.add(tower);

  // Glass Front Atrium
  const atrium = new THREE.Mesh(new THREE.BoxGeometry(6, 6, 2.5), glassMat);
  atrium.position.set(0, SURFACE_Y + 3.0, 3.2);
  atrium.castShadow = true;
  group.add(atrium);

  // Side Wings
  [-5.8, 5.8].forEach((xOff) => {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(4.2, 5.5, 6), hospMat);
    wing.position.set(xOff, SURFACE_Y + 2.75, -1);
    wing.castShadow = true;
    group.add(wing);
  });

  // Red Cross Emblem
  const crossH = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.7, 0.2), new THREE.MeshBasicMaterial({ color: 0xef4444 }));
  crossH.position.set(0, SURFACE_Y + 7.2, 2.6);
  const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.7, 2.4, 0.2), new THREE.MeshBasicMaterial({ color: 0xef4444 }));
  crossV.position.set(0, SURFACE_Y + 7.2, 2.6);
  group.add(crossH);
  group.add(crossV);

  // Rooftop Helipad
  const heliPad = new THREE.Mesh(
    new THREE.CylinderGeometry(2.5, 2.5, 0.15, 24),
    new THREE.MeshStandardMaterial({ color: 0x334155 })
  );
  heliPad.position.set(0, SURFACE_Y + 9.05, -1);
  group.add(heliPad);

  // Ambulance Parked with wheels grounded
  const amb = new THREE.Group();
  amb.position.set(5.5, SURFACE_Y, 4.5);
  const ambBody = new THREE.Mesh(
    new THREE.BoxGeometry(3.6, 1.5, 1.8),
    new THREE.MeshStandardMaterial({ color: 0xffffff })
  );
  ambBody.position.y = 1.1;
  amb.add(ambBody);

  const ambStripe = new THREE.Mesh(
    new THREE.BoxGeometry(3.65, 0.35, 1.82),
    new THREE.MeshBasicMaterial({ color: 0xef4444 })
  );
  ambStripe.position.y = 1.1;
  amb.add(ambStripe);

  // Wheels
  const wheelGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.35, 12);
  wheelGeo.rotateX(Math.PI / 2);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.9 });
  [
    [-1.1, 0.35, -0.9],
    [1.1, 0.35, -0.9],
    [-1.1, 0.35, 0.9],
    [1.1, 0.35, 0.9],
  ].forEach(([wx, wy, wz]) => {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.position.set(wx, wy, wz);
    amb.add(wheel);
  });

  // Flashing Siren
  const siren = new THREE.Mesh(
    new THREE.CylinderGeometry(0.25, 0.25, 0.3, 12),
    new THREE.MeshBasicMaterial({ color: 0x3b82f6 })
  );
  siren.position.set(0, 2.0, 0);
  amb.add(siren);
  group.add(amb);
}

// ----------------------------------------------------
// ZONE 4: SHOPPING DISTRICT
// ----------------------------------------------------
function buildShoppingDistrict(group: THREE.Group) {
  // Mall Galleria Building
  const mall = new THREE.Mesh(
    new THREE.BoxGeometry(13, 6, 7.5),
    new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.4 })
  );
  mall.position.set(0, SURFACE_Y + 3.0, -2);
  mall.castShadow = true;
  group.add(mall);

  // Skylight Glass Barrel
  const dome = new THREE.Mesh(
    new THREE.CylinderGeometry(2.5, 2.5, 10, 16, 1, false, 0, Math.PI),
    new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.1, transparent: true, opacity: 0.8 })
  );
  dome.rotation.z = Math.PI / 2;
  dome.position.set(0, SURFACE_Y + 6.05, -2);
  group.add(dome);

  // Boutique storefront awnings
  const boutiqueMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.5 });
  [-4.5, 0, 4.5].forEach((bx) => {
    const awning = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.25, 1.5), boutiqueMat);
    awning.position.set(bx, SURFACE_Y + 2.0, 2.4);
    group.add(awning);
  });

  // Outdoor cafe tables with colorful umbrellas grounded on SURFACE_Y
  [
    [-4, 5.0],
    [0, 5.5],
    [4, 5.0],
  ].forEach(([ux, uz], i) => {
    const umbrella = new THREE.Group();
    umbrella.position.set(ux, SURFACE_Y, uz);

    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 2.2, 8),
      new THREE.MeshStandardMaterial({ color: 0x94a3b8 })
    );
    pole.position.y = 1.1;
    umbrella.add(pole);

    const canopy = new THREE.Mesh(
      new THREE.ConeGeometry(1.4, 0.6, 8),
      new THREE.MeshStandardMaterial({ color: i % 2 === 0 ? 0xef4444 : 0x3b82f6 })
    );
    canopy.position.y = 2.1;
    umbrella.add(canopy);

    group.add(umbrella);
  });
}

// ----------------------------------------------------
// ZONE 5: CENTRAL PARK
// ----------------------------------------------------
function buildCentralPark(group: THREE.Group) {
  // Lush Park Turf on top of the curb block
  const parkGrass = new THREE.Mesh(
    new THREE.PlaneGeometry(16.0, 23.2),
    new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.9 })
  );
  parkGrass.rotation.x = -Math.PI / 2;
  parkGrass.position.y = SURFACE_Y + 0.002;
  group.add(parkGrass);

  // Ornamental Fountain in Center
  const fountain = new THREE.Group();
  fountain.position.set(0, SURFACE_Y + 0.002, 0);

  const basin = new THREE.Mesh(
    new THREE.CylinderGeometry(3.2, 3.5, 0.7, 24),
    new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.5 })
  );
  basin.position.y = 0.35;
  fountain.add(basin);

  const waterSurface = new THREE.Mesh(
    new THREE.CylinderGeometry(2.9, 2.9, 0.1, 24),
    new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.1, metalness: 0.6 })
  );
  waterSurface.position.y = 0.65;
  fountain.add(waterSurface);

  // Center tiered pedestal
  const tier = new THREE.Mesh(
    new THREE.CylinderGeometry(1.2, 1.5, 1.2, 16),
    new THREE.MeshStandardMaterial({ color: 0xcbd5e1 })
  );
  tier.position.y = 1.2;
  fountain.add(tier);

  group.add(fountain);

  // Park Gazebo Pavilion
  const gazebo = new THREE.Group();
  gazebo.position.set(-5.0, SURFACE_Y + 0.002, -5.5);
  for (let p = 0; p < 4; p++) {
    const angle = (p * Math.PI) / 2;
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 2.4, 8),
      new THREE.MeshStandardMaterial({ color: 0xffffff })
    );
    pillar.position.set(Math.cos(angle) * 1.5, 1.2, Math.sin(angle) * 1.5);
    gazebo.add(pillar);
  }
  const gazRoof = new THREE.Mesh(
    new THREE.ConeGeometry(2.2, 1.2, 4),
    new THREE.MeshStandardMaterial({ color: 0x047857 })
  );
  gazRoof.rotateY(Math.PI / 4);
  gazRoof.position.y = 2.9;
  gazebo.add(gazRoof);
  group.add(gazebo);

  // Benches and Diverse Trees standing firmly in the park
  const parkTrees = [
    [-5.5, 5],
    [5.5, 5],
    [5, -5],
    [5.5, 0],
    [-5.5, 0],
  ];
  parkTrees.forEach(([px, pz]) => {
    group.add(createTree(px, pz));
  });
}

// ----------------------------------------------------
// ZONE 6: POLICE STATION
// ----------------------------------------------------
function buildPoliceStation(group: THREE.Group) {
  // Police Precinct Building
  const bldgMat = new THREE.MeshStandardMaterial({ color: 0x1e3a8a, roughness: 0.4 });
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.6 });

  const main = new THREE.Mesh(new THREE.BoxGeometry(11, 5, 8), bldgMat);
  main.position.set(0, SURFACE_Y + 2.5, -2);
  main.castShadow = true;
  group.add(main);

  const entrance = new THREE.Mesh(new THREE.BoxGeometry(5, 3.5, 2.5), stoneMat);
  entrance.position.set(0, SURFACE_Y + 1.75, 2.5);
  entrance.castShadow = true;
  group.add(entrance);

  // Radio mast / antenna
  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.15, 6, 8),
    new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.8 })
  );
  mast.position.set(4, SURFACE_Y + 5.5, -2);
  group.add(mast);

  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.25, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xef4444 })
  );
  beacon.position.set(4, SURFACE_Y + 8.5, -2);
  group.add(beacon);

  // Police Cruisers Parked on the precinct grounds
  [-3.5, 3.5].forEach((cx) => {
    const cruiser = createCarModel(0x1e40af);
    cruiser.position.set(cx, SURFACE_Y, 4.8);
    // Lightbar on roof
    const siren = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 0.15, 0.3),
      new THREE.MeshBasicMaterial({ color: 0x3b82f6 })
    );
    siren.position.set(-0.2, 1.75, 0);
    cruiser.add(siren);
    group.add(cruiser);
  });
}

// ----------------------------------------------------
// ZONE 7: FIRE STATION
// ----------------------------------------------------
function buildFireStation(group: THREE.Group) {
  const brickMat = new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.7 });
  const doorMat = new THREE.MeshStandardMaterial({ color: 0x991b1b, roughness: 0.4 });

  // Main Fire Station Hall
  const hall = new THREE.Mesh(new THREE.BoxGeometry(12, 6, 8), brickMat);
  hall.position.set(0, SURFACE_Y + 3.0, -2);
  hall.castShadow = true;
  group.add(hall);

  // 2 Large Red Garage Bays
  [-3, 3].forEach((gx) => {
    const bay = new THREE.Mesh(new THREE.BoxGeometry(4, 4.2, 0.3), doorMat);
    bay.position.set(gx, SURFACE_Y + 2.1, 2.1);
    group.add(bay);
  });

  // Hose Drying Watchtower
  const tower = new THREE.Mesh(new THREE.BoxGeometry(3.5, 9, 3.5), brickMat);
  tower.position.set(5.5, SURFACE_Y + 4.5, -2);
  tower.castShadow = true;
  group.add(tower);

  // Big Fire Engine Truck standing firmly on its wheels
  const fireEngine = new THREE.Group();
  fireEngine.position.set(0, SURFACE_Y, 4.8);

  const engineBody = new THREE.Mesh(
    new THREE.BoxGeometry(5.2, 2.0, 2.2),
    new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.3 })
  );
  engineBody.position.y = 1.45;
  engineBody.castShadow = true;
  fireEngine.add(engineBody);

  // Chrome Ladder on top
  const ladder = new THREE.Mesh(
    new THREE.BoxGeometry(4.5, 0.2, 1.2),
    new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.8, roughness: 0.2 })
  );
  ladder.position.set(0, 2.6, 0);
  fireEngine.add(ladder);

  // 6 Heavy duty wheels touching ground
  const wheelGeo = new THREE.CylinderGeometry(0.45, 0.45, 0.45, 16);
  wheelGeo.rotateX(Math.PI / 2);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.9 });
  [
    [-1.7, 0.45, -1.15],
    [0.0, 0.45, -1.15],
    [1.7, 0.45, -1.15],
    [-1.7, 0.45, 1.15],
    [0.0, 0.45, 1.15],
    [1.7, 0.45, 1.15],
  ].forEach(([wx, wy, wz]) => {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.position.set(wx, wy, wz);
    fireEngine.add(wheel);
  });

  group.add(fireEngine);
}

// ----------------------------------------------------
// ZONE 8: SPORTS STADIUM
// ----------------------------------------------------
function buildSportsStadium(group: THREE.Group) {
  // Stadium Outer Arena Bowl
  const bowlGeo = new THREE.CylinderGeometry(7.5, 6.8, 4.2, 32, 1, true);
  const bowlMat = new THREE.MeshStandardMaterial({ color: 0x7c3aed, roughness: 0.5 });
  const bowl = new THREE.Mesh(bowlGeo, bowlMat);
  bowl.position.set(0, SURFACE_Y + 2.1, 0);
  bowl.castShadow = true;
  group.add(bowl);

  // Stadium Inner Seats
  const seatGeo = new THREE.CylinderGeometry(6.6, 5.0, 3.8, 32, 1, true);
  const seatMat = new THREE.MeshStandardMaterial({ color: 0xc4b5fd, roughness: 0.6 });
  const seats = new THREE.Mesh(seatGeo, seatMat);
  seats.position.set(0, SURFACE_Y + 1.95, 0);
  group.add(seats);

  // Green Championship Soccer Pitch
  const pitchGeo = new THREE.PlaneGeometry(8.5, 5.5);
  const pitchMat = new THREE.MeshStandardMaterial({ color: 0x16a34a, roughness: 0.8 });
  const pitch = new THREE.Mesh(pitchGeo, pitchMat);
  pitch.rotation.x = -Math.PI / 2;
  pitch.position.set(0, SURFACE_Y + 0.005, 0);
  group.add(pitch);

  // 4 Stadium Floodlight Towers
  const lightTowerGeo = new THREE.CylinderGeometry(0.15, 0.2, 7.5, 8);
  const towerMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.7 });
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });

  [
    [-6.5, -6.5],
    [6.5, -6.5],
    [-6.5, 6.5],
    [6.5, 6.5],
  ].forEach(([lx, lz]) => {
    const pole = new THREE.Mesh(lightTowerGeo, towerMat);
    pole.position.set(lx, SURFACE_Y + 3.75, lz);
    group.add(pole);

    const cluster = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.6, 0.6), bulbMat);
    cluster.position.set(lx, SURFACE_Y + 7.55, lz);
    group.add(cluster);
  });
}

// ----------------------------------------------------
// ZONE 9: AIRPORT
// ----------------------------------------------------
function buildAirport(group: THREE.Group) {
  // Terminal Concourse
  const terminal = new THREE.Mesh(
    new THREE.BoxGeometry(16, 3.5, 6),
    new THREE.MeshStandardMaterial({ color: 0xe0f2fe, roughness: 0.3 })
  );
  terminal.position.set(-3, SURFACE_Y + 1.75, -4.5);
  terminal.castShadow = true;
  group.add(terminal);

  // Control Tower
  const towerPole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.8, 1.2, 8.5, 16),
    new THREE.MeshStandardMaterial({ color: 0x64748b })
  );
  towerPole.position.set(-9, SURFACE_Y + 4.25, -4.5);
  group.add(towerPole);

  const cab = new THREE.Mesh(
    new THREE.CylinderGeometry(1.9, 1.4, 2.0, 16),
    new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.1, metalness: 0.7 })
  );
  cab.position.set(-9, SURFACE_Y + 9.0, -4.5);
  group.add(cab);

  // Long Runway Surface - positioned on tarmac with tiny offset to prevent z-fighting
  const runwayGeo = new THREE.PlaneGeometry(34, 5.5);
  const runwayMat = new THREE.MeshStandardMaterial({
    color: 0x111827,
    roughness: 0.85,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const runway = new THREE.Mesh(runwayGeo, runwayMat);
  runway.rotation.x = -Math.PI / 2;
  runway.position.set(-3, SURFACE_Y + 0.004, 3.5);
  group.add(runway);

  // Runway Center Line Markings
  for (let rx = -16; rx <= 10; rx += 2.5) {
    const dash = new THREE.Mesh(
      new THREE.PlaneGeometry(1.4, 0.25),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    dash.rotation.x = -Math.PI / 2;
    dash.position.set(rx, SURFACE_Y + 0.008, 3.5);
    group.add(dash);
  }

  // Parked Passenger Jet on Apron with grounded landing gear
  const jet = new THREE.Group();
  jet.position.set(6.0, SURFACE_Y, -2.0);
  jet.rotation.y = -Math.PI / 6;

  const airplaneModel = buildAirplane();
  airplaneModel.scale.set(0.65, 0.65, 0.65);
  airplaneModel.position.y = 0.9;
  jet.add(airplaneModel);

  // Landing gear reaching down to the tarmac
  const strutMat = new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.8 });
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.9 });
  const wheelGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.2, 12);
  wheelGeo.rotateX(Math.PI / 2);

  // Nose gear and two main wing gears
  [
    [2.3, 0.45, 0],
    [-0.3, 0.45, -1.2],
    [-0.3, 0.45, 1.2],
  ].forEach(([gx, gy, gz]) => {
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.9, 8), strutMat);
    strut.position.set(gx, gy, gz);
    jet.add(strut);

    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.position.set(gx, 0.2, gz);
    jet.add(wheel);
  });

  group.add(jet);
}

// ----------------------------------------------------
// ZONE 10: SMART CITY CENTER
// ----------------------------------------------------
function buildSmartCityCenter(group: THREE.Group) {
  // Majestic Futuristic Mega Skyscrapers
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x0284c7,
    roughness: 0.1,
    metalness: 0.85,
  });
  const edgeMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });

  // Central Spire Tower standing on SURFACE_Y
  const mainTower = new THREE.Mesh(new THREE.BoxGeometry(5.5, 16, 5.5), glassMat);
  mainTower.position.set(5, SURFACE_Y + 8.0, -2);
  mainTower.castShadow = true;
  group.add(mainTower);

  const spire = new THREE.Mesh(
    new THREE.ConeGeometry(0.4, 4.5, 8),
    new THREE.MeshStandardMaterial({ color: 0xec4899, metalness: 0.9 })
  );
  spire.position.set(5, SURFACE_Y + 18.0, -2);
  group.add(spire);

  // Twin Flanking Skyscrapers
  [-5, 5].forEach((tx, idx) => {
    const h = idx === 0 ? 12 : 14;
    const tower = new THREE.Mesh(new THREE.BoxGeometry(4.2, h, 4.2), glassMat);
    tower.position.set(5 + tx, SURFACE_Y + h / 2, -2);
    tower.castShadow = true;
    group.add(tower);

    // Glowing roof cap
    const cap = new THREE.Mesh(new THREE.BoxGeometry(4.3, 0.6, 4.3), edgeMat);
    cap.position.set(5 + tx, SURFACE_Y + h + 0.3, -2);
    group.add(cap);
  });

  // Central Hologram Globe Monument
  const globePlaza = new THREE.Mesh(
    new THREE.CylinderGeometry(3.5, 3.8, 0.5, 24),
    new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.3 })
  );
  globePlaza.position.set(5, SURFACE_Y + 0.25, 4.5);
  group.add(globePlaza);

  const hologramSphere = new THREE.Mesh(
    new THREE.SphereGeometry(1.6, 24, 24),
    new THREE.MeshStandardMaterial({
      color: 0x06b6d4,
      roughness: 0.1,
      metalness: 0.9,
      wireframe: true,
    })
  );
  hologramSphere.position.set(5, SURFACE_Y + 2.25, 4.5);
  group.add(hologramSphere);

  // Futuristic Solar Energy Trees
  [-5.5, 5.5].forEach((sx) => {
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.15, 0.25, 3.0, 8),
      new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.6 })
    );
    trunk.position.set(5 + sx, SURFACE_Y + 1.5, 5.0);
    group.add(trunk);

    const solarHex = new THREE.Mesh(
      new THREE.CylinderGeometry(1.4, 1.4, 0.15, 6),
      new THREE.MeshStandardMaterial({ color: 0x3b82f6, metalness: 0.8, roughness: 0.2 })
    );
    solarHex.rotation.x = Math.PI / 6;
    solarHex.position.set(5 + sx, SURFACE_Y + 3.05, 5.0);
    group.add(solarHex);
  });
}

// ----------------------------------------------------
// SHARED 3D HELPERS
// ----------------------------------------------------
function createTree(x: number, z: number): THREE.Group {
  const tree = new THREE.Group();
  tree.position.set(x, SURFACE_Y, z);

  const trunkGeo = new THREE.CylinderGeometry(0.2, 0.3, 1.4, 8);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.9 });
  const trunk = new THREE.Mesh(trunkGeo, trunkMat);
  trunk.position.y = 0.7;
  trunk.castShadow = true;
  tree.add(trunk);

  const foliageGeo = new THREE.DodecahedronGeometry(1.2, 1);
  const foliageMat = new THREE.MeshStandardMaterial({ color: 0x16a34a, roughness: 0.7 });
  const foliage = new THREE.Mesh(foliageGeo, foliageMat);
  foliage.position.y = 2.0;
  foliage.castShadow = true;
  tree.add(foliage);

  return tree;
}

function createStreetLight(x: number, z: number): THREE.Group {
  const light = new THREE.Group();
  light.position.set(x, SURFACE_Y, z);

  const poleGeo = new THREE.CylinderGeometry(0.08, 0.1, 3.2, 8);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.7 });
  const pole = new THREE.Mesh(poleGeo, poleMat);
  pole.position.y = 1.6;
  light.add(pole);

  const headGeo = new THREE.BoxGeometry(0.4, 0.2, 0.7);
  const head = new THREE.Mesh(headGeo, poleMat);
  head.position.set(0, 3.2, 0.2);
  light.add(head);

  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), new THREE.MeshBasicMaterial({ color: 0xfef08a }));
  bulb.position.set(0, 3.05, 0.4);
  light.add(bulb);

  return light;
}
