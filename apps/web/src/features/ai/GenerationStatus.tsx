import { useEffect, useRef, useState } from 'react';
import type { AiJob } from './types';

export function GenerationStatus({ job }: { job: AiJob }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.focus();
  }, [job.id]);
  const active = ['QUEUED', 'RUNNING'].includes(job.status);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  const messages = {
    QUEUED: 'Queued for generation.',
    RUNNING:
      job.phase === 'RECOVERING'
        ? 'Preparing one recovery attempt…'
        : job.phase === 'PACING'
          ? 'Waiting for the provider call interval…'
          : 'Gemini is generating your questions…',
    READY: 'Questions are ready for your review.',
    FAILED: 'Generation failed.',
    EXPIRED: 'This review expired. Generate a new set.',
    DELETED: 'Generation data deleted.',
  };
  const elapsed = job.createdAt
    ? Math.max(0, Math.floor((now - Date.parse(job.createdAt)) / 1000))
    : null;
  return (
    <div
      ref={panel}
      tabIndex={-1}
      role="region"
      className="ai-job-status"
      aria-label="Generation status"
    >
      <p role="status">
        {active ? <span className="ai-activity" aria-hidden="true" /> : null}
        {messages[job.status]}
      </p>
      {job.summary ? (
        <p>
          {job.summary.count} questions · {job.summary.difficulty.toLowerCase()}{' '}
          ·{' '}
          {job.summary.kind === 'TOPIC'
            ? job.summary.topic
            : 'Reviewed document'}
        </p>
      ) : null}
      {active ? (
        <p className="muted">
          {elapsed !== null ? `${elapsed}s elapsed. ` : ''}Stops by{' '}
          {new Date(job.deadlineAt).toLocaleTimeString()}. You can leave and
          resume from this page.
        </p>
      ) : null}
      {job.diagnostics?.length ? (
        <details>
          <summary>Generation diagnostics</summary>
          <p className="muted">
            Request {job.id}. Provider calls:{' '}
            {job.providerAttempts ?? job.diagnostics.length}.
          </p>
          <ul>
            {job.diagnostics.map((call) => (
              <li key={call.attempt}>
                Call {call.attempt}: {call.category}
                {call.requestedCount !== undefined
                  ? ` · Questions: ${call.returnedCount ?? 'unavailable'} returned / ${call.requestedCount} requested`
                  : ''}
                {call.sourceCount !== undefined && call.sourceCount > 0
                  ? ` · Sources: ${call.sourceCount} (${call.sourceCharacters ?? 'unavailable'} characters)`
                  : ''}
                {call.finishReason ? ` · ${call.finishReason}` : ''}
                {call.fields?.length
                  ? ` · Fields: ${call.fields.join(', ')}`
                  : ''}
                {call.inputTokens !== undefined
                  ? ` · Input tokens: ${call.inputTokens}`
                  : ''}
                {call.outputTokens !== undefined
                  ? ` · Output tokens: ${call.outputTokens}`
                  : ''}
                {call.totalTokens !== undefined
                  ? ` · Total tokens: ${call.totalTokens}`
                  : ''}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
