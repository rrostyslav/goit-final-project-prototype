'use client'

import type { Card as CardData, CardGameView, GameAction, PlayerId, Suit } from '@gp/shared'
import { getGameMeta } from '@gp/shared'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useI18n } from '@/lib/i18n'
import { SocketAckError } from '@/lib/socket'
import { useAuthStore } from '@/lib/stores/auth-store'
import { useRoomStore } from '@/lib/stores/room-store'
import { Hand } from './hand'
import { OpponentRow } from './opponent-row'
import { cardKey } from './playing-card'
import { Table } from './table'

export interface CardGameScreenProps {
  view: CardGameView
}

/**
 * Maps `InvalidActionError.code` from `@gp/game-core`'s durak.ts/nine.ts
 * reducers to a translated dictionary key. These codes arrive over the
 * `error` socket event, not `sendAction`'s ack -- see room-store.ts's doc
 * comment on `gameError` and `RealtimeGateway.onGameAction`'s own comment
 * for why a rejected game action never surfaces as a promise rejection here.
 * Exhaustive against both reducers as of this task; an unmapped code (a
 * future reducer change) falls back to the generic `game.actionError`
 * rather than ever showing raw, untranslated server text.
 */
const ERROR_KEY_BY_CODE: Record<string, string> = {
  not_a_player: 'game.errorNotAPlayer',
  defender_cannot_attack: 'game.errorDefenderCannotAttack',
  card_not_in_hand: 'game.errorCardNotInHand',
  not_attacker: 'game.errorNotAttacker',
  rank_not_on_table: 'game.errorRankNotOnTable',
  attack_limit_reached: 'game.errorAttackLimitReached',
  not_defender: 'game.errorNotDefender',
  no_such_attack: 'game.errorNoSuchAttack',
  does_not_beat: 'game.errorDoesNotBeat',
  table_empty: 'game.errorTableEmpty',
  already_passed: 'game.errorAlreadyPassed',
  defender_cannot_pass: 'game.errorDefenderCannotPass',
  game_finished: 'game.errorGameFinished',
  unknown_action: 'game.errorUnknownAction',
  not_your_turn: 'game.errorNotYourTurn',
  illegal_play: 'game.errorIllegalPlay',
  legal_move_available: 'game.errorLegalMoveAvailable',
}

function nicknameOf(members: { user: { id: PlayerId; nickname: string } }[], id: PlayerId): string {
  return members.find((m) => m.user.id === id)?.user.nickname ?? id
}

function avatarOf(
  members: { user: { id: PlayerId; avatarUrl: string | null } }[],
  id: PlayerId,
): string | null {
  return members.find((m) => m.user.id === id)?.user.avatarUrl ?? null
}

/** Every rank currently on the table, attack side and defend side alike --
 * mirrors `ranksOnTable` in `@gp/game-core`'s durak.ts, using only
 * `view.table`, which every player already has in full. */
function ranksOnTable(table: CardGameView['table']): Set<number> {
  const ranks = new Set<number>()
  for (const entry of table) {
    ranks.add(entry.attack.rank)
    if (entry.defend) ranks.add(entry.defend.rank)
  }
  return ranks
}

/** Mirrors `maxAttacksAllowed` in `@gp/game-core`'s durak.ts: at most 6, and
 * never more than the defender's hand could ever cover. `defenderCardCount`
 * comes from `view.opponents` -- public information, not a peek at hidden
 * state -- so this is presentation parity, not a second source of truth;
 * the server enforces the real limit regardless. */
function maxAttacksAllowed(view: CardGameView, defenderCardCount: number): number {
  const alreadyDefended = view.table.filter((entry) => entry.defend !== null).length
  return Math.min(6, defenderCardCount + alreadyDefended)
}

function suitBounds(layout: CardData[], suit: Suit): { low: number; high: number } | null {
  const ranks = layout.filter((c) => c.suit === suit).map((c) => c.rank)
  if (ranks.length === 0) return null
  return { low: Math.min(...ranks), high: Math.max(...ranks) }
}

