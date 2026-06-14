import { useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  OrbitControls,
  useTexture,
  shaderMaterial,
  Html,
  Line,
} from "@react-three/drei";
import { extend } from "@react-three/fiber";
import * as THREE from "three";
import type { Trails, Position, TrailPoint } from "./App";

const DEFAULT_SUN_DIR = new THREE.Vector3(1, 0.05, 0).normalize();

const EARTH_RADIUS_KM = 6371;
// Convert real altitude to Three.js scene units (Earth = radius 1)
function altToRadius(elevation_km: number) {
  return (EARTH_RADIUS_KM + elevation_km) / EARTH_RADIUS_KM;
}

const MOON_ORBIT_RADIUS = 10;
const MOON_RADIUS = 0.35;
const MOON_PERIOD_MINUTES = 27.3 * 24 * 60;
const SUN_DIST = 200;
const SUN_RADIUS = 2.5;
const EARTH_ROT_PER_MIN = (2 * Math.PI) / (24 * 60);

// ─── Ground Track ───────────────────────────────────────────────────────────
function GroundTrack({ trail, earthRotY }: { trail: TrailPoint[]; earthRotY: number }) {
  const points = useMemo(() => {
    if (trail.length < 2) return [];
    const raw = trail.map(
      (p) => new THREE.Vector3(...latLonToXYZ(p.latitude, p.longitude, 1.015, earthRotY)),
    );
    const result: THREE.Vector3[] = [];
    for (let i = 0; i < raw.length - 1; i++) {
      const a = raw[i].clone().normalize();
      const b = raw[i + 1].clone().normalize();
      for (let t = 0; t < 6; t++) {
        result.push(a.clone().lerp(b, t / 6).normalize().multiplyScalar(1.015));
      }
    }
    result.push(raw[raw.length - 1]);
    return result;
  }, [trail, earthRotY]);

  if (points.length < 2) return null;
  return (
    <Line points={points} color="#44ff88" lineWidth={1} transparent opacity={0.45} />
  );
}

// ─── Stars ────────────────────────────────────────────────────────────────────
function StarField() {
  const ref = useRef<THREE.Points>(null);
  const { camera } = useThree();

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const pos: number[] = [];
    for (let i = 0; i < 18000; i++) {
      const theta = Math.random() * 2 * Math.PI;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 800 + Math.random() * 100;
      pos.push(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.sin(phi) * Math.sin(theta),
        r * Math.cos(phi),
      );
    }
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    return geo;
  }, []);

  useFrame(() => {
    if (ref.current) ref.current.position.copy(camera.position);
  });

  return (
    <points ref={ref} geometry={geometry}>
      <pointsMaterial
        size={1.2}
        sizeAttenuation={false}
        color="#ffffff"
        depthWrite={false}
        transparent
        opacity={0.85}
      />
    </points>
  );
}

