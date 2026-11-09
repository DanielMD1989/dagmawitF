'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { enoughToSearch, findClients } from '@/domain/clients/search';

interface Listed {
  id: string;
  name: string;
  phone: string;
  orders: number;
  openOrders: number;
}

function Row({ c }: { c: Listed }) {
  return (
    <li>
      <Link href={`/clients/${c.id}`} className="row-link">
        <span className="row-link__title">{c.name}</span>
        <span className="hint">
          {[
            c.phone || null,
            c.openOrders > 0
              ? `${c.openOrders} open ${c.openOrders === 1 ? 'order' : 'orders'}`
              : c.orders > 0
                ? 'All finished'
                : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </Link>
    </li>
  );
}

/**
 * Her clients (decision 0109): a search at the top, two letters of a name or three digits of a phone; until she
 * types, the clients she is working for now, with every client one tap further.
 */
export function ClientSearch({ clients }: { clients: Listed[] }) {
  const [query, setQuery] = useState('');
  const [all, setAll] = useState(false);
  const found = useMemo(() => findClients(clients, query, 30), [clients, query]);
  const searching = enoughToSearch(query);
  const current = clients.filter((c) => c.openOrders > 0);

  return (
    <>
      <div className="search">
        <label htmlFor="client-find" className="sr-only">
          Find a client
        </label>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" />
          <path d="m16 16 4 4" strokeLinecap="round" />
        </svg>
        <input
          id="client-find"
          className="input search__input"
          type="search"
          autoComplete="off"
          enterKeyHint="search"
          placeholder={`Search ${clients.length} clients`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {searching ? (
        <section className="section" aria-label="Clients found" aria-live="polite">
          {found.length > 0 ? (
            <ul className="rows rows--links">
              {found.map((c) => (
                <Row key={c.id} c={c} />
              ))}
            </ul>
          ) : (
            <p className="hint">
              No client called “{query.trim()}”. <Link href="/clients/new">Add a new client</Link>
            </p>
          )}
        </section>
      ) : (
        <>
          {current.length > 0 && (
            <section className="section" aria-labelledby="current-heading">
              <h2 id="current-heading" className="h3">
                With open orders
              </h2>
              <ul className="rows rows--links">
                {current.map((c) => (
                  <Row key={c.id} c={c} />
                ))}
              </ul>
            </section>
          )}
          {all ? (
            <section className="section" aria-labelledby="all-heading">
              <h2 id="all-heading" className="h3">
                All clients
              </h2>
              <ul className="rows rows--links">
                {clients.map((c) => (
                  <Row key={c.id} c={c} />
                ))}
              </ul>
            </section>
          ) : (
            <button type="button" className="link-button" onClick={() => setAll(true)}>
              Show all {clients.length} clients
            </button>
          )}
        </>
      )}
    </>
  );
}
