// The home page's 3D devices: an iPhone and an iPhone Duo modelled in code (three.js), each showing GrocGo's real
// screens (screens/*.webp, made by prepare-media.py). site.js decides what they show; this file only knows how to
// draw them, turn them and change their screens.
//
// One unit is 100 mm: the iPhone 18 Pro Max is 0.776 wide.
import {
  ACESFilmicToneMapping,
  AmbientLight,
  Box3,
  BoxGeometry,
  CylinderGeometry,
  DirectionalLight,
  ExtrudeGeometry,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  PerspectiveCamera,
  PMREMGenerator,
  PointLight,
  RoomEnvironment,
  Scene,
  Shape,
  ShapeGeometry,
  ShaderMaterial,
  SRGBColorSpace,
  Texture,
  Vector2,
  Vector3,
  WebGLRenderer,
} from './vendor/three.min.js';
import { assetUrl } from './assets.js';

const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
const REDUCED_MOTION = motionPreference.matches;
/** A phone or tablet, where the devices draw lighter. */
const TOUCH_SCREEN = matchMedia('(hover: none) and (pointer: coarse)').matches;
const SCREEN_FOLDER = 'screens/';
/** How fast a device eases into a new pose (per second); higher is snappier. */
const POSE_RATE = REDUCED_MOTION ? 60 : 3.6;
/** A screen dims to black and comes back lit with the next picture, like the app changing screens. */
const SCREEN_DIM_SECONDS = REDUCED_MOTION ? 0 : 0.16;
const SCREEN_LIGHT_SECONDS = REDUCED_MOTION ? 0 : 0.3;
const MAX_PIXEL_RATIO = TOUCH_SCREEN ? 1.5 : 2;
const MAX_DRAWING_PIXELS = 1_500_000;
const FIELD_OF_VIEW = 26;

/** The iPhone 18 Pro Max: body, glass and screen (its 1320 x 2868 pixels). */
const IPHONE = { width: 0.776, depth: 0.083, radius: 0.125, bevel: 0.022, bezel: 0.018, screenAspect: 1320 / 2868 };
/** How dark the Duo's open screen gets as it folds shut (0-1, at fully shut): the half that swings over, the half
 * that stays, and the shadow along the fold. */
const FOLD_SHADOW = { swinging: 0.55, staying: 0.2, crease: 0.85 };
/** iPhone Duo: two halves on a hinge; the open screen is 2853 x 2007 across both, the cover screen 1398 x 2034. */
const DUO = { halfWidth: 0.9875, height: 1.4, depth: 0.042, gap: 0.004, radius: 0.12, bevel: 0.014, bezel: 0.018, coverAspect: 1398 / 2034 };

/** Corners of a rounded rectangle, in the order the shape draws them. */
const ALL_CORNERS = Object.freeze({ bottomLeft: true, bottomRight: true, topRight: true, topLeft: true });
/** A Duo half is square on its hinge side. */
const RIGHT_HALF_CORNERS = Object.freeze({ bottomLeft: false, bottomRight: true, topRight: true, topLeft: false });
const LEFT_HALF_CORNERS = Object.freeze({ bottomLeft: true, bottomRight: false, topRight: false, topLeft: true });
/** A hair's breadth between stacked surfaces, so they never flicker through each other. */
const LAYER = 0.0008;

// ---------------------------------------------------------------- shapes

function roundedRectShape(width, height, radius, corners = ALL_CORNERS) {
  const left = -width / 2;
  const right = width / 2;
  const bottom = -height / 2;
  const top = height / 2;
  const r = (rounded) => (rounded ? radius : 0);
  const shape = new Shape();
  shape.moveTo(left + r(corners.bottomLeft), bottom);
  shape.lineTo(right - r(corners.bottomRight), bottom);
  if (corners.bottomRight) shape.absarc(right - radius, bottom + radius, radius, -Math.PI / 2, 0, false);
  shape.lineTo(right, top - r(corners.topRight));
  if (corners.topRight) shape.absarc(right - radius, top - radius, radius, 0, Math.PI / 2, false);
  shape.lineTo(left + r(corners.topLeft), top);
  if (corners.topLeft) shape.absarc(left + radius, top - radius, radius, Math.PI / 2, Math.PI, false);
  shape.lineTo(left, bottom + r(corners.bottomLeft));
  if (corners.bottomLeft) shape.absarc(left + radius, bottom + radius, radius, Math.PI, Math.PI * 1.5, false);
  return shape;
}

/** A device body: a rounded slab centred on the origin, its edges softened by `bevel`. */
function slabGeometry({ width, height, depth, radius, bevel, corners = ALL_CORNERS }) {
  const core = roundedRectShape(width - 2 * bevel, height - 2 * bevel, Math.max(radius - bevel, 0.002), corners);
  const geometry = new ExtrudeGeometry(core, {
    depth: depth - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 8, curveSegments: 28,
  });
  geometry.translate(0, 0, -(depth - 2 * bevel) / 2);
  return geometry;
}

/**
 * A flat face (glass or screen) facing +z, its texture spread over it. `uv` picks the part of the picture it shows as
 * [left, bottom, right, top] in 0-1 (a Duo half shows half of the open screen).
 */
