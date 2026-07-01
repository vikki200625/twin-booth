const STUN_SERVERS: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
}

export function createPeerConnection(): RTCPeerConnection {
  return new RTCPeerConnection(STUN_SERVERS)
}

export function setupDataChannel(
  pc: RTCPeerConnection,
  label: string = 'twin-booth'
): RTCDataChannel {
  return pc.createDataChannel(label, { ordered: true })
}

export function handleDataChannel(
  pc: RTCPeerConnection,
  onMessage: (data: string) => void
): RTCDataChannel | null {
  let channel: RTCDataChannel | null = null

  pc.ondatachannel = (event) => {
    channel = event.channel
    channel.onmessage = (e) => onMessage(e.data)
  }

  return channel
}

export async function createOffer(pc: RTCPeerConnection): Promise<string> {
  const offer = await pc.createOffer()
  await pc.setLocalDescription(offer)
  return JSON.stringify(offer)
}

export async function handleOffer(
  pc: RTCPeerConnection,
  offerSdp: string
): Promise<string> {
  const offer = JSON.parse(offerSdp)
  await pc.setRemoteDescription(new RTCSessionDescription(offer))
  const answer = await pc.createAnswer()
  await pc.setLocalDescription(answer)
  return JSON.stringify(answer)
}

export async function handleAnswer(
  pc: RTCPeerConnection,
  answerSdp: string
): Promise<void> {
  const answer = JSON.parse(answerSdp)
  await pc.setRemoteDescription(new RTCSessionDescription(answer))
}

export async function addIceCandidate(
  pc: RTCPeerConnection,
  candidateStr: string
): Promise<void> {
  const candidate = JSON.parse(candidateStr)
  await pc.addIceCandidate(new RTCIceCandidate(candidate))
}
