"use client"

import { useParams, useSearchParams } from "next/navigation"
import Link from "next/link"
import { useState, useEffect, useRef } from "react"
import { nanoid } from "nanoid"
import Peer, { DataConnection, MediaConnection } from "peerjs"
import { getLocalStream, captureFrame, compositeImages, downloadBlob } from "@/lib/capture"
import { uploadPhoto, deleteRoom } from "@/lib/storage"
import { findRoom, joinRoom } from "@/lib/rooms"
import WebcamFeed from "@/components/WebcamFeed"
import FilterPicker from "@/components/FilterPicker"
import Countdown from "@/components/Countdown"
import Chat from "@/components/Chat"

type RoomState =
  | "connecting"
  | "waiting"
  | "peer-connected"
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
  const searchParams = useSearchParams()
  const roomId = params.id as string
  const role = searchParams.get("role") as "host" | "guest"
  const roomName = searchParams.get("name") || "Room"

  const [roomState, setRoomState] = useState<RoomState>("connecting")
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
  const pendingCallRef = useRef<MediaConnection | null>(null)
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

    if (type === "ready") setRoomState("ready")
    if (type === "countdown") setCountingActive(true)
    if (type === "snap") performCapture()
    if (type === "photo") handlePhotoMessage(data as { photoIndex: number; imageData: string })
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
    setTimeout(() => setRoomState("ready"), 1000)
  }

  async function endSession() {
    await deleteRoom(roomId)
    localStream?.getTracks().forEach((t) => t.stop())
    peerRef.current?.destroy()
    setRoomState("done")
    setPhotos([])
  }

  // HOST: Create peer, store ID in DB, wait for guest
  useEffect(() => {
    if (role !== "host") return

    const peerId = `twinbooth-${roomId}-${nanoid(6)}`
    const peer = new Peer(peerId)
    peerRef.current = peer

    peer.on("open", async (id) => {
      console.log("Host peer ready:", id)
      await joinRoom(roomId, id)
      setRoomState("waiting")
    })

    peer.on("connection", (conn) => {
      console.log("Host: guest connected!", conn.peer)
      connRef.current = conn

      conn.on("open", () => {
        console.log("Host: data channel open")
        setRoomState("peer-connected")
      })

      conn.on("data", (data) => {
        handleMessage(data as Record<string, unknown>)
      })
    })

    peer.on("call", (call) => {
      console.log("Host: receiving call from guest")
      call.on("stream", (stream) => {
        console.log("Host: received guest stream")
        setRemoteStream(stream)
      })
      if (localStream) {
        call.answer(localStream)
      } else {
        console.log("Host: camera not ready yet, queuing call")
        pendingCallRef.current = call
      }
    })

    peer.on("error", (err) => {
      console.error("Host peer error:", err)
      setError(`Error: ${err.message}`)
    })

    return () => { peer.destroy() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, roomId])

  // GUEST: Find room, get host peer ID, connect with retries
  useEffect(() => {
    if (role !== "guest") return

    let cancelled = false
    let peer: Peer | null = null
    let retryCount = 0
    const maxRetries = 15

    async function tryConnect() {
      if (cancelled) return

      const room = await findRoom(roomName)
      if (!room || !room.host_peer_id) {
        retryCount++
        if (retryCount < maxRetries && !cancelled) {
          console.log(`Guest: room not ready yet, retry ${retryCount}/${maxRetries}...`)
          setTimeout(tryConnect, 2000)
        } else if (!cancelled) {
          setError("Host not found. Make sure the host has created the room and is waiting.")
        }
        return
      }

      console.log("Guest: found host peer ID:", room.host_peer_id)

      peer = new Peer()
      peerRef.current = peer

      peer.on("open", () => {
        console.log("Guest peer ready, connecting to host...")
        const conn = peer!.connect(room.host_peer_id!, { reliable: true })
        connRef.current = conn

        conn.on("open", () => {
          console.log("Guest: data channel open!")
          setRoomState("peer-connected")
        })

        conn.on("data", (data) => {
          handleMessage(data as Record<string, unknown>)
        })

        conn.on("error", (err) => {
          console.error("Guest connection error:", err)
        })
      })

      peer.on("call", (call) => {
        console.log("Guest: receiving call from host")
        call.on("stream", (stream) => {
          console.log("Guest: received host stream")
          setRemoteStream(stream)
        })
        if (localStream) {
          call.answer(localStream)
        } else {
          console.log("Guest: camera not ready yet, queuing call")
          pendingCallRef.current = call
        }
      })

      peer.on("error", (err) => {
        console.error("Guest peer error:", err)
        if (!cancelled) {
          setError(`Connection failed: ${err.message}. Retrying...`)
          setTimeout(tryConnect, 3000)
        }
      })
    }

    tryConnect()

    return () => {
      cancelled = true
      peer?.destroy()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, roomName])

  // Start camera when peer connected
  useEffect(() => {
    if (roomState !== "peer-connected") return

    async function startCamera() {
      try {
        const stream = await getLocalStream()
        setLocalStream(stream)

        // Answer any pending call from the peer
        if (pendingCallRef.current) {
          console.log("Answering pending call with new stream")
          pendingCallRef.current.answer(stream)
          pendingCallRef.current = null
        }

        // Call the peer to send our stream
        if (peerRef.current && connRef.current) {
          const call = peerRef.current.call(connRef.current.peer, stream)
          if (call) {
            call.on("stream", (remote) => {
              setRemoteStream(remote)
            })
          }
        }

        if (role === "host") {
          send({ type: "ready" })
        }
        setRoomState("ready")
      } catch {
        setError("Camera access denied. Please allow camera permissions.")
      }
    }

    startCamera()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomState])

  // Cleanup
  useEffect(() => {
    return () => {
      localStream?.getTracks().forEach((t) => t.stop())
      peerRef.current?.destroy()
    }
  }, [localStream])

  const shareLink = typeof window !== "undefined"
    ? `${window.location.origin}?autojoin=${encodeURIComponent(roomName)}`
    : ""

  function copyLink() {
    navigator.clipboard.writeText(shareLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <main className="flex-1 flex flex-col p-4">
      <h1 className="text-xl font-bold text-center mb-4">
        twin<span className="text-pink-500">booth</span>
        <span className="text-gray-500 text-sm ml-2">| {roomName}</span>
      </h1>

      {error && (
        <div className="bg-red-900/50 text-red-300 px-4 py-3 rounded-lg text-center mb-4">
          {error}
        </div>
      )}

      {roomState === "connecting" && (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-yellow-400 animate-pulse text-lg">Setting up room...</p>
        </div>
      )}

      {roomState === "waiting" && (
        <div className="flex-1 flex flex-col items-center justify-center space-y-6">
          <p className="text-gray-400">Tell your friend to join:</p>
          <div className="bg-gray-800 px-4 py-3 rounded-lg text-center space-y-2">
            <p className="text-white font-semibold">Room: {roomName}</p>
            <p className="text-gray-400 text-sm">Search for &quot;{roomName}&quot; and enter the password</p>
          </div>
          <button
            onClick={copyLink}
            className="text-sm text-pink-400 hover:text-pink-300 cursor-pointer"
          >
            {copied ? "Copied!" : "Or share this link"}
          </button>
          <p className="text-gray-500 animate-pulse">Waiting for friend to join...</p>
        </div>
      )}

      {roomState === "peer-connected" && (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-green-400 animate-pulse text-lg">Friend connected! Starting camera...</p>
        </div>
      )}

      {roomState === "camera" && (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-yellow-400 animate-pulse text-lg">Almost ready...</p>
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
                <img src={photo.url} alt={`Photo ${photo.index + 1}`} className="rounded-lg w-full" />
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
          <p className="text-gray-500">All photos have been deleted.</p>
          <Link href="/" className="px-6 py-3 bg-pink-500 hover:bg-pink-600 rounded-xl font-semibold transition-colors">
            Create New Room
          </Link>
        </div>
      )}
    </main>
  )
}
