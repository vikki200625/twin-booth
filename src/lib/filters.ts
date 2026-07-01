export interface FilterPreset {
  name: string
  label: string
  value: string
}

export const filters: FilterPreset[] = [
  { name: 'none', label: 'Normal', value: 'none' },
  { name: 'bw', label: 'B&W', value: 'grayscale(100%) contrast(110%)' },
  { name: 'vintage', label: 'Vintage', value: 'sepia(60%) saturate(120%) brightness(90%)' },
  { name: 'noir', label: 'Noir', value: 'grayscale(100%) contrast(130%) brightness(85%)' },
  { name: 'dreamy', label: 'Dreamy', value: 'brightness(110%) saturate(130%) blur(0.5px)' },
  { name: 'warm', label: 'Warm', value: 'sepia(30%) saturate(140%) brightness(105%)' },
  { name: 'cool', label: 'Cool', value: 'hue-rotate(15deg) saturate(90%) brightness(105%)' },
  { name: 'fade', label: 'Fade', value: 'saturate(70%) brightness(110%) contrast(90%)' },
  { name: 'dramatic', label: 'Dramatic', value: 'contrast(140%) brightness(85%) saturate(120%)' },
]

export function getFilterValue(name: string): string {
  return filters.find(f => f.name === name)?.value ?? 'none'
}