// ─── Earth ───────────────────────────────────────────────────────────────────
const EarthMaterial = shaderMaterial(
  {
    dayTexture: null as THREE.Texture | null,
    nightTexture: null as THREE.Texture | null,
    sunDirection: DEFAULT_SUN_DIR,
  },
  `
    varying vec2 vUv;
    varying vec3 vWorldNormal;
    void main() {
      vUv = uv;
      vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  `
    uniform sampler2D dayTexture;
    uniform sampler2D nightTexture;
    uniform vec3 sunDirection;
    varying vec2 vUv;
    varying vec3 vWorldNormal;
    void main() {
      float intensity = dot(vWorldNormal, normalize(sunDirection));
      float blend = smoothstep(-0.15, 0.15, intensity);
      vec4 day = texture2D(dayTexture, vUv);
      vec4 night = texture2D(nightTexture, vUv);
      gl_FragColor = mix(night, day, blend);
    }
  `,
);

extend({ EarthMaterial });

declare module "@react-three/fiber" {
  interface ThreeElements {
    earthMaterial: {
      ref?: React.Ref<unknown>;
      dayTexture?: THREE.Texture | null;
      nightTexture?: THREE.Texture | null;
      sunDirection?: THREE.Vector3;
    };
  }
}

function Earth({
  minutesOffset,
  onFocus,
  sunDirection,
}: {
  minutesOffset: number;
  onFocus: (pos: THREE.Vector3, pullback?: number) => void;
  sunDirection: THREE.Vector3;
}) {
  const earthRef = useRef<THREE.Mesh>(null);
  const dayTexture = useTexture("/earth_day_8k.jpg");
  const nightTexture = useTexture("/earth_night.png");

  useFrame(() => {
    if (earthRef.current) {
      earthRef.current.rotation.y = minutesOffset * EARTH_ROT_PER_MIN;
    }
  });

  return (
    <mesh
      ref={earthRef}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onFocus(new THREE.Vector3(0, 0, 0), 3);
      }}
    >
      <sphereGeometry args={[1, 128, 128]} />
      <earthMaterial
        dayTexture={dayTexture}
        nightTexture={nightTexture}
        sunDirection={sunDirection}
      />
    </mesh>
  );
}

// ─── Sun ─────────────────────────────────────────────────────────────────────
function Sun({ direction }: { direction: THREE.Vector3 }) {
  const pos: [number, number, number] = [
    direction.x * SUN_DIST,
    direction.y * SUN_DIST,
    direction.z * SUN_DIST,
  ];
  return (
    <group position={pos}>
      <mesh>
        <sphereGeometry args={[SUN_RADIUS, 32, 32]} />
        <meshStandardMaterial
          color="#ffffff"
          emissive="#fff5c0"
          emissiveIntensity={8}
          toneMapped={false}
        />
      </mesh>
      <mesh>
        <sphereGeometry args={[SUN_RADIUS * 1.6, 32, 32]} />
        <meshStandardMaterial
          color="#ffdd80"
          emissive="#ffcc00"
          emissiveIntensity={2}
          toneMapped={false}
          transparent
          opacity={0.15}
          side={THREE.BackSide}
        />
      </mesh>
      <pointLight color="#fff8e0" intensity={4} distance={800} decay={1} />
    </group>
  );
}

// ─── Moon ────────────────────────────────────────────────────────────────────
function moonAngle(minutesOffset: number) {
  return (minutesOffset / MOON_PERIOD_MINUTES) * 2 * Math.PI + 0.8;
}

function moonXYZ(angle: number): THREE.Vector3 {
  return new THREE.Vector3(
    Math.cos(angle) * MOON_ORBIT_RADIUS,
    0.5,
    Math.sin(angle) * MOON_ORBIT_RADIUS,
  );
}

function MoonTrail({ minutesOffset }: { minutesOffset: number }) {
  const points = useMemo(() => {
    const steps = 80;
    const trailMinutes = MOON_PERIOD_MINUTES / 6;
    return Array.from({ length: steps + 1 }, (_, i) => {
      const t = minutesOffset - trailMinutes * (1 - i / steps);
      return moonXYZ(moonAngle(t));
    });
  }, [minutesOffset]);

  return (
    <Line
      points={points}
      color="#888888"
      lineWidth={0.8}
      transparent
      opacity={0.3}
    />
  );
}

function Moon({
  minutesOffset,
  onFocus,
  overridePos,
}: {
  minutesOffset: number;
  onFocus: (pos: THREE.Vector3, pullback?: number) => void;
  overridePos: THREE.Vector3 | null;
}) {
  const moonRef = useRef<THREE.Group>(null);
  const texture = useTexture("/moon.jpg");
  const posRef = useRef(new THREE.Vector3());

  useFrame(() => {
    if (!moonRef.current) return;
    const pos = overridePos ?? moonXYZ(moonAngle(minutesOffset));
    posRef.current.copy(pos);
    moonRef.current.position.copy(pos);
    moonRef.current.rotation.y = -moonAngle(minutesOffset);
  });

  return (
    <group ref={moonRef}>
      <mesh
        onDoubleClick={(e) => {
          e.stopPropagation();
          onFocus(posRef.current.clone(), MOON_RADIUS + 1);
        }}
      >
        <sphereGeometry args={[MOON_RADIUS, 64, 64]} />
        <meshStandardMaterial map={texture} roughness={1} metalness={0} />
      </mesh>
    </group>
  );
}

// ─── Satellites ───────────────────────────────────────────────────────────────
function latLonToXYZ(
  lat: number,
  lon: number,
  radius: number,
  earthRotY = 0,
): [number, number, number] {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  const x = -radius * Math.sin(phi) * Math.cos(theta);
  const y = radius * Math.cos(phi);
  const z = radius * Math.sin(phi) * Math.sin(theta);
  if (earthRotY === 0) return [x, y, z];
  const cosA = Math.cos(earthRotY);
  const sinA = Math.sin(earthRotY);
  return [x * cosA + z * sinA, y, -x * sinA + z * cosA];
}

function SatelliteTrail({ trail }: { trail: TrailPoint[] }) {
  const points = useMemo(() => {
    if (trail.length < 2) return [];
    const raw = trail.map((p) => {
      const rotY = p.capturedOffset * EARTH_ROT_PER_MIN;
      const r = altToRadius(p.elevation_km);
      return new THREE.Vector3(...latLonToXYZ(p.latitude, p.longitude, r, rotY));
    });
    const result: THREE.Vector3[] = [];
    for (let i = 0; i < raw.length - 1; i++) {
      for (let t = 0; t < 6; t++) {
        result.push(raw[i].clone().lerp(raw[i + 1], t / 6));
      }
    }
    result.push(raw[raw.length - 1]);
    return result;
  }, [trail]);

  if (points.length < 2) return null;
  return (
    <Line
      points={points}
      color="#ff4444"
      lineWidth={1.5}
      transparent
      opacity={0.4}
    />
  );
}

function Satellite({
  p,
  trail,
  onFocus,
  onSelect,
  earthRotY,
  showTrail,
  showGroundTrack,
}: {
  p: Position;
  trail: TrailPoint[];
  onFocus: (pos: THREE.Vector3, pullback?: number) => void;
  onSelect: (p: Position) => void;
  earthRotY: number;
  showTrail: boolean;
  showGroundTrack: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const radius = altToRadius(p.elevation_km);
  const pos = latLonToXYZ(p.latitude, p.longitude, radius, earthRotY);
  // Scale dot so high-altitude satellites remain visible when zoomed out
  const dotSize = 0.022 * Math.sqrt(radius);
  const glowRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (glowRef.current) {
      const s = 1 + Math.sin(clock.elapsedTime * 2) * 0.15;
      glowRef.current.scale.setScalar(s);
    }
  });

  return (
    <>
      {showTrail && <SatelliteTrail trail={trail} />}
      {showGroundTrack && <GroundTrack trail={trail} earthRotY={earthRotY} />}
      <group position={pos}>
        <mesh
          onPointerOver={(e) => { e.stopPropagation(); setHovered(true); }}
          onPointerOut={() => setHovered(false)}
          onClick={(e) => { e.stopPropagation(); onSelect(p); }}
          onDoubleClick={(e) => { e.stopPropagation(); onFocus(new THREE.Vector3(...pos), 0.3); }}
        >
          <sphereGeometry args={[dotSize, 12, 12]} />
          <meshStandardMaterial
            color={hovered ? "#ffcc00" : "#ff3333"}
            emissive={hovered ? "#ffcc00" : "#ff3333"}
            emissiveIntensity={hovered ? 4 : 3}
            toneMapped={false}
          />
        </mesh>
        <mesh ref={glowRef}>
          <sphereGeometry args={[dotSize * 1.7, 12, 12]} />
          <meshStandardMaterial
            color={hovered ? "#ffcc00" : "#ff4444"}
            emissive={hovered ? "#ffcc00" : "#ff4444"}
            emissiveIntensity={1}
            toneMapped={false}
            transparent
            opacity={0.25}
          />
        </mesh>
        {hovered && (
          <Html distanceFactor={4}>
            <div
              style={{
                background: "rgba(0,0,0,0.88)",
                color: "#e0e0e0",
                padding: "5px 9px",
                borderLeft: "2px solid #ff3333",
                fontSize: 11,
                fontFamily: "monospace",
                whiteSpace: "nowrap",
                pointerEvents: "none",
                lineHeight: 1.6,
              }}
            >
              <div style={{ color: "#fff", fontWeight: "bold" }}>{p.name}</div>
              <div style={{ color: "#888", fontSize: 9, marginTop: 2 }}>click for info · dbl-click to focus</div>
            </div>
          </Html>
        )}
      </group>
    </>
  );
}

// ─── Scene ───────────────────────────────────────────────────────────────────
function Scene({
  positions,
  trails,
  minutesOffset,
  showTrail,
  showGroundTrack,
  sunDir,
  moonDir,
  onSelectSat,
}: {
  positions: Position[];
  trails: Trails;
  minutesOffset: number;
  showTrail: boolean;
  showGroundTrack: boolean;
  sunDir?: { x: number; y: number; z: number };
  moonDir?: { x: number; y: number; z: number };
  onSelectSat?: (p: Position) => void;
}) {
  const orbitRef = useRef<any>(null);
  const focusAnim = useRef<{ target: THREE.Vector3; cam: THREE.Vector3 } | null>(null);
  const { camera } = useThree();
  const earthRotY = minutesOffset * EARTH_ROT_PER_MIN;

  const sunVec = useMemo(() => {
    if (!sunDir) return DEFAULT_SUN_DIR.clone();
    return new THREE.Vector3(sunDir.x, sunDir.y, sunDir.z).normalize();
  }, [sunDir?.x, sunDir?.y, sunDir?.z]);

  const moonOverridePos = useMemo(() => {
    if (!moonDir) return null;
    return new THREE.Vector3(moonDir.x, moonDir.y, moonDir.z)
      .normalize()
      .multiplyScalar(MOON_ORBIT_RADIUS);
  }, [moonDir?.x, moonDir?.y, moonDir?.z]);

  useFrame(() => {
    if (!focusAnim.current || !orbitRef.current) return;
    const { target, cam } = focusAnim.current;
    camera.position.lerp(cam, 0.1);
    orbitRef.current.target.lerp(target, 0.1);
    orbitRef.current.update();
    if (camera.position.distanceTo(cam) < 0.01) focusAnim.current = null;
  });

  const handleFocus = (worldPos: THREE.Vector3, pullback = 1.5) => {
    const isOrigin = worldPos.length() < 0.01;
    const dir = isOrigin
      ? new THREE.Vector3(0, 0, 1)
      : worldPos.clone().normalize();
    focusAnim.current = {
      target: worldPos.clone(),
      cam: dir.multiplyScalar(worldPos.length() + pullback),
    };
  };

  return (
    <>
      <color attach="background" args={["#000005"]} />
      <StarField />
      <ambientLight intensity={0.08} />
      <directionalLight
        position={[sunVec.x * 10, sunVec.y * 10, sunVec.z * 10]}
        intensity={1.5}
        color="#fff8e0"
      />
      <Sun direction={sunVec} />
      <Earth minutesOffset={minutesOffset} onFocus={handleFocus} sunDirection={sunVec} />
      {!moonOverridePos && <MoonTrail minutesOffset={minutesOffset} />}
      <Moon minutesOffset={minutesOffset} onFocus={handleFocus} overridePos={moonOverridePos} />
      {positions.map((p) => (
        <Satellite
          key={p.id}
          p={p}
          trail={(trails[p.id] ?? []).filter(pt => pt.capturedOffset <= minutesOffset)}
          onFocus={handleFocus}
          onSelect={onSelectSat ?? (() => {})}
          earthRotY={earthRotY}
          showTrail={showTrail}
          showGroundTrack={showGroundTrack}
        />
      ))}
      <OrbitControls
        ref={orbitRef}
        enableDamping
        dampingFactor={0.05}
        minDistance={1.2}
        maxDistance={50}
        makeDefault
        onStart={() => { focusAnim.current = null; }}
      />
    </>
  );
}

// ─── Globe ───────────────────────────────────────────────────────────────────
export default function Globe({
  positions,
  trails,
  minutesOffset,
  showTrail,
  showGroundTrack,
  sunDir,
  moonDir,
  onSelectSat,
}: {
  positions: Position[];
  trails: Trails;
  minutesOffset: number;
  showTrail: boolean;
  showGroundTrack: boolean;
  sunDir?: { x: number; y: number; z: number };
  moonDir?: { x: number; y: number; z: number };
  onSelectSat?: (p: Position) => void;
}) {
  return (
    <Canvas
      camera={{ position: [0, 0, 3], fov: 45, far: 2000 }}
      style={{ position: "absolute", inset: 0 }}
      gl={{ antialias: true }}
    >
      <Scene
        positions={positions}
        trails={trails}
        minutesOffset={minutesOffset}
        showTrail={showTrail}
        showGroundTrack={showGroundTrack}
        sunDir={sunDir}
        moonDir={moonDir}
        onSelectSat={onSelectSat}
      />
    </Canvas>
  );
}
