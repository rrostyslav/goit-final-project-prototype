'use client'

import { SiteHeader } from '@/components/layout/site-header'
import { RoomBrowser } from '@/components/rooms/room-browser'

export default function RoomsPage() {
  return (
    <main className="flex min-h-screen flex-col items-center gap-8 px-4 py-10">
      <SiteHeader />
      <RoomBrowser />
    </main>
  )
}
