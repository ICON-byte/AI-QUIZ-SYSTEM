import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '../../lib/api';
import { PracticeError } from './PracticeUi';
import { safeError } from './format';
import { useLeaveWarning } from './useLeaveWarning';
import type { DraftQuestion, DraftQuiz, QuizSummary } from './types';

const blankQuestion = (): DraftQuestion => ({
  prompt: '',
  options: ['', '', '', ''],
  correctOption: 0,
  explanation: '',
});

export function QuizEditor() {
  const { quizId } = useParams();
  const query = useQuery({
    queryKey: ['practice', 'draft', quizId],
    queryFn: () => api<DraftQuiz>(`/quizzes/${quizId}/draft`),
    enabled: !!quizId,
    retry: false,
  });
  if (quizId && query.isPending)
    return <p role="status">Loading your draft…</p>;
  if (query.error)
    return (
      <PracticeError
        error={query.error}
        retry={() => {
          void query.refetch();
        }}
      />
    );
  return <EditorForm key={quizId ?? 'new'} initial={query.data} />;
}

function EditorForm({ initial }: { initial?: DraftQuiz }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [minutes, setMinutes] = useState(
    initial?.timeLimitSeconds ? String(initial.timeLimitSeconds / 60) : '',
  );
  const [questions, setQuestions] = useState<DraftQuestion[]>(
    initial?.questions ?? [],
  );
  const [revision, setRevision] = useState(initial?.revision ?? 0);
  const [savedId, setSavedId] = useState(initial?.id);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState<Error | null>(null);
  useLeaveWarning(dirty);

  function changeQuestion(index: number, update: Partial<DraftQuestion>) {
    setDirty(true);
    setNotice('');
    setQuestions((values) =>
      values.map((value, at) =>
        at === index ? { ...value, ...update } : value,
      ),
    );
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const publish =
      (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') ===
      'publish';
    if (
      publish &&
      !window.confirm(
        'Publish this quiz? Its questions and settings will become permanent.',
      )
    )
      return;
    setPending(true);
    setError(null);
    setNotice('');
    try {
      const payload = {
        title,
        description,
        timeLimitSeconds: minutes ? Number(minutes) * 60 : null,
        questions,
        ...(savedId ? { revision } : {}),
      };
      const saved = await api<DraftQuiz>(
        savedId ? `/quizzes/${savedId}` : '/quizzes',
        { method: savedId ? 'PUT' : 'POST', body: JSON.stringify(payload) },
      );
      setDirty(false);
      setRevision(saved.revision);
      setSavedId(saved.id);
      client.setQueryData(['practice', 'draft', saved.id], saved);
      await client.invalidateQueries({ queryKey: ['practice', 'list'] });
      if (publish) {
        await api<QuizSummary>(`/quizzes/${saved.id}/publish`, {
          method: 'POST',
          body: JSON.stringify({ revision: saved.revision }),
        });
        await client.invalidateQueries({ queryKey: ['practice'] });
        navigate(`/practice/${saved.id}`);
      } else if (!initial)
        navigate(`/practice/${saved.id}/edit`, { replace: true });
      else setNotice('Draft saved.');
    } catch (error) {
      setError(safeError(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <div className="practice-heading">
        <div>
          <p className="context-label">
            <Link to="/practice">Personal practice</Link> /{' '}
            {initial ? 'Edit draft' : 'New quiz'}
          </p>
          <h1>{initial ? 'Edit your quiz' : 'Create a practice quiz'}</h1>
          <p className="muted">Write the questions you want to come back to.</p>
        </div>
        <span className="status neutral">Draft</span>
      </div>
      <form
        className="quiz-editor"
        onSubmit={(event) => {
          void save(event);
        }}
      >
        <fieldset disabled={pending} className="editor-fields">
          <div className="editor-layout">
            <section className="panel">
              <h2>Quiz details</h2>
              <label className="field">
                Quiz title
                <input
                  required
                  maxLength={150}
                  value={title}
                  onChange={(event) => {
                    setTitle(event.target.value);
                    setDirty(true);
                  }}
                />
              </label>
              <label className="field">
                Description <span className="field-hint">Optional</span>
                <textarea
                  maxLength={2000}
                  rows={3}
                  value={description}
                  onChange={(event) => {
                    setDescription(event.target.value);
                    setDirty(true);
                  }}
                />
              </label>
              <label className="field">
                Time limit in minutes
                <input
                  type="number"
                  min={1}
                  max={180}
                  step={1}
                  value={minutes}
                  onChange={(event) => {
                    setMinutes(event.target.value);
                    setDirty(true);
                  }}
                  aria-describedby="timer-hint"
                />
              </label>
              <p className="field-hint" id="timer-hint">
                Leave blank for untimed practice. A timer keeps running if you
                leave the quiz.
              </p>
            </section>
            <aside className="editor-guide">
              <h2>A useful question</h2>
              <p className="muted">
                Keep the wording clear. Give four different options, select one
                correct answer, and add an explanation to help your future self.
              </p>
              <p className="field-hint">
                Save a draft to return later. Publishing locks the questions and
                settings.
              </p>
            </aside>
          </div>
          <div className="question-editor-title">
            <h2>
              Questions <span className="muted">({questions.length}/50)</span>
            </h2>
            <p className="field-hint">
              One mark per question. No negative marking.
            </p>
          </div>
          {questions.length === 0 ? (
            <div className="practice-empty panel">
              <p className="muted">
                No questions yet. Add one below, or save this draft and come
                back later.
              </p>
            </div>
          ) : null}
          {questions.map((question, index) => (
            <section
              className="question-editor panel"
              key={index}
              aria-label={`Question ${index + 1}`}
            >
              <div className="section-heading">
                <h3>Question {index + 1}</h3>
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => {
                    if (
                      question.prompt &&
                      !window.confirm(`Remove question ${index + 1}?`)
                    )
                      return;
                    setQuestions((values) =>
                      values.filter((_, at) => at !== index),
                    );
                    setDirty(true);
                  }}
                >
                  Remove question {index + 1}
                </button>
              </div>
              <label className="field">
                Question {index + 1} text
                <textarea
                  required
                  maxLength={2000}
                  rows={3}
                  value={question.prompt}
                  onChange={(event) =>
                    changeQuestion(index, { prompt: event.target.value })
                  }
                />
              </label>
              <fieldset className="options-editor">
                <legend>Answer options · select the correct answer</legend>
                {question.options.map((option, optionIndex) => (
                  <div className="option-editor" key={optionIndex}>
                    <label className="correct-choice">
                      <input
                        type="radio"
                        name={`correct-${index}`}
                        checked={question.correctOption === optionIndex}
                        onChange={() =>
                          changeQuestion(index, { correctOption: optionIndex })
                        }
                        aria-label={`Question ${index + 1} correct answer ${String.fromCharCode(65 + optionIndex)}`}
                      />
                      <span aria-hidden="true">
                        {String.fromCharCode(65 + optionIndex)}
                      </span>
                    </label>
                    <input
                      aria-label={`Question ${index + 1} option ${String.fromCharCode(65 + optionIndex)}`}
                      required
                      maxLength={500}
                      value={option}
                      onChange={(event) => {
                        const options = [
                          ...question.options,
                        ] as DraftQuestion['options'];
                        options[optionIndex] = event.target.value;
                        changeQuestion(index, { options });
                      }}
                    />
                  </div>
                ))}
              </fieldset>
              <label className="field">
                Question {index + 1} explanation{' '}
                <span className="field-hint">
                  Optional · shown after submission
                </span>
                <textarea
                  maxLength={2000}
                  rows={2}
                  value={question.explanation}
                  onChange={(event) =>
                    changeQuestion(index, { explanation: event.target.value })
                  }
                />
              </label>
            </section>
          ))}
          <button
            className="button secondary"
            type="button"
            disabled={questions.length >= 50}
            onClick={() => {
              setQuestions((values) => [...values, blankQuestion()]);
              setDirty(true);
            }}
          >
            Add question +
          </button>
          <div className="editor-actions">
            <span role="status" className="muted">
              {pending
                ? 'Saving your quiz…'
                : notice || (dirty ? 'Unsaved changes' : 'Draft')}
            </span>
            <div className="button-group">
              <button type="submit" value="draft" className="button secondary">
                Save draft
              </button>
              <button
                type="submit"
                value="publish"
                className="button primary"
                disabled={!questions.length}
              >
                Save and publish
              </button>
            </div>
          </div>
        </fieldset>
        {error ? <PracticeError error={error} /> : null}
      </form>
    </>
  );
}
