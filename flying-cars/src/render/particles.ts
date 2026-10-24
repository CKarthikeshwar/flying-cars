import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  NormalBlending,
  Points,
  ShaderMaterial,
} from 'three';

/**
 * Particle data, with no graphics in it. A fixed pool: spawning when the pool is full recycles the oldest
 * particle, so nothing is allocated while the game runs. Each particle has a position and velocity, an age
 * and a life, a size that grows from `size0` to `size1`, and a colour.
 */
export class ParticlePool {
  readonly capacity: number;
  readonly position: Float32Array;
  readonly velocity: Float32Array;
  readonly age: Float32Array;
  /** Seconds the particle lives. Zero means the slot is free. */
  readonly life: Float32Array;
  readonly size0: Float32Array;
  readonly size1: Float32Array;
  readonly color: Float32Array;
  private next = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.position = new Float32Array(capacity * 3);
    this.velocity = new Float32Array(capacity * 3);
    this.age = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.size0 = new Float32Array(capacity);
    this.size1 = new Float32Array(capacity);
    this.color = new Float32Array(capacity * 3);
  }

  spawn(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    size0: number,
    size1: number,
    r: number,
    g: number,
    b: number,
  ): void {
    const i = this.next;
    this.next = (this.next + 1) % this.capacity; // when full this overwrites the oldest
    this.position[i * 3] = x;
    this.position[i * 3 + 1] = y;
    this.position[i * 3 + 2] = z;
    this.velocity[i * 3] = vx;
    this.velocity[i * 3 + 1] = vy;
    this.velocity[i * 3 + 2] = vz;
    this.age[i] = 0;
    this.life[i] = life;
    this.size0[i] = size0;
    this.size1[i] = size1;
    this.color[i * 3] = r;
    this.color[i * 3 + 1] = g;
    this.color[i * 3 + 2] = b;
  }

  /** Moves and ages every live particle. `drag` is a per-second slowdown, `gravity` is added to the y velocity. */
  update(dt: number, drag: number, gravity: number): void {
    const keep = Math.exp(-drag * dt);
    for (let i = 0; i < this.capacity; i++) {
      const life = this.life[i] ?? 0;
      if (life <= 0) continue;
      const age = (this.age[i] ?? 0) + dt;
      if (age >= life) {
        this.life[i] = 0; // expired: free the slot
        continue;
      }
      this.age[i] = age;
      const k = i * 3;
      this.velocity[k] = (this.velocity[k] ?? 0) * keep;
      this.velocity[k + 1] = (this.velocity[k + 1] ?? 0) * keep + gravity * dt;
      this.velocity[k + 2] = (this.velocity[k + 2] ?? 0) * keep;
      this.position[k] = (this.position[k] ?? 0) + (this.velocity[k] ?? 0) * dt;
      this.position[k + 1] = (this.position[k + 1] ?? 0) + (this.velocity[k + 1] ?? 0) * dt;
      this.position[k + 2] = (this.position[k + 2] ?? 0) + (this.velocity[k + 2] ?? 0) * dt;
    }
  }

  /** How many particles are alive. */
  alive(): number {
    let n = 0;
    for (let i = 0; i < this.capacity; i++) if ((this.life[i] ?? 0) > 0) n++;
    return n;
  }

  /** Age as a fraction of life, 0 when new and 1 when about to expire. */
  progress(i: number): number {
    const life = this.life[i] ?? 0;
    return life > 0 ? (this.age[i] ?? 0) / life : 1;
  }
}

const VERTEX = `
  attribute vec3 aColor;
  attribute vec2 aState; // x: how far through its life (0 to 1), y: size in metres
  uniform float uScale;  // pixels per metre at distance 1
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aState.y * uScale / max(0.2, -mv.z);
    float fade = 1.0 - aState.x;
    vAlpha = fade * fade;
    vColor = aColor;
  }
`;

const FRAGMENT = `
  varying vec3 vColor;
  varying float vAlpha;
  uniform float uOpacity;
  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    if (d > 0.5) discard;
    float soft = smoothstep(0.5, 0.05, d);
    gl_FragColor = vec4(vColor, vAlpha * soft * uOpacity);
  }
`;

/** A pool drawn as soft round points. Glowing (additive) or ordinary blending. */
export class ParticleSystem {
  readonly pool: ParticlePool;
  readonly points: Points;
  private readonly material: ShaderMaterial;
  private readonly state: Float32Array;
  private readonly stateAttribute: BufferAttribute;
  private readonly positionAttribute: BufferAttribute;
  private readonly colorAttribute: BufferAttribute;

  constructor(capacity: number, additive: boolean, opacity: number) {
    this.pool = new ParticlePool(capacity);
    this.state = new Float32Array(capacity * 2);
    const geometry = new BufferGeometry();
    this.positionAttribute = new BufferAttribute(this.pool.position, 3);
    this.colorAttribute = new BufferAttribute(this.pool.color, 3);
    this.stateAttribute = new BufferAttribute(this.state, 2);
    for (const a of [this.positionAttribute, this.colorAttribute, this.stateAttribute]) {
      a.setUsage(35048); // DynamicDrawUsage: rewritten every frame
    }
    geometry.setAttribute('position', this.positionAttribute);
    geometry.setAttribute('aColor', this.colorAttribute);
    geometry.setAttribute('aState', this.stateAttribute);
    this.material = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: { uScale: { value: 600 }, uOpacity: { value: opacity } },
      transparent: true,
      depthWrite: false,
      blending: additive ? AdditiveBlending : NormalBlending,
    });
    this.points = new Points(geometry, this.material);
    this.points.frustumCulled = false; // the bounds are not tracked, and there are few points
  }

  /** Pixels per metre at distance one, from the camera and the size of the drawing buffer. */
  setViewScale(pixelsPerMetre: number): void {
    const uniform = this.material.uniforms['uScale'];
    if (uniform) uniform.value = pixelsPerMetre;
  }

  /** Advances the particles and refreshes what the graphics card sees. */
  update(dt: number, drag: number, gravity: number): void {
    const pool = this.pool;
    pool.update(dt, drag, gravity);
    for (let i = 0; i < pool.capacity; i++) {
      const p = pool.progress(i);
      const dead = (pool.life[i] ?? 0) <= 0;
      this.state[i * 2] = dead ? 1 : p;
      this.state[i * 2 + 1] = dead
        ? 0
        : (pool.size0[i] ?? 0) + ((pool.size1[i] ?? 0) - (pool.size0[i] ?? 0)) * p;
    }
    this.positionAttribute.needsUpdate = true;
    this.colorAttribute.needsUpdate = true;
    this.stateAttribute.needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}
