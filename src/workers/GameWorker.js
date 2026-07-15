/**
 * Background worker - keeps track of time for AI turns.
 * Simple approach: just track elapsed time.
 */

// State
let targetInterval = 2000; // ms between turns
let startTime = 0;
let paused = false;
let timerId = null;

function start() {
    startTime = performance.now();
    paused = false;

    // Check every 100ms
    if (timerId) clearInterval(timerId);
    timerId = setInterval(checkTime, 100);
}

function checkTime() {
    if (paused) return;

    const elapsed = performance.now() - startTime;
    const turns = Math.floor(elapsed / targetInterval);

    if (turns > 0) {
        // Tell main thread how many turns should have happened
        // The main thread will handle the actual turn processing
        self.postMessage({
            type: 'turnsElapsed',
            turns: turns,
            elapsed: elapsed,
            interval: targetInterval
        });
    }
}

function stop() {
    if (timerId) {
        clearInterval(timerId);
        timerId = null;
    }
}

function setIntervalMs(ms) {
    targetInterval = ms;
}

function setPaused(p) {
    paused = p;
    if (!paused) {
        // Reset start time when resuming
        startTime = performance.now();
    }
}

// Handle messages
self.onmessage = function(e) {
    const { type, data } = e.data;

    switch (type) {
        case 'start':
            start();
            break;
        case 'stop':
            stop();
            break;
        case 'setInterval':
            setIntervalMs(data);
            break;
        case 'pause':
            setPaused(true);
            break;
        case 'resume':
            setPaused(false);
            break;
        case 'getTurns':
            // Return current turn count immediately (for visibility change recovery)
            const elapsed = performance.now() - startTime;
            const turns = Math.floor(elapsed / targetInterval);
            self.postMessage({
                type: 'turnCount',
                turns: turns,
                elapsed: elapsed
            });
            break;
    }
};

self.postMessage({ type: 'ready' });