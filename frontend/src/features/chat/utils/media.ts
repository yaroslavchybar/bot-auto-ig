export async function preparePhoto(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, 1080 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Could not prepare photo')
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const jpeg = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((result) => result ? resolve(result) : reject(new Error('Could not prepare photo')),
        'image/jpeg', 0.9),
    )
    return jpeg
  } finally {
    bitmap.close()
  }
}

export async function videoMetadata(file: Blob): Promise<{ width: number; height: number; duration: number }> {
  const url = URL.createObjectURL(file)
  try {
    return await new Promise((resolve, reject) => {
      const video = document.createElement('video')
      const timer = setTimeout(() => reject(new Error('Could not read video metadata')), 10_000)
      video.preload = 'metadata'
      video.onloadedmetadata = () => {
        clearTimeout(timer)
        if (!Number.isFinite(video.duration) || video.duration <= 0 || video.duration > 300) {
          reject(new Error('Choose a video up to 5 minutes long'))
        } else resolve({ width: video.videoWidth, height: video.videoHeight, duration: video.duration })
      }
      video.onerror = () => { clearTimeout(timer); reject(new Error('Could not read video metadata')) }
      video.src = url
    })
  } finally { URL.revokeObjectURL(url) }
}