/** Mirrors `isLegalPlay` in `@gp/game-core`'s nine.ts exactly, using only
 * `view.layout` (public to every player). This one is load-bearing, not
 * just a nicety: the brief requires `nine/pass` to never be offered as a
 * free choice (the backend rejects it whenever a legal move exists), so
 * this same predicate both disables illegal hand cards AND gates the pass
 * button below. */
function isLegalNinePlay(layout: CardData[], card: CardData): boolean {
  if (layout.length === 0) return card.suit === 'spades' && card.rank === 9
  if (card.rank === 9) return suitBounds(layout, card.suit) === null
  const bounds = suitBounds(layout, card.suit)
  if (!bounds) return false
  return card.rank === bounds.low - 1 || card.rank === bounds.high + 1
}

/**
 * Durak and Nine's shared screen. Renders opponents as face-down-count rows,
 * the table (attack/defend pairs or the Nine layout), the trump/deck count,
 * and the viewer's own hand -- see `hand.tsx`, `table.tsx`, and
 * `opponent-row.tsx` for each piece.
 *
 * Durak's defend interaction (ambiguity resolution from the brief): the
 * defender must first tap an uncovered attack card on the table (`table.tsx`
 * -> `handleSelectAttack`, stored as `rawSelectedAttack`), THEN tap a hand
 * card to defend with (`handleSelectHandCard`, which reads the CURRENT
 * `selectedAttack` and sends `card/defend` against exactly that). Only the
 * second tap ever dispatches anything -- picking a different attack before
 * playing a card just changes which one is armed, with no side effect -- so
 * there is no window in which a stray click could pair the wrong attack
 * with the wrong hand card. `selectedAttack` is DERIVED from `view.table`
 * every render (`rawSelectedAttack` filtered against still-uncovered
 * entries) rather than cleared imperatively: a successful defend makes the
 * entry `defend !== null` and the selection disappears on its own; a
 * REJECTED defend leaves the entry untouched, so the same attack stays
 * armed and the defender can immediately try a different card without
 * re-selecting it.
 */
