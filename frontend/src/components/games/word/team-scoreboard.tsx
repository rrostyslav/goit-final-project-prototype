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

/** `buildTeams` in the word engine emits deterministic ids of the form
 * `team-{index}`. Deriving the display number from the id keeps the label in
 * the user's language instead of echoing the server's English `team.name`. */
function teamNumber(teamId: string): number {
  const parsed = Number.parseInt(teamId.replace(/^team-/, ''), 10)
  return Number.isFinite(parsed) ? parsed + 1 : 1
}

export interface TeamScoreboardProps {
  teams: TeamView[]
  activeTeamId: string | null
  /** Alias/Hat group real teams, so a team's roster is worth showing. Note
   * `team.name` is server-generated English ("Team 1") and is never rendered
   * -- the label comes from the team's index via the dictionary, so the UI
   * stays translated. Crocodile is not team-based: `createWordRound`'s
   * `teamCount` equals the player count, so every `TeamView` has exactly one
   * member and the row is labelled with that member's nickname instead. */
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
          const label = teamBased
            ? t('game.teamLabel', { number: teamNumber(team.id) })
            : resolveNickname(members, team.memberIds[0] ?? '?')
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
