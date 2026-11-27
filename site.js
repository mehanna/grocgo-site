// The home page's behaviour (see build-site.ts for its parts): sections rising into view, the navigation bar, the
// opening's iPhone, the feature tour, the film and the tours, the iPhone Duo, the watch, the gallery wall with its lightbox, and sharing.
// The 3D devices come from devices.js; where WebGL is missing (or devices.js cannot load) the same parts drive the
// flat screens the page already shows, so every feature stays visible.
import { assetUrl } from './assets.js';

const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)').matches;
/** How long each screen of a feature stays before the next one. */
const SCREEN_STAY_MS = 3200;
/** The opening's cart and wordmark take this long (site.css --intro) before the phone turns into view. */
const INTRO_MS = REDUCED_MOTION ? 0 : 2600;

const readJson = (id) => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`the page has no #${id} data block`);
  return JSON.parse(element.textContent);
};

/**
 * Shows each name in turn, starting now, as show(name, index, first); returns a function that stops it. A hidden tab
 * keeps its place.
 */
function cycleScreens(names, show, stayMs = SCREEN_STAY_MS) {
  show(names[0], 0, true);
  if (names.length < 2) return () => {};
  let index = 0;
  const timer = setInterval(() => {
    if (document.hidden) return;
    index = (index + 1) % names.length;
    show(names[index], index, false);
  }, stayMs);
  return () => clearInterval(timer);
}

/** Runs `callback` once, the first time `element` comes into view. */
function onFirstView(element, callback, threshold = 0.35) {
  const observer = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    observer.disconnect();
    callback();
  }, { threshold });
  observer.observe(element);
}

// ---------------------------------------------------------------- displays: 3D or flat, the same to their sections

/**
 * A phone display: the 3D iPhone when it can be drawn, else the flat screen in its outline. `margin` is the room
 * round the phone (1 fits it exactly).
 */
function phoneDisplay(container, devices, { margin } = {}) {
  const flat = container.querySelector('.flat-phone img');
  if (devices) {
    try {
      const stage = new devices.PhoneStage(container.querySelector('canvas'), { margin });
      stage.screen.onFirstPicture = () => container.classList.add('is-3d');
      return {
        stage,
        show: (name) => stage.screen.show(name),
        preload: (names) => stage.preload(names),
        setPose: (pose, options) => stage.setPose(pose, options),
      };
    } catch (error) {
      console.warn('[GrocGo site] the 3D phone could not start; showing the flat screen', error);
    }
  }
  return { stage: null, show: (name) => { flat.src = assetUrl(`screens/${name}.webp`); }, preload: () => {}, setPose: () => {} };
}

function duoDisplay(container, devices, { margin } = {}) {
  const flat = container.querySelector('.flat-phone img');
  if (devices) {
    try {
      const stage = new devices.DuoStage(container.querySelector('canvas'), { margin });
      stage.duo.screens.innerRight.onFirstPicture = () => container.classList.add('is-3d');
      return {
        stage,
        setPosture: (posture) => stage.setPosture(posture),
        showInner: (name, change) => stage.showInner(name, change),
        setFold: (open, options) => stage.setFold(open, options),
        openAmount: () => stage.fold,
      };
    } catch (error) {
      console.warn('[GrocGo site] the 3D iPhone Duo could not start; showing the flat screen', error);
    }
  }
  // Flat: the cover screen while it is more shut than open, the open screen after.
  let cover = null;
  let inner = null;
  let open = 0;
  const draw = () => {
    const name = open < 0.5 && cover ? cover : inner;
    if (name) flat.src = assetUrl(`screens/${name}.webp`);
  };
  return {
    stage: null,
    setPosture: (posture) => { cover = posture.cover ?? null; draw(); },
    showInner: (name) => { inner = name; draw(); },
    setFold: (next) => { open = next; draw(); },
    openAmount: () => open,
  };
}

// ---------------------------------------------------------------- sections

function setupReveals() {
  const parts = document.querySelectorAll('.reveal');
  if (REDUCED_MOTION || !('IntersectionObserver' in window)) {
    parts.forEach((part) => part.classList.add('is-in'));
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-in');
      observer.unobserve(entry.target);
    }
  }, { threshold: 0.15, rootMargin: '0px 0px -8% 0px' });
  parts.forEach((part) => observer.observe(part));
}

