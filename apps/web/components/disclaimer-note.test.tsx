// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { DisclaimerNote, DISCLAIMER_TEXT } from './disclaimer-note';
import { AppChrome } from './app-chrome';

afterEach(cleanup);

describe('<DisclaimerNote> — disclaimer persistente FR19 (Story 1.7)', () => {
  describe('AC2 — texto fiel ao frontend-spec §11.1, em fonte única', () => {
    it('a fonte única do texto é exatamente a do spec', () => {
      expect(DISCLAIMER_TEXT).toBe('Sugestão de apoio. A conduta é sua.');
    });

    it('variant card renderiza o texto do spec', () => {
      render(<DisclaimerNote variant="card" />);
      expect(screen.getByRole('note').textContent).toContain(DISCLAIMER_TEXT);
    });

    it('variant chrome renderiza o mesmo texto, assinado — NutriMed (mockup §6)', () => {
      render(<DisclaimerNote variant="chrome" />);
      expect(screen.getByRole('note').textContent).toContain(`${DISCLAIMER_TEXT} — NutriMed`);
    });
  });

  describe('AC4 — tom de sugestão, nunca de comando', () => {
    it('o texto não contém linguagem imperativa de conduta', () => {
      for (const comando of ['deve', 'prescreva', 'administre', 'faça', 'obrigatório']) {
        expect(DISCLAIMER_TEXT.toLowerCase()).not.toContain(comando);
      }
    });
  });

  describe('AC5 — acessibilidade (WCAG 2.1 AA)', () => {
    it('tem semântica de nota com rótulo para leitor de tela', () => {
      render(<DisclaimerNote />);
      const note = screen.getByRole('note');
      expect(note.getAttribute('aria-label')).toBe('Aviso: a IA assiste, o médico decide');
    });

    it('o ícone ⓘ é decorativo e escondido do leitor de tela', () => {
      const { container } = render(<DisclaimerNote />);
      const icon = container.querySelector('[aria-hidden="true"]');
      expect(icon).not.toBeNull();
      expect(icon!.textContent).toContain('ⓘ');
    });

    it('não aplica nenhuma classe de animação (prefers-reduced-motion por construção)', () => {
      const { container } = render(<DisclaimerNote />);
      expect(container.innerHTML).not.toMatch(/animate-|transition/);
    });
  });
});

describe('<AppChrome> — persistência no chrome base (AC1/AC3)', () => {
  it('toda página envolvida pelo chrome exibe o disclaimer', () => {
    render(
      <AppChrome>
        <main>conteúdo de qualquer rota</main>
      </AppChrome>,
    );
    expect(screen.getByRole('note').textContent).toContain(DISCLAIMER_TEXT);
    expect(screen.getByText('conteúdo de qualquer rota')).toBeDefined();
  });

  it('o disclaimer vive num footer fixo — não é dispensável (sem botão de fechar)', () => {
    const { container } = render(
      <AppChrome>
        <main>conteúdo</main>
      </AppChrome>,
    );
    const footer = container.querySelector('footer');
    expect(footer).not.toBeNull();
    expect(footer!.className).toContain('fixed');
    expect(footer!.querySelector('button')).toBeNull();
  });
});
