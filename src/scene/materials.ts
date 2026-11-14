// Shader materials for the digital twin in daylight: a light sea with fine
// survey traces, a pencil grid on pale concrete, solid data-flow bands that
// read on white, and calm status markers. The black route is drawn in ink.

import * as THREE from 'three';

export const PALETTE = {
  teal: new THREE.Color('#0d9488'),
  cyan: new THREE.Color('#0284c7'),
  green: new THREE.Color('#16a34a'),
  lime: new THREE.Color('#65a30d'),
  amber: new THREE.Color('#d97706'),
  orange: new THREE.Color('#ea580c'),
  red: new THREE.Color('#dc2626'),
  violet: new THREE.Color('#1f2328'),
  white: new THREE.Color('#f8fafc'),
};

export type Tone = 'normal' | 'risk' | 'down' | 'recovery' | 'muted' | 'radar';

/** start and end colour of a flow for each status */
export function toneColors(t: Tone): [THREE.Color, THREE.Color] {
  switch (t) {
    case 'normal':
      return [PALETTE.teal, PALETTE.lime];
    case 'risk':
      return [PALETTE.amber, PALETTE.orange];
    case 'down':
      return [PALETTE.red, PALETTE.orange];
    case 'recovery':
      return [PALETTE.green, PALETTE.amber];
    case 'radar':
      return [PALETTE.violet, PALETTE.orange];
    default:
      return [new THREE.Color('#9ca3af'), new THREE.Color('#c4c8c2')];
  }
}

export function toneColor(t: Tone): THREE.Color {
  return toneColors(t)[0];
}

export const sharedTime = { value: 0 };

export function waterMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: sharedTime,
      uDeep: { value: new THREE.Color('#5d9ea7') },
      uShallow: { value: new THREE.Color('#8cc5c6') },
      uLine: { value: new THREE.Color('#ffffff') },
      uQuayX: { value: -40 },
      uTrace: { value: 1 },
      uTraceScale: { value: 1.6 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uDeep;
      uniform vec3 uShallow;
      uniform vec3 uLine;
      uniform float uQuayX;
      uniform float uTrace;
      uniform float uTraceScale;
      varying vec3 vWorld;
      // 1 on the grid line, fading to 0 within w of it
      float line(float v, float w) {
        float d = abs(fract(v + 0.5) - 0.5);
        return 1.0 - smoothstep(0.0, w, d);
      }
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        float d = clamp((uQuayX - vWorld.x) / 26.0, 0.0, 1.0);
        vec3 col = mix(uShallow, uDeep, d * 0.85);
        float swell = sin(vWorld.z * 0.22 + uTime * 0.7) * sin(vWorld.x * 0.15 - uTime * 0.5);
        col *= 0.96 + 0.04 * swell;
        // circuit-board traces in the water, like the concept art
        vec2 g = vWorld.xz / uTraceScale;
        vec2 cell = floor(g);
        float on = step(0.7, hash(cell));
        float trace = max(line(g.x, 0.025) * step(0.5, hash(cell + 7.0)), line(g.y, 0.025) * step(0.5, hash(cell + 3.0))) * on;
        float spark = smoothstep(0.94, 1.0, fract(hash(cell) * 9.0 + uTime * 0.2));
        col = mix(col, uLine, trace * (0.25 + spark * 0.45) * uTrace);
        vec2 f = fract(g) - 0.5;
        col = mix(col, uLine, on * smoothstep(0.08, 0.0, length(f)) * 0.5 * uTrace);
        // light glow along the quay
        col = mix(col, uLine, exp(-max(0.0, uQuayX - vWorld.x) * 0.5) * 0.35);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

/** Fine survey grid painted on the concrete. */
export function gridMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: sharedTime,
      uColor: { value: new THREE.Color('#6b7268') },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying vec3 vWorld;
      // 1 on the grid line, fading to 0 within w of it
      float line(float v, float w) {
        float d = abs(fract(v + 0.5) - 0.5);
        return 1.0 - smoothstep(0.0, w, d);
      }
      void main() {
        vec2 g = vWorld.xz / 4.0;
        float minor = max(line(g.x, 0.018), line(g.y, 0.018));
        vec2 G = vWorld.xz / 20.0;
        float major = max(line(G.x, 0.01), line(G.y, 0.01));
        float a = minor * 0.07 + major * 0.16;
        gl_FragColor = vec4(uColor, a);
      }
    `,
  });
}

/**
 * Data-flow line: a soft glowing band with streaks running from start to end,
 * coloured from uColor to uColorB along its length (uv.x 0 -> 1).
 */
export function flowMaterial(tone: Tone = 'normal', opts: { speed?: number; opacity?: number; dashes?: number } = {}): THREE.ShaderMaterial {
  const [a, b] = toneColors(tone);
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
    uniforms: {
      uTime: sharedTime,
      uColor: { value: a.clone() },
      uColorB: { value: b.clone() },
      uSpeed: { value: opts.speed ?? 0.35 },
      uDashes: { value: opts.dashes ?? 8 },
      uOpacity: { value: opts.opacity ?? 1 },
      uIntensity: { value: 1.25 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      uniform vec3 uColorB;
      uniform float uSpeed;
      uniform float uDashes;
      uniform float uOpacity;
      uniform float uIntensity;
      varying vec2 vUv;
      void main() {
        float across = abs(vUv.y - 0.5) * 2.0;
        float core = 1.0 - smoothstep(0.0, 1.0, across);
        float p = fract(vUv.x * uDashes - uTime * uSpeed * uDashes * 0.25);
        float streak = smoothstep(0.0, 0.25, p) * (1.0 - smoothstep(0.45, 0.8, p));
        float ends = smoothstep(0.0, 0.04, vUv.x) * smoothstep(1.0, 0.96, vUv.x);
        float glow = (0.5 + streak * 0.5) * core * ends;
        vec3 col = mix(uColor, uColorB, vUv.x);
        col = mix(col, vec3(1.0), streak * 0.35);
        gl_FragColor = vec4(col, clamp(glow * 1.25, 0.0, 1.0) * uOpacity);
      }
    `,
  });
}

