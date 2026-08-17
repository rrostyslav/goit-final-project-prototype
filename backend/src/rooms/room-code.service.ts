import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '@gp/shared'
import { Injectable } from '@nestjs/common'

const VALID_CODE_PATTERN = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`)

/** Generates and validates room codes drawn from `ROOM_CODE_ALPHABET` — the
 * ambiguous characters I/O/0/1 are excluded so a code can be read aloud or
 * typed without confusion. Uniqueness against existing rooms is enforced by
 * the database's unique constraint on `rooms.code`; `RoomsService` retries
 * generation on collision. */
@Injectable()
export class RoomCodeService {
  generate(): string {
    let code = ''
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
      const index = Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)
      code += ROOM_CODE_ALPHABET[index]
    }
    return code
  }

  isValid(code: string): boolean {
    return VALID_CODE_PATTERN.test(code)
  }
}
