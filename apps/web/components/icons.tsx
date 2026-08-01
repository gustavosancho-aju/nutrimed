import type { SVGProps } from 'react';

/**
 * Ícones stroke próprios (rodada premium 2026-07-31). Um único vocabulário de
 * traço (1.75px, pontas redondas, 24×24) tingido por `currentColor` — substitui
 * os emojis de AÇÃO/CHROME, que renderizavam diferente por SO e ignoravam a
 * paleta. O vocabulário SEMÂNTICO do board (⚠️ 💡 🔍 📋) fica como está: é
 * hierarquia de segurança testada (frontend-spec §6), não decoração.
 *
 * Sem dependência externa de propósito: ~20 ícones não justificam uma lib, e o
 * peso do traço fica sob controle do design system.
 */

type IconProps = SVGProps<SVGSVGElement> & { className?: string };

function Icon({ className = 'h-4 w-4', children, ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
      {...rest}
    >
      {children}
    </svg>
  );
}

export function IconShield(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3l7 3v5c0 4.6-2.9 7.6-7 9-4.1-1.4-7-4.4-7-9V6l7-3z" />
      <path d="M9.5 12l2 2 3.5-4" />
    </Icon>
  );
}

export function IconLock(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </Icon>
  );
}

/** Gravação ativa: anel + ponto cheio (o "REC" domesticado). */
export function IconRecord(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function IconTrash(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 7h16" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <path d="M6.5 7l1 13h9l1-13" />
      <path d="M10 11v5.5M14 11v5.5" />
    </Icon>
  );
}

export function IconPencil(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 20l1.2-4.2L16.4 4.6a2.1 2.1 0 0 1 3 3L8.2 18.8 4 20z" />
      <path d="M14.5 6.5l3 3" />
    </Icon>
  );
}

export function IconChart(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 4v16h16" />
      <path d="M8 15l3.2-4 2.8 2 4.5-6" />
    </Icon>
  );
}

export function IconSparkle(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M11 4l1.6 4.6L17 10.2l-4.4 1.6L11 16.4l-1.6-4.6L5 10.2l4.4-1.6L11 4z" />
      <path d="M18.5 15.5v5M16 18h5" />
    </Icon>
  );
}

export function IconFileText(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 3h8l4 4v14H6V3z" />
      <path d="M14 3v4h4" />
      <path d="M9 12h6M9 16h6" />
    </Icon>
  );
}

export function IconImage(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.5" />
      <path d="M4 17l5-4 3 2.5 4-3.5 4 3.2" />
    </Icon>
  );
}

export function IconSliders(props: IconProps) {
  // Linhas interrompidas no knob (sem fill): um fill de superfície aqui viraria
  // disco branco quando o botão vive em chrome escuro no tema claro.
  return (
    <Icon {...props}>
      <path d="M4 7h6M16 7h4M4 12h2M12 12h8M4 17h10M18 17h2" />
      <circle cx="13" cy="7" r="2" />
      <circle cx="9" cy="12" r="2" />
      <circle cx="16" cy="17" r="2" />
    </Icon>
  );
}

export function IconStethoscope(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 4v4a4 4 0 0 0 8 0V4" />
      <path d="M9 12v3a5 5 0 0 0 10 0v-1.5" />
      <circle cx="19" cy="11" r="2" />
    </Icon>
  );
}

export function IconClipboard(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="6" y="5" width="12" height="16" rx="2" />
      <rect x="9" y="3" width="6" height="4" rx="1" />
      <path d="M9 12h6M9 16h6" />
    </Icon>
  );
}

export function IconLeaf(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 20C6 11 10.5 5 20 4c0 9.5-5 15-13 15" />
      <path d="M6 20c2.5-5 5.5-8 10-10.5" />
    </Icon>
  );
}

export function IconSave(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 6a2 2 0 0 1 2-2h10l4 4v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6z" />
      <path d="M8 4v5h7V4" />
      <path d="M7 20v-6h10v6" />
    </Icon>
  );
}

export function IconMic(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </Icon>
  );
}

export function IconExpand(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" />
    </Icon>
  );
}

export function IconRotate(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.8-6.3" />
      <path d="M3.5 3.5V9H9" />
    </Icon>
  );
}

export function IconFolder(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    </Icon>
  );
}

export function IconFilePen(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 3h8l4 4v4" />
      <path d="M14 3v4h4" />
      <path d="M6 3v18h5" />
      <path d="M14 21l.7-2.8 5-5a1.8 1.8 0 0 1 2.6 2.6l-5 5-3.3.2z" />
    </Icon>
  );
}

export function IconCamera(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 8a2 2 0 0 1 2-2h2l1.5-2h5L16 6h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8z" />
      <circle cx="12" cy="12.5" r="3.5" />
    </Icon>
  );
}

export function IconInfo(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v.01M12 11.5V16" />
    </Icon>
  );
}

export function IconAlert(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3.5L21.5 20h-19L12 3.5z" />
      <path d="M12 10v4.5M12 17.5v.01" />
    </Icon>
  );
}

export function IconVolumeOff(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M11 5L7 9H4v6h3l4 4V5z" />
      <path d="M16 9.5l5 5M21 9.5l-5 5" />
    </Icon>
  );
}

export function IconCheck(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.5 12.5l4.8 4.8L19.5 6.5" />
    </Icon>
  );
}

export function IconX(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Icon>
  );
}

export function IconPlay(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7.5 5l11 7-11 7V5z" />
    </Icon>
  );
}

export function IconStop(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="6.5" y="6.5" width="11" height="11" rx="1.5" />
    </Icon>
  );
}

export function IconClock(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.2 2" />
    </Icon>
  );
}

export function IconPrinter(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7 8V4h10v4" />
      <path d="M7 16H5a1.5 1.5 0 0 1-1.5-1.5v-5A1.5 1.5 0 0 1 5 8h14a1.5 1.5 0 0 1 1.5 1.5v5A1.5 1.5 0 0 1 19 16h-2" />
      <rect x="7" y="13" width="10" height="7" rx="1" />
    </Icon>
  );
}
