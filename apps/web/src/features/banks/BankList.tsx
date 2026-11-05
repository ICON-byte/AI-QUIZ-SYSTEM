import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '../../lib/api';
import { Pagination, PracticeError } from '../practice/PracticeUi';
import type { Bank } from './types';
import { useDebouncedValue } from './useDebouncedValue';

export function BankList() {
  const [search, setSearch] = useState('');
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(1);
  const term = useDebouncedValue(search);
  const query = useQuery({
    queryKey: ['banks', 'list', term, archived, page],
    queryFn: () =>
      api<{ banks: Bank[]; total: number }>(
        `/question-banks?${new URLSearchParams({ search: term, archived: String(archived), page: String(page) })}`,
      ),
    retry: false,
  });
  return (
    <>
      <div className="practice-heading">
        <div>
          <h1>My question banks</h1>
          <p className="muted">
            Keep useful questions ready for your next quiz.
          </p>
        </div>
        <Link to="/banks/new" className="button primary">
          Create a bank
        </Link>
      </div>
      <div className="bank-filters">
        <label className="field">
          Search banks
          <input
            type="search"
            maxLength={150}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => {
              setArchived(e.target.checked);
              setPage(1);
            }}
          />
          Show archived banks
        </label>
      </div>
      {query.isPending ? (
        <p role="status">Loading question banks…</p>
      ) : query.error ? (
        <PracticeError
          error={query.error}
          retry={() => {
            void query.refetch();
          }}
        />
      ) : (
        <>
          <p className="list-caption">
            {query.data.total} {archived ? 'archived' : 'active'} banks ·
            Private to you
          </p>
          {query.data.banks.length ? (
            <div className="quiz-list">
              {query.data.banks.map((bank) => (
                <article className="quiz-row" key={bank.id}>
                  <div>
                    <h2>
                      <Link to={`/banks/${bank.id}`}>{bank.title}</Link>
                    </h2>
                    <p className="muted">{bank.description}</p>
                    <p className="field-hint">
                      {bank.questionCount} active questions
                      {bank.archivedAt ? ' · Archived' : ''}
                    </p>
                  </div>
                  <Link className="button secondary" to={`/banks/${bank.id}`}>
                    View bank
                  </Link>
                </article>
              ))}
            </div>
          ) : (
            <section className="panel practice-empty">
              <h2>
                {search || archived
                  ? 'No matching banks'
                  : 'A home for your questions'}
              </h2>
              <p className="muted">
                {search || archived
                  ? 'Try another search or view active banks.'
                  : 'Create a bank, then write questions or import a CSV.'}
              </p>
            </section>
          )}
          <Pagination page={page} total={query.data.total} setPage={setPage} />
        </>
      )}
    </>
  );
}
