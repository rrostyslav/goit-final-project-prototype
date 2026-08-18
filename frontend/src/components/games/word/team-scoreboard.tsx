'use client'

import type { PlayerId, RoomMemberDto, TeamView } from '@gp/shared'
import { cn } from '@/lib/cn'
import { useI18n } from '@/lib/i18n'

/** Looks up a player's nickname from the room's member list, falling back to
 * the raw id if the player is no longer a room member (should not normally
 * happen mid-game, but the room member list is the only source of nicknames
 * a `WordGameView` has -- it never carries display names itself). Exported
 * so `explainer-controls.tsx` and `guesser-view.tsx` share this exact
 * lookup rather than each re-implementing it. */
export function resolveNickname(members: RoomMemberDto[], id: PlayerId): string {
  return members.find((member) => member.user.id === id)?.user.nickname ?? id
}

export interface TeamScoreboardProps {
  teams: TeamView[]
  activeTeamId: string | null
  /** Alias/Hat group real teams (`team.name` is meaningful, e.g. "Team 1",
   * and a team's roster is worth showing). Crocodile is not team-based --
   * `createWordRound`'s `teamCount` is set to the player count, so every
   * `TeamView` here has exactly one member and `team.name` is a meaningless
   * "Team 1" (see this task's report) -- the row must be labelled with that
   * one member's nickname instead, and there is no roster line to show. */
  teamBased: boolean
  members: RoomMemberDto[]
  selfId: PlayerId
}

export function TeamScoreboard({
  teams,
  activeTeamId,
  teamBased,
  members,
  selfId,
}: TeamScoreboardProps) {
  const { t } = useI18n()
  const sorted = [...teams].sort((a, b) => b.score - a.score)

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-fg">{t('game.scoreboardTitle')}</h2>
      <ul className="flex flex-col gap-2">
        {sorted.map((team) => {
          const isActive = team.id === activeTeamId
          const isSelfTeam = team.memberIds.includes(selfId)
          const label = teamBased ? team.name : resolveNickname(members, team.memberIds[0] ?? '?')
          const roster = teamBased
            ? team.memberIds.map((id) => resolveNickname(members, id)).join(', ')
            : null

          return (
            <li
              key={team.id}
              className={cn(
                'flex items-center justify-between gap-3 rounded-lg border px-3 py-2',
                isActive ? 'border-primary bg-surface-hover' : 'border-border bg-surface',
              )}
            >
              <div className="flex flex-col">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-fg">{label}</span>
                  {isSelfTeam ? (
                    <span className="text-xs text-fg-muted">{t('room.youBadge')}</span>
                  ) : null}
                  {isActive ? (
                    <span className="rounded-full bg-primary px-2 py-0.5 text-xs text-primary-fg">
                      {t('game.activeNow')}
                    </span>
                  ) : null}
                </div>
                {roster ? <span className="text-xs text-fg-muted">{roster}</span> : null}
              </div>
              <span className="text-lg font-semibold text-fg">{team.score}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