/** The bar along the top comes down once the opening has mostly played. */
function setupNavigation() {
  const update = () => document.body.classList.toggle('nav-on', scrollY > innerHeight * 0.7);
  addEventListener('scroll', update, { passive: true });
  update();
}

/**
 * The opening: it stays on screen for its first stretch of scrolling. The phone spins into view after the intro,
 * waiting low under the words; scrolling lifts it into the middle and turns it to face you while the words fade up.
 */
function setupHero(devices) {
  const hero = document.querySelector('.hero');
  const container = hero?.querySelector('[data-device="hero"]');
  if (!container) return;
  const display = phoneDisplay(container, devices);
  const screens = readJson('hero-screens');
  display.preload(screens);
  /** How far through its pinned stretch the opening is, 0 to 1. */
  const progress = () => {
    const box = hero.getBoundingClientRect();
    return Math.min(1, Math.max(0, -box.top / Math.max(1, box.height - innerHeight)));
  };
  // At the top the phone waits low, under the words (lower on a phone, where the words take more of the screen).
  const narrow = matchMedia('(max-width: 600px)');
  const poseAt = (amount) => ({
    yaw: -0.36 + 0.36 * amount, pitch: 0.16 - 0.14 * amount, drop: (narrow.matches ? 0.62 : 0.55) * (1 - amount), zoom: 0.8 + 0.16 * amount,
  });
  let shownProgress = '';
  const follow = () => {
    const amount = progress();
    // Past the opening the value stays at 1: leave the style alone, so scrolling further down restyles nothing.
    const text = amount.toFixed(3);
    if (text !== shownProgress) hero.style.setProperty('--hero-progress', text);
    shownProgress = text;
    return amount;
  };
  follow();
  addEventListener('scroll', follow, { passive: true });
  if (!display.stage) {
    cycleScreens(screens, display.show);
    return;
  }
  display.stage.followPointer(hero);
  if (REDUCED_MOTION) {
    display.setPose(poseAt(follow()), { instantly: true });
    addEventListener('scroll', () => display.setPose(poseAt(progress()), { instantly: true }), { passive: true });
    cycleScreens(screens, display.show);
    return;
  }
  // It starts turned away and lower still, then spins round into place as the wordmark lands.
  display.setPose({ yaw: -Math.PI * 1.2, pitch: 0.35, drop: 0.9, zoom: 0.8 }, { instantly: true });
  display.show(screens[0]);
  let introDone = false;
  setTimeout(() => {
    introDone = true;
    display.setPose(poseAt(progress()));
    setTimeout(() => cycleScreens(screens, display.show), SCREEN_STAY_MS);
  }, INTRO_MS);
  addEventListener('scroll', () => { if (introDone) display.setPose(poseAt(progress())); }, { passive: true });
}

/**
 * A feature explorer (build-site.ts featureExplorer): one row open at a time, picked by its row, its tab (the rows of
 * other tabs wait hidden) or the arrow keys. `onOpen(index, body)` shows the stop on the device. With `stopMs(index)`
 * the explorer moves on by itself while it is on screen, the open row's progress line filling meanwhile; the pointer
 * resting on the explorer holds it.
 */