function faceGeometry({ width, height, radius, corners = ALL_CORNERS, uv = [0, 0, 1, 1] }) {
  const geometry = new ShapeGeometry(roundedRectShape(width, height, radius, corners), 28);
  const positions = geometry.attributes.position;
  const uvs = geometry.attributes.uv;
  const [uvLeft, uvBottom, uvRight, uvTop] = uv;
  for (let index = 0; index < positions.count; index += 1) {
    const across = positions.getX(index) / width + 0.5;
    const up = positions.getY(index) / height + 0.5;
    uvs.setXY(index, uvLeft + across * (uvRight - uvLeft), uvBottom + up * (uvTop - uvBottom));
  }
  return geometry;
}

// ---------------------------------------------------------------- materials and screens

/**
 * Each device's finish, matte (the owner's choice: no shine, no metal gleam), so frame, back and camera bar read as one
 * soft-touch colour: the iPhone a green so dark it is nearly black, the iPhone Duo black. Change a finish here and that
 * device follows.
 */
const FINISHES = {
  iphone: { metal: 0x18231b, backMetal: 0x141e17, panel: 0x111a14 },
  duo: { metal: 0x1b1b1e, backMetal: 0x161618, panel: 0x131315 },
};
/** Matte: almost no metal, a rough surface and little of the room mirrored in it. */
const MATTE = { metalness: 0.08, roughness: 0.88, envMapIntensity: 0.35 };

/** A lens's glass, drawn once: near-black depth, the rings of the elements inside, a violet glint. */
function lensGlassTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const paint = canvas.getContext('2d');
  const middle = size / 2;
  const depth = paint.createRadialGradient(middle, middle, 0, middle, middle, middle);
  depth.addColorStop(0, '#1b2346');
  depth.addColorStop(0.22, '#0a0e1e');
  depth.addColorStop(0.75, '#030307');
  depth.addColorStop(1, '#0d0c12');
  paint.fillStyle = depth;
  paint.fillRect(0, 0, size, size);
  paint.strokeStyle = 'rgba(130, 135, 185, 0.28)';
  paint.lineWidth = 3;
  for (const ring of [0.66, 0.46, 0.27]) {
    paint.beginPath();
    paint.arc(middle, middle, middle * ring, 0, Math.PI * 2);
    paint.stroke();
  }
  paint.strokeStyle = 'rgba(165, 125, 235, 0.38)';
  paint.lineWidth = 9;
  paint.beginPath();
  paint.arc(middle, middle, middle * 0.52, Math.PI * 1.08, Math.PI * 1.42);
  paint.stroke();
  paint.fillStyle = 'rgba(255, 255, 255, 0.4)';
  paint.beginPath();
  paint.arc(middle * 0.7, middle * 0.66, middle * 0.06, 0, Math.PI * 2);
  paint.fill();
  const texture = new Texture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createMaterials(finish) {
  return {
    frame: new MeshPhysicalMaterial({ color: finish.metal, ...MATTE }),
    glass: new MeshPhysicalMaterial({ color: 0x050506, metalness: 0, roughness: 0.5 }),
    // The back: the body, the camera bar in the same colour, and a frosted glass panel below the bar.
    back: new MeshPhysicalMaterial({ color: finish.backMetal, ...MATTE }),
    plateau: new MeshPhysicalMaterial({ color: finish.metal, ...MATTE }),
    panel: new MeshPhysicalMaterial({ color: finish.panel, ...MATTE, roughness: 0.94 }),
    lensRing: new MeshPhysicalMaterial({ color: 0x0c0b0e, ...MATTE }),
    // A soft reflection travels across the optical glass as the camera turns. Its element rings stay visible below.
    lens: new MeshPhysicalMaterial({ map: lensGlassTexture(), roughness: 0.28, clearcoat: 0.65, clearcoatRoughness: 0.16, envMapIntensity: 0.45 }),
    dark: new MeshBasicMaterial({ color: 0x050407 }),
    flash: new MeshPhysicalMaterial({ color: 0xe8e1cf, metalness: 0, roughness: 0.55, emissive: 0x2a271f }),
  };
}

const imageRequests = new Map();

/** A screen picture by name, fetched once for the whole page whichever device shows it. */
function loadScreenImage(name) {
  if (!imageRequests.has(name)) {
    imageRequests.set(name, new Promise((resolve, reject) => {
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`screen "${name}" did not load from ${image.src}`));
      image.src = assetUrl(`${SCREEN_FOLDER}${name}.webp`);
    }));
  }
  return imageRequests.get(name);
}

/** The screen pictures as textures of one device's WebGL context (textures cannot be shared between contexts). */
class TextureLibrary {
  constructor(renderer) {
    this.anisotropy = renderer.capabilities.getMaxAnisotropy();
    this.textures = new Map();
  }

  load(name) {
    if (!this.textures.has(name)) {
      this.textures.set(name, loadScreenImage(name).then((image) => {
        const texture = new Texture(image);
        texture.colorSpace = SRGBColorSpace;
        texture.anisotropy = this.anisotropy;
        texture.needsUpdate = true;
        return texture;
      }));
    }
    return this.textures.get(name);
  }
}

/**
 * How a screen changes to its next picture. `dim`: it dims to black and lights up with the next one (a change of
 * screen). The others copy GrocGo's own side pane on iPhone Duo (GrocGo/components/layout/sidePaneMotion.ts), each
 * frame giving how much of the next picture shows (`amount`) and how far it sits to the right (`offset`, a share of the
 * open screen's width):
 * - `resize`: the list beside the pane changes its width over 420 ms (cubic ease in and out); drawn as a blend.
 * - `paneIn`: the pane fades in over 150 ms while it travels in from 64 points to the right, 240 ms past its resting
 *   edge by 18 points, then settles on a tight spring (stiffness 380, damping 21, mass 0.85).
 * - `paneOut`: the pane fades out over 140 ms.
 */
