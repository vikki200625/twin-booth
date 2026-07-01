import { supabase } from './supabase'
import { RealtimeChannel } from '@supabase/supabase-js'

export type SignalMessage =
  | { type: 'join'; role: 'host' | 'guest' }
  | { type: 'offer'; sdp: string }
  | { type: 'answer'; sdp: string }
  | { type: 'ice-candidate'; candidate: string }
  | { type: 'ready' }
  | { type: 'countdown'; value: number }
  | { type: 'snap' }
  | { type: 'photo'; photoIndex: number; imageData: string }
  | { type: 'photo-uploaded'; photoIndex: number; url: string }
  | { type: 'chat'; sender: string; text: string; timestamp: number }

export function createRoomChannel(
  roomId: string,
  onMessage: (msg: SignalMessage) => void
): RealtimeChannel {
  const channel = supabase.channel(`room:${roomId}`, {
    config: { broadcast: { self: false } },
  })

  channel
    .on('broadcast', { event: 'signal' }, ({ payload }) => {
      onMessage(payload as SignalMessage)
    })
    .subscribe()

  return channel
}

export function broadcastSignal(
  channel: RealtimeChannel,
  message: SignalMessage
) {
  channel.send({
    type: 'broadcast',
    event: 'signal',
    payload: message,
  })
}
