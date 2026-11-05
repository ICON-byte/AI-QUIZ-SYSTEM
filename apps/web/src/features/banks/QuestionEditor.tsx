import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '../../lib/api';
import { PracticeError } from '../practice/PracticeUi';
import { safeError } from '../practice/format';
import { useLeaveWarning } from '../practice/useLeaveWarning';
import { QuestionFields } from './QuestionFields';
import type { DraftQuestion } from '../practice/types';
import type { Bank, BankQuestion, Difficulty } from './types';

export function QuestionEditor() {
  const { bankId, questionId } = useParams();
  const bank = useQuery({
    queryKey: ['banks', bankId],
    queryFn: () => api<Bank>(`/question-banks/${bankId}`),
    retry: false,
  });
  const question = useQuery({
    queryKey: ['banks', bankId, 'question', questionId],
    queryFn: () =>
      api<BankQuestion>(`/question-banks/${bankId}/questions/${questionId}`),
    enabled: !!questionId,
    retry: false,
  });
  if (bank.isPending || (questionId && question.isPending))
    return <p role="status">Loading question…</p>;
  if (bank.error || question.error)
    return <PracticeError error={(bank.error ?? question.error)!} />;
  if (bank.data.archivedAt || question.data?.archivedAt)
    return (
      <>
        <h1>Question archived</h1>
        <p>Archived questions and banks are read-only.</p>
        <Link to={`/banks/${bankId}`}>Return to bank</Link>
      </>
    );
  return (
    <QuestionForm
      key={questionId ?? 'new'}
      bankId={bankId!}
      initial={question.data}
    />
  );
}
function QuestionForm({
  bankId,
  initial,
}: {
  bankId: string;
  initial?: BankQuestion;
}) {
  const [value, setValue] = useState<DraftQuestion>(
    initial
      ? {
          prompt: initial.prompt,
          options: initial.options,
          correctOption: initial.correctOption,
          explanation: initial.explanation,
        }
      : {
          prompt: '',
          options: ['', '', '', ''],
          correctOption: 0,
          explanation: '',
        },
  );
  const [topic, setTopic] = useState(initial?.topic ?? '');
  const [difficulty, setDifficulty] = useState<Difficulty>(
    initial?.difficulty ?? 'MEDIUM',
  );
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const client = useQueryClient();
  const navigate = useNavigate();
  useLeaveWarning(dirty);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api(
        `/question-banks/${bankId}/questions${initial ? `/${initial.id}` : ''}`,
        {
          method: initial ? 'PUT' : 'POST',
          body: JSON.stringify({
            ...value,
            difficulty,
            topic,
            ...(initial ? { revision: initial.revision } : {}),
          }),
        },
      );
      setDirty(false);
      await client.invalidateQueries({ queryKey: ['banks'] });
      navigate(`/banks/${bankId}`, {
        state: { notice: initial ? 'Question updated.' : 'Question added.' },
      });
    } catch (err) {
      setError(safeError(err));
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <div className="practice-heading">
        <div>
          <p className="context-label">
            <Link to={`/banks/${bankId}`}>Question bank</Link>
          </p>
          <h1>{initial ? 'Edit question' : 'Add a question'}</h1>
        </div>
      </div>
      <form
        className="panel bank-form"
        onSubmit={(e) => {
          void submit(e);
        }}
      >
        <fieldset className="editor-fields" disabled={pending}>
          <QuestionFields
            value={value}
            onChange={(next) => {
              setValue(next);
              setDirty(true);
            }}
          />
          <div className="bank-filters">
            <label className="field">
              Difficulty
              <select
                value={difficulty}
                onChange={(e) => {
                  setDifficulty(e.target.value as Difficulty);
                  setDirty(true);
                }}
              >
                <option value="EASY">Easy</option>
                <option value="MEDIUM">Medium</option>
                <option value="HARD">Hard</option>
              </select>
            </label>
            <label className="field">
              Topic <span className="field-hint">Optional</span>
              <input
                maxLength={100}
                value={topic}
                onChange={(e) => {
                  setTopic(e.target.value);
                  setDirty(true);
                }}
              />
            </label>
          </div>
          <div className="editor-actions">
            <Link to={`/banks/${bankId}`}>Cancel</Link>
            <button type="submit" className="button primary">
              {pending ? 'Saving…' : 'Save question'}
            </button>
          </div>
        </fieldset>
        {error ? <PracticeError error={error} /> : null}
      </form>
    </>
  );
}
