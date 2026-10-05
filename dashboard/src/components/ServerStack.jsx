// 3D fleet view: one cabinet per host in the inventory, lit by state and dark when offline.
// labels are DOM elements placed over the canvas by projecting each cabinet top every frame.

import { Component, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Environment, Lightformer, MeshReflectorMaterial, OrbitControls, RoundedBox } from "@react-three/drei";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import * as THREE from "three";
import { StatePill } from "./Status";
import { STATE_LABEL, isLit, num } from "../lib/format";

const W = 1.0; // cabinet width
const H = 2.25; // height
const D = 1.25; // depth
const GAP = 0.14; // between cabinets in a row
const ROW_GAP = 2.4; // between rows
const PER_ROW = 8;
const BLADES = 9;

const LED = {
  ok: "#27f08a",
  warning: "#ffb21c",
  critical: "#ff4545",
  stale: "#7d8a84",
};

const PALETTE = {
  dark: { floor: "#050807", body: "#161c1a", blade: "#0b0f0e", bladeFace: "#131917", glassTint: "#9fd9bb", bg: "#040605" },
  light: { floor: "#eef1ef", body: "#20262a", blade: "#0e1211", bladeFace: "#1a2022", glassTint: "#cfe9dc", bg: "#eef1ef" },
};

function glowTexture() {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,0.9)");
  g.addColorStop(0.35, "rgba(255,255,255,0.35)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function emissive(hex, strength) {
  return new THREE.Color(hex).multiplyScalar(strength);
}

function layout(count) {
  const rows = Math.ceil(count / PER_ROW) || 1;
  const positions = Array.from({ length: count }, (_, i) => {
    const row = Math.floor(i / PER_ROW);
    const col = i % PER_ROW;
    const inRow = Math.min(PER_ROW, count - row * PER_ROW);
    const width = inRow * W + (inRow - 1) * GAP;
    return [-width / 2 + W / 2 + col * (W + GAP), 0, -row * ROW_GAP + ((rows - 1) * ROW_GAP) / 2];
  });
  const rowWidth = Math.min(count, PER_ROW) * (W + GAP);
  const span = Math.max(rowWidth, rows * ROW_GAP, 3);
  return { positions, span, dist: 3.4 + span * 1.05 };
}

