/** Tiny classnames joiner -- avoids pulling in `clsx` for a handful of call
 * sites. Falsy entries (false/null/undefined/'') are dropped. */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ')
}
