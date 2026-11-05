import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '../../lib/api';
import { QuestionFields } from '../banks/QuestionFields';
import { BankSelect } from '../banks/BankSelect';
import { PracticeError } from '../practice/PracticeUi';
import { safeError } from '../practice/format';
import { useLeaveWarning } from '../practice/useLeaveWarning';
import type { DraftQuestion } from '../practice/types';
import type { Difficulty } from '../banks/types';
import type { AiJob } from './types';

export function GenerationReview({
  job,
  onAdd,
  remaining = 50,
  initialBankId,
}: {
  job: AiJob;
  onAdd?: (questions: DraftQuestion[]) => void;
  remaining?: number;
  initialBankId?: string;
}) {
  const [questions, setQuestions] = useState(() =>
    job.result!.questions.map((q, index) => ({
      key: index,
      selected: true,
      value: {
        prompt: q.prompt,
        options: q.options,
        correctOption: q.correctOption,
        explanation:
          q.explanation +
          (q.source
            ? `\n\nSource: ${q.source.label} — "${q.source.quote}"`
            : ''),
        difficulty: q.difficulty,
        topic: q.topic,
      },
    })),
  );
  const [bankId, setBankId] = useState(initialBankId ?? '');
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [saved, setSaved] = useState(job.acceptance);
  const [dirty, setDirty] = useState(false);
  const client = useQueryClient();
  useLeaveWarning(dirty);
  const selected = questions.filter((q) => q.selected).map((q) => q.value);
  function update(
    key: number,
    patch: Partial<(typeof questions)[number]['value']>,
  ) {
    setQuestions((values) =>
      values.map((q) =>
        q.key === key ? { ...q, value: { ...q.value, ...patch } } : q,
      ),
    );
    setDirty(true);
  }
  async function accept(toQuiz = false) {
    setPending(true);
    setError(null);
    try {
      if (toQuiz) {
        const result = await api<{ questions: typeof selected }>(
          `/ai/generations/${job.id}/review`,
          { method: 'POST', body: JSON.stringify({ questions: selected }) },
        );
        setDirty(false);
        onAdd?.(
          result.questions.map(
            ({ prompt, options, correctOption, explanation }) => ({
              prompt,
              options,
              correctOption,
              explanation,
            }),
          ),
        );
      } else {
        const result = await api<{ bankId: string; savedCount: number }>(
          `/ai/generations/${job.id}/accept`,
          {
            method: 'POST',
            body: JSON.stringify({
              questions: selected,
              ...(creating
                ? { newBank: { title, description: '', courseId: null } }
                : { bankId }),
            }),
          },
        );
        setSaved(result);
        setDirty(false);
        await client.invalidateQueries({ queryKey: ['banks'] });
      }
    } catch (err) {
      setError(safeError(err));
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="ai-review" aria-label="Review generated questions">
      <div className="section-heading">
        <div>
          <h2>Review generated questions</h2>
          <p className="muted">
            AI can make mistakes. Check every answer and source before accepting
            it.
          </p>
        </div>
        <span className="status neutral">Drafts</span>
      </div>
      <p className="field-hint">
        Review expires {new Date(job.expiresAt!).toLocaleString()}. Source
        excerpts are checked against the supplied text; they do not guarantee a
        correct answer.
      </p>
      {!questions.length ? (
        <p className="panel">
          All questions removed. Regenerate to create a new set.
        </p>
      ) : null}
      <div>
        <fieldset className="editor-fields" disabled={pending}>
          {questions.map((q, index) => (
            <section
              className="question-editor panel"
              key={q.key}
              aria-label={`Generated question ${index + 1}`}
            >
              <div className="section-heading">
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={q.selected}
                    onChange={(e) => {
                      setQuestions((values) =>
                        values.map((item) =>
                          item.key === q.key
                            ? { ...item, selected: e.target.checked }
                            : item,
                        ),
                      );
                      setDirty(true);
                    }}
                  />
                  Include question {index + 1}
                </label>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => {
                    setQuestions((values) =>
                      values.filter((item) => item.key !== q.key),
                    );
                    setDirty(true);
                  }}
                >
                  Remove question {index + 1}
                </button>
              </div>
              <QuestionFields
                value={q.value}
                idPrefix={`ai-${q.key}`}
                explanationRequired
                onChange={(next) => update(q.key, next)}
              />
              <div className="bank-filters">
                <label className="field">
                  Difficulty
                  <select
                    value={q.value.difficulty}
                    onChange={(e) =>
                      update(q.key, {
                        difficulty: e.target.value as Difficulty,
                      })
                    }
                  >
                    <option value="EASY">Easy</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="HARD">Hard</option>
                  </select>
                </label>
                <label className="field">
                  Topic
                  <input
                    maxLength={100}
                    value={q.value.topic}
                    onChange={(e) => update(q.key, { topic: e.target.value })}
                  />
                </label>
              </div>
            </section>
          ))}
          <section className="panel ai-save">
            <h2>Accept selected questions</h2>
            <p role="status">{selected.length} selected</p>
            {onAdd ? (
              <>
                <button
                  type="button"
                  className="button primary"
                  disabled={!selected.length || selected.length > remaining}
                  onClick={() => {
                    void accept(true);
                  }}
                >
                  Add {selected.length} to quiz draft
                </button>
                <p className="field-hint">
                  {remaining} spaces in this draft. Save the quiz to keep these
                  copies.
                </p>
              </>
            ) : null}
            {saved ? (
              <p role="status">
                Saved {saved.savedCount} questions.{' '}
                <Link className="text-link" to={`/banks/${saved.bankId}`}>
                  Open question bank ↗
                </Link>
              </p>
            ) : (
              <>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={creating}
                    onChange={(e) => setCreating(e.target.checked)}
                  />
                  Create a new question bank
                </label>
                {creating ? (
                  <label className="field">
                    New bank title
                    <input
                      maxLength={150}
                      required
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                    />
                  </label>
                ) : (
                  <BankSelect value={bankId} onChange={setBankId} />
                )}
                <button
                  type="button"
                  className={`button ${onAdd ? 'secondary' : 'primary'}`}
                  disabled={!selected.length || (!creating && !bankId)}
                  onClick={() => {
                    void accept();
                  }}
                >
                  {pending ? 'Saving…' : 'Save selected to bank'}
                </button>
              </>
            )}
          </section>
        </fieldset>
      </div>
      {error ? <PracticeError error={error} /> : null}
    </section>
  );
}
