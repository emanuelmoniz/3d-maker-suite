import { Bounds, OrbitControls } from "@react-three/drei";
import { Canvas, useLoader } from "@react-three/fiber";
import { useMemo } from "react";
import { BufferAttribute, Color, type Mesh, MeshStandardMaterial, type Object3D } from "three";
import { ThreeMFLoader } from "three/examples/jsm/loaders/3MFLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

/** Shows only the objects of one plate; if no object name matches, everything stays visible. */
function showOnly(root: Object3D, names: string[]) {
  const wanted = new Set(names);
  let hits = 0;
  root.traverse((o) => {
    if (wanted.has(o.name)) hits++;
  });
  const walk = (o: Object3D, inside: boolean): boolean => {
    const within = inside || wanted.has(o.name);
    const child = o.children.map((c) => walk(c, within)).some(Boolean);
    o.visible = !hits || within || child;
    return o.visible;
  };
  walk(root, false);
}

type Painted = { palette: string[]; parts: (number[] | null)[][] };

/** Vertex colors from run-length painted triangles; state 0 keeps the part color. */
function paintTriangles(mesh: Mesh, runs: number[], palette: string[], base: string | null) {
  const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
  const colors = new Float32Array(geometry.getAttribute("position").count * 3);
  const fallback = new Color(base ?? "#ffffff");
  const slots = palette.map((c) => new Color(c));
  let tri = 0;
  for (let r = 0; r < runs.length; r += 2) {
    const state = runs[r] ?? 0;
    const color = (state > 0 && slots[state - 1]) || fallback;
    for (let n = runs[r + 1] ?? 0; n > 0; n--, tri++) {
      for (let v = 0; v < 3; v++) color.toArray(colors, (tri * 3 + v) * 3);
    }
  }
  if (tri * 3 !== geometry.getAttribute("position").count) return false; // not this mesh
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  mesh.geometry = geometry;
  mesh.material = new MeshStandardMaterial({ vertexColors: true, flatShading: true });
  return true;
}

/**
 * Applies part colors and painted triangles to the loader's scene: the root has one child per
 * build item, and each of those one child per component. Parts without an extruder color (or
 * with their own 3MF material colors) are left alone.
 */
function paint(root: Object3D, partColors: (string | null)[][], painted?: Painted) {
  partColors.forEach((parts, i) => {
    parts.forEach((color, j) => {
      const part = root.children[i]?.children[j];
      if (!part) return;
      const runs = painted?.parts[i]?.[j];
      part.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        if (runs && paintTriangles(mesh, runs, painted?.palette ?? [], color)) return;
        if (color) mesh.material = new MeshStandardMaterial({ color, flatShading: true });
      });
    });
  });
}

function Stl({ url }: { url: string }) {
  const geometry = useLoader(STLLoader, url);
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial color="#9aa4b2" />
    </mesh>
  );
}

function ThreeMf({
  url,
  objects,
  partColors,
  painted,
}: {
  url: string;
  objects: string[];
  partColors: (string | null)[][];
  painted?: Painted;
}) {
  const group = useLoader(ThreeMFLoader, url);
  useMemo(() => paint(group, partColors, painted), [group, partColors, painted]);
  useMemo(() => showOnly(group, objects), [group, objects]);
  return <primitive object={group} />;
}

/** Lazy chunk: three.js and loaders live only here. Slicer models are Z-up, three.js is Y-up. */
export default function ModelViewer({
  url,
  kind,
  objects,
  partColors,
  painted,
  label,
}: {
  url: string;
  kind: "3mf" | "stl";
  objects: string[];
  partColors: (string | null)[][];
  painted?: Painted;
  label: string;
}) {
  return (
    <Canvas
      role="img"
      aria-label={label}
      camera={{ position: [120, 100, 120], fov: 40 }}
      className="h-full w-full"
    >
      <hemisphereLight args={["#ffffff", "#667085", 1.6]} />
      <directionalLight position={[100, 150, 200]} intensity={2} />
      <Bounds fit clip observe margin={1.3}>
        <group rotation={[-Math.PI / 2, 0, 0]}>
          {kind === "stl" ? (
            <Stl url={url} />
          ) : (
            <ThreeMf url={url} objects={objects} partColors={partColors} painted={painted} />
          )}
        </group>
      </Bounds>
      <OrbitControls makeDefault />
    </Canvas>
  );
}