function Cabinet({ host, position, palette, glow, light, hovered, onHover, onOpen }) {
  const group = useRef();
  const strip = useRef();
  const leds = useRef([]);
  const floor = useRef();
  const lit = isLit(host.state);
  const color = LED[host.state];

  // each blade blinks at its own pace
  const rhythm = useMemo(() => Array.from({ length: BLADES }, () => ({ speed: 2 + Math.random() * 7, phase: Math.random() * 10 })), []);

  useFrame(({ clock }, delta) => {
    const t = clock.elapsedTime;
    if (group.current) {
      const targetY = hovered ? 0.06 : 0;
      group.current.position.y += (targetY - group.current.position.y) * Math.min(1, delta * 10);
    }
    if (!lit) return;
    const pulse = host.state === "critical" ? 0.55 + 0.45 * Math.sin(t * 4) : 1;
    if (strip.current) strip.current.color.set(color).multiplyScalar((hovered ? 5 : 3.4) * pulse);
    if (floor.current) floor.current.opacity = (light ? 0.32 : hovered ? 0.75 : 0.5) * (0.6 + 0.4 * pulse) * (hovered && light ? 1.4 : 1);
    leds.current.forEach((m, i) => {
      if (!m) return;
      const r = rhythm[i];
      const on = Math.sin(t * r.speed + r.phase) > -0.2 || i === 0;
      m.color.set(i === 0 ? color : LED.ok).multiplyScalar(on ? 2.6 : 0.25);
    });
  });

  const bladeH = (H * 0.84) / BLADES;
  const front = D / 2;

  return (
    <group position={position}>
      <group
        ref={group}
        onPointerOver={(e) => {
          e.stopPropagation();
          onHover(host.name);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          onHover(null);
          document.body.style.cursor = "";
        }}
        onClick={(e) => {
          e.stopPropagation();
          onOpen(host.name);
        }}
      >
        {/* cabinet shell */}
        <RoundedBox args={[W, H, D]} radius={0.035} smoothness={4} position={[0, H / 2, 0]} castShadow receiveShadow>
          <meshStandardMaterial color={palette.body} metalness={0.75} roughness={0.36} />
        </RoundedBox>

        {/* recessed front frame */}
        <mesh position={[0, H / 2, front + 0.001]}>
          <planeGeometry args={[W * 0.9, H * 0.94]} />
          <meshStandardMaterial color="#050706" metalness={0.4} roughness={0.8} />
        </mesh>

        {/* server blades */}
        {Array.from({ length: BLADES }, (_, i) => {
          const y = H * 0.08 + bladeH * (i + 0.5);
          return (
            <group key={i} position={[0, y, front + 0.012]}>
              <mesh>
                <boxGeometry args={[W * 0.8, bladeH * 0.84, 0.02]} />
                <meshStandardMaterial color={palette.bladeFace} metalness={0.6} roughness={0.45} />
              </mesh>
              {/* vent grooves */}
              {[-0.1, 0, 0.1, 0.2].map((x) => (
                <mesh key={x} position={[x + 0.02, 0, 0.011]}>
                  <boxGeometry args={[0.06, bladeH * 0.5, 0.002]} />
                  <meshStandardMaterial color={palette.blade} roughness={1} />
                </mesh>
              ))}
              {/* status leds */}
              <mesh position={[-W * 0.33, 0, 0.012]}>
                <boxGeometry args={[0.035, 0.035, 0.01]} />
                <meshBasicMaterial
                  ref={(m) => (leds.current[i] = m)}
                  toneMapped={false}
                  color={lit ? emissive(color, 2) : host.state === "offline" && i === 0 ? emissive("#ff3b3b", 0.6) : "#1b2220"}
                />
              </mesh>
              <mesh position={[-W * 0.27, 0, 0.012]}>
                <boxGeometry args={[0.035, 0.035, 0.01]} />
                <meshBasicMaterial toneMapped={false} color={lit ? emissive("#4aa3ff", 0.9) : "#1b2220"} />
              </mesh>
            </group>
          );
        })}

        {/* glass door */}
        <mesh position={[0, H / 2, front + 0.035]}>
          <planeGeometry args={[W * 0.88, H * 0.92]} />
          <meshPhysicalMaterial color={palette.glassTint} transparent opacity={0.07} roughness={0.05} metalness={0.1} clearcoat={1} />
        </mesh>

        {/* vertical light strip on the front edge */}
        <mesh position={[W / 2 - 0.035, H / 2, front + 0.02]}>
          <boxGeometry args={[0.018, H * 0.9, 0.012]} />
          <meshBasicMaterial ref={strip} toneMapped={false} color={lit ? emissive(color, 3.4) : "#151a18"} />
        </mesh>

        {/* top status bar */}
        <mesh position={[0, H + 0.002, front - 0.08]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[W * 0.7, 0.03]} />
          <meshBasicMaterial toneMapped={false} color={lit ? emissive(color, 2.2) : "#151a18"} />
        </mesh>
      </group>

      {/* floor glow, additive on the dark theme and a soft tint on the light one */}
      {lit && (
        <mesh position={[0, 0.004, 0.25]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[W * 2.6, D * 2.4]} />
          <meshBasicMaterial
            ref={floor}
            map={glow}
            color={color}
            transparent
            opacity={0.5}
            depthWrite={false}
            blending={light ? THREE.NormalBlending : THREE.AdditiveBlending}
            toneMapped={false}
          />
        </mesh>
      )}
    </group>
  );
}

// moves the camera back on narrow screens so the whole row stays in frame
function CameraFit({ dist }) {
  const { camera, size, controls } = useThree();
  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    const factor = Math.max(1, 1.55 / aspect);
    camera.position.set(dist * 0.62 * factor, dist * 0.52 * factor, dist * 0.78 * factor);
    camera.lookAt(0, 1, 0);
    controls?.update?.();
  }, [camera, size.width, size.height, dist, controls]);
  return null;
}

