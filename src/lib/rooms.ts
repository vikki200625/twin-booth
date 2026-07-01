import { supabase } from './supabase'

export interface Room {
  id: string
  name: string
  password: string
  host_peer_id: string | null
  status: string
  created_at: string
}

export async function createRoom(name: string, password: string): Promise<Room | null> {
  const { data, error } = await supabase
    .from('rooms')
    .insert({ name, password, status: 'active' })
    .select()
    .single()

  if (error) {
    console.error('Create room error:', error.message)
    return null
  }
  return data
}

export async function findRoom(name: string): Promise<Room | null> {
  const { data, error } = await supabase
    .from('rooms')
    .select('*')
    .eq('name', name)
    .eq('status', 'active')
    .single()

  if (error) return null
  return data
}

export async function joinRoom(roomId: string, hostPeerId: string): Promise<boolean> {
  const { error } = await supabase
    .from('rooms')
    .update({ host_peer_id: hostPeerId })
    .eq('id', roomId)

  return !error
}

export async function deleteRoom(roomId: string): Promise<void> {
  await supabase
    .from('rooms')
    .update({ status: 'ended' })
    .eq('id', roomId)
}
