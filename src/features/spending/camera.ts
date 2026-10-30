/** Whether this browser can open the camera inside the app (needs HTTPS). */
export function canUseLiveCamera(): boolean {
  return typeof navigator.mediaDevices?.getUserMedia === 'function';
}

/** The square in the middle of the picture, which is what the frame on screen shows. */
export function grabSquare(video: HTMLVideoElement, canvas: HTMLCanvasElement): ImageData | null {
  const { videoWidth: width, videoHeight: height } = video;
  if (video.readyState < video.HAVE_CURRENT_DATA || width === 0 || height === 0) return null;
  const side = Math.min(width, height);
  if (canvas.width !== side) {
    canvas.width = side;
    canvas.height = side;
  }
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(video, (width - side) / 2, (height - side) / 2, side, side, 0, 0, side, side);
  return context.getImageData(0, 0, side, side);
}
