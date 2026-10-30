import type { Metadata } from 'next';
import { BackLink } from '@/components/BackLink';
import { requireUser } from '@/server/session';
import { ClientForm } from '../ClientForm';

export const metadata: Metadata = { title: 'Add a client' };

export default async function NewClientPage() {
  await requireUser();
  return (
    <>
      <div className="page-head">
        <BackLink href="/clients">Clients</BackLink>
        <h1>Add a client</h1>
      </div>
      <ClientForm />
    </>
  );
}