/** Soft pulsing ring on the ground; only shown when something needs attention. */
export function ringMaterial(tone: Tone = 'normal'): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
    uniforms: {
      uTime: sharedTime,
      uColor: { value: toneColor(tone).clone() },
      uPulse: { value: 1 },
      uIntensity: { value: 1.2 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      uniform float uPulse;
      uniform float uIntensity;
      varying vec2 vUv;
      void main() {
        float r = length(vUv - 0.5) * 2.0;
        if (r > 1.0) discard;
        float rim = smoothstep(0.9, 0.95, r) * (1.0 - smoothstep(0.97, 1.0, r));
        float wave = fract(uTime * 0.45);
        float ripple = uPulse * smoothstep(wave - 0.08, wave, r) * (1.0 - smoothstep(wave, wave + 0.02, r)) * (1.0 - wave);
        float fill = (1.0 - r) * 0.08 * uPulse;
        float a = rim * 0.8 + ripple * 0.8 + fill;
        gl_FragColor = vec4(uColor, clamp(a, 0.0, 1.0));
      }
    `,
  });
}

/** Vertical column of light rising from an incident. */
export function beamMaterial(tone: Tone = 'normal'): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
    uniforms: {
      uTime: sharedTime,
      uColor: { value: toneColor(tone).clone() },
      uIntensity: { value: 1.0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      uniform float uIntensity;
      varying vec2 vUv;
      void main() {
        float fade = pow(1.0 - vUv.y, 2.2);
        float flicker = 0.85 + 0.15 * sin(uTime * 3.0 + vUv.y * 12.0);
        float a = fade * flicker * 0.32;
        gl_FragColor = vec4(uColor, a);
      }
    `,
  });
}

export function setTone(mat: THREE.ShaderMaterial, tone: Tone) {
  const [a, b] = toneColors(tone);
  (mat.uniforms.uColor.value as THREE.Color).copy(a);
  if (mat.uniforms.uColorB) (mat.uniforms.uColorB.value as THREE.Color).copy(b);
}

/** A canvas texture of office windows, some lit, for the skyline. */
export function windowTexture(seed = 1, warm = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#eceeea';
  g.fillRect(0, 0, c.width, c.height);
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (let y = 4; y < c.height - 4; y += 6) {
    for (let x = 4; x < c.width - 4; x += 6) {
      const r = rnd();
      if (r < 0.5) {
        g.fillStyle = 'rgba(150,170,185,0.55)';
        g.fillRect(x, y, 3, 3);
        continue;
      }
      const lum = 0.45 + rnd() * 0.55;
      const col = warm ? (r > 0.92 ? [120, 160, 190] : [140, 165, 182]) : [110, 150, 180];
      g.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${lum})`;
      g.fillRect(x, y, 3, 3);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  return tex;
}
