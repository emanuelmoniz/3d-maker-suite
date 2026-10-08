import { Bounds, OrbitControls } from "@react-three/drei";
import { Canvas, useLoader } from "@react-three/fiber";
import { useMemo } from "react";
import type { Object3D } from "three";
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

function Stl({ url }: { url: string }) {
  const geometry = useLoader(STLLoader, url);
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial color="#9aa4b2" />
    </mesh>
  );
}

function ThreeMf({ url, objects }: { url: string; objects: string[] }) {
  const group = useLoader(ThreeMFLoader, url);
  useMemo(() => showOnly(group, objects), [group, objects]);
  return <primitive object={group} />;
}

/** Lazy chunk: three.js and loaders live only here. Slicer models are Z-up, three.js is Y-up. */
export default function ModelViewer({
  url,
  kind,
  objects,
  label,
}: {
  url: string;
  kind: "3mf" | "stl";
  objects: string[];
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
          {kind === "stl" ? <Stl url={url} /> : <ThreeMf url={url} objects={objects} />}
        </group>
      </Bounds>
      <OrbitControls makeDefault />
    </Canvas>
  );
}
