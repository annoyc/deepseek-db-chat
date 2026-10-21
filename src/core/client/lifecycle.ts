/** One owner for cancellation and deadlines; all timers/listeners are disposable. */
export function createAbortScope(parent?: AbortSignal, deadlineMs?: number) {
  const controller = new AbortController()
  const forwardAbort = () => controller.abort(parent?.reason ?? new DOMException('Request cancelled', 'AbortError'))
  if (parent?.aborted) forwardAbort()
  else parent?.addEventListener('abort', forwardAbort, { once: true })
  const timer = deadlineMs && deadlineMs > 0
    ? setTimeout(() => controller.abort(new DOMException('Task deadline exceeded', 'TimeoutError')), deadlineMs)
    : undefined
  return {
    signal: controller.signal,
    abort: (reason?: unknown) => controller.abort(reason ?? new DOMException('Request cancelled', 'AbortError')),
    clearDeadline() { if (timer) clearTimeout(timer) },
    dispose() {
      if (timer) clearTimeout(timer)
      parent?.removeEventListener('abort', forwardAbort)
    },
  }
}

export function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) {
    // The caller may already have started the operation; consume its rejection.
    void promise.catch(() => {})
    return Promise.reject(signal.reason)
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

export async function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await abortable(new Promise<void>((resolve) => { timer = setTimeout(resolve, ms) }), signal)
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export interface ManagedStreamContext {
  signal: AbortSignal
  enqueue: (value: Uint8Array) => void
}

/** Start synchronously so a pending upstream request cannot delay stream.cancel(). */
export function createManagedStream(
  run: (context: ManagedStreamContext) => Promise<void>,
  options: {
    signal?: AbortSignal
    deadlineMs: number
    onError: (error: unknown, enqueue: ManagedStreamContext['enqueue']) => void
  },
): ReadableStream<Uint8Array> {
  const scope = createAbortScope(options.signal, options.deadlineMs)
  let closed = false
  let close: () => void = () => {}
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const enqueue = (value: Uint8Array) => { if (!closed) controller.enqueue(value) }
      const onAbort = () => {
        if (scope.signal.reason?.name === 'TimeoutError') options.onError(scope.signal.reason, enqueue)
        close()
      }
      close = () => {
        if (closed) return
        closed = true
        scope.signal.removeEventListener('abort', onAbort)
        scope.dispose()
        controller.close()
      }
      scope.signal.addEventListener('abort', onAbort, { once: true })
      if (scope.signal.aborted) { onAbort(); return }
      void Promise.resolve().then(() => {
        scope.signal.throwIfAborted()
        return run({ signal: scope.signal, enqueue })
      }).catch((error) => {
        if (!closed && !scope.signal.aborted) options.onError(error, enqueue)
      }).finally(close)
    },
    cancel(reason) {
      closed = true
      scope.abort(reason)
      scope.dispose()
    },
  })
}
