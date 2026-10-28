import { useEffect, useRef, useState } from 'react';
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist';

// Load the worker as a bundled module Worker rather than via workerSrc. This avoids
// depending on the server labelling .mjs as text/javascript: some hosts serve it as
// application/octet-stream, which makes strict module MIME checks reject the worker
// ("Failed to load module script") and the panel falls back to a failing fake worker.
GlobalWorkerOptions.workerPort = new Worker(
  new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url),
  { type: 'module' },
);

function PdfPage({
  pdf,
  pageNumber,
  width,
  root,
}: {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  width: number;
  root: HTMLElement | null;
}) {
  const holderRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [height, setHeight] = useState(Math.round(width * 1.414));

  useEffect(() => {
    const holder = holderRef.current;
    if (!holder || width < 40) return;
    let cancelled = false;
    let renderTask: RenderTask | null = null;

    const io = new IntersectionObserver(
      async ([entry]) => {
        if (!entry.isIntersecting) return;
        io.disconnect();
        try {
          const page = await pdf.getPage(pageNumber);
          if (cancelled) return;
          const unscaled = page.getViewport({ scale: 1 });
          const scale = width / unscaled.width;
          const viewport = page.getViewport({ scale });
          setHeight(viewport.height);
          const canvas = canvasRef.current;
          const ctx = canvas?.getContext('2d');
          if (!canvas || !ctx) return;
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          canvas.width = Math.floor(viewport.width * dpr);
          canvas.height = Math.floor(viewport.height * dpr);
          canvas.style.width = `${viewport.width}px`;
          canvas.style.height = `${viewport.height}px`;
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          renderTask = page.render({ canvasContext: ctx, viewport });
          await renderTask.promise;
        } catch {
          /* unmounted or cancelled */
        }
      },
      { root: root || undefined, rootMargin: '800px' },
    );
    io.observe(holder);

    return () => {
      cancelled = true;
      renderTask?.cancel();
      io.disconnect();
    };
  }, [pdf, pageNumber, width, root]);

  return (
    <div ref={holderRef} className="protected-pdf-page" style={{ minHeight: height }}>
      <canvas ref={canvasRef} draggable={false} />
    </div>
  );
}

export function ProtectedPdfViewer({
  src,
  title,
  compact,
}: {
  src: string;
  title: string;
  compact?: boolean;
}) {
  const shellRef = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [width, setWidth] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let doc: PDFDocumentProxy | null = null;
    setLoading(true);
    setError(null);
    setPdf(null);

    getDocument({ url: src, disableRange: true, disableStream: true })
      .promise.then((loaded) => {
        if (cancelled) {
          loaded.destroy();
          return;
        }
        doc = loaded;
        setPdf(loaded);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setError('Unable to display the thesis in the panel.');
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      doc?.destroy();
    };
  }, [src]);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const update = () => setWidth(Math.max(0, Math.floor(shell.clientWidth - 24)));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(shell);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      className={`protected-pdf${compact ? ' compact' : ''}`}
      ref={shellRef}
      title={title}
      onContextMenu={(e) => e.preventDefault()}
      onCopy={(e) => e.preventDefault()}
      onCut={(e) => e.preventDefault()}
      onDragStart={(e) => e.preventDefault()}
    >
      {loading && <p className="protected-pdf-status">Loading thesis…</p>}
      {error && <p className="protected-pdf-status">{error}</p>}
      {pdf && width > 0 && (
        <div className="protected-pdf-pages">
          {Array.from({ length: pdf.numPages }, (_, i) => (
            <PdfPage key={`${src}-${i + 1}`} pdf={pdf} pageNumber={i + 1} width={width} root={shellRef.current} />
          ))}
        </div>
      )}
    </div>
  );
}
