import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { Brand } from '../../components/Brand';

export function LandingNavigation({ signedIn }: { signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  return (
    <header
      className="lp-header"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          setOpen(false);
          toggle.current?.focus();
        }
      }}
    >
      <Brand />
      <button
        ref={toggle}
        className="lp-menu-toggle"
        type="button"
        aria-expanded={open}
        aria-controls="public-navigation"
        onClick={() => setOpen(!open)}
      >
        {open ? 'Close' : 'Menu'}
        <span aria-hidden="true">{open ? '−' : '+'}</span>
      </button>
      <nav
        id="public-navigation"
        className={open ? 'lp-navigation is-open' : 'lp-navigation'}
        aria-label="Public navigation"
        onClick={(event) => {
          const link = (event.target as HTMLElement).closest('a');
          if (!link) return;
          setOpen(false);
          if (link.hash)
            requestAnimationFrame(() =>
              document
                .getElementById(link.hash.slice(1))
                ?.focus({ preventScroll: true }),
            );
        }}
      >
        <a href="#review">How it works</a>
        <a href="#practice">Practice</a>
        <a href="#teaching">Teaching</a>
        <a href="#challenges">Challenges</a>
        {!signedIn ? (
          <Link to="/login" className="lp-sign-in">
            Sign in
          </Link>
        ) : null}
        <Link
          className="lp-button lp-header-action"
          to={signedIn ? '/dashboard' : '/register'}
        >
          {signedIn ? 'Open workspace' : 'Create account'}
          <span aria-hidden="true">↗</span>
        </Link>
      </nav>
    </header>
  );
}
