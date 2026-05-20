/**
 * SceneMesh — Three.js Scene, PerspectiveCamera, and the high-density plane.
 *
 * Geometry
 * ────────
 * PlaneGeometry(2, 2, SEGMENTS, SEGMENTS) sits in the XY plane.
 * Vertices are displaced along their normals (Z-axis) by the vertex shader.
 * At SEGMENTS=256 → 256×256 quads → 131 072 triangles at a comfortable cost.
 *
 * Increase SEGMENTS to 512 for extreme density (524k tris). Decrease to 128
 * for mobile targets. The shader code does not need to change.
 *
 * Material
 * ────────
 * THREE.ShaderMaterial with glslVersion: THREE.GLSL3 enables GLSL 3.00 ES,
 * which allows dynamic integer indexing into uniform arrays — critical for
 * mapping uv.x to uFrequencyData[int(uv.x * 127.0)] without an if/else chain.
 *
 * Camera
 * ──────
 * Positioned slightly above and in front of the plane so the displacement
 * has visible perspective depth. Adjust freely in main.js after construction.
 */

import * as THREE          from 'three';
import vertexShader        from '../shaders/plane.vert.js';
import fragmentShader      from '../shaders/plane.frag.js';
import { uniforms }        from './Uniforms.js';

// Grid resolution — change this one constant to control mesh density.
const SEGMENTS = 256;

export class SceneMesh {
  constructor() {
    // ── Scene ────────────────────────────────────────────────────────────────
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);

    // ── Camera ───────────────────────────────────────────────────────────────
    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.01,
      100,
    );
    this.camera.position.set(0, 1.2, 2.5);
    this.camera.lookAt(0, 0, 0);

    // ── Geometry ─────────────────────────────────────────────────────────────
    // width=2, height=2 fills a normalized view nicely with this camera.
    const geometry = new THREE.PlaneGeometry(2, 2, SEGMENTS, SEGMENTS);

    // ── Material ─────────────────────────────────────────────────────────────
    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,

      // glslVersion: THREE.GLSL3 compiles shaders as GLSL 3.00 ES.
      // Three.js still injects its standard builtins (projectionMatrix etc.)
      // in GLSL 3 syntax before your source. Do not redeclare them.
      glslVersion: THREE.GLSL3,

      // Shared uniform registry — all references point to the same objects,
      // so updating uniforms.uTime.value in main.js is immediately visible here.
      uniforms,

      // Wireframe shows the mesh topology during development.
      // Flip to false for solid rendering.
      wireframe: true,

      side: THREE.DoubleSide,
    });

    // ── Mesh ─────────────────────────────────────────────────────────────────
    this.mesh = new THREE.Mesh(geometry, material);
    // Tilt the plane so the displacement reads as 3D depth from camera.
    this.mesh.rotation.x = -Math.PI * 0.25;
    this.scene.add(this.mesh);
  }

  /** Toggle wireframe on/off at runtime. */
  setWireframe(enabled) {
    this.mesh.material.wireframe = enabled;
  }

  /** Swap the ShaderMaterial for a different one without rebuilding the scene. */
  replaceMaterial(newMaterial) {
    this.mesh.material.dispose();
    this.mesh.material = newMaterial;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
