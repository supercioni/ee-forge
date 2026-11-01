import { BufferGeometry, Float32BufferAttribute, Mesh, Matrix4, type Object3D } from "three";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";

/** EE .model: big-endian vertex count followed by eight little-endian floats, native Z-up coordinates. */
export function readNativeModel(bytes: ArrayBuffer): BufferGeometry {
  const data = new DataView(bytes);
  if (data.byteLength < 4) throw new Error("Truncated EE model");
  const count = data.getUint32(0, false);
  if (count === 0 || count % 3 !== 0 || count > 2000000 || 4 + count * 32 !== data.byteLength) throw new Error("Invalid EE model vertex count");
  const p: number[] = [], n: number[] = [], uv: number[] = [];
  for (let i = 0; i < count; i++) {
    const values = Array.from({ length: 8 }, (_, j) => data.getFloat32(4 + i * 32 + j * 4, true));
    if (values.some(v => !Number.isFinite(v))) throw new Error("Invalid model coordinates");
    p.push(...values.slice(0, 3)); n.push(...values.slice(3, 6)); uv.push(...values.slice(6, 8));
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(p, 3)); g.setAttribute("normal", new Float32BufferAttribute(n, 3)); g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  return g;
}

/** Canonical, triangulated OBJ with positive v/vt/vn indices: supported by both EE loaders. */
export function normaliseObj(text: string): string {
  if (text.length > 8 * 1024 * 1024) throw new Error("OBJ must be smaller than 8 MiB");
  const root = new OBJLoader().parse(text);
  const lines: string[] = ["# EE FORGE single-material triangulated OBJ"];
  let count = 0;
  root.traverse((object: Object3D) => {
    if (!(object instanceof Mesh)) return;
    const g = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry;
    if (!g.getAttribute("normal")) g.computeVertexNormals();
    const p = g.getAttribute("position"), n = g.getAttribute("normal"), uv = g.getAttribute("uv");
    for (let i = 0; i < p.count; i++) {
      const xyz = [p.getX(i), p.getY(i), p.getZ(i)];
      if (xyz.some(v => !Number.isFinite(v))) throw new Error("OBJ contains invalid coordinates");
      lines.push(`v ${xyz.join(" ")}`, `vt ${uv?.getX(i) ?? 0} ${uv?.getY(i) ?? 0}`, `vn ${n.getX(i)} ${n.getY(i)} ${n.getZ(i)}`);
      count++;
      if (count % 3 === 0) lines.push(`f ${[count - 2, count - 1, count].map(k => `${k}/${k}/${k}`).join(" ")}`);
    }
    g.dispose();
  });
  if (count === 0 || count > 150000) throw new Error("OBJ must contain triangles and at most 150,000 triangle vertices");
  const result = lines.join("\n");
  if (result.length > 8 * 1024 * 1024) throw new Error("Triangulated OBJ exceeds 8 MiB; simplify the model first");
  return result;
}

/** Apply the same OBJ Y/Z swap and V flip as EE's Mesh loader; do not load MTL or external URLs. */
export function readObjNative(text: string): Object3D {
  const root = new OBJLoader().parse(text);
  const swap = new Matrix4().set(1,0,0,0, 0,0,1,0, 0,1,0,0, 0,0,0,1);
  root.traverse(object => {
    if (!(object instanceof Mesh)) return;
    object.geometry.applyMatrix4(swap);
    const uv = object.geometry.getAttribute("uv");
    if (uv) for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
  });
  return root;
}
