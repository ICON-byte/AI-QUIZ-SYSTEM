export function QuestionFilters({
  search,
  difficulty,
  topic,
  change,
}: {
  search: string;
  difficulty: string;
  topic: string;
  change: (key: 'search' | 'difficulty' | 'topic', value: string) => void;
}) {
  return (
    <div className="bank-filters">
      <label className="field">
        Search questions
        <input
          type="search"
          value={search}
          maxLength={150}
          onChange={(e) => change('search', e.target.value)}
        />
      </label>
      <label className="field">
        Difficulty
        <select
          value={difficulty}
          onChange={(e) => change('difficulty', e.target.value)}
        >
          <option value="">All difficulties</option>
          <option value="EASY">Easy</option>
          <option value="MEDIUM">Medium</option>
          <option value="HARD">Hard</option>
        </select>
      </label>
      <label className="field">
        Topic filter
        <input
          value={topic}
          maxLength={100}
          onChange={(e) => change('topic', e.target.value)}
        />
      </label>
    </div>
  );
}
