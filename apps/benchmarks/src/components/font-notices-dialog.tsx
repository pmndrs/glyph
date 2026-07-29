import fontNotices from 'virtual:font-notices';

import { Button } from './ui';

export default function FontNoticesDialog({ onClose }: { readonly onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-3 sm:p-6" role="presentation">
      <button
        aria-label="Close font licenses"
        className="absolute inset-0 bg-black/70"
        type="button"
        onClick={onClose}
      />
      <dialog
        open
        aria-labelledby="font-notices-title"
        className="relative flex max-h-[80dvh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-chrome shadow-2xl"
        onCancel={(event) => {
          event.preventDefault();
          onClose();
        }}
      >
        <header className="flex items-center justify-between gap-4 border-b border-border px-4 py-3">
          <div>
            <p className="eyebrow">Font fixtures</p>
            <h2 className="mt-1 text-base font-semibold" id="font-notices-title">
              Licenses &amp; notices
            </h2>
          </div>
          <Button aria-label="Close font licenses" variant="secondary" onClick={onClose}>
            Close
          </Button>
        </header>
        <pre className="overflow-auto whitespace-pre-wrap p-4 font-mono text-[10px] leading-relaxed text-muted">
          {fontNotices}
        </pre>
      </dialog>
    </div>
  );
}
