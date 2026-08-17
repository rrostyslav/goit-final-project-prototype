import { RoomCodeService } from '../src/rooms/room-code.service'

describe('RoomCodeService', () => {
  const service = new RoomCodeService()

  it('generates a 6-character code from the safe alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const code = service.generate()
      expect(code).toHaveLength(6)
      expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/)
    }
  })

  it('rejects codes containing ambiguous characters', () => {
    expect(service.isValid('ABC1DE')).toBe(false)
    expect(service.isValid('ABCODE')).toBe(false)
    expect(service.isValid('ABCDEF')).toBe(true)
  })

  it('rejects codes with the wrong length', () => {
    expect(service.isValid('ABCDE')).toBe(false)
    expect(service.isValid('ABCDEFG')).toBe(false)
  })

  it('rejects lowercase codes', () => {
    expect(service.isValid('abcdef')).toBe(false)
  })
})
