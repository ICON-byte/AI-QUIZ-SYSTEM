export function Feedback({ message, retry, retryLabel = 'Try again' }: { message: string; retry?: () => void; retryLabel?: string }) {
  return <div className="feedback" role="alert">
    <p>{message}</p>
    {retry ? <button className="button secondary" onClick={retry}>{retryLabel}</button> : null}
  </div>;
}

export function Loading() {
  return (
    <main className="standalone page-loading" aria-busy="true">
      <svg className="loading-mark" viewBox="0 0 28 28" width="64" height="64" fill="none" aria-hidden="true">
        <path className="loading-mark-track" d="M4 5h8c3 0 5 2 5 5v13c0-3-2-5-5-5H4V5ZM24 5h-3M24 10h-3M24 15h-3M8 10h5M8 14h3" />
        <path className="loading-mark-stroke" pathLength="100" d="M4 5h8c3 0 5 2 5 5v13c0-3-2-5-5-5H4V5ZM24 5h-3M24 10h-3M24 15h-3M8 10h5M8 14h3" />
      </svg>
      <p role="status">Opening your workspace…</p>
    </main>
  );
}
