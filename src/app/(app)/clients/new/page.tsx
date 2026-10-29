import type { Metadata } from 'next';
import Link from 'next/link';
import { requireUser } from '@/server/session';
import { ClientForm } from '../ClientForm';

export const metadata: Metadata = { title: 'Add a client' };

export default async function NewClientPage() {
  await requireUser();
  return (
    <>
      <div className="page-head">
        <p className="crumbs">
          <Link href="/clients">Clients</Link> / New
        </p>
        <h1>Add a client</h1>
      </div>
      <ClientForm />
    </>
  );
}
