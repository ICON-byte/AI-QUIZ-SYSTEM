import type { DraftQuestion } from '../practice/types';

// Shared by bank authoring; quiz editor retains its question-specific accessible labels.
export function QuestionFields({
  value,
  onChange,
}: {
  value: DraftQuestion;
  onChange: (next: DraftQuestion) => void;
}) {
  return (
    <>
      <label className="field">
        Question text
        <textarea
          required
          rows={3}
          maxLength={2000}
          value={value.prompt}
          onChange={(e) => onChange({ ...value, prompt: e.target.value })}
        />
      </label>
      <fieldset className="options-editor">
        <legend>Answer options · select the correct answer</legend>
        {value.options.map((text, i) => (
          <div className="option-editor" key={i}>
            <label className="correct-choice">
              <input
                type="radio"
                name="bank-correct"
                checked={value.correctOption === i}
                onChange={() => onChange({ ...value, correctOption: i })}
                aria-label={`Correct answer ${String.fromCharCode(65 + i)}`}
              />
              <span aria-hidden="true">{String.fromCharCode(65 + i)}</span>
            </label>
            <input
              aria-label={`Option ${String.fromCharCode(65 + i)}`}
              required
              maxLength={500}
              value={text}
              onChange={(e) => {
                const options = [...value.options] as DraftQuestion['options'];
                options[i] = e.target.value;
                onChange({ ...value, options });
              }}
            />
          </div>
        ))}
      </fieldset>
      <label className="field">
        Explanation <span className="field-hint">Optional</span>
        <textarea
          rows={3}
          maxLength={2000}
          value={value.explanation}
          onChange={(e) => onChange({ ...value, explanation: e.target.value })}
        />
      </label>
    </>
  );
}
