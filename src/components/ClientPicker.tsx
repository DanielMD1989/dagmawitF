'use client';

import { useId, useMemo, useState } from 'react';
import { enoughToSearch, findClients } from '@/domain/clients/search';

export interface PickableClient {
  id: string;
  name: string;
  phone: string;
}

/**
 * "For": she types two letters of her client's name, or three digits of her phone, and picks her from the few that
 * match (decision 0109). Her clients are many, so they are never all listed. With no one matching, or anyway at the
 * end, she can add the name she typed as a new client. A combobox: arrows move through the matches, Enter picks,
 * Escape closes them.
 */
export function ClientPicker({
  clients,
  value,
  newValue,
  onPick,
  error,
}: {
  clients: readonly PickableClient[];
  /** The chosen client's id, `newValue` for a new client, or '' for none yet. */
  value: string;
  newValue: string;
  /** A client's id, or `newValue` with the name she typed. */
  onPick: (value: string, typedName?: string) => void;
  error?: string;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const list = useId();
  const matches = useMemo(() => findClients(clients, query), [clients, query]);
  const looking = open && enoughToSearch(query);
  // The matches, then "add as a new client" last.
  const count = matches.length + 1;
  const chosen = clients.find((c) => c.id === value);

  const pick = (i: number) => {
    if (i < matches.length) onPick(matches[i]!.id);
    else onPick(newValue, query.trim());
    setOpen(false);
    setQuery('');
  };

  if (chosen)
    return (
      <div className="field">
        <span className="label" id={`${list}-label`}>
          For
        </span>
        <input type="hidden" name="client" value={chosen.id} />
        <div className="picked" aria-labelledby={`${list}-label`}>
          <span className="picked__name">{chosen.name}</span>
          {chosen.phone && <span className="picked__phone">{chosen.phone}</span>}
          <button type="button" className="picked__change" onClick={() => onPick('')}>
            Change<span className="sr-only"> the client</span>
          </button>
        </div>
      </div>
    );

  return (
    <div className="field picker">
      <label htmlFor="client-search">For</label>
      <input type="hidden" name="client" value={value === newValue ? newValue : ''} />
      <input
        id="client-search"
        className="input"
        type="search"
        role="combobox"
        autoComplete="off"
        enterKeyHint="search"
        placeholder="Type her name or phone"
        value={query}
        aria-expanded={looking}
        aria-controls={list}
        aria-autocomplete="list"
        aria-activedescendant={looking ? `${list}-${active}` : undefined}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? 'client-error' : undefined}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (!looking) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => (a + 1) % count);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => (a - 1 + count) % count);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            pick(active);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      {looking && (
        <ul id={list} className="picker__list" role="listbox" aria-label="Clients that match">
          {matches.map((c, i) => (
            <li
              key={c.id}
              id={`${list}-${i}`}
              role="option"
              aria-selected={i === active}
              className="picker__option"
              // Picked on press, before the field loses focus and closes the list.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(i);
              }}
            >
              <span className="picker__name">{c.name}</span>
              {c.phone && <span className="picker__phone">{c.phone}</span>}
            </li>
          ))}
          <li
            id={`${list}-${matches.length}`}
            role="option"
            aria-selected={active === matches.length}
            className="picker__option picker__option--new"
            onMouseDown={(e) => {
              e.preventDefault();
              pick(matches.length);
            }}
          >
            + Add “{query.trim()}” as a new client
          </li>
        </ul>
      )}
      {error && (
        <p id="client-error" className="error">
          {error}
        </p>
      )}
    </div>
  );
}