export function CardGameScreen({ view }: CardGameScreenProps) {
  const { t } = useI18n()
  const room = useRoomStore((s) => s.room)
  const sendAction = useRoomStore((s) => s.sendAction)
  const gameError = useRoomStore((s) => s.gameError)
  const clearGameError = useRoomStore((s) => s.clearGameError)
  const selfId = useAuthStore((s) => s.user?.id)

  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [rawSelectedAttack, setRawSelectedAttack] = useState<CardData | null>(null)

  if (!room || !selfId) return null

  const meta = getGameMeta(view.gameId)
  const isDurak = view.gameId === 'durak'
  const isDefender = isDurak && selfId === view.defenderId
  const isMyTurn = view.turnPlayerId === selfId

  const openAttackKeys = new Set(
    view.table.filter((entry) => entry.defend === null).map((entry) => cardKey(entry.attack)),
  )
  const selectedAttack =
    rawSelectedAttack !== null && openAttackKeys.has(cardKey(rawSelectedAttack))
      ? rawSelectedAttack
      : null

  const gameErrorMessage = gameError
    ? t(ERROR_KEY_BY_CODE[gameError.code] ?? 'game.actionError')
    : null
  const displayError = error ?? gameErrorMessage

  async function dispatch(action: GameAction) {
    setError(null)
    clearGameError()
    setIsSubmitting(true)
    try {
      await sendAction(action)
    } catch (err) {
      setError(err instanceof SocketAckError ? err.message : t('game.actionError'))
    } finally {
      setIsSubmitting(false)
    }
  }

  function canAttackWithCard(card: CardData): boolean {
    if (view.phase !== 'active' || isDefender) return false
    if (view.table.length === 0) return isMyTurn
    if (!ranksOnTable(view.table).has(card.rank)) return false
    const defenderCardCount =
      view.opponents.find((o) => o.playerId === view.defenderId)?.cardCount ?? 0
    return view.table.length < maxAttacksAllowed(view, defenderCardCount)
  }

  function isHandCardEnabled(card: CardData): boolean {
    if (view.phase !== 'active' || isSubmitting) return false
    if (view.gameId === 'nine') {
      return isMyTurn && isLegalNinePlay(view.layout, card)
    }
    if (isDefender) return selectedAttack !== null
    return canAttackWithCard(card)
  }

  function handleSelectHandCard(card: CardData) {
    if (view.gameId === 'nine') {
      void dispatch({ type: 'nine/play', card })
      return
    }
    if (isDefender && selectedAttack) {
      void dispatch({ type: 'card/defend', card, against: selectedAttack })
      return
    }
    void dispatch({ type: 'card/attack', card })
  }

  function handleSelectAttack(card: CardData) {
    setRawSelectedAttack((prev) => (prev !== null && cardKey(prev) === cardKey(card) ? null : card))
  }

  const canTake = isDurak && isDefender && view.table.length > 0 && view.phase === 'active'
  const canDurakPass = isDurak && !isDefender && view.table.length > 0 && view.phase === 'active'
  const canNinePass =
    !isDurak &&
    isMyTurn &&
    view.phase === 'active' &&
    !view.hand.some((card) => isLegalNinePlay(view.layout, card))

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-fg">{t(meta.titleKey)}</h2>
        {view.phase === 'active' ? (
          isDurak ? (
            <span className="rounded-full bg-primary px-2 py-0.5 text-xs text-primary-fg">
              {isDefender ? t('game.youDefendBadge') : t('game.youAttackBadge')}
            </span>
          ) : isMyTurn ? (
            <span className="rounded-full bg-primary px-2 py-0.5 text-xs text-primary-fg">
              {t('game.activeNow')}
            </span>
          ) : null
        ) : null}
      </Card>

      {view.phase === 'finished' ? (
        <Card className="text-center">
          <p className="text-sm text-fg-muted">{t('game.gameFinishedNotice')}</p>
        </Card>
      ) : (
        <>
          <Card>
            <ul className="flex flex-col gap-2">
              {view.opponents.map((opponent) => (
                <OpponentRow
                  key={opponent.playerId}
                  opponent={opponent}
                  nickname={nicknameOf(room.members, opponent.playerId)}
                  avatarUrl={avatarOf(room.members, opponent.playerId)}
                  isTurn={view.turnPlayerId === opponent.playerId}
                  isDefender={isDurak && view.defenderId === opponent.playerId}
                />
              ))}
            </ul>
          </Card>

          <Card className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold text-fg-muted">{t('game.tableTitle')}</h3>
            <Table
              view={view}
              selectedAttack={selectedAttack}
              onSelectAttack={handleSelectAttack}
              canSelectAttack={isDefender && !isSubmitting}
            />
          </Card>

          {displayError ? <p className="text-sm text-danger">{displayError}</p> : null}

          <Card className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-fg-muted">{t('game.yourHand')}</h3>
              {isDefender && selectedAttack === null ? (
                <span className="text-xs text-fg-muted">{t('game.selectAttackHint')}</span>
              ) : null}
            </div>
            <Hand
              cards={view.hand}
              isCardEnabled={isHandCardEnabled}
              onSelect={handleSelectHandCard}
              disabled={isSubmitting}
            />
            {isDurak ? (
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!canTake || isSubmitting}
                  onClick={() => void dispatch({ type: 'card/take' })}
                >
                  {t('game.take')}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!canDurakPass || isSubmitting}
                  onClick={() => void dispatch({ type: 'card/pass' })}
                >
                  {t('game.beaten')}
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="secondary"
                disabled={!canNinePass || isSubmitting}
                onClick={() => void dispatch({ type: 'nine/pass' })}
              >
                {t('game.ninePass')}
              </Button>
            )}
          </Card>
        </>
      )}
    </div>
  )
}
