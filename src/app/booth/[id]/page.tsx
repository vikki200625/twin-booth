"use client"

import { useParams } from "next/navigation"
import Link from "next/link"
import { useState, useEffect, useRef } from "react"
import { nanoid } from "nanoid"
import Peer, { DataConnection } from "peerjs"
import { getLocalStream, captureFrame, compositeImages, downloadBlob } from "@/lib/capture"
import { uploadPhoto, deleteRoom } from "@/lib/storage"
import WebcamFeed from "@/components/WebcamFeed"
import FilterPicker from "@/components/FilterPicker"
import Countdown from "@/components/Countdown"
import Chat from "@/components/Chat"

type RoomState =
  | "lobby"
  | "waiting"
  | "connecting"
  | "connected"
  | "camera"
  | "ready"
  | "counting"
  | "snapping"
  | "done"

interface CapturedPhoto {
  index: number
  blob: Blob
  url: string
}

export default function BoothPage() {
  const params = useParams()
  const roomId = params.id as string

  const [role, setRole] = useState<"host" | "guest" | null>(null)
  const [roomState, setRoomState] = useState<RoomState>("lobby")
  const [copied, setCopied] = useState(false)
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [localFilter, setLocalFilter] = useState("none")
  const [countingActive, setCountingActive] = useState(false)
  const [photos, setPhotos] = useState<CapturedPhoto[]>([])
  const [photoIndex, setPhotoIndex] = useState(0)
  const [chatMessages, setChatMessages] = useState<{ sender: string; text: string; timestamp: number }[]>([])
  const [myId] = useState(() => nanoid(8))

  const peerRef = useRef<Peer | null>(null)
  const connRef = useRef<DataConnection | null>(null)
  const photoIndexRef = useRef(photoIndex)
  photoIndexRef.current = photoIndex
  const localFilterRef = useRef(localFilter)
  localFilterRef.current = localFilter

  function send(data: Record<string, unknown>) {
    if (connRef.current?.open) {
      connRef.current.send(data)
    }
  }

  async function captureLocalFrame(): Promise<Blob | null> {
    const videoEl = document.querySelector('video')
    if (!videoEl) return null
    const filter = localFilterRef.current !== "none" ? localFilterRef.current : undefined
    return captureFrame(videoEl as HTMLVideoElement, filter)
  }

  async function performCapture() {
    const localBlob = await captureLocalFrame()
    if (!localBlob) return

    const idx = photoIndexRef.current
    const reader = new FileReader()
    reader.onload = async () => {
      const base64 = (reader.result as string).split(",")[1]

      const binary = atob(base64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
      }
      const remoteBlob = new Blob([bytes], { type: "image/jpeg" })

      const composite = await compositeImages(localBlob, remoteBlob)
      const uploadedUrl = await uploadPhoto(roomId, idx, composite)
      setPhotos((prev) => [
        ...prev,
        { index: idx, blob: composite, url: uploadedUrl || URL.createObjectURL(composite) },
      ])
      setPhotoIndex(idx + 1)
    }
    reader.readAsDataURL(localBlob)
  }

  async function handlePhotoMessage(msg: { photoIndex: number; imageData: string }) {
    const binary = atob(msg.imageData)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    const remoteBlob = new Blob([bytes], { type: "image/jpeg" })
    const localBlob = await captureLocalFrame()
    if (localBlob) {
      const composite = await compositeImages(localBlob, remoteBlob)
      const idx = msg.photoIndex
      const uploadedUrl = await uploadPhoto(roomId, idx, composite)
      setPhotos((prev) => [
        ...prev,
        { index: idx, blob: composite, url: uploadedUrl || URL.createObjectURL(composite) },
      ])
      setPhotoIndex(idx + 1)
    }
    setCountingActive(false)
  }

  function handleMessage(data: Record<string, unknown>) {
    const type = data.type as string

    if (type === "ready") {
      setRoomState("ready")
    }

    if (type === "countdown") {
      setCountingActive(true)
    }

    if (type === "snap") {
      performCapture()
    }

    if (type === "photo") {
      handlePhotoMessage(data as { photoIndex: number; imageData: string })
    }

    if (type === "chat") {
      setChatMessages((prev) => [...prev, { sender: data.sender as string, text: data.text as string, timestamp: data.timestamp as number }])
    }
  }

  function sendChat(text: string) {
    const msg = { type: "chat", sender: myId, text, timestamp: Date.now() }
    send(msg)
    setChatMessages((prev) => [...prev, { sender: myId, text, timestamp: Date.now() }])
  }

  function handleSnap() {
    setCountingActive(true)
    send({ type: "countdown", value: 3 })
  }

  function handleCountdownComplete() {
    setCountingActive(false)
    setRoomState("snapping")
    performCapture()
    send({ type: "snap" })

    setTimeout(() => {
      setRoomState("ready")
    }, 1000)
  }

  async function endSession() {
    await deleteRoom(roomId)
    localStream?.getTracks().forEach((t) => t.stop())
    peerRef.current?.destroy()
    setRoomState("done")
    setPhotos([])
  }

  // Host: create peer and wait for guest
  useEffect(() => {
    if (role !== "host") return

    const peer = new Peer(roomId, {
      debug: 1,
    })
    peerRef.current = peer

    peer.on("open", (id) => {
      console.log("Host peer opened with id:", id)
      setRoomState("waiting")
    })

    peer.on("connection", (conn) => {
      console.log("Host received connection from guest")
      connRef.current = conn

      conn.on("open", () => {
        console.log("Data connection opened (host side)")
        setRoomState("connected")
      })

      conn.on("data", (data) => {
        handleMessage(data as Record<string, unknown>)
      })

      conn.on("close", () => {
        console.log("Data connection closed (host side)")
      })
    })

    peer.on("error", (err) => {
      console.error("Host peer error:", err)
      setError(`Connection error: ${err.message}`)
    })

    return () => {
      peer.destroy()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, roomId])

  // Guest: connect to host
  useEffect(() => {
    if (role !== "guest") return

    setRoomState("connecting")

    const peer = new Peer(undefined as unknown as string, {
      debug: 1,
    })
    peerRef.current = peer

    peer.on("open", () => {
      console.log("Guest peer opened, connecting to host:", roomId)
      const conn = peer.connect(roomId, { reliable: true })
      connRef.current = conn

      conn.on("open", () => {
        console.log("Data connection opened (guest side)")
        setRoomState("connected")
      })

      conn.on("data", (data) => {
        handleMessage(data as Record<string, unknown>)
      })

      conn.on("close", () => {
        console.log("Data connection closed (guest side)")
      })
    })

    peer.on("error", (err) => {
      console.error("Guest peer error:", err)
      setError(`Connection error: ${err.message}`)
    })

    return () => {
      peer.destroy()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, roomId])

  // Start camera when connected
  useEffect(() => {
    if (roomState !== "connected") return

    async function startCamera() {
      try {
        const stream = await getLocalStream()
        setLocalStream(stream)
        setRoomState("camera")

        if (role === "host") {
          send({ type: "ready" })
          setRoomState("ready")
        }
      } catch {
        setError("Camera access denied. Please allow camera permissions.")
      }
    }

    startCamera()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomState])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      localStream?.getTracks().forEach((t) => t.stop())
      peerRef.current?.destroy()
    }
  }, [localStream])

  const shareLink = typeof window !== "undefined" ? window.location.href : ""

  function copyLink() {
    navigator.clipboard.writeText(shareLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <main className="flex-1 flex flex-col p-4">
      <h1 className="text-xl font-bold text-center mb-4">
        twin<span className="text-pink-500">booth</span>
      </h1>

      {error && (
        <div className="bg-red-900/50 text-red-300 px-4 py-3 rounded-lg text-center mb-4">
          {error}
        </div>
      )}

      {roomState === "lobby" && (
        <div className="flex-1 flex flex-col items-center justify-center space-y-6">
          <p className="text-gray-400 text-lg">How are you joining?</p>
          <div className="flex gap-4">
            <button
              onClick={() => setRole("host")}
              className="px-8 py-4 bg-pink-500 hover:bg-pink-600 rounded-xl font-semibold text-lg transition-colors cursor-pointer"
            >
              I&apos;m hosting
            </button>
            <button
              onClick={() => setRole("guest")}
              className="px-8 py-4 bg-gray-700 hover:bg-gray-600 rounded-xl font-semibold text-lg transition-colors cursor-pointer"
            >
              I&apos;m joining
            </button>
          </div>
        </div>
      )}

      {roomState === "waiting" && (
        <div className="flex-1 flex flex-col items-center justify-center space-y-6">
          <p className="text-gray-400">Share this link with your friend:</p>
          <div
            onClick={copyLink}
            className="bg-gray-800 px-4 py-3 rounded-lg font-mono text-sm break-all cursor-pointer hover:bg-gray-700 transition-colors max-w-md"
          >
            {shareLink}
          </div>
          <button
            onClick={copyLink}
            className="text-sm text-pink-400 hover:text-pink-300 cursor-pointer"
          >
            {copied ? "Copied!" : "Click to copy link"}
          </button>
          <p className="text-gray-500 animate-pulse">Waiting for friend to join...</p>
        </div>
      )}

      {(roomState === "connecting") && (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-yellow-400 animate-pulse text-lg">Connecting to host...</p>
        </div>
      )}

      {(roomState === "connected" || roomState === "camera") && (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-yellow-400 animate-pulse text-lg">
            {roomState === "connected" && "Starting camera..."}
            {roomState === "camera" && "Almost ready..."}
          </p>
        </div>
      )}

      {(roomState === "ready" || roomState === "counting" || roomState === "snapping" || roomState === "done") && (
        <div className="flex-1 flex flex-col lg:flex-row gap-4 items-start">
          <div className="flex-1 flex flex-col items-center gap-4 w-full">
            <FilterPicker selected={localFilter} onSelect={setLocalFilter} />

            <div className="relative grid grid-cols-2 gap-2 w-full max-w-2xl">
              <WebcamFeed stream={localStream} label="You" filter={localFilter} />
              <WebcamFeed stream={remoteStream} label="Friend" />
              <Countdown active={countingActive} onComplete={handleCountdownComplete} />
            </div>

            {role === "host" && (
              <div className="flex gap-3">
                <button
                  onClick={handleSnap}
                  disabled={countingActive || roomState === "snapping"}
                  className="px-8 py-4 bg-pink-500 hover:bg-pink-600 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-xl font-semibold text-lg transition-colors cursor-pointer"
                >
                  {countingActive ? "Wait..." : "Snap!"}
                </button>
                <button
                  onClick={endSession}
                  className="px-6 py-4 bg-red-600 hover:bg-red-700 rounded-xl font-semibold text-lg transition-colors cursor-pointer"
                >
                  End Session
                </button>
              </div>
            )}

            {role === "guest" && (
              <p className="text-gray-400 text-sm">Waiting for host to snap...</p>
            )}
          </div>

          <div className="w-full lg:w-80 h-96 lg:h-[500px] border border-gray-700 rounded-xl overflow-hidden">
            <Chat onSend={sendChat} messages={chatMessages} myId={myId} />
          </div>
        </div>
      )}

      {photos.length > 0 && (
        <div className="mt-8 space-y-4">
          <h2 className="text-lg font-semibold text-center">Gallery</h2>
          <div className="grid gap-4 max-w-2xl mx-auto">
            {photos.map((photo) => (
              <div key={photo.index} className="flex flex-col items-center gap-2">
                <img
                  src={photo.url}
                  alt={`Photo ${photo.index + 1}`}
                  className="rounded-lg w-full"
                />
                <button
                  onClick={() => downloadBlob(photo.blob, `twin-booth-${photo.index + 1}.jpg`)}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm transition-colors cursor-pointer"
                >
                  Download Photo {photo.index + 1}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {roomState === "done" && (
        <div className="flex-1 flex flex-col items-center justify-center space-y-4">
          <p className="text-xl text-gray-300">Session ended</p>
          <p className="text-gray-500">All photos have been deleted from the server.</p>
          <Link
            href="/"
            className="px-6 py-3 bg-pink-500 hover:bg-pink-600 rounded-xl font-semibold transition-colors"
          >
            Create New Booth
          </Link>
        </div>
      )}
    </main>
  )
}
