export async function getLocalStream(filter?: string): Promise<MediaStream> {
  const constraints: MediaStreamConstraints = {
    video: { width: 640, height: 480, facingMode: 'user' },
    audio: false,
  }
  const stream = await navigator.mediaDevices.getUserMedia(constraints)
  return stream
}

export function captureFrame(
  video: HTMLVideoElement,
  filter?: string
): Promise<Blob> {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')!

    if (filter && filter !== 'none') {
      ctx.filter = filter
    }

    ctx.drawImage(video, 0, 0)
    canvas.toBlob((blob) => resolve(blob!), 'image/jpeg', 0.9)
  })
}

export function compositeImages(
  leftBlob: Blob,
  rightBlob: Blob
): Promise<Blob> {
  return new Promise((resolve) => {
    const leftImg = new Image()
    const rightImg = new Image()
    let loaded = 0

    function onLoad() {
      loaded++
      if (loaded < 2) return

      const singleWidth = leftImg.width
      const singleHeight = leftImg.height
      const canvas = document.createElement('canvas')
      canvas.width = singleWidth * 2
      canvas.height = singleHeight
      const ctx = canvas.getContext('2d')!

      ctx.drawImage(leftImg, 0, 0)
      ctx.drawImage(rightImg, singleWidth, 0)

      canvas.toBlob((blob) => resolve(blob!), 'image/jpeg', 0.9)
    }

    leftImg.onload = onLoad
    rightImg.onload = onLoad
    leftImg.src = URL.createObjectURL(leftBlob)
    rightImg.src = URL.createObjectURL(rightBlob)
  })
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
