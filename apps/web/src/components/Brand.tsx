import { Link } from 'react-router';

export function Brand() {
  return <Link to="/" className="brand" aria-label="AI Quiz home">
    <svg viewBox="0 0 28 28" width="28" height="28" fill="none" aria-hidden="true">
      <path d="M4 5h8c3 0 5 2 5 5v13c0-3-2-5-5-5H4V5Z" stroke="currentColor" strokeWidth="1.7" />
      <path d="M24 5h-3M24 10h-3M24 15h-3M8 10h5M8 14h3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
    <span>AI Quiz<span className="brand-caption">Academic workspace</span></span>
  </Link>;
}