const DUO_OPEN_WIDTH_POINTS = 951;
const PANE_ENTER_OFFSET = 64 / DUO_OPEN_WIDTH_POINTS;
const PANE_ENTER_OVERSHOOT = 18 / DUO_OPEN_WIDTH_POINTS;
const SPRING = { stiffness: 380, damping: 21, mass: 0.85, seconds: 0.45 };
const easeOutCubic = (amount) => 1 - (1 - amount) ** 3;
const easeInOutCubic = (amount) => (amount < 0.5 ? 4 * amount ** 3 : 1 - (-2 * amount + 2) ** 3 / 2);
/** Where the spring holds the pane `seconds` after it starts from the overshoot, at rest. */
function springOffset(seconds) {
  const natural = Math.sqrt(SPRING.stiffness / SPRING.mass);
  const dampingRatio = SPRING.damping / (2 * Math.sqrt(SPRING.stiffness * SPRING.mass));
  const damped = natural * Math.sqrt(1 - dampingRatio ** 2);
  const decay = Math.exp(-dampingRatio * natural * seconds);
  return -PANE_ENTER_OVERSHOOT * decay * (Math.cos(damped * seconds) + (dampingRatio * natural / damped) * Math.sin(damped * seconds));
}
const CHANGES = {
  resize: { seconds: 0.42, frame: (t) => ({ amount: easeInOutCubic(t / 0.42), offset: 0 }) },
  paneIn: {
    seconds: 0.24 + SPRING.seconds,
    frame: (t) => ({
      amount: Math.min(1, t / 0.15),
      offset: t < 0.24 ? PANE_ENTER_OFFSET + (-PANE_ENTER_OVERSHOOT - PANE_ENTER_OFFSET) * easeOutCubic(t / 0.24) : springOffset(t - 0.24),
    }),
  },
  paneOut: { seconds: 0.14, frame: (t) => ({ amount: t / 0.14, offset: 0 }) },
};

// A screen draws its picture (and, during a change, the next one over it) without lighting or tone mapping, so the
// app's colours show as they are. `pane` is the part of the picture across (0-1) this screen shows: a Duo half shows
// half; where the next picture has moved off that part, the current one shows.
const SCREEN_VERTEX_SHADER = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const SCREEN_FRAGMENT_SHADER = `
uniform sampler2D current;
uniform sampler2D next;
uniform float amount;
uniform float offset;
uniform float brightness;
uniform vec2 pane;
uniform float shade;
uniform float crease;
uniform float shadowReach;
varying vec2 vUv;
void main() {
  vec4 color = texture2D(current, vUv);
  vec2 from = vec2(vUv.x - offset, vUv.y);
  if (amount > 0.0 && from.x >= pane.x && from.x <= pane.y) color = mix(color, texture2D(next, from), amount);
  // Folding, a Duo screen falls into shadow: all of it by shade, and most of all along the fold (u = 0.5), where the
  // two halves close over each other, by crease. Open flat, and on every other screen, both are 0.
  float light = brightness * (1.0 - shade);
  if (crease > 0.0) {
    float distanceFromFold = 2.0 * abs(vUv.x - 0.5);
    light *= 1.0 - crease * exp(-distanceFromFold / 0.28);
    // The swinging half casts a soft-edged shadow on the stationary display. Its edge retreats to the hinge.
    float penumbra = 0.12 + 0.16 * shadowReach;
    float covered = 1.0 - smoothstep(shadowReach - penumbra, shadowReach + penumbra, distanceFromFold);
    light *= 1.0 - 0.72 * smoothstep(0.0, 0.32, shadowReach) * covered;
  }
  gl_FragColor = vec4(color.rgb * light, 1.0);
  #include <colorspace_fragment>
}`;

/** One lit screen: the picture, with no glare over it, and the change from one picture to the next (CHANGES). */
class Screen {
  constructor(geometry, library, pane = [0, 1]) {
    this.library = library;
    this.uniforms = {
      current: { value: new Texture() }, next: { value: new Texture() }, amount: { value: 0 }, offset: { value: 0 },
      brightness: { value: 0 }, pane: { value: new Vector2(pane[0], pane[1]) }, shade: { value: 0 }, crease: { value: 0 }, shadowReach: { value: 0 },
    };
    this.material = new ShaderMaterial({ uniforms: this.uniforms, vertexShader: SCREEN_VERTEX_SHADER, fragmentShader: SCREEN_FRAGMENT_SHADER });
    this.object = new Group();
    this.object.add(new Mesh(geometry, this.material));
    this.brightness = 0;
    this.wanted = null;
    this.shown = null;
    this.pending = null;
    this.pendingChange = 'dim';
    this.change = null;
    this.changeSeconds = 0;
    this.hasPicture = false;
    this.onFirstPicture = null;
  }

  /** Shows the named picture as soon as it has loaded, changing to it as `change` says; a later call wins. */
  show(name, change = 'dim') {
    if (this.wanted === name) return;
    this.wanted = name;
    this.library.load(name).then((texture) => {
      if (this.wanted !== name) return;
      this.pending = texture;
      this.pendingChange = change;
    }).catch((error) => console.warn('[GrocGo site] screen picture', error));
  }

