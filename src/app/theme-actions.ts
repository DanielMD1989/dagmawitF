'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { THEME_COOKIE, parseTheme } from '@/lib/theme';

export async function setTheme(formData: FormData): Promise<void> {
  const theme = parseTheme(formData.get('theme'));
  (await cookies()).set(THEME_COOKIE, theme, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' });
  revalidatePath('/', 'layout');
}
