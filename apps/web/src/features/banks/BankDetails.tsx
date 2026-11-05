import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { api } from '../../lib/api';
import { Pagination, PracticeError } from '../practice/PracticeUi';
import { safeError } from '../practice/format';
import { QuestionFilters } from './QuestionFilters';
import { BankSelect } from './BankSelect';
import type { Bank, BankQuestion } from './types';
import { useDebouncedValue } from './useDebouncedValue';

export function BankDetails() {
  const { bankId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const client = useQueryClient();
  const [filters, setFilters] = useState({
    search: '',
    difficulty: '',
    topic: '',
  });
  const [archived, setArchived] = useState(false);
  const settledFilters = useDebouncedValue(filters);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<Error | null>(null);
  const [notice, setNotice] = useState(
    (location.state as { notice?: string } | null)?.notice ?? '',
  );
  const [pending, setPending] = useState(false);
  const [transfer, setTransfer] = useState<BankQuestion | null>(null);
  const [target, setTarget] = useState('');
  const bank = useQuery({
    queryKey: ['banks', bankId],
    queryFn: () => api<Bank>(`/question-banks/${bankId}`),
    retry: false,
  });
  const questions = useQuery({
    queryKey: ['banks', bankId, 'questions', settledFilters, archived, page],
    queryFn: () =>
      api<{ questions: BankQuestion[]; total: number }>(
        `/question-banks/${bankId}/questions?${new URLSearchParams({ ...Object.fromEntries(Object.entries(settledFilters).filter(([, v]) => v)), archived: String(archived), page: String(page) })}`,
      ),
    enabled: !!bank.data,
    retry: false,
  });
  async function action(
    path: string,
    payload: object,
    message: string,
    duplicate = false,
  ) {
    setPending(true);
    setError(null);
    setNotice('');
    try {
      const result = await api<Bank>(`/question-banks/${bankId}${path}`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      await client.invalidateQueries({ queryKey: ['banks'] });
      setTransfer(null);
      setNotice(message);
      if (duplicate)
        navigate(`/banks/${result.id}`, { state: { notice: message } });
    } catch (err) {
      setError(safeError(err));
    } finally {
      setPending(false);
    }
  }
  if (bank.isPending) return <p role="status">Loading bank…</p>;
  if (bank.error)
    return (
      <PracticeError
        error={bank.error}
        retry={() => {
          void bank.refetch();
        }}
      />
    );
  const current = bank.data;
  return (
    <>
      <div className="practice-heading">
        <div>
          <p className="context-label">
            <Link to="/banks">Question banks</Link> / Private
          </p>
          <h1>{current.title}</h1>
          <p className="muted">
            {current.description || 'Questions ready to reuse.'}
          </p>
        </div>
        <div className="button-group">
          {!current.archivedAt ? (
            <>
              <Link
                className="button primary"
                to={`/banks/${bankId}/questions/new`}
              >
                Add question
              </Link>
              <Link className="button secondary" to={`/banks/${bankId}/import`}>
                Import CSV
              </Link>
              <Link className="button secondary" to={`/ai?bank=${bankId}`}>Generate with AI</Link>
            </>
          ) : (
            <span className="status neutral">Archived</span>
          )}
        </div>
      </div>
      {!current.archivedAt ? (
        <div className="bank-tools">
          <Link to={`/banks/${bankId}/edit`}>Edit bank</Link>
          <button
            className="text-action"
            disabled={pending}
            onClick={() => {
              void action('/duplicate', {}, 'Bank duplicated.', true);
            }}
          >
            Duplicate bank
          </button>
          <button
            className="text-action"
            disabled={pending}
            onClick={() => {
              if (
                window.confirm(
                  'Archive this bank? It will remain visible in your archive, but cannot be edited or added to quizzes.',
                )
              )
                void action(
                  '/archive',
                  { revision: current.revision },
                  'Bank archived.',
                );
            }}
          >
            Archive bank
          </button>
        </div>
      ) : (
        <p className="muted">
          This bank is read-only. Copies already saved in quizzes remain
          available.
        </p>
      )}
      {notice ? (
        <p role="status" className="bank-notice">
          {notice}
        </p>
      ) : null}
      {error ? <PracticeError error={error} /> : null}
      <QuestionFilters
        {...filters}
        change={(key, value) => {
          setFilters((f) => ({ ...f, [key]: value }));
          setPage(1);
        }}
      />
      <label className="check-label">
        <input
          type="checkbox"
          checked={archived}
          onChange={(e) => {
            setArchived(e.target.checked);
            setPage(1);
          }}
        />
        Show archived questions
      </label>
      {questions.isPending ? (
        <p role="status">Loading questions…</p>
      ) : questions.error ? (
        <PracticeError
          error={questions.error}
          retry={() => {
            void questions.refetch();
          }}
        />
      ) : (
        <>
          <p className="list-caption">
            {questions.data.total} matching {archived ? 'archived' : 'active'}{' '}
            questions
          </p>
          {questions.data.questions.length ? (
            <div className="bank-question-list">
              {questions.data.questions.map((q) => (
                <article className="bank-question panel" key={q.id}>
                  <div className="section-heading">
                    <div>
                      <h2>{q.prompt}</h2>
                      <p className="field-hint">
                        {q.difficulty.charAt(0) +
                          q.difficulty.slice(1).toLowerCase()}
                        {q.topic ? ` · ${q.topic}` : ''}
                        {q.archivedAt ? ' · Archived' : ''}
                      </p>
                    </div>
                  </div>
                  <details>
                    <summary>View answers and explanation</summary>
                    <ol type="A" className="bank-options">
                      {q.options.map((option, index) => (
                        <li key={index}>
                          {option}
                          {index === q.correctOption ? (
                            <strong> · Correct</strong>
                          ) : null}
                        </li>
                      ))}
                    </ol>
                    <p className="muted">
                      {q.explanation || 'No explanation added.'}
                    </p>
                  </details>
                  {!q.archivedAt && !current.archivedAt ? (
                    <div className="bank-tools">
                      <Link to={`/banks/${bankId}/questions/${q.id}/edit`}>
                        Edit question
                      </Link>
                      <button
                        className="text-action"
                        disabled={pending}
                        onClick={() => {
                          void action(
                            `/questions/${q.id}/transfer`,
                            {
                              targetBankId: bankId,
                              action: 'COPY',
                              revision: q.revision,
                            },
                            'Question duplicated.',
                          );
                        }}
                      >
                        Duplicate
                      </button>
                      <button
                        className="text-action"
                        disabled={pending}
                        onClick={() => {
                          setTransfer(q);
                          setTarget('');
                        }}
                      >
                        Move or copy
                      </button>
                      <button
                        className="text-action"
                        disabled={pending}
                        onClick={() => {
                          if (
                            window.confirm(
                              'Archive this question? Existing quiz copies will stay unchanged.',
                            )
                          )
                            void action(
                              `/questions/${q.id}/archive`,
                              { revision: q.revision },
                              'Question archived.',
                            );
                        }}
                      >
                        Archive question
                      </button>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <section className="panel practice-empty">
              <h2>No matching questions</h2>
              <p className="muted">
                {!current.archivedAt
                  ? 'Add a question, import a CSV, or adjust your filters.'
                  : 'Try another filter to view your archived bank.'}
              </p>
            </section>
          )}
          <Pagination
            page={page}
            total={questions.data.total}
            setPage={setPage}
          />
        </>
      )}
      {transfer ? (
        <section
          className="panel bank-transfer"
          aria-label="Move or copy question"
        >
          <h2>Move or copy question</h2>
          <p className="muted">{transfer.prompt}</p>
          <BankSelect
            label="Destination bank"
            value={target}
            onChange={setTarget}
          />
          <div className="button-group">
            <button
              type="button"
              className="button secondary"
              disabled={pending}
              onClick={() => setTransfer(null)}
            >
              Cancel
            </button>
            {(['COPY', 'MOVE'] as const).map((kind) => (
              <button
                key={kind}
                className={`button ${kind === 'COPY' ? 'primary' : 'secondary'}`}
                disabled={
                  !target || pending || (kind === 'MOVE' && target === bankId)
                }
                onClick={() => {
                  void action(
                    `/questions/${transfer.id}/transfer`,
                    {
                      targetBankId: target,
                      action: kind,
                      revision: transfer.revision,
                    },
                    kind === 'COPY' ? 'Question copied.' : 'Question moved.',
                  );
                }}
              >
                {kind === 'COPY' ? 'Copy question' : 'Move question'}
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