  update(seconds) {
    const { uniforms } = this;
    if (this.change) {
      this.changeSeconds = Math.min(this.change.seconds, this.changeSeconds + seconds);
      const { amount, offset } = this.change.frame(this.changeSeconds);
      uniforms.amount.value = amount;
      uniforms.offset.value = offset;
      if (this.changeSeconds === this.change.seconds) {
        uniforms.current.value = uniforms.next.value;
        uniforms.amount.value = 0;
        uniforms.offset.value = 0;
        this.shown = uniforms.current.value;
        this.change = null;
      }
    }
    const waiting = !this.change && this.pending && this.pending !== this.shown;
    if (waiting && this.shown && CHANGES[this.pendingChange] && !REDUCED_MOTION) {
      uniforms.next.value = this.pending;
      this.change = CHANGES[this.pendingChange];
      this.changeSeconds = 0;
      this.pending = null;
    } else if (waiting) {
      this.brightness = SCREEN_DIM_SECONDS > 0 && this.shown ? Math.max(0, this.brightness - seconds / SCREEN_DIM_SECONDS) : 0;
      if (this.brightness === 0) {
        const first = !this.hasPicture;
        uniforms.current.value = this.pending;
        this.shown = this.pending;
        this.hasPicture = true;
        if (first && this.onFirstPicture) this.onFirstPicture();
      }
    } else if (this.shown || this.change) {
      this.brightness = SCREEN_LIGHT_SECONDS > 0 ? Math.min(1, this.brightness + seconds / SCREEN_LIGHT_SECONDS) : 1;
    }
    uniforms.brightness.value = this.brightness;
  }
}

// ---------------------------------------------------------------- the devices

/** A side button: a slim, rounded-looking key that barely stands proud of the frame. */
function sideButton(materials, x, y, length) {
  const button = new Mesh(new BoxGeometry(0.008, length, 0.026), materials.frame);
  button.position.set(x, y, 0);
  return button;
}

/** A disc facing out of the back (-z), `thickness` deep, its outer face at `face`. */
function backDisc(material, radius, thickness, x, y, face) {
  const disc = new Mesh(new CylinderGeometry(radius, radius, thickness, 64), material);
  disc.rotation.x = Math.PI / 2;
  disc.position.set(x, y, face + thickness / 2);
  return disc;
}

/**
 * A camera lens as the iPhone's are built: a thick raised ring in the body's metal, a black inner ring, and the glass
 * with its elements inside.
 */
function lens(materials, x, y, face, radius) {
  const lensGroup = new Group();
  lensGroup.add(
    backDisc(materials.plateau, radius, 0.028, x, y, face),
    backDisc(materials.lensRing, radius * 0.84, 0.029, x, y, face - 0.0006),
    backDisc(materials.lens, radius * 0.7, 0.03, x, y, face - 0.0012),
  );
  return lensGroup;
}

/**
 * The camera bar across the top of a back, in the body's metal: three large lenses on the side that is on the left
 * seen from behind (two above each other, one between them further in), and on the other side the flash, a pin-hole
 * microphone and the dark depth sensor. Sizes follow the bar's height.
 */
function cameraPlateau(materials, { width, height, top, back, lensSide }) {
  const plateau = new Group();
  const depth = 0.016;
  const body = new Mesh(slabGeometry({ width, height, depth, radius: Math.min(0.105, height * 0.28), bevel: 0.007 }), materials.plateau);
  body.position.set(0, 0, back - depth / 2);
  plateau.add(body);
  const surface = back - depth;
  const radius = height * 0.235;
  const margin = height * 0.04;
  const near = lensSide * (width / 2 - margin - radius);
  const far = near - lensSide * radius * 2.05;
  const rise = radius * 1.04;
  plateau.add(
    lens(materials, near, rise, surface - 0.012, radius),
    lens(materials, near, -rise, surface - 0.012, radius),
    lens(materials, far, 0, surface - 0.012, radius),
  );
  const side = -lensSide * (width / 2 - margin - height * 0.11);
  plateau.add(
    backDisc(materials.lensRing, height * 0.085, 0.006, side, height * 0.27, surface - 0.004),
    backDisc(materials.flash, height * 0.068, 0.006, side, height * 0.27, surface - 0.0046),
    backDisc(materials.dark, height * 0.012, 0.004, side, height * 0.04, surface - 0.002),
    backDisc(materials.dark, height * 0.075, 0.004, side, -height * 0.24, surface - 0.003),
  );
  plateau.position.y = top - height / 2;
  return plateau;
}

