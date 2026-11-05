import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '../../lib/api';
import { PracticeError } from '../practice/PracticeUi';
import { safeError } from '../practice/format';
import { useLeaveWarning } from '../practice/useLeaveWarning';
import type { Bank, CsvPreview } from './types';

export function CsvImport() {
  const { bankId } = useParams();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [csv, setCsv] = useState('');
  const [filename, setFilename] = useState('');
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [skip, setSkip] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const fileVersion = useRef(0);
  const bank = useQuery({
    queryKey: ['banks', bankId],
    queryFn: () => api<Bank>(`/question-banks/${bankId}`),
    retry: false,
  });
  useLeaveWarning(!!preview);
  async function load(file?: File) {
    const version = ++fileVersion.current;
    setPreview(null);
    setCsv('');
    setFilename('');
    setSkip(false);
    setError(null);
    if (!file) return;
    try {
      if (!file.name.toLowerCase().endsWith('.csv') || file.size > 1024 * 1024)
        throw new Error('Choose a .csv file no larger than 1 MiB.');
      const text = new TextDecoder('utf-8', { fatal: true }).decode(
        await file.arrayBuffer(),
      );
      if (version !== fileVersion.current) return;
      setCsv(text);
      setFilename(file.name);
    } catch (err) {
      if (version === fileVersion.current) setError(safeError(err));
    }
  }
  async function parse() {
    setPending(true);
    setError(null);
    setPreview(null);
    setSkip(false);
    try {
      setPreview(
        await api<CsvPreview>(`/question-banks/${bankId}/import/preview`, {
          method: 'POST',
          body: JSON.stringify({ csv }),
        }),
      );
    } catch (err) {
      setError(safeError(err));
    } finally {
      setPending(false);
    }
  }
  async function confirm() {
    if (
      !preview ||
      !window.confirm(
        `Import ${preview.validCount} question${preview.validCount === 1 ? '' : 's'} into ${bank.data?.title}?${preview.invalidCount ? ` ${preview.invalidCount} invalid row${preview.invalidCount === 1 ? '' : 's'} will be skipped.` : ''}`,
      )
    )
      return;
    setPending(true);
    setError(null);
    try {
      const result = await api<{ importedCount: number; skippedCount: number }>(
        `/question-banks/${bankId}/import/confirm`,
        {
          method: 'POST',
          body: JSON.stringify({
            csv,
            token: preview.token,
            confirmed: true,
            skipInvalid: skip,
          }),
        },
      );
      setPreview(null);
      await client.invalidateQueries({ queryKey: ['banks'] });
      navigate(`/banks/${bankId}`, {
        state: {
          notice: `Imported ${result.importedCount} question${result.importedCount === 1 ? '' : 's'}. ${result.skippedCount} row${result.skippedCount === 1 ? '' : 's'} skipped.`,
        },
      });
    } catch (err) {
      setError(safeError(err));
    } finally {
      setPending(false);
    }
  }
  if (bank.isPending) return <p role="status">Loading bank…</p>;
  if (bank.error) return <PracticeError error={bank.error} />;
  return (
    <>
      <div className="practice-heading">
        <div>
          <p className="context-label">
            <Link to={`/banks/${bankId}`}>{bank.data.title}</Link>
          </p>
          <h1>Import questions from CSV</h1>
          <p className="muted">
            Preview every row before adding it to your bank.
          </p>
        </div>
        <a
          className="button secondary"
          href="/api/v1/question-banks/csv-template"
          download
        >
          Download CSV template
        </a>
      </div>
      {bank.data.archivedAt ? (
        <p>This bank is archived and cannot accept imports.</p>
      ) : (
        <>
          <section className="panel bank-form">
            <label className="field" htmlFor="question-csv">
              CSV file
            </label>
            <input
              id="question-csv"
              type="file"
              accept=".csv,text/csv"
              disabled={pending}
              aria-describedby="csv-limits"
              onChange={(e) => {
                void load(e.target.files?.[0]);
              }}
            />
            <p id="csv-limits" className="field-hint">
              UTF-8, comma-separated · Maximum 1 MiB and 200 question rows. Use
              all nine template columns. Correct Answer: A, B, C or D.
              Difficulty: EASY, MEDIUM or HARD.
            </p>
            <div className="editor-actions">
              <span className="muted">{filename || 'No file selected'}</span>
              <button
                className="button primary"
                disabled={!csv || pending}
                onClick={() => {
                  void parse();
                }}
              >
                {pending ? 'Working…' : 'Preview CSV'}
              </button>
            </div>
          </section>
          {preview ? (
            <section className="csv-preview">
              <div className="section-heading">
                <h2>Import preview</h2>
                <p role="status">
                  {preview.validCount} valid · {preview.invalidCount} invalid
                </p>
              </div>
              <p className="field-hint">
                Row numbers count nonempty CSV records, including the header;
                quoted multiline fields belong to one record. Preview expires at{' '}
                {new Date(preview.expiresAt).toLocaleTimeString()}.
              </p>
              <div className="bank-question-list">
                {preview.rows.map((row) => (
                  <article className="panel bank-question" key={row.row}>
                    <p className="field-hint">
                      Row {row.row} ·{' '}
                      {row.question ? 'Ready to import' : 'Needs correction'}
                    </p>
                    <h3>{row.prompt || 'Empty question'}</h3>
                    {row.errors.length ? (
                      <ul className="form-error">
                        {row.errors.map((err, i) => (
                          <li key={i}>{err}</li>
                        ))}
                      </ul>
                    ) : row.question ? (
                      <>
                        <ol type="A" className="bank-options">
                          {row.question.options.map((option, i) => (
                            <li key={i}>
                              {option}
                              {i === row.question!.correctOption ? (
                                <strong> · Correct</strong>
                              ) : null}
                            </li>
                          ))}
                        </ol>
                        <p className="field-hint">
                          {row.question.difficulty}{' '}
                          {row.question.topic ? `· ${row.question.topic}` : ''}
                        </p>
                        <p className="muted">{row.question.explanation}</p>
                      </>
                    ) : null}
                  </article>
                ))}
              </div>
              {preview.invalidCount ? (
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={skip}
                    disabled={pending}
                    onChange={(e) => setSkip(e.target.checked)}
                  />
                  Import only valid rows and skip {preview.invalidCount} invalid
                  rows
                </label>
              ) : null}
              <div className="editor-actions">
                <Link to={`/banks/${bankId}`}>Cancel import</Link>
                <button
                  className="button primary"
                  disabled={
                    pending ||
                    !preview.validCount ||
                    (!!preview.invalidCount && !skip)
                  }
                  onClick={() => {
                    void confirm();
                  }}
                >
                  Confirm import of {preview.validCount} question
                  {preview.validCount === 1 ? '' : 's'}
                </button>
              </div>
            </section>
          ) : null}
        </>
      )}
      {error ? <PracticeError error={error} /> : null}
    </>
  );
}
