"use client"

import { useState, useRef, useEffect } from "react"

interface ChatMessage {
  sender: string
  text: string
  timestamp: number
}

interface ChatProps {
  onSend: (text: string) => void
  messages: ChatMessage[]
  myId: string
}

export default function Chat({ onSend, messages, myId }: ChatProps) {
  const [input, setInput] = useState("")
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  function handleSend() {
    if (!input.trim()) return
    onSend(input.trim())
    setInput("")
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto space-y-2 p-3">
        {messages.length === 0 && (
          <p className="text-gray-500 text-sm text-center">No messages yet. Say hi!</p>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex flex-col ${msg.sender === myId ? "items-end" : "items-start"}`}
          >
            <div
              className={`px-3 py-2 rounded-xl max-w-[80%] text-sm ${
                msg.sender === myId
                  ? "bg-pink-500 text-white rounded-br-none"
                  : "bg-gray-700 text-gray-100 rounded-bl-none"
              }`}
            >
              {msg.text}
            </div>
            <span className="text-[10px] text-gray-500 mt-0.5">
              {msg.sender === myId ? "You" : "Friend"}
            </span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="p-3 border-t border-gray-800">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            className="flex-1 bg-gray-800 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:ring-1 focus:ring-pink-500"
          />
          <button
            onClick={handleSend}
            className="px-4 py-2 bg-pink-500 hover:bg-pink-600 rounded-lg text-sm font-semibold transition-colors cursor-pointer"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
