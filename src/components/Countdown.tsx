"use client"

import { useEffect, useState } from "react"

interface CountdownProps {
  active: boolean
  onComplete: () => void
}

export default function Countdown({ active, onComplete }: CountdownProps) {
  const [value, setValue] = useState(3)

  useEffect(() => {
    if (!active) {
      setValue(3)
      return
    }

    if (value === 0) {
      onComplete()
      return
    }

    const timer = setTimeout(() => {
      setValue((v) => v - 1)
    }, 1000)

    return () => clearTimeout(timer)
  }, [active, value, onComplete])

  if (!active || value === 0) return null

  return (
    <div className="absolute inset-0 flex items-center justify-center z-10">
      <div className="text-8xl font-bold text-white drop-shadow-lg animate-pulse">
        {value}
      </div>
    </div>
  )
}
