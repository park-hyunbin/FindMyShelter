import { DepthTexture, HalfFloatType, UnsignedIntType, WebGLRenderTarget,
  type PerspectiveCamera, type Scene, type WebGLRenderer } from 'three';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export function createStreetOcclusion(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera) {
  if (!renderer.extensions.has('EXT_color_buffer_float')) return;

  const depth = new DepthTexture(1, 1, UnsignedIntType);
  const color = new WebGLRenderTarget(1, 1, {
    type: HalfFloatType,
    depthTexture: depth,
    samples: Math.min(2, renderer.capabilities.maxSamples),
  });
  // Reuse the lit scene's depth so cutouts and terrain openings match the displayed geometry.
  const occlusion = new GTAOPass(scene, camera, 1, 1, { depthTexture: depth });
  occlusion.output = GTAOPass.OUTPUT.Off;
  occlusion.updateGtaoMaterial({ radius: 2.4, thickness: 0.85, scale: 1.35, samples: 12, distanceFallOff: 1 });
  occlusion.updatePdMaterial({ radius: 4, samples: 12 });

  // Apply AO in the existing output pass before tone mapping, without another full-size buffer.
  const output = new OutputPass();
  output.renderToScreen = true;
  output.uniforms.tOcclusion = { value: occlusion.gtaoMap };
  output.material.fragmentShader = output.material.fragmentShader
    .replace('uniform sampler2D tDiffuse;', 'uniform sampler2D tDiffuse;\nuniform sampler2D tOcclusion;')
    .replace('gl_FragColor = texture2D( tDiffuse, vUv );', `
      gl_FragColor = texture2D( tDiffuse, vUv );
      gl_FragColor.rgb *= mix( 1.0, texture2D( tOcclusion, vUv ).r, 0.70 );
    `);

  return {
    resize(cssWidth: number, cssHeight: number) {
      const ratio = Math.min(renderer.getPixelRatio(), 1.25, 1600 / Math.max(1, cssWidth), 1050 / Math.max(1, cssHeight));
      const width = Math.max(1, Math.round(cssWidth * ratio));
      const height = Math.max(1, Math.round(cssHeight * ratio));
      color.setSize(width, height);
      occlusion.setSize(Math.max(1, Math.ceil(width / 2)), Math.max(1, Math.ceil(height / 2)));
    },
    render() {
      renderer.setRenderTarget(color);
      renderer.render(scene, camera);
      // Flush color and multisampled depth before the AO pass samples the depth texture.
      renderer.setRenderTarget(null);
      occlusion.render(renderer, color, color, 0, false);
      output.render(renderer, color, color, 0, false);
    },
    dispose() {
      color.dispose();
      occlusion.dispose();
      // r187 does not dispose these two materials inside GTAOPass.dispose().
      occlusion.gtaoMaterial.dispose();
      occlusion.blendMaterial.dispose();
      output.dispose();
    },
  };
}
