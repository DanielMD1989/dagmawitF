import { exportFileName, readExportFile } from '@/backup/format';
import { exportZip } from '@/backup/zip';
import { loadPreferences } from '@/server/preferences';
import { getSessionUser } from '@/server/session';
import { createSupabase } from '@/server/supabase';

/**
 * Everything of hers, as one zip (docs/harden.md, "The export"): the data as one moment, made by the database
 * (decision 0051), and her pictures, read one at a time as the download goes.
 */
export async function GET(): Promise<Response> {
  if (!(await getSessionUser())) return new Response('Please sign in.', { status: 401 });

  const supabase = await createSupabase();
  const { data, error } = await supabase.rpc('export_my_data');
  if (error) {
    console.error(`Export failed [${error.code}]: ${error.message}`);
    return new Response('The export could not be made. Nothing was changed. Try again in a moment.', {
      status: 500,
    });
  }
  const read = readExportFile(data);
  if (!read.ok) {
    console.error(`Export is malformed: ${read.reason}`);
    return new Response('The export could not be made. Try again in a moment.', { status: 500 });
  }
  const { today } = await loadPreferences(supabase);

  const pictures = supabase.storage.from('order-files');
  const zip = exportZip(read.value, async (path) => {
    const found = await pictures.download(path);
    if (found.error || !found.data) {
      console.error(`Export could not read picture ${path}: ${found.error?.message ?? 'no data'}`);
      return null;
    }
    return new Uint8Array(await found.data.arrayBuffer());
  });

  return new Response(zip, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${exportFileName(today)}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
