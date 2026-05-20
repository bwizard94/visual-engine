/**
 * Renderer — Three.js WebGLRenderer + EffectComposer setup.
 *
 * The EffectComposer is initialised with two passes:
 *   1. RenderPass  — draws the scene into an offscreen MSAA buffer
 *   2. OutputPass  — tone-mapping + sRGB conversion before display
 *
 * Injecting post-processing:
 *   Insert additional passes between RenderPass and OutputPass:
 *
 *     import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
 *     renderer.injectPass(new UnrealBloomPass(resolution, strength, radius, threshold), 1);
 *
 *   The integer argument is the insertion index (1 = after RenderPass, before OutputPass).
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }     from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass }     from 'three/addons/postprocessing/OutputPass.js';
import { uniforms }       from './Uniforms.js';

export class Renderer {
  /**
   * @param {HTMLCanvasElement}   canvas
   * @param {THREE.Scene}         scene
   * @param {THREE.PerspectiveCamera} camera
   */
  constructor(canvas, scene, camera) {
    this._camera = camera;

    // ── WebGLRenderer ────────────────────────────────────────────────────────
    this.gl = new THREE.WebGLRenderer({
      canvas,
      antialias:        false, // Disabled — MSAA via EffectComposer is preferred
      alpha:            false,
      stencil:          false,
      powerPreference:  'high-performance',
    });

    this.gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.gl.setSize(window.innerWidth, window.innerHeight);

    // ACESFilmic gives a natural roll-off on bright frequency peaks
    this.gl.toneMapping         = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.0;
    this.gl.outputColorSpace    = THREE.SRGBColorSpace;

    // ── EffectComposer ───────────────────────────────────────────────────────
    this.composer = new EffectComposer(this.gl);
    this.composer.addPass(new RenderPass(scene, camera));
    // OutputPass converts the render target's Linear color to sRGB for display,
    // and applies toneMapping. Always keep this as the last pass.
    this.composer.addPass(new OutputPass());

    // ── Resize ───────────────────────────────────────────────────────────────
    this._onResize = this._onResize.bind(this);
    window.addEventListener('resize', this._onResize);
  }

  /**
   * Insert a post-processing pass into the pipeline.
   * index 0 = before RenderPass (rare), 1 = after RenderPass, -1 = before OutputPass.
   *
   * @param {import('three/addons/postprocessing/Pass.js').Pass} pass
   * @param {number} [index=1]
   */
  injectPass(pass, index = 1) {
    // EffectComposer has no public insert method — splice into the passes array.
    const passes = this.composer.passes;
    // Clamp so negative indices and out-of-bounds are handled gracefully.
    // Always insert before the last OutputPass.
    const safeIndex = Math.max(1, Math.min(index, passes.length - 1));
    passes.splice(safeIndex, 0, pass);
  }

  /** Render one frame. Call from requestAnimationFrame. */
  render() {
    this.composer.render();
  }

  /** Release GPU resources and remove event listeners. */
  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.composer.dispose();
    this.gl.dispose();
  }

  _onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;

    this._camera.aspect = w / h;
    this._camera.updateProjectionMatrix();

    this.gl.setSize(w, h);
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.composer.setSize(w, h);

    uniforms.uResolution.value.set(w, h);
  }
}
