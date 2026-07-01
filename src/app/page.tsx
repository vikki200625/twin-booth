"use client"

import { useRouter } from "next/navigation"
import { nanoid } from "nanoid"

export default function Home() {
  const router = useRouter()

  function createBooth() {
    const roomId = nanoid(10)
    router.push(`/booth/${roomId}`)
  }

  return (
    <main className="flex-1 flex flex-col items-center justify-center px-6">
      <div className="max-w-lg text-center space-y-8">
        <h1 className="text-5xl font-bold tracking-tight">
          twin<span className="text-pink-500">booth</span>
        </h1>

        <p className="text-lg text-gray-400 leading-relaxed">
          Take photos together, even when you're apart.
          <br />
          Two screens. One moment. Shared memories.
        </p>

        <div className="flex flex-col items-center gap-4">
          <button
            onClick={createBooth}
            className="px-8 py-4 bg-pink-500 hover:bg-pink-600 text-white font-semibold rounded-xl text-lg transition-colors cursor-pointer"
          >
            Create a Booth
          </button>

          <p className="text-sm text-gray-600">
            Share the link with your friend and start snapping
          </p>
        </div>
      </div>
    </main>
  )
}
