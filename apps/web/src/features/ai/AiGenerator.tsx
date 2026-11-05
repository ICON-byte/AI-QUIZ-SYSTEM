import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { api, ApiError } from '../../lib/api';
import { PracticeError } from '../practice/PracticeUi';
import { safeError } from '../practice/format';
import type { DraftQuestion } from '../practice/types';
import { PrivacyNotice } from './PrivacyNotice';
import { GenerationStatus } from './GenerationStatus';
import { GenerationReview } from './GenerationReview';
import type { AiCapabilities, AiJob, Segment } from './types';

export function AiPage() {
  const [params, setParams] = useSearchParams();
  return (
    <>
      <div className="practice-heading">
        <div>
          <h1>Generate questions</h1>
          <p className="muted">
            Turn a topic or your reviewed notes into questions you can refine.
          </p>
        </div>
        <Link className="button secondary" to="/banks">
          Question banks
        </Link>
      </div>
      <AiGenerator
        initialBankId={params.get('bank') ?? undefined}
        initialJobId={params.get('generation') ?? undefined}
        onJobChange={(id) =>
          setParams(
            {
              generation: id,
              ...(params.get('bank') ? { bank: params.get('bank')! } : {}),
            },
            { replace: true },
          )
        }
      />
    </>
  );
}