function setupExplorer(explorer, { onOpen, stopMs = null }) {
  const rows = Array.from(explorer.querySelectorAll('.explorer-row'));
  const tabs = Array.from(explorer.querySelectorAll('.explorer-tab'));
  let current = -1;
  let timer = null;
  let visible = false;
  let held = false;

  const schedule = () => {
    clearTimeout(timer);
    timer = null;
    const row = rows[current];
    row.classList.remove('is-playing');
    if (!stopMs || REDUCED_MOTION || !visible || held) return;
    const duration = stopMs(current);
    row.style.setProperty('--stop-ms', `${duration}ms`);
    void row.offsetWidth; // restart the progress line's animation
    row.classList.add('is-playing');
    timer = setTimeout(() => open((current + 1) % rows.length), duration);
  };

  function open(index) {
    if (index < 0 || index >= rows.length) return;
    const changed = index !== current;
    current = index;
    const group = rows[index].dataset.group;
    rows.forEach((row, rowIndex) => {
      const isOpen = rowIndex === index;
      row.classList.toggle('is-open', isOpen);
      row.hidden = Boolean(group) && row.dataset.group !== group;
      row.querySelector('.row-head').setAttribute('aria-expanded', String(isOpen));
    });
    tabs.forEach((tab) => tab.setAttribute('aria-selected', String(tab.dataset.group === group)));
    if (changed) onOpen(index, rows[index].querySelector('.row-body'));
    schedule();
  }

  rows.forEach((row, index) => row.querySelector('.row-head').addEventListener('click', () => open(index)));
  tabs.forEach((tab) => tab.addEventListener('click', () => open(rows.findIndex((row) => row.dataset.group === tab.dataset.group))));
  explorer.querySelector('.explorer-rows').addEventListener('keydown', (event) => {
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    open(Math.min(rows.length - 1, Math.max(0, current + step)));
    rows[current].querySelector('.row-head').focus({ preventScroll: true });
  });
  if (stopMs) {
    explorer.addEventListener('pointerenter', (event) => { if (event.pointerType === 'mouse') { held = true; schedule(); } });
    explorer.addEventListener('pointerleave', (event) => { if (event.pointerType === 'mouse') { held = false; schedule(); } });
    new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (current >= 0) schedule();
    }, { threshold: 0.35 }).observe(explorer);
  }
  open(0);
}

/**
 * The feature tour: the open stop turns the phone and plays that feature's screens; after showing each of them it moves
 * on to the next feature.
 */
function setupTour(devices) {
  const explorer = document.querySelector('.explorer-tour');
  if (!explorer) return;
  const stops = readJson('tour-stops');
  const container = explorer.querySelector('[data-device="tour"]');
  const display = phoneDisplay(container, devices, { margin: 1.04 });
  if (display.stage) display.stage.followPointer(container, { drag: true });
  /** On a phone the device is small: turn it less, so its screen stays easy to read. */
  const PHONE_TURN = 0.5;
  const narrow = matchMedia('(max-width: 860px)');
  let stopScreens = () => {};
  setupExplorer(explorer, {
    onOpen: (index) => {
      const stop = stops[index];
      display.preload(stop.screens);
      display.setPose(narrow.matches ? { ...stop.pose, yaw: stop.pose.yaw * PHONE_TURN } : stop.pose);
      stopScreens();
      stopScreens = cycleScreens(stop.screens, display.show);
      // Fetch the next stop's screens while this one plays.
      if (stops[index + 1]) display.preload(stops[index + 1].screens);
    },
    stopMs: (index) => Math.max(2, stops[index].screens.length) * SCREEN_STAY_MS,
  });
}

/**
 * iPhone Duo: each stop plays the Duo on a loop, as the owner asked: shut on its cover screen, it unfolds, shows the
 * full screen, opens the side pane a tap makes and closes it, then folds shut again. The slider (in the open row)
 * follows it; dragging the slider takes over until another stop is picked. Cooking mode
 * rests half-open, the fold across.
 */
