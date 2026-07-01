"use client"

import { useParams } from "next/navigation"
import { useState, useEffect, useRef, useCallback } from "react"
import { nanoid } from "nanoid"
import { createRoomChannel, broadcastSignal, SignalMessage } from "@/lib/signaling"
import {
  createPeerConnection,
  setupDataChannel,
  handleDataChannel,
  createOffer,
  handleOffer,
  handleAnswer,
} from "@/lib/webrtc"
import { getLocalStream, captureFrame, compositeImages, downloadBlob } from "@/lib/capture"
import { uploadPhoto } from "@/lib/storage"
import { RealtimeChannel } from "@supabase/supabase-js"
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

  const pcRef = useRef<RTCPeerConnection | null>(null)
  const channelRef = useRef<RealtimeChannel | null>(null)
  const dataChannelRef = useRef<RTCDataChannel | null>(null)
  const pendingCandidatesRef = useRef<RTCIceCandidate[]>([])
  const localVideoRef = useRef<HTMLVideoElement | null>(null)
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null)

  function sendData(msg: SignalMessage) {
    if (dataChannelRef.current?.readyState === "open") {
      dataChannelRef.current.send(JSON.stringify(msg))
    }
  }

  const handleSignal = useCallback(
    async (msg: SignalMessage) => {
      if (msg.type === "offer" && role === "guest") {
        const pc = createPeerConnection()
        pcRef.current = pc

        pc.ontrack = (e) => {
          setRemoteStream(e.streams[0])
        }

        handleDataChannel(pc, (data) => {
          handleDataMessage(JSON.parse(data))
        })

        const answer = await handleOffer(pc, msg.sdp)
        broadcastSignal(channelRef.current!, { type: "answer", sdp: answer })

        pc.onicecandidate = (e) => {
          if (e.candidate) {
            broadcastSignal(channelRef.current!, {
              type: "ice-candidate",
              candidate: JSON.stringify(e.candidate),
            })
          }
        }

        pc.onconnectionstatechange = () => {
          if (pc.connectionState === "connected") {
            setRoomState("connected")
          }
        }

        for (const c of pendingCandidatesRef.current) {
          await pc.addIceCandidate(c)
        }
        pendingCandidatesRef.current = []
      }

      if (msg.type === "answer" && role === "host") {
        await handleAnswer(pcRef.current!, msg.sdp)
      }

      if (msg.type === "ice-candidate") {
        const candidate = JSON.parse(msg.candidate)
        if (pcRef.current?.remoteDescription) {
          await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate))
        } else {
          pendingCandidatesRef.current.push(new RTCIceCandidate(candidate))
        }
      }

      if (msg.type === "ready") {
        setRoomState("ready")
      }

      if (msg.type === "countdown") {
        setCountingActive(true)
      }

      if (msg.type === "snap") {
        performCapture()
      }

      if (msg.type === "photo") {
        const binary = atob(msg.imageData)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i)
        }
        const blob = new Blob([bytes], { type: "image/jpeg" })
        const localBlob = await captureLocalFrame()
        if (localBlob) {
          const composite = await compositeImages(localBlob, blob)
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

      if (msg.type === "chat") {
        setChatMessages((prev) => [...prev, { sender: msg.sender, text: msg.text, timestamp: msg.timestamp }])
      }
    },
    [role, roomId]
  )

  async function captureLocalFrame(): Promise<Blob | null> {
    const videoEl = document.querySelector('video')
    if (!videoEl) return null
    return captureFrame(videoEl as HTMLVideoElement, localFilter !== "none" ? localFilter : undefined)
  }

  async function performCapture() {
    const localBlob = await captureLocalFrame()
    if (!localBlob) return

    const reader = new FileReader()
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1]
      sendData({
        type: "photo",
        photoIndex: photoIndex,
        imageData: base64,
      })
    }
    reader.readAsDataURL(localBlob)
  }

  function handleDataMessage(msg: SignalMessage) {
    if (msg.type === "ready") {
      setRoomState("ready")
    }
    if (msg.type === "countdown") {
      setCountingActive(true)
    }
    if (msg.type === "snap") {
      performCapture()
    }
    if (msg.type === "photo") {
      const binary = atob(msg.imageData)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
      }
      const blob = new Blob([bytes], { type: "image/jpeg" })
      captureLocalFrame().then((localBlob) => {
        if (localBlob) {
          compositeImages(localBlob, blob).then(async (composite) => {
            const idx = msg.photoIndex
            const uploadedUrl = await uploadPhoto(roomId, idx, composite)
            setPhotos((prev) => [
              ...prev,
              { index: idx, blob: composite, url: uploadedUrl || URL.createObjectURL(composite) },
            ])
            setPhotoIndex(idx + 1)
          })
        }
      })
      setCountingActive(false)
    }
    if (msg.type === "chat") {
      setChatMessages((prev) => [...prev, { sender: msg.sender, text: msg.text, timestamp: msg.timestamp }])
    }
  }

  function handleSnap() {
    setCountingActive(true)
    sendData({ type: "countdown", value: 3 })
  }

  function handleCountdownComplete() {
    setCountingActive(false)
    setRoomState("snapping")
    performCapture()
    sendData({ type: "snap" })

    setTimeout(() => {
      setRoomState("ready")
    }, 1000)
  }

  function sendChat(text: string) {
    const msg = { type: "chat" as const, sender: myId, text, timestamp: Date.now() }
    sendData(msg)
    setChatMessages((prev) => [...prev, { sender: myId, text, timestamp: Date.now() }])
  }

  // Start camera when connected
  useEffect(() => {
    if (roomState !== "connected") return

    async function startCamera() {
      try {
        const stream = await getLocalStream()
        setLocalStream(stream)
        setRoomState("camera")

        if (pcRef.current) {
          stream.getTracks().forEach((track) => {
            pcRef.current!.addTrack(track, stream)
          })
        }

        if (role === "host" && dataChannelRef.current) {
          broadcastSignal(channelRef.current!, { type: "ready" })
          setRoomState("ready")
        }
      } catch {
        setError("Camera access denied. Please allow camera permissions.")
      }
    }

    startCamera()
  }, [roomState, role])

  // Join as guest
  useEffect(() => {
    if (role !== "guest") return

    const channel = createRoomChannel(roomId, handleSignal)
    channelRef.current = channel
    setRoomState("connecting")

    const checkSubscribed = setInterval(() => {
      if (channel.state === "subscribed") {
        clearInterval(checkSubscribed)
        broadcastSignal(channel, { type: "join", role: "guest" })
      }
    }, 100)

    return () => {
      clearInterval(checkSubscribed)
      channel.unsubscribe()
    }
  }, [role, handleSignal, roomId])

  // Host creates offer
  useEffect(() => {
    if (role !== "host" || roomState !== "waiting") return

    const channel = createRoomChannel(roomId, (msg) => {
      if (msg.type === "join" && msg.role === "guest") {
        startWebRTC()
      }
      handleSignal(msg)
    })
    channelRef.current = channel

    async function startWebRTC() {
      const pc = createPeerConnection()
      pcRef.current = pc

      pc.ontrack = (e) => {
        setRemoteStream(e.streams[0])
      }

      const dc = setupDataChannel(pc)
      dataChannelRef.current = dc

      dc.onopen = () => {
        setRoomState("connected")
      }

      dc.onmessage = (e) => {
        handleDataMessage(JSON.parse(e.data))
      }

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          broadcastSignal(channel, {
            type: "ice-candidate",
            candidate: JSON.stringify(e.candidate),
          })
        }
      }

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "connected") {
          setRoomState("connected")
        }
      }

      const offer = await createOffer(pc)
      broadcastSignal(channel, { type: "offer", sdp: offer })
      setRoomState("connecting")
    }

    return () => channel.unsubscribe()
  }, [role, roomState, roomId, handleSignal])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      localStream?.getTracks().forEach((t) => t.stop())
      pcRef.current?.close()
      channelRef.current?.unsubscribe()
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
              onClick={() => { setRole("host"); setRoomState("waiting") }}
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

      {(roomState === "connecting" || roomState === "connected" || roomState === "camera") && (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-yellow-400 animate-pulse text-lg">
            {roomState === "connecting" && "Connecting to peer..."}
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
              <button
                onClick={handleSnap}
                disabled={countingActive || roomState === "snapping"}
                className="px-8 py-4 bg-pink-500 hover:bg-pink-600 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-xl font-semibold text-lg transition-colors cursor-pointer"
              >
                {countingActive ? "Wait..." : "Snap!"}
              </button>
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
    </main>
  )
}
