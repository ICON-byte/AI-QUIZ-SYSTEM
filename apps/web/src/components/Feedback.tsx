export function Feedback({ message, retry, retryLabel = 'Try again' }: { message: string; retry?: () => void; retryLabel?: string }) {
  return <div className="feedback" role="alert">
    <p>{message}</p>
    {retry ? <button className="button secondary" onClick={retry}>{retryLabel}</button> : null}
  </div>;
}

export function Loading() {
  return <main className="standalone" aria-busy="true"><p role="status">Opening your workspace…</p></main>;
}