function setupDuo(devices) {
  const explorer = document.querySelector('.explorer-duo');
  if (!explorer) return;
  const postures = readJson('duo-postures');
  const container = explorer.querySelector('[data-device="duo"]');
  const display = duoDisplay(container, devices, { margin: 1.16 });
  if (display.stage) display.stage.followPointer(container, { drag: true });
  const fold = explorer.querySelector('.fold');
  const slider = fold.querySelector('input');
  const HALF_OPEN = 0.62;
  const SLIDER_MAX = Number(slider.max);
  /** How long each moment of the loop lasts (the fold itself eases over about a second and a half). */
  const LOOP_MS = { shut: 1600, unfold: 1700, full: 2400, split: 2800, closed: 1200, fold: 1700 };
  const sliderOpen = () => Number(slider.value) / SLIDER_MAX;
  let posture = postures[0];
  let run = { live: false };
  let seen = false;

  /** Keeps the slider's knob on the Duo's hinge while the loop moves it. */
  const followFold = (current) => {
    if (!current.live) return;
    slider.value = String(Math.round(display.openAmount() * SLIDER_MAX));
    requestAnimationFrame(() => followFold(current));
  };

  /** The loop for the current stop; it stops when another stop is picked or the slider is dragged. */
  async function play() {
    run.live = false;
    const current = { live: true };
    run = current;
    const [full, split] = posture.inner;
    if (posture.laptop || REDUCED_MOTION) {
      display.showInner(full);
      display.setFold(posture.laptop ? HALF_OPEN : 1);
      slider.value = String(SLIDER_MAX);
      return;
    }
    followFold(current);
    const step = async (milliseconds) => { await wait(milliseconds); return current.live; };
    while (current.live) {
      // Fold shut first, unless it already is (the first time round).
      if (display.openAmount() > 0.02) {
        display.setFold(0);
        if (!(await step(LOOP_MS.fold))) return;
      }
      display.showInner(full);
      if (!(await step(LOOP_MS.shut))) return;
      display.setFold(1);
      if (!(await step(LOOP_MS.unfold + LOOP_MS.full))) return;
      if (split) {
        display.showInner(split, 'open');
        if (!(await step(LOOP_MS.split))) return;
        display.showInner(full, 'close');
        if (!(await step(LOOP_MS.closed))) return;
      }
    }
  }

  setupExplorer(explorer, {
    // The slider sits in the open row (cooking mode, which rests half-open, has none).
    onOpen: (index, body) => {
      posture = postures[index];
      display.setPosture(posture);
      fold.hidden = Boolean(posture.laptop);
      body.append(fold);
      if (seen) play();
    },
  });

  // Dragging the slider takes over from the loop; let go and it settles shut or open (only cooking rests half-open).
  slider.addEventListener('input', () => {
    run.live = false;
    display.setFold(sliderOpen());
  });
  slider.addEventListener('change', () => {
    const settled = sliderOpen() < 0.5 ? 0 : 1;
    slider.value = String(settled * SLIDER_MAX);
    display.setFold(settled);
  });
  display.showInner(posture.inner[0]);
  display.setFold(0, { instantly: true });
  slider.value = '0';
  onFirstView(container, () => {
    seen = true;
    play();
  }, 0.5);
}

const wait = (milliseconds) => new Promise((resolve) => { setTimeout(resolve, milliseconds); });

/**
 * Walk in: while the section is on screen, a pin walks the route into Whole Foods; on arrival the store lights up, the
 * note "You're at Whole Foods" comes up and the phone's list switches to that store (site.css, .is-arrived). Then it
 * starts again. With motion turned off it simply shows the arrival.
 */
function setupWalkIn() {
  const stage = document.querySelector('.walk-in');
  if (!stage) return;
  const route = stage.querySelector('.walk-route');
  const trail = stage.querySelector('.walk-trail');
  const walker = stage.querySelector('.walker');
  const length = route.getTotalLength();
  trail.style.strokeDasharray = `${length} ${length}`;
  const place = (amount) => {
    const point = route.getPointAtLength(length * amount);
    walker.setAttribute('transform', `translate(${point.x.toFixed(1)} ${point.y.toFixed(1)})`);
    trail.style.strokeDashoffset = String(length * (1 - amount));
  };
  if (REDUCED_MOTION) {
    place(1);
    stage.classList.add('is-arrived');
    return;
  }
  const WALK_MS = 3200;
  const ARRIVED_MS = 4200;
  const REST_MS = 900;
  const walk = () => new Promise((resolve) => {
    const start = performance.now();
    const step = (now) => {
      const amount = Math.min(1, (now - start) / WALK_MS);
      place(amount < 0.5 ? 2 * amount * amount : 1 - (-2 * amount + 2) ** 2 / 2);
      if (amount < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
  let visible = false;
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    while (visible) {
      stage.classList.remove('is-arrived');
      place(0);
      await wait(REST_MS);
      await walk();
      stage.classList.add('is-arrived');
      await wait(ARRIVED_MS);
    }
    running = false;
  };
  place(0);
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) run();
  }, { threshold: 0.4 }).observe(stage);
}

/** Share to GrocGo: the four steps light up one after another while the section is on screen. */
function setupShareSteps() {
  const steps = Array.from(document.querySelectorAll('.share-step'));
  if (steps.length === 0) return;
  const list = steps[0].parentElement;
  if (REDUCED_MOTION) return;
  const STEP_MS = 2200;
  let current = -1;
  let timer = null;
  const light = (index) => {
    current = index;
    steps.forEach((step, stepIndex) => step.classList.toggle('is-current', stepIndex === index));
  };
  new IntersectionObserver(([entry]) => {
    if (entry.isIntersecting && !timer) {
      list.classList.add('is-playing');
      light(0);
      timer = setInterval(() => { if (!document.hidden) light((current + 1) % steps.length); }, STEP_MS);
    } else if (!entry.isIntersecting && timer) {
      clearInterval(timer);
      timer = null;
    }
  }, { threshold: 0.4 }).observe(list);
}

