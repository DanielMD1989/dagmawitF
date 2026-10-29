import { setTheme } from '@/app/theme-actions';
import { THEMES, THEME_LABELS, type Theme } from '@/lib/theme';

export function ThemeSwitch({ current }: { current: Theme }) {
  return (
    <form action={setTheme} className="segmented" aria-label="Appearance">
      {THEMES.map((theme) => (
        <button key={theme} type="submit" name="theme" value={theme} aria-pressed={theme === current}>
          {THEME_LABELS[theme]}
        </button>
      ))}
    </form>
  );
}
