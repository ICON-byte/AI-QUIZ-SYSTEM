# Stage 1 interface

The interface is an academic workspace for students and lecturers. Stage 1 lets
people create an account, sign in, inspect their role and verification status,
and sign out. Unimplemented academic features are described honestly without
dead navigation, invented courses, or fabricated activity statistics.

## Direction

The frontend design skill dealt the **Editorial greeting** direction, seed
`80601035`, without redraws. Its neutral frame, white sheet, tonal panels, and
personal greeting suit an account workspace. The product's face comes from
sage-tinted academic paper surfaces, locally bundled Instrument Sans, a book and
question-lines mark, and an account-access summary specific to the user's role.

The primary questions are:

- Sign in/register: how do I enter the workspace with the correct role?
- Student overview: is my account ready, and where are my account details?
- Lecturer overview/verification: am I approved for official assessment access?
- Account: which identity and role am I signed in with?

## Implementation

- Tokens and responsive behavior live in `apps/web/src/styles.css`.
- Primary text `#1f201d`, muted text `#626963`, white sheets, sage-neutral surfaces,
  and restrained semantic status colors. No gradients, glows, or decorative metrics.
- Instrument Sans is self-hosted through its npm font package.
- Forms have explicit labels, autocomplete, visible focus, safe error feedback,
  native validation, pending states, and an optional password visibility control.
- Navigation folds into an accessible menu below 900px; the authentication layout
  stacks at the same width. Content and account identifiers wrap on small screens.
- The desktop canvas supports a maximum 1100px content grid with 16px gutters.
- Application data comes from the current authenticated account. No sample data
  ships in the product; test accounts exist only in disposable verification data.

## Verification notes

Browser inspection at 1440px, 768px, and 390px found no failing design checks for
sign-in, registration, or the authenticated dashboard. Source design lint passed.
The authentication inspector reports whitespace warnings because it treats the
two intentionally separated full-height authentication regions as content cards.
The dashboard retains empty space below its actual Stage 1 account content; filling
it with invented activity or unapproved features would misrepresent the product.
Screenshots were visually reviewed, including the phone form and dashboard,
tablet navigation, and approved lecturer verification state.

Real-browser checks also exercised registration for both roles, account navigation,
mobile menu expansion, logout, operator CLI approval, verification refresh within
the existing session, and access-cookie renewal. There was no horizontal overflow
at the checked widths and no uncaught browser exception in the exercised flow.
