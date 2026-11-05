import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { Pagination, PracticeError } from '../practice/PracticeUi';
import type { Bank } from './types';
import { useDebouncedValue } from './useDebouncedValue';

export function BankSelect({
  value,
  onChange,
  label = 'Question bank',
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
}) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const term = useDebouncedValue(search);
  const query = useQuery({
    queryKey: ['banks', 'chooser', term, page],
    queryFn: () =>
      api<{ banks: Bank[]; total: number }>(
        `/question-banks?${new URLSearchParams({ search: term, page: String(page) })}`,
      ),
    retry: false,
  });
  return (
    <div className="bank-chooser">
      <label className="field">
        Find bank
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
      {query.isPending ? (
        <p role="status">Loading banks…</p>
      ) : query.error ? (
        <PracticeError
          error={query.error}
          retry={() => {
            void query.refetch();
          }}
        />
      ) : (
        <>
          <label className="field">
            {label}
            <select value={value} onChange={(e) => onChange(e.target.value)}>
              <option value="">Choose a bank</option>
              {value && !query.data.banks.some((b) => b.id === value) ? (
                <option value={value}>Selected bank</option>
              ) : null}
              {query.data.banks.map((bank) => (
                <option key={bank.id} value={bank.id}>
                  {bank.title} ({bank.questionCount})
                </option>
              ))}
            </select>
          </label>
          {!query.data.banks.length ? (
            <p className="muted">No active banks match your search.</p>
          ) : null}
          <Pagination page={page} total={query.data.total} setPage={setPage} />
        </>
      )}
    </div>
  );
}
