import { cn } from '@/lib/cn'

export type AvatarSize = 'sm' | 'md' | 'lg'

export interface AvatarProps {
  nickname: string
  avatarUrl?: string | null
  size?: AvatarSize
  className?: string
}

const SIZE_CLASSES: Record<AvatarSize, string> = {
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-14 w-14 text-lg',
}

export function Avatar({ nickname, avatarUrl, size = 'md', className }: AvatarProps) {
  const initial = nickname.trim().charAt(0).toUpperCase() || '?'

  // avatarUrl is an arbitrary/remote URL (OAuth provider avatars, later
  // user-uploaded ones); next/image would need a configured remote-domain
  // allowlist we don't have yet for this prototype, so a plain <img> below
  // is deliberate, not an oversight.
  if (avatarUrl) {
    return (
      // biome-ignore lint/performance/noImgElement: remote avatarUrl, no next/image domain allowlist configured yet
      <img
        src={avatarUrl}
        alt={nickname}
        className={cn('rounded-full object-cover', SIZE_CLASSES[size], className)}
      />
    )
  }

  return (
    <div
      role="img"
      aria-label={nickname}
      className={cn(
        'flex items-center justify-center rounded-full bg-primary font-semibold text-primary-fg',
        SIZE_CLASSES[size],
        className,
      )}
    >
      {initial}
    </div>
  )
}