/** The watch: its screens take turns, and it leans toward the pointer. */
function setupWatch() {
  const section = document.querySelector('.watch-section');
  if (!section) return;
  const screen = section.querySelector('.watch-screen img');
  const watch = section.querySelector('.watch');
  const DIM_MS = 180;
  onFirstView(watch, () => cycleScreens(readJson('watch-screens'), (name) => {
    const source = assetUrl(`screens/${name}.webp`);
    if (screen.getAttribute('src') === source) return;
    screen.classList.add('is-dim');
    setTimeout(() => { screen.src = source; screen.classList.remove('is-dim'); }, DIM_MS);
  }));
  if (REDUCED_MOTION || !matchMedia('(hover: hover)').matches) return;
  section.addEventListener('pointermove', (event) => {
    const box = section.getBoundingClientRect();
    watch.style.setProperty('--lean-x', ((event.clientX - box.left) / box.width - 0.5).toFixed(3));
    watch.style.setProperty('--lean-y', ((event.clientY - box.top) / box.height - 0.5).toFixed(3));
  });
  section.addEventListener('pointerleave', () => { watch.style.setProperty('--lean-x', '0'); watch.style.setProperty('--lean-y', '0'); });
}

// ---------------------------------------------------------------- the gallery

const modulo = (value, size) => ((value % size) + size) % size;

/**
 * A lightbox: an item opens out of its tile; arrows and the keyboard step through all of them. `show(item)` makes
 * the item's picture or film and `caption(item)` gives its two caption lines, so the gallery and the films share it.
 */
function createLightbox(dialog, items, { show, caption }) {
  const media = dialog.querySelector('.lightbox-media');
  const feature = dialog.querySelector('.lightbox-feature');
  const title = dialog.querySelector('.lightbox-title');
  let index = 0;

  function render(nextIndex, fromBox) {
    index = modulo(nextIndex, items.length);
    const item = items[index];
    const element = show(item);
    element.className = 'lightbox-picture';
    media.replaceChildren(element);
    [feature.textContent, title.textContent] = caption(item);
    if (!fromBox || REDUCED_MOTION || typeof element.animate !== 'function') return;
    // Open out of the tile: start where the tile is, at its size, and grow into place.
    const box = element.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const scale = fromBox.width / box.width;
    const shiftX = fromBox.left + fromBox.width / 2 - (box.left + box.width / 2);
    const shiftY = fromBox.top + fromBox.height / 2 - (box.top + box.height / 2);
    element.animate([
      { transform: `translate(${shiftX}px, ${shiftY}px) scale(${scale})`, borderRadius: '28px' },
      { transform: 'none', borderRadius: '18px' },
    ], { duration: 520, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
  }

  function open(nextIndex, sourceElement) {
    if (!dialog.open) dialog.showModal();
    render(nextIndex, sourceElement ? sourceElement.getBoundingClientRect() : null);
  }

  // One film alone has nothing to step to.
  dialog.querySelectorAll('.lightbox-step').forEach((button) => { button.hidden = items.length < 2; });
  dialog.querySelector('.lightbox-close').addEventListener('click', () => dialog.close());
  dialog.querySelectorAll('.lightbox-step').forEach((button) => button.addEventListener('click', () => render(index + Number(button.dataset.step))));
  dialog.addEventListener('keydown', (event) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (step) { event.preventDefault(); render(index + step); }
  });
  // A click on the dimmed backdrop (the dialog itself, not its contents) closes it.
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => media.replaceChildren());
  return open;
}

/**
 * The wall: columns of tiles that run on forever in every direction. It drifts slowly by itself, follows a drag
 * (with a little glide after), sideways scrolling and the arrow keys. A tap opens the lightbox.
 *
 * It stays light on a phone: no tile exists until the wall is about a screen away, and each video plays in one tile
 * at a time (its other copies show its still), so the page does not fetch and decode the same video over and over.
 */
