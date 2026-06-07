function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry(fn, opts = {}) {
  const {
    retries = 3,
    delayMs = 1000,
    factor = 2,
    label = 'operation',
    onRetry = null,
  } = opts;

  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt < retries) {
        const wait = delayMs * Math.pow(factor, attempt);

        if (onRetry) {
          onRetry(error, attempt + 1);
        }

        // jitter ±25% to avoid thundering herd
        const jitter = wait * 0.25 * (Math.random() * 2 - 1);
        await sleep(Math.max(100, wait + jitter));
      }
    }
  }

  const enriched = new Error(
    `[${label}] Failed after ${retries + 1} attempts: ${lastError.message}`
  );
  enriched.cause = lastError;
  enriched.attempts = retries + 1;
  throw enriched;
}

async function withTimeout(fn, timeoutMs = 15000, label = 'operation') {
  return Promise.race([
    fn(),
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`[${label}] Timed out after ${timeoutMs}ms`)),
        timeoutMs
      )
    ),
  ]);
}

module.exports = { sleep, withRetry, withTimeout };
