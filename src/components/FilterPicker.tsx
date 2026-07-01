"use client"

import { filters } from "@/lib/filters"

interface FilterPickerProps {
  selected: string
  onSelect: (filter: string) => void
}

export default function FilterPicker({ selected, onSelect }: FilterPickerProps) {
  return (
    <div className="flex flex-wrap gap-2 justify-center">
      {filters.map((f) => (
        <button
          key={f.name}
          onClick={() => onSelect(f.value)}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
            selected === f.value
              ? "bg-pink-500 text-white"
              : "bg-gray-800 text-gray-300 hover:bg-gray-700"
          }`}
        >
          {f.label}
        </button>
      ))}
    </div>
  )
}
