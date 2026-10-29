import { isUuid } from '@/domain/form-input';
import { getSessionUser } from '@/server/session';
import { createSupabase } from '@/server/supabase';

/**
 * Opens a sketch or photo. Nothing in the app links to storage: a page points at /files/<picture id>, and this
 * checks she is signed in and that the picture is hers (row-level security answers that), then sends the
 * browser to a link that works for one minute. A link copied from the page is useless a minute later.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!(await getSessionUser())) return new Response('Please sign in.', { status: 401 });
  if (!isUuid(id)) return new Response('Not found.', { status: 404 });

  const supabase = await createSupabase();
  const found = await supabase.from('attachment').select('storage_path').eq('id', id).maybeSingle();
  if (found.error) {
    console.error(`Could not look up picture ${id}: ${found.error.message}`);
    return new Response('Something went wrong. Try again in a moment.', { status: 500 });
  }
  if (!found.data) return new Response('Not found.', { status: 404 });

  const signed = await supabase.storage
    .from('order-files')
    .createSignedUrl(String(found.data.storage_path), 60);
  if (signed.error) {
    console.error(`Could not open picture ${id}: ${signed.error.message}`);
    return new Response('Not found.', { status: 404 });
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: signed.data.signedUrl,
      // The browser may reuse the redirect for a short while, well inside the minute the link lasts.
      'Cache-Control': 'private, max-age=30',
    },
  });
}
