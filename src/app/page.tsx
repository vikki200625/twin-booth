"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createRoom, findRoom } from "@/lib/rooms"

export default function Home() {
  const router = useRouter()
  const [mode, setMode] = useState<"idle" | "create" | "join">("idle")
  const [roomName, setRoomName] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleCreate() {
    if (!roomName.trim() || !password.trim()) {
      setError("Fill in all fields")
      return
    }
    setLoading(true)
    setError("")

    const room = await createRoom(roomName.trim(), password.trim())
    if (!room) {
      setError("Room name already taken or error occurred")
      setLoading(false)
      return
    }

    router.push(`/booth/${room.id}?role=host&name=${encodeURIComponent(room.name)}&password=${encodeURIComponent(room.password)}`)
  }

  async function handleJoin() {
    if (!roomName.trim() || !password.trim()) {
      setError("Fill in all fields")
      return
    }
    setLoading(true)
    setError("")

    const room = await findRoom(roomName.trim())
    if (!room) {
      setError("Room not found")
      setLoading(false)
      return
    }

    if (room.password !== password.trim()) {
      setError("Wrong password")
      setLoading(false)
      return
    }

    router.push(`/booth/${room.id}?role=guest&name=${encodeURIComponent(room.name)}&password=${encodeURIComponent(room.password)}`)
  }

  return (
    <main className="flex-1 flex flex-col items-center justify-center px-6">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <h1 className="text-5xl font-bold tracking-tight">
            twin<span className="text-pink-500">booth</span>
          </h1>
          <p className="mt-4 text-gray-400">
            Take photos together, even when you&apos;re apart.
          </p>
        </div>

        {mode === "idle" && (
          <div className="flex flex-col gap-4">
            <button
              onClick={() => setMode("create")}
              className="w-full px-8 py-4 bg-pink-500 hover:bg-pink-600 text-white font-semibold rounded-xl text-lg transition-colors cursor-pointer"
            >
              Create a Room
            </button>
            <button
              onClick={() => setMode("join")}
              className="w-full px-8 py-4 bg-gray-700 hover:bg-gray-600 text-white font-semibold rounded-xl text-lg transition-colors cursor-pointer"
            >
              Join a Room
            </button>
          </div>
        )}

        {mode === "create" && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-center">Create a Room</h2>
            <input
              type="text"
              placeholder="Room name"
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              className="w-full px-4 py-3 bg-gray-800 rounded-lg text-white placeholder-gray-500 outline-none focus:ring-2 focus:ring-pink-500"
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 bg-gray-800 rounded-lg text-white placeholder-gray-500 outline-none focus:ring-2 focus:ring-pink-500"
            />
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <button
              onClick={handleCreate}
              disabled={loading}
              className="w-full px-8 py-4 bg-pink-500 hover:bg-pink-600 disabled:bg-gray-600 text-white font-semibold rounded-xl text-lg transition-colors cursor-pointer"
            >
              {loading ? "Creating..." : "Create Room"}
            </button>
            <button
              onClick={() => { setMode("idle"); setError(""); setRoomName(""); setPassword("") }}
              className="w-full text-gray-400 hover:text-white text-sm cursor-pointer"
            >
              Back
            </button>
          </div>
        )}

        {mode === "join" && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-center">Join a Room</h2>
            <input
              type="text"
              placeholder="Room name"
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              className="w-full px-4 py-3 bg-gray-800 rounded-lg text-white placeholder-gray-500 outline-none focus:ring-2 focus:ring-pink-500"
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 bg-gray-800 rounded-lg text-white placeholder-gray-500 outline-none focus:ring-2 focus:ring-pink-500"
            />
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <button
              onClick={handleJoin}
              disabled={loading}
              className="w-full px-8 py-4 bg-pink-500 hover:bg-pink-600 disabled:bg-gray-600 text-white font-semibold rounded-xl text-lg transition-colors cursor-pointer"
            >
              {loading ? "Joining..." : "Join Room"}
            </button>
            <button
              onClick={() => { setMode("idle"); setError(""); setRoomName(""); setPassword("") }}
              className="w-full text-gray-400 hover:text-white text-sm cursor-pointer"
            >
              Back
            </button>
          </div>
        )}
      </div>
    </main>
  )
}