/** The iPhone: frame, front glass with the screen, back glass with its camera plateau, and the side buttons. */
function buildIPhone(materials, library) {
  const screenWidth = IPHONE.width - 2 * IPHONE.bezel;
  const screenHeight = screenWidth / IPHONE.screenAspect;
  const height = screenHeight + 2 * IPHONE.bezel;
  const half = IPHONE.depth / 2;
  const glassInset = IPHONE.bevel * 0.55;
  const group = new Group();

  group.add(new Mesh(slabGeometry({ width: IPHONE.width, height, depth: IPHONE.depth, radius: IPHONE.radius, bevel: IPHONE.bevel }), materials.frame));
  const glassFace = faceGeometry({ width: IPHONE.width - 2 * glassInset, height: height - 2 * glassInset, radius: IPHONE.radius - glassInset });
  const front = new Mesh(glassFace, materials.glass);
  front.position.z = half + LAYER;
  const back = new Mesh(glassFace, materials.back);
  back.rotation.y = Math.PI;
  back.position.z = -half - LAYER;
  group.add(front, back);

  const screen = new Screen(faceGeometry({ width: screenWidth, height: screenHeight, radius: IPHONE.radius - IPHONE.bezel }), library);
  screen.object.position.z = half + 2 * LAYER;
  group.add(screen.object);

  // Seen from behind the lenses sit top left, which is the right side seen from the front.
  const plateauHeight = 0.42;
  const plateauTop = height / 2 - 0.022;
  group.add(cameraPlateau(materials, { width: IPHONE.width - 0.044, height: plateauHeight, top: plateauTop, back: -half, lensSide: 1 }));
  // The satin glass panel that fills the back below the camera bar.
  const panelTop = plateauTop - plateauHeight - 0.018;
  const panelBottom = -height / 2 + 0.03;
  const panel = new Mesh(faceGeometry({ width: IPHONE.width - 0.06, height: panelTop - panelBottom, radius: 0.09 }), materials.panel);
  panel.rotation.y = Math.PI;
  panel.position.set(0, (panelTop + panelBottom) / 2, -half - 2 * LAYER);
  group.add(panel);
  const edge = IPHONE.width / 2 + 0.002;
  group.add(
    sideButton(materials, -edge, 0.5, 0.06), sideButton(materials, -edge, 0.33, 0.12), sideButton(materials, -edge, 0.18, 0.12),
    sideButton(materials, edge, 0.28, 0.17), sideButton(materials, edge, -0.2, 0.11),
  );
  return { group, screen, width: IPHONE.width, height, screenWidth, screenHeight };
}

/**
 * The iPhone Duo. The right half stays put; the left half turns on the hinge (`fold`: 0 open flat, Math.PI shut on
 * top of the right half, its back with the cover screen facing out).
 */
function buildDuo(materials, library) {
  const { halfWidth: width, height, depth, gap, radius, bevel, bezel } = DUO;
  const group = new Group();
  const innerWidth = width - bezel;
  const innerHeight = height - 2 * bezel;
  const glassInset = bevel * 0.55;
  const glass = (corners) => faceGeometry({ width: width - glassInset, height: height - 2 * glassInset, radius: radius - glassInset, corners });

  // The right half, its inner face at z = depth / 2.
  const right = new Group();
  const rightBody = new Mesh(slabGeometry({ width, height, depth, radius, bevel, corners: RIGHT_HALF_CORNERS }), materials.frame);
  rightBody.position.x = width / 2;
  const rightGlass = new Mesh(glass(RIGHT_HALF_CORNERS), materials.glass);
  rightGlass.position.set(width / 2 - glassInset / 2, 0, depth / 2 + LAYER);
  const rightBack = new Mesh(glass(LEFT_HALF_CORNERS), materials.back);
  rightBack.rotation.y = Math.PI;
  rightBack.position.set(width / 2 - glassInset / 2, 0, -depth / 2 - LAYER);
  right.add(rightBody, rightGlass, rightBack);
  const innerRight = new Screen(faceGeometry({ width: innerWidth, height: innerHeight, radius: radius - bezel, corners: RIGHT_HALF_CORNERS, uv: [0.5, 0, 1, 1] }), library, [0.5, 1]);
  innerRight.object.position.set(innerWidth / 2, 0, depth / 2 + 2 * LAYER);
  right.add(innerRight.object);
  right.add(cameraPlateau(materials, { width: width - 0.05, height: 0.34, top: height / 2 - 0.025, back: -depth / 2, lensSide: 1 }).translateX(width / 2));
  group.add(right);

  // The left half hangs on the hinge, which sits level with the inner faces (half the gap above them).
  const hinge = new Group();
  const leftBody = new Mesh(slabGeometry({ width, height, depth, radius, bevel, corners: LEFT_HALF_CORNERS }), materials.frame);
  leftBody.position.set(-width / 2, 0, -depth / 2 - gap / 2);
  const leftGlass = new Mesh(glass(LEFT_HALF_CORNERS), materials.glass);
  leftGlass.position.set(-width / 2 + glassInset / 2, 0, -gap / 2 + LAYER);
  hinge.add(leftBody, leftGlass);
  const innerLeft = new Screen(faceGeometry({ width: innerWidth, height: innerHeight, radius: radius - bezel, corners: LEFT_HALF_CORNERS, uv: [0, 0, 0.5, 1] }), library, [0, 0.5]);
  innerLeft.object.position.set(-innerWidth / 2, 0, -gap / 2 + 2 * LAYER);
  hinge.add(innerLeft.object);
  // The cover: black glass and its screen on the left half's back.
  const coverBack = -depth - gap / 2;
  const coverGlass = new Mesh(glass(ALL_CORNERS), materials.glass);
  coverGlass.rotation.y = Math.PI;
  coverGlass.position.set(-width / 2, 0, coverBack - LAYER);
  const coverHeight = innerHeight;
  const cover = new Screen(faceGeometry({ width: coverHeight * DUO.coverAspect, height: coverHeight, radius: radius - bezel }), library);
  cover.object.rotation.y = Math.PI;
  cover.object.position.set(-width / 2, 0, coverBack - 2 * LAYER);
  hinge.add(coverGlass, cover.object);
  // Each half is rigid. Measure its case, glass and cameras once in its own local coordinates.
  const leftBounds = new Box3().setFromObject(hinge);
  const rightBounds = new Box3().setFromObject(right);
  hinge.position.z = depth / 2 + gap / 2;
  group.add(hinge);

  // The spine: flush with the halves when open, wrapping both of them when shut.
  const spine = new Mesh(new CylinderGeometry(1, 1, height * 0.96, 40), materials.frame);
  spine.geometry.computeBoundingBox();
  group.add(spine);
  // The crease: a dark line under the seam where the two halves of the open screen meet, so the lit metal of the
  // spine never shows through it.
  const crease = new Mesh(new BoxGeometry(0.006, innerHeight, 0.001), new MeshBasicMaterial({ color: 0x000000 }));
  crease.position.z = depth / 2 + LAYER;
  group.add(crease);

  function setFold(fold) {
    const shut = MathUtils.clamp(fold / Math.PI, 0, 1);
    hinge.rotation.y = fold;
    const spineRadius = MathUtils.lerp(depth / 2, depth + gap / 2, shut);
    spine.scale.set(spineRadius, 1, spineRadius);
    spine.position.z = MathUtils.lerp(0, depth / 2 + gap / 2, shut);
  }
  setFold(0);
  const part = new Box3();
  function measureBounds(bounds) {
    right.updateWorldMatrix(true, false);
    hinge.updateWorldMatrix(false, false);
    spine.updateWorldMatrix(false, false);
    bounds.copy(rightBounds).applyMatrix4(right.matrixWorld);
    bounds.union(part.copy(leftBounds).applyMatrix4(hinge.matrixWorld));
    bounds.union(part.copy(spine.geometry.boundingBox).applyMatrix4(spine.matrixWorld));
  }
  return { group, screens: { innerLeft, innerRight, cover }, setFold, measureBounds, halfWidth: width, height };
}