function setupGalleryWall(wall, items, open) {
  /** Tile heights as a share of their width, dealt out in turn so neighbours differ. */
  const TILE_SHAPES = [2.17, 1.3, 1.72, 1.04, 2.17, 1.45];
  const COLUMN_COUNT = 6;
  const TILES_PER_COLUMN = 6;
  const DRIFT = { x: -14, y: -9 }; // pixels a second
  const GLIDE_RATE = 3.2; // how fast a flick slows down
  const KEY_STEP = 260;
  const layer = document.createElement('div');
  layer.className = 'gallery-wall';
  wall.append(layer);
  wall.classList.add('is-wall');

  let columnWidth = 0;
  let gap = 0;
  let columns = [];
  const nodes = new Map();
  const offset = { x: 0, y: 0 };
  const velocity = { x: 0, y: 0 };
  let visible = false;
  let hovered = false;
  let drag = null;
  let last = 0;
  let near = false;
  /** The one tile that plays each video, by gallery item. */
  const playingTiles = new Map();
  /** A tile's video can be refused (Low Power Mode stops muted videos playing by themselves): its still stays. */
  const playTile = (video) => video.play().catch((error) => console.warn('[GrocGo site] a gallery video did not play', video.src.split('/').pop(), error.name));

  function layout() {
    const narrow = wall.clientWidth < 700;
    columnWidth = narrow ? 150 : 232;
    gap = narrow ? 12 : 20;
    columns = Array.from({ length: COLUMN_COUNT }, (_, column) => {
      let top = 0;
      const tiles = Array.from({ length: TILES_PER_COLUMN }, (_, row) => {
        const item = (column * 7 + row * 5) % items.length;
        const height = Math.round(columnWidth * TILE_SHAPES[(column + row * 2) % TILE_SHAPES.length]);
        const tile = { item, top, height };
        top += height + gap;
        return tile;
      });
      // Every other column starts part of a tile lower, so the rows never line up.
      return { tiles, period: top, stagger: (column % 2) * Math.round(columnWidth * 0.7) };
    });
    for (const node of nodes.values()) node.remove();
    nodes.clear();
    playingTiles.clear();
  }

  function tileNode(item, height) {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = 'wall-tile';
    node.dataset.index = String(item);
    node.style.width = `${columnWidth}px`;
    node.style.height = `${height}px`;
    const entry = items[item];
    let picture;
    if (entry.kind === 'video' && !REDUCED_MOTION && !playingTiles.has(item)) {
      playingTiles.set(item, node);
      picture = document.createElement('video');
      Object.assign(picture, { src: assetUrl(`gallery/${entry.name}.mp4`), poster: assetUrl(`gallery/${entry.name}-tile.webp`), muted: true, loop: true, playsInline: true, preload: 'none' });
      picture.setAttribute('aria-hidden', 'true');
      if (visible) playTile(picture);
    } else {
      picture = document.createElement('img');
      Object.assign(picture, { src: assetUrl(`gallery/${entry.name}-tile.webp`), alt: '', decoding: 'async', draggable: false });
    }
    const label = document.createElement('span');
    label.className = 'gallery-label';
    label.textContent = entry.feature;
    node.append(picture, label);
    node.setAttribute('aria-label', `${entry.title} (${entry.kind === 'video' ? 'video' : 'picture'})`);
    node.tabIndex = -1;
    return node;
  }

  function draw() {
    if (!near) return;
    const width = wall.clientWidth;
    const height = wall.clientHeight;
    const pitch = columnWidth + gap;
    const first = Math.floor(-offset.x / pitch) - 1;
    const last = first + Math.ceil(width / pitch) + 2;
    const seen = new Set();
    for (let column = first; column <= last; column += 1) {
      const { tiles, period, stagger } = columns[modulo(column, COLUMN_COUNT)];
      const x = column * pitch + offset.x;
      const columnTop = offset.y + stagger;
      for (let round = Math.floor(-columnTop / period) - 1; columnTop + round * period < height; round += 1) {
        for (let index = 0; index < tiles.length; index += 1) {
          const tile = tiles[index];
          const y = columnTop + round * period + tile.top;
          if (y > height || y + tile.height < 0) continue;
          const key = `${column}:${round}:${index}`;
          seen.add(key);
          let node = nodes.get(key);
          if (!node) {
            node = tileNode(tile.item, tile.height);
            nodes.set(key, node);
            layer.append(node);
          }
          node.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
        }
      }
    }
    for (const [key, node] of nodes) {
      if (seen.has(key)) continue;
      node.remove();
      nodes.delete(key);
      const item = Number(node.dataset.index);
      if (playingTiles.get(item) === node) playingTiles.delete(item);
    }
  }

  function frame(now) {
    const seconds = Math.min(0.05, last ? (now - last) / 1000 : 0);
    last = now;
    if (!drag) {
      const glide = Math.exp(-GLIDE_RATE * seconds);
      velocity.x *= glide;
      velocity.y *= glide;
      const drift = REDUCED_MOTION ? 0 : hovered ? 0.25 : 1;
      offset.x += (velocity.x + DRIFT.x * drift) * seconds;
      offset.y += (velocity.y + DRIFT.y * drift) * seconds;
    }
    draw();
    if (visible && !document.hidden) requestAnimationFrame(frame);
    else last = 0;
  }
  const start = () => { if (!last) requestAnimationFrame(frame); };

  wall.addEventListener('pointerenter', () => { hovered = true; });
  wall.addEventListener('pointerleave', () => { hovered = false; });
  wall.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    drag = { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, time: performance.now(), moved: false, tile: event.target.closest('.wall-tile') };
    velocity.x = 0;
    velocity.y = 0;
  });
  wall.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.pointerType === 'touch' ? 0 : event.clientY - drag.y; // a finger's up-and-down scrolls the page
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 6) {
      drag.moved = true;
      wall.setPointerCapture(event.pointerId);
      wall.classList.add('is-dragging');
    }
    const now = performance.now();
    const seconds = Math.max(0.001, (now - drag.time) / 1000);
    offset.x += dx;
    offset.y += dy;
    velocity.x = dx / seconds;
    velocity.y = dy / seconds;
    drag.x = event.clientX;
    drag.y = event.clientY;
    drag.time = now;
  });
  const release = (event) => {
    if (!drag) return;
    const { moved, tile } = drag;
    drag = null;
    wall.classList.remove('is-dragging');
    if (event.type === 'pointerup' && !moved && tile) open(Number(tile.dataset.index), tile);
  };
  wall.addEventListener('pointerup', release);
  wall.addEventListener('pointercancel', release);
  // Sideways scrolling moves the wall; up-and-down scrolling stays with the page.
  wall.addEventListener('wheel', (event) => {
    const sideways = event.shiftKey ? event.deltaY : event.deltaX;
    if (Math.abs(sideways) <= Math.abs(event.shiftKey ? event.deltaX : event.deltaY)) return;
    event.preventDefault();
    offset.x -= sideways;
  }, { passive: false });
  wall.addEventListener('keydown', (event) => {
    const step = { ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[event.key];
    if (step) {
      event.preventDefault();
      velocity.x += step[0] * KEY_STEP * GLIDE_RATE;
      velocity.y += step[1] * KEY_STEP * GLIDE_RATE;
      start();
    } else if (event.key === 'Enter' || event.key === ' ') {
      // Open the tile nearest the middle of the wall.
      const box = wall.getBoundingClientRect();
      const middle = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
      let nearest = null;
      let nearestDistance = Infinity;
      for (const node of nodes.values()) {
        const tileBox = node.getBoundingClientRect();
        const distance = Math.hypot(tileBox.left + tileBox.width / 2 - middle.x, tileBox.top + tileBox.height / 2 - middle.y);
        if (distance < nearestDistance) { nearest = node; nearestDistance = distance; }
      }
      if (nearest) { event.preventDefault(); open(Number(nearest.dataset.index), nearest); }
    }
  });

  new ResizeObserver(() => { layout(); draw(); }).observe(wall);
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    for (const video of layer.querySelectorAll('video')) {
      if (visible) playTile(video);
      else video.pause();
    }
    if (visible) start();
  }).observe(wall);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && visible) start(); });
  // The tiles come in a screen ahead of the wall, so they are ready by the time it scrolls into view.
  new IntersectionObserver(([entry]) => {
    if (!entry.isIntersecting || near) return;
    near = true;
    draw();
  }, { rootMargin: '100% 0px' }).observe(wall);
  layout();
  draw();
}

