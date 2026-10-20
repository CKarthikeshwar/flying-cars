import {
  CanvasTexture,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  BoxGeometry,
  PlaneGeometry,
  PerspectiveCamera,
  RepeatWrapping,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  LinearMipmapLinearFilter,
} from 'three';

const GRID_CELL = 8; // m, one repeat of the ground texture
const PLANE_SIZE = GRID_CELL * 500; // m
const PYLON_CELL = 120; // m between pylon slots
const PYLON_RADIUS = 7; // slots in each direction around the car
const PYLON_SLOTS = (PYLON_RADIUS * 2 + 1) ** 2;
const PYLON_COLORS = [0x19e3ff, 0xff7a1a, 0x19e3ff, 0xb8ff3c];

/** A deterministic 0..1 hash of two integers, so pylons stay put as the cell window slides. */
function hash2(x: number, z: number, salt: number): number {
  let h = (x * 374761393 + z * 668265263 + salt * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function makeSkyTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const g = c.getContext('2d');
  if (g) {
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#05070c');
    grad.addColorStop(0.55, '#0b1524');
    grad.addColorStop(0.78, '#1a1230');
    grad.addColorStop(1, '#241338');
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 256);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function makeGridTexture(renderer: WebGLRenderer): CanvasTexture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (g) {
    g.fillStyle = '#0a1016';
    g.fillRect(0, 0, size, size);
    g.fillStyle = '#0e1620';
    g.fillRect(2, 2, size - 4, size - 4);
    g.strokeStyle = '#1c8da0';
    g.lineWidth = 3;
    g.strokeRect(0, 0, size, size);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(PLANE_SIZE / GRID_CELL, PLANE_SIZE / GRID_CELL);
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  t.minFilter = LinearMipmapLinearFilter;
  return t;
}

/** The world: renderer, scene, lights, sky, an endless-looking floor and neon pylons for a sense of speed. */
export class World3D {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;

  private readonly ground: Mesh;
  private readonly sun = new DirectionalLight(0xbfd8ff, 1.1);
  private readonly pylons: InstancedMesh;
  private pylonCellX = Number.NaN;
  private pylonCellZ = Number.NaN;
  private readonly matrix = new Matrix4();
  private readonly color = new Color();
  private readonly scale = new Vector3();
  private readonly position = new Vector3();

  constructor(container: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // cap the cost on dense screens
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(this.renderer.domElement);

    this.camera = new PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 4000);

    this.scene.background = makeSkyTexture();
    this.scene.fog = new Fog(0x14102a, 160, 1100);

    this.scene.add(new HemisphereLight(0x6f8fb8, 0x0a0d12, 1.1));
    this.sun.position.set(40, 80, 25);
    this.scene.add(this.sun, this.sun.target);

    const groundMat = new MeshStandardMaterial({
      map: makeGridTexture(this.renderer),
      roughness: 0.55,
      metalness: 0.3,
    });
    this.ground = new Mesh(new PlaneGeometry(PLANE_SIZE, PLANE_SIZE), groundMat);
    this.ground.rotation.x = -Math.PI / 2;
    this.scene.add(this.ground);

    this.pylons = new InstancedMesh(
      new BoxGeometry(1, 1, 1),
      new MeshBasicMaterial({ color: 0xffffff }),
      PYLON_SLOTS,
    );
    this.pylons.frustumCulled = false;
    this.scene.add(this.pylons);

    window.addEventListener('resize', this.resize);
  }

  private readonly resize = (): void => {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  };

  /** Keeps the floor and the pylon window centred on the car so the world looks endless. */
  follow(carPosition: Vector3): void {
    this.ground.position.x = Math.round(carPosition.x / GRID_CELL) * GRID_CELL;
    this.ground.position.z = Math.round(carPosition.z / GRID_CELL) * GRID_CELL;
    this.sun.position.set(carPosition.x + 40, 80, carPosition.z + 25);
    this.sun.target.position.copy(carPosition);

    const cx = Math.round(carPosition.x / PYLON_CELL);
    const cz = Math.round(carPosition.z / PYLON_CELL);
    if (cx !== this.pylonCellX || cz !== this.pylonCellZ) {
      this.pylonCellX = cx;
      this.pylonCellZ = cz;
      this.layoutPylons(cx, cz);
    }
  }

  private layoutPylons(cx: number, cz: number): void {
    let n = 0;
    for (let dx = -PYLON_RADIUS; dx <= PYLON_RADIUS; dx++) {
      for (let dz = -PYLON_RADIUS; dz <= PYLON_RADIUS; dz++) {
        const gx = cx + dx;
        const gz = cz + dz;
        const exists = hash2(gx, gz, 1) < 0.6;
        const nearSpawn = Math.abs(gx) <= 0 && Math.abs(gz) <= 0; // keep the start area clear
        const height = 4 + hash2(gx, gz, 2) * 26;
        const width = 1.5 + hash2(gx, gz, 3) * 2.5;
        if (!exists || nearSpawn) {
          this.scale.set(0, 0, 0);
        } else {
          this.scale.set(width, height, width);
        }
        this.position.set(
          (gx + (hash2(gx, gz, 4) - 0.5) * 0.6) * PYLON_CELL,
          height / 2,
          (gz + (hash2(gx, gz, 5) - 0.5) * 0.6) * PYLON_CELL,
        );
        this.matrix.makeScale(this.scale.x, this.scale.y, this.scale.z);
        this.matrix.setPosition(this.position);
        this.pylons.setMatrixAt(n, this.matrix);
        const pick = PYLON_COLORS[Math.floor(hash2(gx, gz, 6) * PYLON_COLORS.length)] ?? 0x19e3ff;
        this.pylons.setColorAt(n, this.color.setHex(pick));
        n++;
      }
    }
    this.pylons.count = n;
    this.pylons.instanceMatrix.needsUpdate = true;
    if (this.pylons.instanceColor) this.pylons.instanceColor.needsUpdate = true;
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
