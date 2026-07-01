"use client"

import { useEffect, useRef } from "react"

interface WebcamFeedProps {
  stream: MediaStream | null
  label: string
  filter?: string
}

export default function WebcamFeed({ stream, label, filter }: WebcamFeedProps) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream
    }
  }, [stream])

  return (
    <div className="relative aspect-square bg-gray-900 rounded-xl overflow-hidden">
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="w-full h-full object-cover"
        style={{ filter: filter || "none", transform: "scaleX(-1)" }}
      />
      <div className="absolute bottom-2 left-2 bg-black/60 px-2 py-1 rounded text-xs text-white">
        {label}
      </div>
      {!stream && (
        <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm">
          Camera loading...
        </div>
      )}
    </div>
  )
}