/** A gallery item as the lightbox shows it: a looping tile video, or a picture that sharpens when its full size arrives. */
function galleryMedia(item) {
  if (item.kind === 'video') {
    const video = document.createElement('video');
    Object.assign(video, { src: assetUrl(`gallery/${item.name}.mp4`), poster: assetUrl(`gallery/${item.name}-tile.webp`), muted: true, loop: true, playsInline: true, autoplay: !REDUCED_MOTION, controls: true });
    return video;
  }
  // The tile's small picture shows at once (it is already loaded), and the sharp one replaces it when it arrives.
  const picture = document.createElement('img');
  Object.assign(picture, { src: assetUrl(`gallery/${item.name}-tile.webp`), alt: item.title, decoding: 'async' });
  const sharp = new Image();
  sharp.onload = () => { if (picture.isConnected) picture.src = sharp.src; };
  sharp.onerror = () => console.warn(`[GrocGo site] gallery picture "${item.name}" did not load`);
  sharp.src = assetUrl(`gallery/${item.name}.webp`);
  return picture;
}

/** A film as the lightbox plays it: with its sound and its controls, started by the visitor's own tap. */
function filmMedia(film) {
  const video = document.createElement('video');
  Object.assign(video, { src: assetUrl(`films/${film.name}.mp4`), poster: assetUrl(`films/${film.name}-cover.webp`), playsInline: true, autoplay: true, controls: true });
  video.setAttribute('aria-label', film.title);
  return video;
}

