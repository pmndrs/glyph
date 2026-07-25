export function cacheSuccessfulPromise<Value>(load: () => Promise<Value>): () => Promise<Value> {
  let cached: Promise<Value> | undefined
  return () => {
    if (cached === undefined) {
      const pending = Promise.resolve().then(load)
      const retryable = pending.catch((error: unknown) => {
        if (cached === retryable) cached = undefined
        throw error
      })
      cached = retryable
    }
    return cached
  }
}