// ---------------------------------------------------------------- the stage: renderer, camera, lights, loop

function lightScene(scene, renderer) {
  const environment = new PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  // The matte cases need only broad reflections. Bake a small map once for this WebGL context.
  scene.environment = environment.fromScene(room, 0.04, 0.1, 100, { size: 64 }).texture;
  room.dispose();
  // Half the room's reflections: enough to show the shape, not a mirror.
  scene.environmentIntensity = 0.5;
  environment.dispose();
  const key = new DirectionalLight(0xffffff, 1.1);
  key.position.set(2, 3, 4);
  // The site's two glows: navy from the upper left, the app's orange from the lower right.
  const navy = new PointLight(0x4f6fd8, 5, 0, 1.6);
  navy.position.set(-2.2, 1.8, 0.4);
  const orange = new PointLight(0xff6a1a, 7, 0, 1.6);
  orange.position.set(2.2, -1.6, 0.2);
  // A soft light from behind and above, so the back shows its shape when the phone turns round.
  const backLight = new DirectionalLight(0xfff4ea, 0.32);
  backLight.position.set(-1.5, 2.5, -3.5);
  scene.add(key, backLight, navy, orange, new AmbientLight(0xffffff, 0.25));
}

/** A value that eases toward its target, frame by frame. */
class Eased {
  constructor(value, rate = POSE_RATE) {
    this.value = value;
    this.target = value;
    this.rate = rate;
  }

  step(seconds) {
    this.value = this.target + (this.value - this.target) * Math.exp(-this.rate * seconds);
    return this.value;
  }

  snap(value) {
    this.value = value;
    this.target = value;
  }
}

const stages = new Set();
let lastFrame = 0;
let frameRequest = null;

function loop(now) {
  const seconds = Math.min(0.05, lastFrame ? (now - lastFrame) / 1000 : 0);
  lastFrame = now;
  let running = false;
  for (const stage of stages) {
    if (!stage.visible) continue;
    running = true;
    stage.frame(seconds, now / 1000);
  }
  frameRequest = running && !document.hidden ? requestAnimationFrame(loop) : null;
  if (frameRequest === null) lastFrame = 0;
}

function wake() {
  if (frameRequest === null && !document.hidden) frameRequest = requestAnimationFrame(loop);
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) return wake();
  cancelAnimationFrame(frameRequest);
  frameRequest = null;
  lastFrame = 0;
});

