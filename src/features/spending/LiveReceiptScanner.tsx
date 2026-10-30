import { useEffect, useRef, useState } from 'react';
import { createFrameReader } from '../../qr/frame-reader';
import { startLiveScan } from '../../qr/live-scan';
import type { FoundQr } from '../../qr/scan';
import { t } from '../../i18n/pt-PT';
import { grabSquare } from './camera';
import { hasFiscalQr } from './receipt';

const copy = t.spending.receipt.live;

/** Time without a reading before the photo is suggested. */
const SLOW_MS = 10_000;

const CAMERA: MediaStreamConstraints = {
  // A fiscal QR code is dense: the highest usual resolution, or it does not resolve.
  video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
  audio: false,
};

/** The live camera over the whole screen, closing itself at the first fiscal QR code. */
export function LiveReceiptScanner({
  onFound,
  onPhoto,
  onClose,
}: {
  onFound: (found: FoundQr[]) => void;
  /** Called from the button's click, which is what lets the browser open the camera app. */
  onPhoto: () => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [slow, setSlow] = useState(false);

  function stopCamera() {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  }

  useEffect(() => {
    if (!dialog.current?.open) dialog.current?.showModal();
    let closed = false;
    let stopScan = () => {};
    let slowTimer: ReturnType<typeof setTimeout> | undefined;
    const reader = createFrameReader();
    const canvas = document.createElement('canvas');

    async function open() {
      const media = await navigator.mediaDevices.getUserMedia(CAMERA);
      if (closed) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = media;
      const element = video.current;
      if (!element) return;
      element.srcObject = media;
      await element.play();
      if (closed) return;
      slowTimer = setTimeout(() => setSlow(true), SLOW_MS);
      stopScan = startLiveScan({
        grabFrame: () => grabSquare(element, canvas),
        readFrame: (frame) => reader.read(frame),
        accept: hasFiscalQr,
        onFound: (found) => {
          stopCamera();
          onFound(found);
        },
        onFailed: () => {
          stopCamera();
          setUnavailable(true);
        },
        wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      });
    }

    open().catch(() => {
      if (closed) return;
      stopCamera();
      setUnavailable(true);
    });

    // The camera is not left on behind another app.
    const onHidden = () => {
      if (document.hidden) onClose();
    };
    document.addEventListener('visibilitychange', onHidden);

    return () => {
      closed = true;
      document.removeEventListener('visibilitychange', onHidden);
      clearTimeout(slowTimer);
      stopScan();
      stopCamera();
      reader.close();
    };
    // Opens once; the parent's callbacks only close this screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <dialog ref={dialog} className="live-scanner" aria-label={copy.title} onClose={onClose}>
      <div className="live-scanner-view">
        <video ref={video} autoPlay muted playsInline hidden={unavailable} />
        {!unavailable && <div className="live-scanner-frame" aria-hidden="true" />}
      </div>
      <div className="live-scanner-panel">
        <p role="status">{unavailable ? copy.unavailable : slow ? copy.slow : copy.title}</p>
        <div className="month-actions">
          <button
            type="button"
            className="action-primary"
            onClick={() => {
              stopCamera();
              onPhoto();
            }}
          >
            {copy.takePhoto}
          </button>
          <button type="button" className="action-secondary" onClick={onClose}>
            {copy.close}
          </button>
        </div>
      </div>
    </dialog>
  );
}
