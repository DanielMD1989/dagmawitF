import Link from 'next/link';

export function Plus() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/** The round green "+" of a list (decision 0105): what is added there, in one tap. */
export function AddLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="icon-btn icon-btn--round icon-btn--solid" aria-label={label}>
      <Plus />
    </Link>
  );
}

/**
 * A tab's large title (decision 0105), as a phone's own apps have it: a line above it when there is one (Today's
 * date), and its one action on the right, a round button.
 */
export function PageTitle({
  title,
  eyebrow,
  action,
}: {
  title: string;
  eyebrow?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-head title-bar">
      <div className="title-bar__words">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
      </div>
      {action}
    </div>
  );
}
