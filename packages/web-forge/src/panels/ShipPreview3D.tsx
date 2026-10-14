import { Suspense, useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, useGLTF } from "@react-three/drei";
import { Box3, Group, Vector3 } from "three";
import type { AssetManifest, EETemplateDef } from "@forge/contracts";
import { resolveShipModel } from "@forge/core/editor";
import { assetUrl } from "../api/transport.js";

/**
 * The hull, in three dimensions.
 *
 * Default-exported and loaded through `React.lazy` on purpose: three.js
 * and its loaders are an order of magnitude larger than the rest of the
 * editor, and an author working on the map or the narrative should never
 * pay for them. Opening the Ship view fetches the chunk; everything else
 * never does.
 *
 * The mesh is the one the *asset manifest* has for this template — which
 * for a new hull means the stock template it copies (see
 * `resolveShipModel`). It is a likeness, not a render of the project's own
 * `ModelData`: EE's meshes are its own `.model` format, and the glTF
 * conversions in `assets/ee-ships/` exist per stock template.
 */

export default function ShipPreview3D({
  template,
  templates,
  manifest,
  onLoaded,
}: {
  template: EETemplateDef;
  templates: readonly EETemplateDef[];
  manifest: AssetManifest | null;
  /** Called once the glTF has been read, so the page can say "loaded" rather than assume it. */
  onLoaded?: () => void;
}): JSX.Element {
  const found = useMemo(
    () => (manifest === null ? null : resolveShipModel(manifest, template, templates)),
    [manifest, template, templates],
  );

  if (manifest === null) {
    return <p className="hint">Loading the asset manifest…</p>;
  }
  if (found === null) {
    // No model for this hull — either the template is unknown to the manifest or the installed app does not
    // carry it (stock EmptyEpsilon models are not redistributed: licences, see THIRD-PARTY-NOTICES). A generic
    // stand-in keeps the viewer working and says plainly that it is not this hull.
    return (
      <div className="preview-3d" data-testid="ship-placeholder">
        <Canvas camera={{ position: [0, 2.2, 4.4], fov: 45 }} dpr={[1, 2]}>
          <ambientLight intensity={0.55} />
          <directionalLight position={[4, 6, 3]} intensity={1.5} />
          <directionalLight position={[-5, -2, -4]} intensity={0.35} />
          <PlaceholderHull />
          <OrbitControls enablePan={false} minDistance={2} maxDistance={12} />
        </Canvas>
        <p className="hint">Generic stand-in — drawn from primitives, not from any hull.</p>
      </div>
    );
  }

  return (
    <div className="preview-3d">
      <Canvas camera={{ position: [0, 2.2, 4.4], fov: 45 }} dpr={[1, 2]}>
        <ambientLight intensity={0.55} />
        <directionalLight position={[4, 6, 3]} intensity={1.5} />
        <directionalLight position={[-5, -2, -4]} intensity={0.35} />
        <Suspense fallback={null}>
          <Hull url={assetUrl(found.entry.model)} rotationOffset={found.entry.rotationOffset} onLoaded={onLoaded} />
        </Suspense>
        <OrbitControls enablePan={false} minDistance={2} maxDistance={12} />
      </Canvas>
    </div>
  );
}

/**
 * The glTF, normalised to a unit-ish size and turning slowly.
 *
 * Normalised rather than scaled by the manifest's `radius`: the viewer
 * needs EE's true footprint because it composes a scene, and this needs a
 * hull that fills the box whether it is a fighter or a dreadnought.
 */
function Hull({
  url,
  rotationOffset,
  onLoaded,
}: {
  url: string;
  rotationOffset: readonly [number, number, number];
  onLoaded?: (() => void) | undefined;
}): JSX.Element {
  const gltf = useGLTF(url);
  useEffect(() => {
    onLoaded?.();
  }, [gltf, onLoaded]);
  const spin = useRef<Group>(null);
  const fit = useRef<Group>(null);

  const scene = useMemo(() => gltf.scene.clone(true), [gltf.scene]);

  useEffect(() => {
    const group = fit.current;
    if (group === null) return;
    const box = new Box3().setFromObject(group);
    const size = box.getSize(new Vector3());
    const longest = Math.max(size.x, size.y, size.z);
    if (longest > 0) group.scale.setScalar(2.2 / longest);
    const centre = box.getCenter(new Vector3()).multiplyScalar(group.scale.x);
    group.position.set(-centre.x, -centre.y, -centre.z);
  }, [scene]);

  useFrame((_, delta) => {
    if (spin.current !== null) spin.current.rotation.y += delta * 0.35;
  });

  return (
    <group ref={spin}>
      <group ref={fit} rotation={[rotationOffset[0], rotationOffset[1], rotationOffset[2]]}>
        <primitive object={scene} />
      </group>
    </group>
  );
}

/** A plain wedge with two wings: obviously not any real hull, and drawn from nothing but primitives. */
function PlaceholderHull(): JSX.Element {
  const spin = useRef<Group>(null);
  useFrame((_, delta) => {
    if (spin.current !== null) spin.current.rotation.y += delta * 0.35;
  });
  return (
    <group ref={spin}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.45, 2.2, 5]} />
        <meshStandardMaterial color="#7f8da3" metalness={0.5} roughness={0.5} />
      </mesh>
      <mesh position={[0, 0, 0.45]}>
        <boxGeometry args={[1.7, 0.06, 0.55]} />
        <meshStandardMaterial color="#5f6b7d" metalness={0.5} roughness={0.55} />
      </mesh>
    </group>
  );
}
