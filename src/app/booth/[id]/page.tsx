"use client"

import { useParams } from "next/navigation"
import { useState } from "react"

type RoomState = "lobby" | "waiting" | "ready" | "snapping" | "done"

export default function BoothPage() {
  const params = useParams()
  const roomId = params.id as string
  const [role, setRole] = useState<"host" | "guest" | null>(null)
  const [roomState, setRoomState] = useState<RoomState>("lobby")

  return (
    <main className="flex-1 flex flex-col items-center justify-center p-6">
      <div className="text-center space-y-6">
        <h1 className="text-2xl font-bold">
          Room: <span className="text-pink-500">{roomId}</span>
        </h1>

        {roomState === "lobby" && (
          <div className="space-y-4">
            <p className="text-gray-400">How are you joining?</p>
            <div className="flex gap-4 justify-center">
              <button
                onClick={() => { setRole("host"); setRoomState("waiting") }}
                className="px-6 py-3 bg-pink-500 hover:bg-pink-600 rounded-xl font-semibold transition-colors cursor-pointer"
              >
                I&apos;m hosting
              </button>
              <button
                onClick={() => { setRole("guest"); setRoomState("ready") }}
                className="px-6 py-3 bg-gray-700 hover:bg-gray-600 rounded-xl font-semibold transition-colors cursor-pointer"
              >
                I&apos;m joining
              </button>
            </div>
          </div>
        )}

        {roomState === "waiting" && (
          <div className="space-y-4">
            <p className="text-gray-400">Share this link with your friend:</p>
            <div className="bg-gray-800 px-4 py-3 rounded-lg font-mono text-sm break-all">
              {typeof window !== "undefined" ? window.location.href : ""}
            </div>
            <p className="text-gray-500 animate-pulse">Waiting for friend to join...</p>
          </div>
        )}

        {roomState === "ready" && (
          <div className="space-y-4">
            <p className="text-green-400">Both connected! Webcams coming next...</p>
          </div>
        )}
      </div>
    </main>
  )
}