/**
 * The film and the tours: each section ([data-films]) plays its own films in its own lightbox. A card opens out of
 * itself; a button elsewhere (the opening's "Watch the film") names its group and just opens the film.
 */
function setupFilms() {
  const openers = {};
  for (const section of document.querySelectorAll('[data-films]')) {
    const group = section.dataset.films;
    const films = readJson(`${group}-list`);
    openers[group] = createLightbox(section.querySelector('.lightbox'), films, { show: filmMedia, caption: (film) => [film.length, film.title] });
  }
  for (const button of document.querySelectorAll('[data-film]')) {
    const open = openers[button.dataset.filmGroup];
    if (!open) {
      console.warn(`[GrocGo site] a film button names the group "${button.dataset.filmGroup}", which the page does not have`);
      continue;
    }
    button.addEventListener('click', () => open(Number(button.dataset.film), button.classList.contains('film') ? button : null));
  }
}

function setupGallery() {
  const section = document.querySelector('.gallery-section');
  if (!section) return;
  const items = readJson('gallery-items');
  const open = createLightbox(section.querySelector('.lightbox'), items, { show: galleryMedia, caption: (item) => [item.feature, item.title] });
  const wall = section.querySelector('.gallery');
  // The plain grid (what the page shows without this script) opens the lightbox too.
  wall.querySelector('.gallery-grid').addEventListener('click', (event) => {
    const button = event.target.closest('.gallery-open');
    if (button) open(Number(button.dataset.index), button);
  });
  setupGalleryWall(wall, items, open);
}

// ---------------------------------------------------------------- sharing

function setupShareButton() {
  const button = document.querySelector('.share');
  const status = document.querySelector('.share-status');
  if (!button || !status) return;
  button.addEventListener('click', async () => {
    const url = button.dataset.shareUrl;
    const shared = { title: 'GrocGo', text: 'GrocGo: the shopping list and AI Chef of the future.', url };
    if (navigator.share) {
      try {
        await navigator.share(shared);
        return;
      } catch (error) {
        if (error.name === 'AbortError') return;
        console.warn('[GrocGo site] share sheet failed; copying the link instead', error);
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      status.textContent = 'Link copied. Paste it anywhere to share GrocGo.';
    } catch (error) {
      console.warn('[GrocGo site] could not copy the link', error);
      status.textContent = `Share this link: ${url}`;
    }
  });
}

// ---------------------------------------------------------------- start

async function loadDevices() {
  try {
    const devices = await import('./devices.js');
    return devices.canDraw3D() ? devices : null;
  } catch (error) {
    console.warn('[GrocGo site] the 3D devices could not load; showing flat screens', error);
    return null;
  }
}

setupReveals();
setupNavigation();
setupWatch();
setupWalkIn();
setupShareSteps();
setupFilms();
setupGallery();
setupShareButton();
const devices = await loadDevices();
setupHero(devices);
setupTour(devices);
setupDuo(devices);
