import type { Metadata } from 'next';
import Link from 'next/link';
import { requireUser } from '@/server/session';
import { TemplateForm } from '../TemplateForm';

export const metadata: Metadata = { title: 'New template' };

export default async function NewTemplatePage() {
  await requireUser();
  return (
    <>
      <div className="page-head">
        <p className="crumbs">
          <Link href="/library">Library</Link> / New
        </p>
        <h1>New template</h1>
        <p className="lede">Name it first. Its steps are added on the next page.</p>
      </div>
      <TemplateForm />
    </>
  );
}
