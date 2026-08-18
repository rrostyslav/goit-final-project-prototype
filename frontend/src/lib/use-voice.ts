'use client'

import type { RoomId, UserId, VoiceCredentials } from '@gp/shared'
import type { Participant, RemoteTrack, RemoteTrackPublication } from 'livekit-client'
import { ConnectionState, Room, RoomEvent, Track } from 'livekit-client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRoomStore } from './stores/room-store'

export type VoiceStatus = 'idle' | 'connecting' | 'connected' | 'mic_denied' | 'error' | 'disabled'

export interface UseVoiceResult {
  /** Whether voice chat is configured on this backend deployment at all
   * (`VoiceCredentials.enabled` -- false when LIVEKIT_URL is unset there).
   * Distinct from `connected`, which tracks this client's own connection. */
  enabled: boolean
  connected: boolean
  muted: boolean
  speakers: Set<UserId>
  status: VoiceStatus
  errorMessage: string | null
  toggleMute: () => void
}

const AUDIO_CONTAINER_ID = 'gp-voice-audio-sink'

/** A single, page-lifetime container for the `<audio>` elements LiveKit's
 * `track.attach()` creates for remote participants -- invisible (no
 * `controls` attribute, `display: none`), deliberately kept outside the
 * React tree so component re-renders never touch it; only the imperative
 * `TrackSubscribed`/`TrackUnsubscribed` handlers below add or remove
 * elements from it. */
function getAudioContainer(): HTMLElement {
  let container = document.getElementById(AUDIO_CONTAINER_ID)
  if (!container) {
    container = document.createElement('div')
    container.id = AUDIO_CONTAINER_ID
    container.style.display = 'none'
    document.body.appendChild(container)
  }
  return container
}

/**
 * Connects to this room's LiveKit voice channel on mount and disconnects
 * ONLY on unmount (or if `roomId` itself changes, which it never does for
 * the lifetime of `/room/[code]` -- see room-store.ts's `join`). This is the
 * core product promise: the room page renders `<VoicePanel/>` (this hook's
 * sole consumer) OUTSIDE its `room.status` switch, so this effect's
 * dependency array (`[roomId]`) never sees a reason to re-run across
 * `lobby -> in_game -> results -> lobby`.
 *
 * `voice:token` is only requested once the caller has actually joined the
 * room over the socket (`RealtimeGateway.onVoiceToken` enforces membership
 * via the same `assertMember` every other room-scoped handler uses) -- the
 * room page only ever renders `<VoicePanel roomId={room.id}/>` once `room`
 * is populated, which is exactly the point `room:join` has already
 * succeeded.
 */
export function useVoice(roomId: RoomId | null): UseVoiceResult {
  const [status, setStatus] = useState<VoiceStatus>('idle')
  const [enabled, setEnabled] = useState(true)
  const [connected, setConnected] = useState(false)
  const [muted, setMuted] = useState(true)
  const [speakers, setSpeakers] = useState<Set<UserId>>(new Set())
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const roomRef = useRef<Room | null>(null)
  const audioElsRef = useRef<Map<string, HTMLMediaElement>>(new Map())

  useEffect(() => {
    if (!roomId) return

    // React Strict Mode (dev only) double-invokes this effect: mount ->
    // cleanup -> mount again, synchronously, before any awaited call below
    // ever resolves. `cancelled` is captured fresh per invocation, so the
    // FIRST (fake) run's every `await` sees `cancelled === true` by the time
    // it resumes and bails before ever creating a `Room` -- only the SECOND
    // (real) run's `roomRef`/`audioElsRef` (both shared across invocations)
    // end up holding a connection. Verified in the task-21 report.
    let cancelled = false

    async function run() {
      setStatus('connecting')
      setErrorMessage(null)

      let credentials: VoiceCredentials
      try {
        credentials = await useRoomStore.getState().requestVoiceToken(roomId as RoomId)
      } catch (err) {
        if (cancelled) return
        setStatus('error')
        setErrorMessage(err instanceof Error ? err.message : String(err))
        return
      }
      if (cancelled) return

      if (!credentials.enabled || !credentials.url || !credentials.token) {
        setEnabled(false)
        setStatus('disabled')
        return
      }
      setEnabled(true)

      const room = new Room()
      roomRef.current = room

      room.on(RoomEvent.ActiveSpeakersChanged, (activeSpeakers: Participant[]) => {
        setSpeakers(new Set(activeSpeakers.map((p) => p.identity as UserId)))
      })

      room.on(
        RoomEvent.TrackSubscribed,
        (track: RemoteTrack, publication: RemoteTrackPublication) => {
          if (track.kind !== Track.Kind.Audio) return
          const element = track.attach()
          getAudioContainer().appendChild(element)
          audioElsRef.current.set(publication.trackSid, element)
        },
      )

      room.on(
        RoomEvent.TrackUnsubscribed,
        (_track: RemoteTrack, publication: RemoteTrackPublication) => {
          const element = audioElsRef.current.get(publication.trackSid)
          if (element) {
            element.remove()
            audioElsRef.current.delete(publication.trackSid)
          }
        },
      )

      room.on(RoomEvent.Disconnected, () => {
        setConnected(false)
        setSpeakers(new Set())
      })

      room.on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
        setConnected(state === ConnectionState.Connected)
      })

      try {
        await room.connect(credentials.url, credentials.token)
      } catch (err) {
        if (cancelled) {
          room.disconnect()
          return
        }
        setStatus('error')
        setErrorMessage(err instanceof Error ? err.message : String(err))
        return
      }

      if (cancelled) {
        room.disconnect()
        return
      }
      setConnected(true)

      try {
        await room.localParticipant.setMicrophoneEnabled(true)
        if (cancelled) return
        setMuted(false)
        setStatus('connected')
      } catch (err) {
        if (cancelled) return
        // Permission denial (or no microphone device) is a visible,
        // translated state per the brief, never a silent console error --
        // the room connection itself is still good (others can still be
        // heard), only publishing this client's own mic failed.
        setMuted(true)
        setStatus('mic_denied')
        setErrorMessage(err instanceof Error ? err.message : String(err))
      }
    }

    void run()

    return () => {
      cancelled = true
      const room = roomRef.current
      roomRef.current = null
      for (const element of audioElsRef.current.values()) {
        element.remove()
      }
      audioElsRef.current.clear()
      if (room) {
        room.disconnect()
      }
      setConnected(false)
      setSpeakers(new Set())
      setStatus('idle')
    }
  }, [roomId])

  const toggleMute = useCallback(() => {
    const room = roomRef.current
    if (!room) return
    const next = !muted
    setMuted(next)
    room.localParticipant.setMicrophoneEnabled(!next).catch(() => {
      // Revert the optimistic flip if the toggle itself fails (e.g. the
      // device was unplugged mid-call) so the button never lies about the
      // real track state.
      setMuted((current) => (current === next ? !next : current))
    })
  }, [muted])

  return { enabled, connected, muted, speakers, status, errorMessage, toggleMute }
}
