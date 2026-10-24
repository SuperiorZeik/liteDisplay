import * as THREE from "three";

/** Blocks only translate: three floats replace a sixteen-float instance matrix. */
export function translatedMaterial<T extends THREE.Material>(material: T): T {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = "attribute vec3 blockOffset;\n" + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      "#include <begin_vertex>\ntransformed += blockOffset;",
    );
  };
  material.customProgramCacheKey = () => "block-translation-v1";
  return material;
}

const inverse = new THREE.Matrix4();
const localRay = new THREE.Ray();
const instanceRay = new THREE.Ray();
const offset = new THREE.Vector3();
const translation = new THREE.Matrix4();
const picker = new THREE.Mesh();
const hits: THREE.Intersection[] = [];

export class BlockInstances extends THREE.Mesh<THREE.InstancedBufferGeometry> {
  readonly offsets: THREE.InstancedBufferAttribute;
  readonly count: number;

  constructor(
    readonly base: THREE.BufferGeometry,
    material: THREE.Material,
    offsets: Float32Array | THREE.InstancedBufferAttribute,
  ) {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = base.index;
    for (const [key, attribute] of Object.entries(base.attributes))
      geometry.setAttribute(key, attribute);
    geometry.groups = base.groups;
    const attribute = offsets instanceof Float32Array
      ? new THREE.InstancedBufferAttribute(offsets, 3)
      : offsets;
    geometry.setAttribute("blockOffset", attribute);
    geometry.instanceCount = attribute.count;
    if (!base.boundingBox) base.computeBoundingBox();
    if (!base.boundingSphere) base.computeBoundingSphere();
    const bounds = new THREE.Box3();
    for (let i = 0; i < attribute.count; i++) {
      offset.fromBufferAttribute(attribute, i);
      bounds.expandByPoint(offset);
    }
    bounds.min.add(base.boundingBox!.min);
    bounds.max.add(base.boundingBox!.max);
    geometry.boundingBox = bounds;
    geometry.boundingSphere = bounds.getBoundingSphere(new THREE.Sphere());
    super(geometry, material);
    this.offsets = attribute;
    this.count = attribute.count;
  }

  override raycast(raycaster: THREE.Raycaster, intersects: THREE.Intersection[]) {
    inverse.copy(this.matrixWorld).invert();
    localRay.copy(raycaster.ray).applyMatrix4(inverse);
    // Spatial batches reject off-ray chunks before testing individual blocks.
    if (!localRay.intersectsBox(this.geometry.boundingBox!)) return;
    picker.geometry = this.base;
    picker.material = this.material;
    for (let i = 0; i < this.count; i++) {
      offset.fromBufferAttribute(this.offsets, i);
      instanceRay.copy(localRay);
      instanceRay.origin.sub(offset);
      if (!instanceRay.intersectsBox(this.base.boundingBox!)) continue;
      translation.makeTranslation(offset.x, offset.y, offset.z);
      picker.matrixWorld.multiplyMatrices(this.matrixWorld, translation);
      picker.raycast(raycaster, hits);
      for (const hit of hits) {
        hit.instanceId = i;
        hit.object = this;
        intersects.push(hit);
      }
      hits.length = 0;
    }
  }
}

/** Grow small numeric batches without retaining a JS object for every block. */
export class BlockIndices {
  private values = new Uint32Array(64);
  length = 0;
  push(index: number) {
    if (this.length === this.values.length) {
      const next = new Uint32Array(this.length * 2);
      next.set(this.values);
      this.values = next;
    }
    this.values[this.length++] = index;
  }
  finish() {
    return this.values.slice(0, this.length);
  }
}
