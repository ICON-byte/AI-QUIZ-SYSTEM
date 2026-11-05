import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '../../lib/api';
import { Pagination, PracticeError } from '../practice/PracticeUi';
import { safeError } from '../practice/format';
import type { DraftQuestion } from '../practice/types';
import { BankSelect } from './BankSelect';
import { QuestionFilters } from './QuestionFilters';
import type { BankQuestion } from './types';
import { useDebouncedValue } from './useDebouncedValue';

export function QuestionPicker({
  remaining,
  onAdd,
  onClose,
}: {
  remaining: number;
  onAdd: (questions: DraftQuestion[]) => void;
  onClose: () => void;
}) {
  const [bankId, setBankId] = useState('');
  const [filters, setFilters] = useState({
    search: '',
    difficulty: '',
    topic: '',
  });
  const [page, setPage] = useState(1);
  const settledFilters = useDebouncedValue(filters);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const query = useQuery({
    queryKey: ['banks', bankId, 'picker', settledFilters, page],
    queryFn: () =>
      api<{ questions: BankQuestion[]; total: number }>(
        `/question-banks/${bankId}/questions?${new URLSearchParams({ ...Object.fromEntries(Object.entries(settledFilters).filter(([, v]) => v)), page: String(page) })}`,
      ),
    enabled: !!bankId,
    retry: false,
  });
  async function add() {
    setPending(true);
    setError(null);
    try {
      const result = await api<{ questions: DraftQuestion[] }>(
        '/question-banks/selection',
        { method: 'POST', body: JSON.stringify({ ids: [...selected] }) },
      );
      onAdd(result.questions);
    } catch (err) {
      setError(safeError(err));
    } finally {
      setPending(false);
    }
  }
  return (
    <section
      className="panel question-picker"
      aria-label="Select saved questions"
    >
      <div className="section-heading">
        <div>
          <h2>Select saved questions</h2>
          <p className="muted">
            Copies become part of this draft. {remaining} spaces remaining.
          </p>
        </div>
        <button
          className="button secondary"
          type="button"
          disabled={pending}
          onClick={onClose}
        >
          Close selector
        </button>
      </div>
      <BankSelect
        value={bankId}
        onChange={(value) => {
          setBankId(value);
          setPage(1);
        }}
      />
      <Link
        className="text-link"
        to="/banks"
        target="_blank"
        rel="noopener noreferrer"
      >
        Manage question banks in a new tab ↗
      </Link>
      {bankId ? (
        <>
          <QuestionFilters
            {...filters}
            change={(key, value) => {
              setFilters((f) => ({ ...f, [key]: value }));
              setPage(1);
            }}
          />
          {query.isPending ? (
            <p role="status">Loading questions…</p>
          ) : query.error ? (
            <PracticeError
              error={query.error}
              retry={() => {
                void query.refetch();
              }}
            />
          ) : (
            <>
              {!query.data.questions.length ? (
                <p className="muted">No active questions match your filters.</p>
              ) : (
                <div className="picker-questions">
                  {query.data.questions.map((q) => (
                    <label className="picker-question" key={q.id}>
                      <input
                        type="checkbox"
                        checked={selected.has(q.id)}
                        disabled={
                          pending ||
                          (!selected.has(q.id) && selected.size >= remaining)
                        }
                        onChange={(e) => {
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(q.id);
                            else next.delete(q.id);
                            return next;
                          });
                        }}
                      />
                      <span>
                        <strong>{q.prompt}</strong>
                        <span className="field-hint">
                          {q.difficulty}
                          {q.topic ? ` · ${q.topic}` : ''}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
              <Pagination
                page={page}
                total={query.data.total}
                setPage={setPage}
              />
            </>
          )}
        </>
      ) : null}
      <div className="editor-actions">
        <span role="status">{selected.size} selected across banks</span>
        <div className="button-group">
          <button
            className="button secondary"
            type="button"
            disabled={!selected.size || pending}
            onClick={() => setSelected(new Set())}
          >
            Clear selection
          </button>
          <button
            className="button primary"
            type="button"
            disabled={!selected.size || selected.size > remaining || pending}
            onClick={() => {
              void add();
            }}
          >
            {pending
              ? 'Adding…'
              : `Add ${selected.size} selected question${selected.size === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
      {error ? <PracticeError error={error} /> : null}
    </section>
  );
}
