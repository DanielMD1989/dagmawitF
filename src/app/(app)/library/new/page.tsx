import type { Metadata } from 'next';
import { BackLink } from '@/components/BackLink';
import { requireUser } from '@/server/session';
import { TemplateForm } from '../TemplateForm';

export const metadata: Metadata = { title: 'New list' };

export default async function NewTemplatePage() {
  await requireUser();
  return (
    <>
      <div className="page-head">
        <BackLink href="/library">Library</BackLink>
        <h1>New list of steps</h1>
        <p className="lede">Name it first. Its steps are added on the next page.</p>
      </div>
      <TemplateForm />
    </>
  );
}
