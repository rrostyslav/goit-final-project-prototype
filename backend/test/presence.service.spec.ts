import { RECONNECT_GRACE_MS } from '@gp/shared'
import { PresenceService } from '../src/realtime/presence.service'

describe('PresenceService', () => {
  let service: PresenceService

  beforeEach(() => {
    service = new PresenceService()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('keeps the member in the room during the grace period', () => {
    jest.useFakeTimers()
    const evict = jest.fn()
    service.setEvictionHandler(evict)
    service.markOnline('r1', 'u1', 's1')
    service.markDisconnected('r1', 'u1')
    jest.advanceTimersByTime(RECONNECT_GRACE_MS - 1000)
    expect(evict).not.toHaveBeenCalled()
    expect(service.getConnection('r1', 'u1')).toBe('disconnected')
  })

  it('evicts the member once the grace period expires', () => {
    jest.useFakeTimers()
    const evict = jest.fn()
    service.setEvictionHandler(evict)
    service.markOnline('r1', 'u1', 's1')
    service.markDisconnected('r1', 'u1')
    jest.advanceTimersByTime(RECONNECT_GRACE_MS + 1)
    expect(evict).toHaveBeenCalledWith('r1', 'u1')
  })

  it('a reconnect within the grace period cancels the eviction', () => {
    jest.useFakeTimers()
    const evict = jest.fn()
    service.setEvictionHandler(evict)
    service.markOnline('r1', 'u1', 's1')
    service.markDisconnected('r1', 'u1')
    jest.advanceTimersByTime(10_000)
    service.markOnline('r1', 'u1', 's2')
    jest.advanceTimersByTime(RECONNECT_GRACE_MS)
    expect(evict).not.toHaveBeenCalled()
    expect(service.getConnection('r1', 'u1')).toBe('online')
  })

  it('cancelEviction stops a pending eviction without a reconnect', () => {
    jest.useFakeTimers()
    const evict = jest.fn()
    service.setEvictionHandler(evict)
    service.markOnline('r1', 'u1', 's1')
    service.markDisconnected('r1', 'u1')
    service.cancelEviction('r1', 'u1')
    jest.advanceTimersByTime(RECONNECT_GRACE_MS + 1)
    expect(evict).not.toHaveBeenCalled()
  })

  it('reports online for a room/user pair with no presence record', () => {
    expect(service.getConnection('unknown-room', 'unknown-user')).toBe('online')
  })

  it('tracks presence independently per room and per user', () => {
    jest.useFakeTimers()
    const evict = jest.fn()
    service.setEvictionHandler(evict)
    service.markOnline('r1', 'u1', 's1')
    service.markOnline('r2', 'u1', 's2')
    service.markOnline('r1', 'u2', 's3')
    service.markDisconnected('r1', 'u1')
    expect(service.getConnection('r1', 'u1')).toBe('disconnected')
    expect(service.getConnection('r2', 'u1')).toBe('online')
    expect(service.getConnection('r1', 'u2')).toBe('online')
  })
})
