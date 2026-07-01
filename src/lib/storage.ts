import { supabase } from './supabase'

const BUCKET = 'photo-booth'

export async function uploadPhoto(
  roomId: string,
  photoIndex: number,
  blob: Blob
): Promise<string | null> {
  const path = `${roomId}/photo-${photoIndex}.jpg`
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { contentType: 'image/jpeg' })

  if (error) {
    console.error('Upload failed:', error.message)
    return null
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  return data.publicUrl
}

export async function listPhotos(
  roomId: string
): Promise<{ name: string; url: string }[]> {
  const { data: files, error } = await supabase.storage
    .from(BUCKET)
    .list(`${roomId}/`)

  if (error || !files) return []

  return files
    .filter((f) => f.name.endsWith('.jpg'))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((f) => {
      const { data } = supabase.storage
        .from(BUCKET)
        .getPublicUrl(`${roomId}/${f.name}`)
      return { name: f.name, url: data.publicUrl }
    })
}

export async function deleteRoom(roomId: string): Promise<void> {
  const { data: files } = await supabase.storage
    .from(BUCKET)
    .list(`${roomId}/`)

  if (!files || files.length === 0) return

  const paths = files.map((f) => `${roomId}/${f.name}`)
  await supabase.storage.from(BUCKET).remove(paths)
}