// writes label positions straight to the DOM to avoid a React render per frame
function LabelProjector({ anchors, labelRefs }) {
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) => {
    // on narrow screens alternate label heights so names do not overlap
    const crowded = size.width / Math.max(1, Math.min(anchors.length, PER_ROW)) < 110;
    anchors.forEach(([x, y, z], i) => {
      const el = labelRefs.current[i];
      if (!el) return;
      v.set(x, y, z).project(camera);
      const sx = ((v.x + 1) / 2) * size.width;
      const sy = ((1 - v.y) / 2) * size.height - (crowded && i % 2 ? 34 : 0);
      el.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0)`;
      el.style.visibility = v.z < 1 ? "visible" : "hidden";
    });
  });
  return null;
}

function Scene({ hosts, theme, onOpen, hovered, onHover, labelRefs }) {
  const palette = PALETTE[theme] || PALETTE.dark;
  const light = theme === "light";
  const glow = useMemo(glowTexture, []);
  const { positions, span, dist } = layout(hosts.length);
  const anchors = positions.map(([x, , z]) => [x, H + 0.18, z]);

  return (
    <>
      <color attach="background" args={[palette.bg]} />
      <fog attach="fog" args={[palette.bg, dist * 1.3, dist * 3]} />
      <ambientLight intensity={light ? 0.9 : 0.35} />
      <directionalLight position={[5, 9, 6]} intensity={light ? 1.5 : 0.9} castShadow shadow-mapSize={[1024, 1024]} />
      <pointLight position={[-4, 3, 4]} intensity={light ? 4 : 14} color="#2bf08c" distance={14} decay={2} />

      <Environment resolution={256} frames={1}>
        <Lightformer form="rect" intensity={light ? 3 : 1.6} position={[0, 6, 0]} rotation-x={Math.PI / 2} scale={[12, 4, 1]} />
        <Lightformer form="rect" intensity={1.2} position={[-6, 2, 3]} rotation-y={Math.PI / 2} scale={[8, 2, 1]} />
        <Lightformer form="rect" intensity={light ? 2 : 0.8} color="#bfffe0" position={[6, 2, 4]} rotation-y={-Math.PI / 2} scale={[8, 2, 1]} />
      </Environment>

      {hosts.map((host, i) => (
        <Cabinet
          key={host.name}
          host={host}
          position={positions[i]}
          palette={palette}
          glow={glow}
          light={light}
          hovered={hovered === host.name}
          onHover={onHover}
          onOpen={onOpen}
        />
      ))}

      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[200, 200]} />
        {light ? (
          <meshStandardMaterial color={palette.floor} roughness={0.95} metalness={0} />
        ) : (
          <MeshReflectorMaterial
            blur={[400, 120]}
            resolution={1024}
            mixBlur={1}
            mixStrength={38}
            roughness={1}
            depthScale={1.1}
            minDepthThreshold={0.4}
            maxDepthThreshold={1.3}
            color={palette.floor}
            metalness={0.6}
            mirror={0.6}
          />
        )}
      </mesh>
      <ContactShadows position={[0, 0.002, 0]} scale={span * 3} blur={2.4} far={3} opacity={light ? 0.5 : 0.8} />

      <OrbitControls
        makeDefault
        target={[0, 1, 0]}
        enablePan={false}
        enableDamping
        minDistance={dist * 0.55}
        maxDistance={dist * 2.6}
        minPolarAngle={0.55}
        maxPolarAngle={1.32}
        minAzimuthAngle={-1.1}
        maxAzimuthAngle={1.1}
      />

      <CameraFit dist={dist} />
      <LabelProjector anchors={anchors} labelRefs={labelRefs} />

      <EffectComposer disableNormalPass multisampling={4}>
        <Bloom mipmapBlur luminanceThreshold={1} intensity={light ? 0.55 : 1.05} radius={0.72} />
        <Vignette eskil={false} offset={0.2} darkness={light ? 0.2 : 0.6} />
      </EffectComposer>
    </>
  );
}

function Label({ host, hovered, innerRef }) {
  const lit = isLit(host.state);
  return (
    <div ref={innerRef} style={{ position: "absolute", left: 0, top: 0, visibility: "hidden", zIndex: hovered ? 5 : 1 }}>
      <div className="rack-tag">
        {hovered ? (
          <div className="rack-tip">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <strong>{host.name}</strong>
              <StatePill state={host.state} />
            </div>
            <div className="muted mono" style={{ fontSize: 11 }}>{host.ip}</div>
            <dl className="kv">
              <dt>Load</dt><dd>{num(host.metrics.load1, 2)}</dd>
              <dt>Memory</dt><dd>{num(host.metrics.memory_percent, 0, "%")}</dd>
              <dt>Fullest disk</dt><dd>{host.metrics.disk_max ? `${host.metrics.disk_max.mount} ${host.metrics.disk_max.percent}%` : "-"}</dd>
              <dt>CPU temp</dt><dd>{num(host.metrics.cpu_temp, 0, "°C")}</dd>
              <dt>Active alerts</dt><dd>{host.alerts.critical + host.alerts.warning + host.alerts.info}</dd>
            </dl>
          </div>
        ) : (
          <div className="label">
            <span className={`dot tone-${host.state} ${lit ? "glow" : ""}`} />
            {host.name}
          </div>
        )}
        <div className="stem" />
      </div>
    </div>
  );
}

// without WebGL a flat list replaces the scene
class WebGLBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="empty" style={{ height: "100%" }}>
        3D view unavailable in this browser.
        <div className="row wrap" style={{ justifyContent: "center" }}>
          {this.props.hosts.map((h) => (
            <span key={h.name} className={`pill tone-${h.state}`}>{h.name} · {STATE_LABEL[h.state]}</span>
          ))}
        </div>
      </div>
    );
  }
}

export default function ServerStack({ hosts, theme, onOpen }) {
  const [hovered, setHovered] = useState(null);
  const labelRefs = useRef([]);
  const { dist } = layout(hosts.length);

  return (
    <WebGLBoundary hosts={hosts}>
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: [dist * 0.62, dist * 0.52, dist * 0.78], fov: 32, near: 0.1, far: 300 }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        style={{ position: "absolute", inset: 0 }}
        onPointerMissed={() => (document.body.style.cursor = "")}
      >
        <Scene hosts={hosts} theme={theme} onOpen={onOpen} hovered={hovered} onHover={setHovered} labelRefs={labelRefs} />
      </Canvas>
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
        {hosts.map((h, i) => (
          <Label key={h.name} host={h} hovered={hovered === h.name} innerRef={(el) => (labelRefs.current[i] = el)} />
        ))}
      </div>
    </WebGLBoundary>
  );
}