/** What every device's canvas shares: renderer, scene, camera, lights, size, visibility, pointer tilt and drag. */
class Stage {
  constructor(canvas, finish) {
    this.canvas = canvas;
    // A phone's screen is sharp enough that smoothing the edges costs more than it shows; it keeps scrolling smooth.
    this.renderer = new WebGLRenderer({ canvas, antialias: !TOUCH_SCREEN, alpha: true, powerPreference: 'high-performance' });
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.scene = new Scene();
    this.camera = new PerspectiveCamera(FIELD_OF_VIEW, 1, 0.1, 40);
    this.materials = createMaterials(finish);
    this.library = new TextureLibrary(this.renderer);
    lightScene(this.scene, this.renderer);
    this.visible = false;
    this.aspect = 1;
    // Pointer tilt (hover) and drag turn the device a little on top of its pose; both ease back.
    this.tiltYaw = new Eased(0, 4);
    this.tiltPitch = new Eased(0, 4);
    this.dragYaw = new Eased(0, 5);

    new ResizeObserver(() => this.resize()).observe(canvas);
    new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      if (this.visible) wake();
    }, { rootMargin: '120px' }).observe(canvas);
    stages.add(this);
    this.resize();
  }

  resize() {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (!width || !height) return;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO, Math.sqrt(MAX_DRAWING_PIXELS / (width * height)));
    this.renderer.setDrawingBufferSize(width, height, pixelRatio);
    this.aspect = width / height;
    this.camera.aspect = this.aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Lets the pointer tilt the device as it moves over `area`, and dragging across the canvas turn it. */
  followPointer(area, { drag = false } = {}) {
    if (matchMedia('(hover: hover)').matches) {
      area.addEventListener('pointermove', (event) => {
        if (motionPreference.matches) return;
        const box = area.getBoundingClientRect();
        this.tiltYaw.target = ((event.clientX - box.left) / box.width - 0.5) * 0.3;
        this.tiltPitch.target = ((event.clientY - box.top) / box.height - 0.5) * 0.16;
      });
      area.addEventListener('pointerleave', () => { this.tiltYaw.target = 0; this.tiltPitch.target = 0; });
    }
    if (!drag) return;
    let start = null;
    this.canvas.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || motionPreference.matches) return;
      start = { x: event.clientX, yaw: this.dragYaw.value };
      this.canvas.setPointerCapture(event.pointerId);
      this.canvas.classList.add('is-dragging');
    });
    this.canvas.addEventListener('pointermove', (event) => {
      if (!start) return;
      this.dragYaw.target = start.yaw + (event.clientX - start.x) * 0.01;
      this.dragYaw.value = this.dragYaw.target;
    });
    const release = () => {
      if (!start) return;
      start = null;
      this.dragYaw.target = 0;
      this.canvas.classList.remove('is-dragging');
    };
    this.canvas.addEventListener('pointerup', release);
    this.canvas.addEventListener('pointercancel', release);
    motionPreference.addEventListener('change', () => {
      if (!motionPreference.matches) return;
      release();
      this.tiltYaw.snap(0);
      this.tiltPitch.snap(0);
      this.dragYaw.snap(0);
    });
  }

  /** The camera distance that fits a box of this width and height in the view, with room around it. */
  fitDistance(width, height, margin) {
    const halfView = Math.tan(MathUtils.degToRad(FIELD_OF_VIEW / 2));
    return Math.max(height / (2 * halfView), width / (2 * halfView * this.aspect)) * margin;
  }

  frame(seconds, time) {
    this.tiltYaw.step(seconds);
    this.tiltPitch.step(seconds);
    this.dragYaw.step(seconds);
    this.update(seconds, time);
    this.renderer.render(this.scene, this.camera);
  }
}

// ---------------------------------------------------------------- the iPhone stage

/**
 * An iPhone on a stage. A pose is { yaw, pitch, roll, zoom, focusX, focusY, drop }: angles in radians; zoom 1 fits the
 * phone in the view; focus is the point of the screen the camera centres on (-1 to 1 across and up); drop lowers the
 * phone in the view (a fraction of its height).
 */
export class PhoneStage extends Stage {
  constructor(canvas, { margin = 1.14 } = {}) {
    super(canvas, FINISHES.iphone);
    this.margin = margin;
    this.phone = buildIPhone(this.materials, this.library);
    this.scene.add(this.phone.group);
    // A broad falloff across the matte back separates the raised cameras from the case during the turn.
    const cameraLight = new PointLight(0xdae8ee, 3.8, 0, 2);
    cameraLight.position.set(-0.95, 1.05, 1.25);
    this.scene.add(cameraLight);
    this.pose = { yaw: new Eased(0), pitch: new Eased(0), roll: new Eased(0), zoom: new Eased(1), focusX: new Eased(0), focusY: new Eased(0), drop: new Eased(0) };
    this.idle = !REDUCED_MOTION;
    this.focusPoint = new Vector3();
  }

  get screen() {
    return this.phone.screen;
  }

  /** Fetches screens ahead of showing them, so a change of screen does not wait for the network. */
  preload(names) {
    for (const name of names) this.library.load(name).catch((error) => console.warn('[GrocGo site] screen picture', error));
  }

  setPose(pose, { instantly = false } = {}) {
    for (const [name, eased] of Object.entries(this.pose)) {
      const target = pose[name] ?? (name === 'zoom' ? 1 : 0);
      if (instantly) eased.snap(target);
      else eased.target = target;
    }
    wake();
  }

  update(seconds, time) {
    const { yaw, pitch, roll, drop, focusX, focusY, zoom } = this.pose;
    const sway = this.idle ? Math.sin(time * 0.6) * 0.045 : 0;
    const bob = this.idle ? Math.sin(time * 0.9) * 0.008 : 0;
    const { group, height, screenWidth, screenHeight } = this.phone;
    group.rotation.set(pitch.step(seconds) + this.tiltPitch.value, yaw.step(seconds) + sway + this.tiltYaw.value + this.dragYaw.value, roll.step(seconds), 'YXZ');
    group.position.y = bob - drop.step(seconds) * height;
    group.updateMatrixWorld();
    this.focusPoint.set(focusX.step(seconds) * screenWidth / 2, focusY.step(seconds) * screenHeight / 2, 0);
    group.localToWorld(this.focusPoint);
    const magnification = zoom.step(seconds);
    const distance = this.fitDistance(this.phone.width * 1.3, height, this.margin) / magnification;
    // Zoomed in, the camera centres on the focus; otherwise it stays on the stage's middle, so a dropped phone sits low.
    const centring = MathUtils.clamp((magnification - 1) / 0.4, 0, 1);
    this.camera.position.set(this.focusPoint.x * centring, this.focusPoint.y * centring, distance);
    this.camera.lookAt(this.camera.position.x, this.camera.position.y, 0);
    this.phone.screen.update(seconds);
  }
}

