// The home page's showcase (see build-site.ts and site.css): it turns the slides, and it tosses the food emoji of
// the AI loading slide. With motion turned off on the device, the first slide stays and nothing is tossed.
(() => {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  /** A custom property of the page that holds a time in seconds, in milliseconds. */
  const secondsProperty = (name) => (parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0) * 1000;

  // ---- Turning the slides ----
  /** How long a slide stays before the next one slides in. */
  const SLIDE_STAY_MS = 4200;

  function turnSlides(showcase) {
    const slides = Array.from(showcase.querySelectorAll('.slide'));
    if (slides.length < 2) return;
    let current = Math.max(0, slides.findIndex(slide => slide.classList.contains('is-current')));
    const next = () => {
      // A tab in the background keeps its timers but shows nothing: leave the slide where it is.
      if (document.hidden) return;
      const leaving = slides[current];
      current = (current + 1) % slides.length;
      const entering = slides[current];
      // The entering slide may still be parked on the left from its last turn: put it back on the right, unseen and
      // without crossing the stage, before it slides in.
      entering.classList.add('is-waiting');
      entering.classList.remove('is-leaving');
      void entering.offsetWidth;
      entering.classList.remove('is-waiting');
      leaving.classList.replace('is-current', 'is-leaving');
      entering.classList.add('is-current');
    };
    // The showcase only appears once the page's opening has played (--intro), so the first slide's stay starts then.
    setTimeout(() => setInterval(next, SLIDE_STAY_MS), secondsProperty('--intro'));
  }

  // ---- Tossing the emoji ----
  // This follows the app's own animation (GrocGo/components/Loading/EmojiToss.tsx): the same emoji in the same order
  // (the page's .tossed elements, written by build-site.ts from the app's list), the same batches and the same
  // timing. Each emoji rests unseen on the line; tossed, it rises, spins, drifts sideways and fades back down.
  const HALF_TOSS_MS = 500; // up for this long, down for as long again
  const FULL_TURN_DEGREES = 360;
  const MAX_SPIN_DEGREES = 270; // how far an emoji may spin on the way up
  // Three emoji go up 300 ms apart, and every 1.5 s the next three start two places further on.
  const BATCH_SIZE = 3;
  const BATCH_STEP = 2;
  const BATCH_INTERVAL_MS = 1500;
  const STAGGER_MS = 300;

  function tossEmoji(stage) {
    const line = stage.querySelector('.toss-line');
    const emojis = Array.from(stage.querySelectorAll('.tossed'));
    if (!line || emojis.length === 0 || typeof stage.animate !== 'function') return;
    const restingAngles = emojis.map(() => Math.random() * FULL_TURN_DEGREES);
    const randomSpotOnLine = () => (Math.random() - 0.5) * line.clientWidth;

    const toss = (index) => {
      const carrier = emojis[index];
      const picture = carrier.firstElementChild;
      if (!picture) return;
      const height = parseFloat(getComputedStyle(stage).getPropertyValue('--toss-height')) || 0;
      const resting = restingAngles[index];
      const spun = resting + Math.random() * MAX_SPIN_DEGREES;
      carrier.animate(
        [{ transform: `translateX(${randomSpotOnLine()}px)` }, { transform: `translateX(${randomSpotOnLine()}px)` }],
        { duration: 2 * HALF_TOSS_MS, easing: 'ease-in-out' },
      );
      picture.animate([
        { transform: `translateY(0) rotate(${resting}deg)`, opacity: 0, easing: 'ease-in-out' },
        { transform: `translateY(${-height}px) rotate(${spun}deg)`, opacity: 1, easing: 'ease-in-out' },
        { transform: `translateY(0) rotate(${resting}deg)`, opacity: 0 },
      ], { duration: 2 * HALF_TOSS_MS });
    };

    let firstInBatch = 0;
    const tossBatch = () => {
      if (document.hidden) return;
      for (let place = 0; place < BATCH_SIZE; place += 1) {
        // The last batch runs on into the first emoji, so every batch is full whatever the number of emoji.
        const index = (firstInBatch + place) % emojis.length;
        setTimeout(() => toss(index), place * STAGGER_MS);
      }
      firstInBatch = firstInBatch + BATCH_STEP < emojis.length ? firstInBatch + BATCH_STEP : 0;
    };
    tossBatch();
    setInterval(tossBatch, BATCH_INTERVAL_MS);
  }

  const showcase = document.querySelector('.showcase');
  if (showcase) turnSlides(showcase);
  const tossStage = document.querySelector('.toss');
  if (tossStage) tossEmoji(tossStage);
})();
