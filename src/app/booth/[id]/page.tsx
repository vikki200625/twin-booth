"use client"

import { useParams } from "next/navigation"
import { useState, useEffect, useRef, useCallback } from "react"
import { createRoomChannel, broadcastSignal, SignalMessage } from "@/lib/signaling"
import {
  createPeerConnection,
  setupDataChannel,
  handleDataChannel,
  createOffer,
  handleOffer,
  handleAnswer,
} from "@/lib/webrtc"
import { getLocalStream } from "@/lib/capture"
import { RealtimeChannel } from "@supabase/supabase-js"
import WebcamFeed from "@/components/WebcamFeed"

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

export default function BoothPage() {
  const params = useParams()
  const roomId = params.id as string

  const [role, setRole] = useState<"host" | "guest" | null>(null)
  const [roomState, setRoomState] = useState<RoomState>("lobby")
  const [copied, setCopied] = useState(false)
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)

  const pcRef = useRef<RTCPeerConnection | null>(null)
  const channelRef = useRef<RealtimeChannel | null>(null)
  const dataChannelRef = useRef<RTCDataChannel | null>(null)
  const pendingCandidatesRef = useRef<RTCIceCandidate[]>([])

  const handleSignal = useCallback(
    async (msg: SignalMessage) => {
      if (msg.type === "offer" && role === "guest") {
        const pc = createPeerConnection()
        pcRef.current = pc

        pc.ontrack = (e) => {
          setRemoteStream(e.streams[0])
        }

        handleDataChannel(pc, (data) => {
          const parsed = JSON.parse(data)
          handleDataMessage(parsed)
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
    },
    [role]
  )

  function handleDataMessage(msg: SignalMessage) {
    if (msg.type === "ready") {
      setRoomState("ready")
    }
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
        <div className="flex-1 flex flex-col items-center gap-4">
          <div className="grid grid-cols-2 gap-2 w-full max-w-2xl">
            <WebcamFeed stream={localStream} label="You" />
            <WebcamFeed stream={remoteStream} label="Friend" />
          </div>
          <p className="text-green-400">Both cameras live! Snap feature coming next...</p>
        </div>
      )}
    </main>
  )
}
