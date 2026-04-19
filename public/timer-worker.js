// Web Worker for precise timer that doesn't get throttled in background tabs
let timerId = null;
let startTime = null;
let duration = 0;
let isPaused = false;

self.onmessage = function(e) {
  const { type, payload } = e.data;

  switch (type) {
    case 'START':
      startTime = Date.now();
      duration = payload.duration; // in seconds
      isPaused = false;
      tick();
      break;

    case 'PAUSE':
      isPaused = true;
      if (timerId) {
        clearTimeout(timerId);
        timerId = null;
      }
      break;

    case 'RESUME':
      isPaused = false;
      tick();
      break;

    case 'STOP':
      if (timerId) {
        clearTimeout(timerId);
        timerId = null;
      }
      startTime = null;
      duration = 0;
      break;

    case 'SYNC':
      // Recalculate from timestamp to fix drift
      if (startTime && !isPaused) {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        const remaining = Math.max(0, duration - elapsed);
        self.postMessage({ type: 'TICK', timeLeft: remaining });
      }
      break;
  }
};

function tick() {
  if (isPaused || !startTime) return;

  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const remaining = Math.max(0, duration - elapsed);

  self.postMessage({ type: 'TICK', timeLeft: remaining });

  if (remaining > 0) {
    // Schedule next tick at the next full second for precision
    const nextTick = 1000 - (Date.now() % 1000);
    timerId = setTimeout(tick, nextTick);
  } else {
    self.postMessage({ type: 'COMPLETE' });
    startTime = null;
  }
}
