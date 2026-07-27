import { describe, expect, it, vi } from 'vitest'
import { createExclusiveLifecycleCoordinator } from './exclusive-lifecycle'

describe('exclusive renderer lifecycle coordinator', () => {
  it('admits one renderer lease at a time and preserves the queue after cancellation', async () => {
    const coordinator = createExclusiveLifecycleCoordinator()
    const first = await coordinator.acquire()
    const secondAcquired = vi.fn<() => void>()
    const secondPromise = coordinator.acquire().then((lease) => {
      secondAcquired()
      return lease
    })

    await Promise.resolve()
    expect(secondAcquired).not.toHaveBeenCalled()
    first.release()
    const second = await secondPromise
    expect(secondAcquired).toHaveBeenCalledOnce()

    const cancelled = new AbortController()
    const cancelledPromise = coordinator.acquire(cancelled.signal)
    cancelled.abort()
    const fourthPromise = coordinator.acquire()
    second.release()
    await expect(cancelledPromise).rejects.toMatchObject({ name: 'AbortError' })
    const fourth = await fourthPromise
    fourth.release()
  })
})
