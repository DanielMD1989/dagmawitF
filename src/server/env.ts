import 'server-only';
import { z } from 'zod';

const schema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
});

/**
 * The only place the app reads its settings. Read when first needed, not at import, so a
 * build can run without secrets and a missing one fails with a clear message.
 */
export function env(): z.infer<typeof schema> {
  const parsed = schema.safeParse({
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
  });
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(
      `Missing or invalid settings: ${missing}. Copy .env.example to .env.local and fill it in.`,
    );
  }
  return parsed.data;
}