// ---------------------------------------------------------------- the iPhone Duo stage

/**
 * The iPhone Duo on a stage. `setFold(open)` takes 0 (shut) to 1 (open flat). A posture is { cover, laptop, yaw,
 * pitch, zoom }: the cover screen, `laptop` holds it with the fold across (cooking mode's half-open posture), and
 * zoom below 1 steps the camera back. `showInner(name)` puts a picture on the open screen.
 */
export class DuoStage extends Stage {
  constructor(canvas, { margin = 1.12 } = {}) {
    super(canvas, FINISHES.duo);
    this.margin = margin;
    this.duo = buildDuo(this.materials, this.library);
    this.holder = new Group();
    this.holder.add(this.duo.group);
    this.scene.add(this.holder);
    this.open = new Eased(0, REDUCED_MOTION ? 60 : 3);
    this.roll = new Eased(0);
    this.yaw = new Eased(-0.3);
    this.pitch = new Eased(0.08);
    this.zoom = new Eased(1);
    this.bounds = new Box3();
    this.boundsCentre = new Vector3();
    this.boundsSize = new Vector3();
  }

  setFold(open, { instantly = false } = {}) {
    if (instantly) this.open.snap(open);
    else this.open.target = open;
    wake();
  }

  get fold() {
    return this.open.value;
  }

  setPosture({ cover, laptop = false, yaw = -0.3, pitch = 0.08, zoom = 1 }) {
    if (cover) this.duo.screens.cover.show(cover);
    this.roll.target = laptop ? -Math.PI / 2 : 0;
    this.yaw.target = yaw;
    this.pitch.target = pitch;
    this.zoom.target = zoom;
    wake();
  }

  /**
   * The open screen's picture, across both halves. `change` is how it arrives: `dim` for a new screen; `open` or
   * `close` for the app's own move between its full screen and its split, the side pane coming in or going on the
   * right while the list on the left resizes (CHANGES).
   */
  showInner(name, change = 'dim') {
    const sides = { open: ['resize', 'paneIn'], close: ['resize', 'paneOut'] }[change] ?? ['dim', 'dim'];
    this.duo.screens.innerLeft.show(name, sides[0]);
    this.duo.screens.innerRight.show(name, sides[1]);
  }

  update(seconds, time) {
    const open = this.open.step(seconds);
    const roll = this.roll.step(seconds);
    const fold = (1 - open) * Math.PI;
    this.duo.setFold(fold);
    const { halfWidth } = this.duo;
    // Keep the device centred as the left half swings over: open it spans both halves, shut only the right one.
    // The shift runs along the halves, so it turns with the device when it is held with the fold across.
    const shift = halfWidth / 2 * (1 - Math.cos(fold)) / 2;
    this.duo.group.position.set(-shift * Math.cos(roll), -shift * Math.sin(roll), -DUO.depth * shift / halfWidth);
    this.duo.group.rotation.z = roll;
    const sway = REDUCED_MOTION ? 0 : Math.sin(time * 0.55) * 0.04;
    this.holder.rotation.set(this.pitch.step(seconds) + this.tiltPitch.value, this.yaw.step(seconds) + sway + this.tiltYaw.value + this.dragYaw.value, 0, 'YXZ');
    // The camera frames the device as it stands now, whatever its fold and turn: half-open with the fold across, the
    // standing half rises well above the middle, so centring on the hinge would cut its top off on a short stage.
    this.duo.measureBounds(this.bounds);
    this.bounds.getCenter(this.boundsCentre);
    this.bounds.getSize(this.boundsSize);
    const distance = this.fitDistance(this.boundsSize.x, this.boundsSize.y, this.margin) / this.zoom.step(seconds);
    // Measured from the device's nearest face, so its nearer parts, drawn larger, still fit.
    this.camera.position.set(this.boundsCentre.x, this.boundsCentre.y, this.bounds.max.z + distance);
    this.camera.lookAt(this.boundsCentre.x, this.boundsCentre.y, this.bounds.max.z);
    // The shadow of folding: nothing open flat, deepening as the halves close. The half that swings over darkens more
    // than the half that stays; both darken along the fold.
    const closing = Math.sin(fold / 2);
    const { innerLeft, innerRight, cover } = this.duo.screens;
    innerLeft.uniforms.shade.value = FOLD_SHADOW.swinging * closing;
    innerRight.uniforms.shade.value = FOLD_SHADOW.staying * closing;
    innerLeft.uniforms.crease.value = FOLD_SHADOW.crease * closing;
    innerRight.uniforms.crease.value = FOLD_SHADOW.crease * closing;
    innerRight.uniforms.shadowReach.value = closing * closing;
    cover.uniforms.shade.value = 0.38 * Math.sin(fold);
    innerLeft.update(seconds);
    innerRight.update(seconds);
    cover.update(seconds);
  }
}

/** Whether this browser can draw the devices; without WebGL the page shows the flat screens instead. */
export function canDraw3D() {
  try {
    const probe = document.createElement('canvas');
    return Boolean(window.WebGL2RenderingContext && probe.getContext('webgl2'));
  } catch {
    return false;
  }
}
