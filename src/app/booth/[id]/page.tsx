"use client"

import { useParams, useRouter } from "next/navigation"
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
  addIceCandidate,
} from "@/lib/webrtc"
import { RealtimeChannel } from "@supabase/supabase-js"

type RoomState =
  | "lobby"
  | "waiting"
  | "connecting"
  | "connected"
  | "ready"
  | "counting"
  | "snapping"
  | "done"

export default function BoothPage() {
  const params = useParams()
  const router = useRouter()
  const roomId = params.id as string

  const [role, setRole] = useState<"host" | "guest" | null>(null)
  const [roomState, setRoomState] = useState<RoomState>("lobby")
  const [copied, setCopied] = useState(false)

  const pcRef = useRef<RTCPeerConnection | null>(null)
  const channelRef = useRef<RealtimeChannel | null>(null)
  const dataChannelRef = useRef<RTCDataChannel | null>(null)
  const pendingCandidatesRef = useRef<RTCIceCandidate[]>([])

  const handleSignal = useCallback(
    async (msg: SignalMessage) => {
      if (msg.type === "offer" && role === "guest") {
        const pc = createPeerConnection()
        pcRef.current = pc

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

  // Join as guest automatically
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

  // Host creates offer when guest joins
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

  const shareLink = typeof window !== "undefined" ? window.location.href : ""

  function copyLink() {
    navigator.clipboard.writeText(shareLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <main className="flex-1 flex flex-col items-center justify-center p-6">
      <div className="text-center space-y-6 max-w-lg">
        <h1 className="text-2xl font-bold">
          twin<span className="text-pink-500">booth</span>
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
                onClick={() => setRole("guest")}
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
            <div
              onClick={copyLink}
              className="bg-gray-800 px-4 py-3 rounded-lg font-mono text-sm break-all cursor-pointer hover:bg-gray-700 transition-colors"
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

        {roomState === "connecting" && (
          <p className="text-yellow-400 animate-pulse">Connecting to peer...</p>
        )}

        {roomState === "connected" && (
          <p className="text-green-400">Connected! Webcams coming next...</p>
        )}
      </div>
    </main>
  )
}
