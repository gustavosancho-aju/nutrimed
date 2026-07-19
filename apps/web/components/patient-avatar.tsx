/**
 * Avatar do paciente com as iniciais do nome (fallback até existir foto real).
 * A cor de fundo é derivada deterministicamente do id — estável entre renders
 * e sem depender de estado. Paleta restrita aos tons da identidade UNIC.
 */
const AVATAR_TONES = [
  'bg-brand/15 text-brand',
  'bg-secondary/15 text-secondary',
  'bg-accent-gold/20 text-brand',
  'bg-ink/10 text-ink',
] as const;

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]![0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]![0] ?? '') : '';
  return (first + last).toUpperCase();
}

function toneOf(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length]!;
}

export function PatientAvatar({
  id,
  name,
  size = 'md',
}: {
  id: string;
  name: string;
  size?: 'md' | 'lg';
}) {
  const sizeClass = size === 'lg' ? 'h-16 w-16 text-xl' : 'h-12 w-12 text-base';
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-full font-display font-semibold ${sizeClass} ${toneOf(id)}`}
    >
      {initialsOf(name)}
    </span>
  );
}
