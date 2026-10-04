'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import { Button } from '../ui/button';

export function PdfPreview({ url }: { url: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    let task: PDFDocumentLoadingTask | undefined;
    setLoading(true); setError(''); setDocument(null); setPage(1);
    import('pdfjs-dist').then(async pdf => {
      if (cancelled) return;
      pdf.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
      task = pdf.getDocument({ url, stopAtErrors: true });
      const loaded = await task.promise;
      if (loaded.numPages > 30) throw new Error('page limit');
      if (!cancelled) setDocument(loaded);
    }).catch(() => { if (!cancelled) { setError('Preview unavailable. Download the file to view it.'); setLoading(false); } });
    return () => { cancelled = true; void task?.destroy(); };
  }, [url]);
  useEffect(() => {
    if (!document || !canvas.current) return;
    let cancelled = false;
    let render: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined;
    setLoading(true); setError('');
    document.getPage(page).then(async loaded => {
      if (cancelled || !canvas.current) return;
      const original = loaded.getViewport({ scale: 1 });
      const viewport = loaded.getViewport({ scale: Math.min(1.6, 1200 / original.width, 1600 / original.height) });
      canvas.current.width = Math.ceil(viewport.width); canvas.current.height = Math.ceil(viewport.height);
      render = loaded.render({ canvas: canvas.current, viewport });
      await render.promise;
      if (!cancelled) setLoading(false);
    }).catch(() => { if (!cancelled) { setError('This page could not be rendered.'); setLoading(false); } });
    return () => { cancelled = true; render?.cancel(); };
  }, [document, page]);
  return <div className="pdf-viewer">
    {error ? <p role="alert">{error}</p> : <>
      <div className="pdf-controls"><Button variant="outline" size="icon" aria-label="Previous page" title="Previous page" disabled={!document || page <= 1 || loading} onClick={() => setPage(page - 1)}><ChevronLeft size={16} /></Button><span aria-live="polite">{document ? `Page ${page} of ${document.numPages}` : 'Loading PDF…'}</span><Button variant="outline" size="icon" aria-label="Next page" title="Next page" disabled={!document || page >= document.numPages || loading} onClick={() => setPage(page + 1)}><ChevronRight size={16} /></Button></div>
      {loading && <p role="status">Rendering…</p>}
      <canvas ref={canvas} role="img" aria-label={`PDF page ${page}`} />
    </>}
  </div>;
}