export function AiGenerator({
  onAdd,
  remaining = 50,
  initialBankId,
  initialJobId,
  onJobChange,
  onClose,
}: {
  onAdd?: (questions: DraftQuestion[]) => void;
  remaining?: number;
  initialBankId?: string;
  initialJobId?: string;
  onJobChange?: (id: string) => void;
  onClose?: () => void;
}) {
  const client = useQueryClient();
  const [settings, setSettings] = useState<{
    jobId?: string;
    kind: 'TOPIC' | 'DOCUMENT';
    topic: string;
    difficulty: string;
    count: number;
  } | null>(null);
  const [consent, setConsent] = useState(false);
  const [age, setAge] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [localJobId, setJobId] = useState(initialJobId);
  const jobId = onJobChange ? initialJobId : localJobId;
  const [pending, setPending] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [retrying, setRetrying] = useState(false);
  const lastRequest = useRef<object | null>(null);
  const capabilities = useQuery({
    queryKey: ['ai', 'capabilities'],
    queryFn: () => api<AiCapabilities>('/ai/capabilities'),
    retry: false,
  });
  const job = useQuery({
    queryKey: ['ai', 'job', jobId],
    queryFn: () => api<AiJob>(`/ai/generations/${jobId}`),
    enabled: !!jobId,
    retry: false,
    refetchInterval: (query) =>
      ['QUEUED', 'RUNNING'].includes(query.state.data?.status ?? '')
        ? 3000
        : false,
  });
  useEffect(() => {
    if (job.data?.status && !['QUEUED', 'RUNNING'].includes(job.data.status))
      void client.invalidateQueries({ queryKey: ['ai', 'capabilities'] });
  }, [job.data?.status, client]);
  const currentSettings =
    settings && settings.jobId === jobId
      ? settings
      : (job.data?.summary ?? {
          kind: 'TOPIC' as const,
          topic: '',
          difficulty: 'MEDIUM',
          count: 5,
        });
  const { kind: candidateKind, topic, difficulty, count } = currentSettings;
  function updateSettings(patch: Partial<typeof currentSettings>) {
    setSettings({ ...currentSettings, ...patch, jobId });
  }
  const setKind = (kind: 'TOPIC' | 'DOCUMENT') => updateSettings({ kind });
  const setTopic = (topic: string) => updateSettings({ topic });
  const setDifficulty = (difficulty: string) => updateSettings({ difficulty });
  const setCount = (count: number) => updateSettings({ count });
  const active =
    jobId &&
    (job.isPending || ['QUEUED', 'RUNNING'].includes(job.data?.status ?? ''));
  function displayJob(id: string, retainSettings = false) {
    if (retainSettings) setSettings({ ...currentSettings, jobId: id });
    else {
      setSegments([]);
      setReviewed(false);
      setConsent(false);
      setFile(null);
      lastRequest.current = null;
      setRetrying(false);
      if (fileInput.current) fileInput.current.value = '';
    }
    setJobId(id);
    onJobChange?.(id);
  }
  async function confirmAge() {
    setPending(true);
    setError(null);
    try {
      await api('/ai/eligibility', {
        method: 'POST',
        body: JSON.stringify({ ageConfirmed: age }),
      });
      await client.invalidateQueries({ queryKey: ['ai', 'capabilities'] });
    } catch (err) {
      setError(safeError(err));
    } finally {
      setPending(false);
    }
  }
  async function extract() {
    if (!file || !consent) return;
    setExtracting(true);
    setError(null);
    setReviewed(false);
    setSegments([]);
    try {
      const form = new FormData();
      form.set('nonSensitiveConfirmed', 'true');
      form.set('document', file);
      const result = await api<{ segments: Segment[] }>(
        '/ai/documents/extract',
        { method: 'POST', body: form },
      );
      setSegments(result.segments);
      setFile(null);
      if (fileInput.current) fileInput.current.value = '';
    } catch (err) {
      setError(safeError(err));
    } finally {
      setExtracting(false);
    }
  }
  async function generate(retry = false) {
    if (
      !retry &&
      job.data?.status === 'READY' &&
      !window.confirm(
        'Generate a new set? This is a new request and a successful generation counts toward your daily allowance. Save any edited questions first.',
      )
    )
      return;
    const payload = retry
      ? lastRequest.current
      : {
          idempotencyKey: crypto.randomUUID(),
          kind: candidateKind,
          topic: candidateKind === 'TOPIC' ? topic : '',
          segments: candidateKind === 'DOCUMENT' ? segments : [],
          difficulty,
          count,
          nonSensitiveConfirmed: consent,
          textReviewed: candidateKind === 'DOCUMENT' ? reviewed : false,
        };
    if (!payload) return;
    lastRequest.current = payload;
    setPending(true);
    setError(null);
    try {
      const result = await api<AiJob>('/ai/generations', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setRetrying(false);
      client.setQueryData(['ai', 'job', result.id], result);
      displayJob(result.id, true);
      await client.invalidateQueries({ queryKey: ['ai', 'capabilities'] });
    } catch (err) {
      setError(safeError(err));
      setRetrying(
        err instanceof ApiError &&
          (err.status === 0 || err.status === 502 || err.status === 504),
      );
    } finally {
      setPending(false);
    }
  }
  async function discard() {
    if (
      !jobId ||
      !window.confirm(
        'Delete this generation’s source and review data? Saved bank questions remain available. Successful generations still count toward the daily allowance.',
      )
    )
      return;
    setPending(true);
    try {
      await api(`/ai/generations/${jobId}/discard`, {
        method: 'POST',
        body: '{}',
      });
      await job.refetch();
      setTopic('');
      setSegments([]);
      setFile(null);
      setReviewed(false);
      setRetrying(false);
      lastRequest.current = null;
      if (fileInput.current) fileInput.current.value = '';
      await client.invalidateQueries({ queryKey: ['ai', 'capabilities'] });
    } catch (err) {
      setError(safeError(err));
    } finally {
      setPending(false);
    }
  }
  if (capabilities.isPending)
    return <p role="status">Checking AI availability…</p>;
  if (capabilities.error)
    return (
      <PracticeError
        error={capabilities.error}
        retry={() => {
          void capabilities.refetch();
        }}
      />
    );
  const caps = capabilities.data;
  return (
    <section
      className="ai-generator"
      aria-label="AI question generation"
      onKeyDown={(e) => {
        if (
          e.key === 'Enter' &&
          e.target instanceof HTMLInputElement &&
          !['checkbox', 'radio', 'button', 'submit'].includes(e.target.type)
        )
          e.preventDefault();
      }}
    >
      {onClose ? (
        <div className="section-heading">
          <h2>Generate questions</h2>
          <button className="button secondary" type="button" onClick={onClose}>
            Close AI generator
          </button>
        </div>
      ) : null}
      <PrivacyNotice />
      {!caps.available ? (
        <section className="panel">
          <h2>AI generation is unavailable</h2>
          <p className="muted">
            Gemini has not been configured for this application. You can
            continue creating questions manually and using your question banks.
          </p>
        </section>
      ) : null}
      {!caps.ageConfirmed ? (
        <section className="panel">
          <h2>Confirm age eligibility</h2>
          <p>
            AI Quiz is currently for university students and lecturers aged 18+
            in Nigeria.
          </p>
          <label className="check-label">
            <input
              type="checkbox"
              checked={age}
              onChange={(e) => setAge(e.target.checked)}
            />
            I confirm that I am at least 18 years old.
          </label>
          <button
            className="button primary"
            type="button"
            disabled={!age || pending}
            onClick={() => {
              void confirmAge();
            }}
          >
            Confirm eligibility
          </button>
        </section>
      ) : null}
      <p className="ai-usage">
        {caps.remaining} of {caps.dailyLimit} generations available today
        {caps.reserved ? ` · ${caps.reserved} reserved` : ''}. Resets{' '}
        {new Date(caps.resetsAt).toLocaleString()} (midnight UTC). Failed
        generations do not use your allowance; provider limits can still apply.
      </p>
      {caps.currentJobId && caps.currentJobId !== jobId ? (
        <button
          className="button secondary"
          type="button"
          onClick={() => displayJob(caps.currentJobId!)}
        >
          Resume active generation
        </button>
      ) : null}
      {!caps.currentJobId && caps.recentJobId && caps.recentJobId !== jobId ? (
        <button
          className="button secondary"
          type="button"
          onClick={() => displayJob(caps.recentJobId!)}
        >
          Resume recent generation
        </button>
      ) : null}
      {job.data ? <GenerationStatus job={job.data} /> : null}
      {job.data?.summary?.kind === 'DOCUMENT' && !segments.length ? (
        <p className="muted">
          Your generation settings have been restored. To regenerate from this
          document, upload it again and review the extracted text. Source text
          is not retained after generation.
        </p>
      ) : null}
      <div className="panel ai-inputs">
        <fieldset
          className="editor-fields"
          disabled={
            !caps.available ||
            !caps.ageConfirmed ||
            pending ||
            extracting ||
            !!active
          }
        >
          <label className="check-label ai-consent">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            I confirm that this topic or document contains only non-sensitive
            educational material, and I understand it will be sent to Google.
          </label>
          <label className="field">
            Generate from
            <select
              value={candidateKind}
              onChange={(e) => {
                setKind(e.target.value as typeof candidateKind);
                setError(null);
              }}
            >
              <option value="TOPIC">Topic</option>
              <option value="DOCUMENT">Document</option>
            </select>
          </label>
          {candidateKind === 'TOPIC' ? (
            <label className="field">
              Topic or subject
              <input
                minLength={3}
                maxLength={500}
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
              />
            </label>
          ) : (
            <>
              <label className="field" htmlFor="ai-document">
                Lecture document
              </label>
              <input
                id="ai-document"
                ref={fileInput}
                type="file"
                accept=".pdf,.docx,.txt"
                aria-describedby="ai-document-limits"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setSegments([]);
                  setReviewed(false);
                }}
              />
              <p className="field-hint" id="ai-document-limits">
                PDF, DOCX or UTF-8 TXT · Maximum{' '}
                {Math.round(caps.limits.fileBytes / 1024 / 1024)} MiB,{' '}
                {caps.limits.pages} PDF pages and{' '}
                {caps.limits.characters.toLocaleString()} extracted characters.
                Scanned PDFs and OCR are not supported.
              </p>
              <button
                className="button secondary"
                type="button"
                disabled={!file || !consent}
                onClick={() => {
                  void extract();
                }}
              >
                Extract text for review
              </button>
              {segments.length ? (
                <section className="ai-source">
                  <h2>Review extracted text</h2>
                  <p>
                    Remove private information and material you do not want sent
                    to Google. Only the text below is used for generation.
                  </p>
                  {segments.map((segment, index) => (
                    <label className="field" key={index}>
                      {segment.label}
                      <textarea
                        rows={4}
                        maxLength={caps.limits.characters}
                        value={segment.text}
                        onChange={(e) => {
                          setSegments((values) =>
                            values.map((s, i) =>
                              i === index ? { ...s, text: e.target.value } : s,
                            ),
                          );
                          setReviewed(false);
                        }}
                      />
                    </label>
                  ))}
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={reviewed}
                      onChange={(e) => setReviewed(e.target.checked)}
                    />
                    I have reviewed this text and removed sensitive or
                    unnecessary content.
                  </label>
                  <button
                    type="button"
                    className="text-action"
                    onClick={() => {
                      setSegments([]);
                      setReviewed(false);
                    }}
                  >
                    Clear extracted text
                  </button>
                </section>
              ) : null}
            </>
          )}
          <div className="bank-filters">
            <label className="field">
              Difficulty
              <select
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value)}
              >
                <option value="EASY">Easy</option>
                <option value="MEDIUM">Medium</option>
                <option value="HARD">Hard</option>
              </select>
            </label>
            <label className="field">
              Number of questions
              <select
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
              >
                {[5, 10, 15, 20, 30].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            className="button primary"
            type="button"
            disabled={
              !consent ||
              caps.remaining === 0 ||
              !!caps.currentJobId ||
              retrying ||
              (candidateKind === 'TOPIC'
                ? topic.trim().length < 3
                : !reviewed || !segments.length)
            }
            onClick={() => {
              void generate();
            }}
          >
            {active
              ? 'Generation in progress'
              : jobId
                ? 'Regenerate questions'
                : 'Generate questions'}
          </button>
        </fieldset>
      </div>
      {extracting ? (
        <p role="status">
          Extracting text for your review… No material is being sent to Gemini.
        </p>
      ) : null}
      {pending ? <p role="status">Saving your request…</p> : null}
      {error ? <PracticeError error={error} /> : null}
      {retrying ? (
        <button
          className="button secondary"
          type="button"
          disabled={pending}
          onClick={() => {
            void generate(true);
          }}
        >
          Retry the same generation request
        </button>
      ) : null}
      {job.error ? (
        <PracticeError
          error={job.error}
          retry={() => {
            void job.refetch();
          }}
        />
      ) : null}
      {job.data ? (
        <>
          {job.data.failure ? (
            <p className="feedback" role="alert">
              {job.data.failure.message}
            </p>
          ) : null}
          {job.data.status === 'READY' && job.data.result ? (
            <GenerationReview
              key={job.data.id}
              job={job.data}
              onAdd={onAdd}
              remaining={remaining}
              initialBankId={initialBankId}
            />
          ) : null}
          {job.data.status !== 'DELETED' ? (
            <button
              className="text-action"
              type="button"
              disabled={pending}
              onClick={() => {
                void discard();
              }}
            >
              Delete generation data
            </button>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
