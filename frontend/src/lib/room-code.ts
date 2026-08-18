import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '@gp/shared'

/** Room codes deliberately exclude I, O, 0 and 1 so a code read aloud or
 * copied off a screen is unambiguous. Enforce that alphabet as the user
 * types rather than letting an impossible code reach the server as a 404.
 * Shared by the landing page's "join by code" form and any other input that
 * accepts a room code, so the alphabet only lives in one place. */
export function sanitizeRoomCode(raw: string): string {
  return raw
    .toUpperCase()
    .split('')
    .filter((char) => ROOM_CODE_ALPHABET.includes(char))
    .join('')
    .slice(0, ROOM_CODE_LENGTH)
}
