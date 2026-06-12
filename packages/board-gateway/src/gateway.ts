import { WebSocketServer, WebSocket } from 'ws';
import type { Server as HttpServer } from 'node:http';
import type { SqlExecutor } from '@nutrimed/db';
import { validateSession } from '@nutrimed/auth';
import type { BoardContributionEvent } from '@nutrimed/board';

/** Fonte de eventos do board (3.1 BoardOrchestrator ou E6 FullBoardOrchestrator). */
export interface BoardEventSource {
  subscribe(listener: (event: BoardContributionEvent) => void): () => void;
}
import {
  BOARD_PROTOCOL_VERSION,
  type BoardServerMessage,
} from '@nutrimed/shared-types';

/**
 * WebSocket Gateway do board (Story 3.2 — ADR-003).
 *
 * Canal de EVENTOS do board, servidor→cliente: contribuições do orchestrator
 * (3.1) chegam ao navegador em tempo real. O áudio NUNCA passa por aqui
 * (architecture §7 — vai pelo SDK do provider de STT).
 *
 * Auth: o cliente conecta em `/board?consultationId=X&token=Y` com o token de
 * sessão (Story 1.2). Token inválido/expirado ou consulta inexistente/de outro
 * usuário ⇒ close 4401/4403 — o gateway nunca entrega eventos sem autorização.
 *
 * Runtime: servidor Node long-lived (`ws`) — coerente com ADR-005 (sessão
 * stateful); a decisão formal de runtime é a Story 3.5.
 */

export interface BoardGatewayOptions {
  /** Porta própria OU server HTTP existente (upgrade). */
  readonly port?: number;
  readonly server?: HttpServer;
  readonly heartbeatMs?: number;
  readonly now?: () => number;
}

export class BoardGateway {
  private readonly wss: WebSocketServer;
  private readonly clients = new Map<string, Set<WebSocket>>();
  private readonly unbinders = new Map<string, () => void>();
  private readonly heartbeat: ReturnType<typeof setInterval>;
  private readonly now: () => number;

  constructor(
    private readonly db: SqlExecutor,
    opts: BoardGatewayOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.wss = opts.server
      ? new WebSocketServer({ server: opts.server, path: '/board' })
      : new WebSocketServer({ port: opts.port ?? 0, path: '/board' });

    this.wss.on('connection', (socket, request) => {
      void this.onConnection(socket, request.url ?? '');
    });

    // heartbeat (ADR-003): detecta conexões mortas sem derrubar a sessão
    this.heartbeat = setInterval(() => this.pingAll(), opts.heartbeatMs ?? 30_000);
    this.heartbeat.unref?.();
  }

  /** Porta efetiva (útil quando port=0 em teste). */
  get port(): number {
    const address = this.wss.address();
    return typeof address === 'object' && address ? address.port : 0;
  }

  /**
   * Conecta um orchestrator (3.1) ao canal da consulta: toda contribuição
   * publicada vira mensagem `contribution` para os clientes conectados.
   */
  bind(consultationId: string, orchestrator: BoardEventSource): void {
    this.unbinders.get(consultationId)?.();
    const unbind = orchestrator.subscribe((event) => this.broadcast(event));
    this.unbinders.set(consultationId, unbind);
  }

  async close(): Promise<void> {
    clearInterval(this.heartbeat);
    for (const unbind of this.unbinders.values()) unbind();
    this.unbinders.clear();
    for (const sockets of this.clients.values()) {
      for (const socket of sockets) socket.close(1001, 'gateway closing');
    }
    this.clients.clear();
    await new Promise<void>((resolve, reject) =>
      this.wss.close((err) => (err ? reject(err) : resolve())),
    );
  }

  /** Transcrição ao vivo p/ o TranscriptPanel (E7) — texto, nunca áudio (§7). */
  broadcastTranscript(consultationId: string, text: string, isFinal: boolean): void {
    const payload = JSON.stringify({
      v: BOARD_PROTOCOL_VERSION,
      type: 'transcript',
      text,
      isFinal,
      at: this.now(),
    } satisfies BoardServerMessage);
    for (const socket of this.clients.get(consultationId) ?? []) {
      if (socket.readyState === WebSocket.OPEN) socket.send(payload);
    }
  }

  private async onConnection(socket: WebSocket, url: string): Promise<void> {
    const params = new URL(url, 'http://localhost').searchParams;
    const consultationId = params.get('consultationId');
    const token = params.get('token');

    if (!consultationId || !token) {
      socket.close(4400, 'consultationId e token são obrigatórios');
      return;
    }
    const session = await validateSession(this.db, token);
    if (!session) {
      socket.close(4401, 'sessão inválida ou expirada');
      return;
    }
    // a consulta precisa existir e pertencer ao usuário autenticado
    const res = await this.db.query<{ id: string }>(
      'SELECT id FROM consultation WHERE id = $1 AND user_id = $2',
      [consultationId, session.userId],
    );
    if (res.rows.length === 0) {
      socket.close(4403, 'consulta não encontrada para este usuário');
      return;
    }

    const set = this.clients.get(consultationId) ?? new Set<WebSocket>();
    set.add(socket);
    this.clients.set(consultationId, set);
    socket.on('close', () => {
      set.delete(socket);
    });
  }

  private broadcast(event: BoardContributionEvent): void {
    const message: BoardServerMessage = {
      v: BOARD_PROTOCOL_VERSION,
      type: 'contribution',
      id: event.id,
      consultationId: event.consultationId,
      triggeredBy: event.triggeredBy,
      at: event.at,
      contribution: {
        personaId: event.contribution.personaId,
        type: event.contribution.type,
        severity: event.contribution.severity,
        text: event.contribution.text,
        relevanceScore: event.contribution.relevanceScore,
      },
      personaIds: (event as { personaIds?: readonly string[] }).personaIds,
      divergent: (event as { divergent?: boolean }).divergent,
    };
    const payload = JSON.stringify(message);
    for (const socket of this.clients.get(event.consultationId) ?? []) {
      if (socket.readyState === WebSocket.OPEN) socket.send(payload);
    }
  }

  private pingAll(): void {
    const payload = JSON.stringify({
      v: BOARD_PROTOCOL_VERSION,
      type: 'ping',
      at: this.now(),
    } satisfies BoardServerMessage);
    for (const sockets of this.clients.values()) {
      for (const socket of sockets) {
        if (socket.readyState === WebSocket.OPEN) socket.send(payload);
      }
    }
  }
}
