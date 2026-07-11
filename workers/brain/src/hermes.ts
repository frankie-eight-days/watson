/**
 * hermes.ts — the Hermes Durable Object (SKELETON milestone).
 *
 * One instance per engagement (keyed by engagement id via the DO name). Exposes
 * the Bench WebSocket chat protocol. This milestone acks/echoes so we can prove
 * the deploy path + DO wiring live on Cloudflare; the real terra chat loop and
 * COMMENCE → toy-workflow handoff land in the next milestone.
 *
 * Bench WS protocol:
 *   inbound : { type: 'user', text } | { type: 'commence', repoUrl }
 *   outbound: { type: 'hermes', text } | { type: 'status', phase|status, ... }
 */

import { Agent, type Connection, type ConnectionContext, type WSMessage } from 'agents';
import './lib/env';

export interface HermesState {
  engagementId: string;
  repoUrl?: string;
  phase: 'bench' | 'ingestion' | 'library' | 'lab' | 'conference' | 'done';
  hermesSpawned: boolean;
}

export class HermesAgent extends Agent<Env, HermesState> {
  initialState: HermesState = {
    engagementId: '',
    phase: 'bench',
    hermesSpawned: false,
  };

  override onConnect(connection: Connection, _ctx: ConnectionContext): void {
    if (!this.state.engagementId) {
      this.setState({ ...this.state, engagementId: this.name });
    }
    this.sendHermes(
      connection,
      `Hermes online for engagement "${this.name}". Tell me the repo and what you want moved, then say COMMENCE.`,
    );
  }

  override async onMessage(connection: Connection, message: WSMessage): Promise<void> {
    const msg = this.parse(message);
    if (!msg) {
      this.sendHermes(connection, 'Could not parse that message.');
      return;
    }

    if (msg.type === 'commence') {
      const repoUrl = typeof msg.repoUrl === 'string' ? msg.repoUrl : this.state.repoUrl;
      this.setState({ ...this.state, repoUrl, phase: 'ingestion' });
      connection.send(JSON.stringify({ type: 'status', phase: 'ingestion', repoUrl }));
      this.sendHermes(connection, `(skeleton) COMMENCE received for ${repoUrl ?? 'unknown repo'}.`);
      return;
    }

    if (msg.type === 'user') {
      const text = typeof msg.text === 'string' ? msg.text : '';
      // Skeleton: echo/ack. Real terra loop lands in the next milestone.
      this.sendHermes(connection, `(skeleton) Received: "${text}".`);
      return;
    }

    this.sendHermes(connection, `(skeleton) Unhandled message type "${String(msg.type)}".`);
  }

  /** HTTP-triggered COMMENCE (native DO RPC from the Worker entry). */
  async commence(repoUrl?: string): Promise<{ phase: string; repoUrl?: string }> {
    const nextRepo = repoUrl ?? this.state.repoUrl;
    this.setState({ ...this.state, repoUrl: nextRepo, phase: 'ingestion' });
    // Skeleton: no workflow yet. Broadcast a status to any bench clients.
    this.broadcast(JSON.stringify({ type: 'status', phase: 'ingestion', repoUrl: nextRepo }));
    return { phase: 'ingestion', repoUrl: nextRepo };
  }

  private parse(message: WSMessage): Record<string, unknown> | null {
    if (typeof message !== 'string') return null;
    try {
      const v = JSON.parse(message);
      return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
    } catch {
      // Treat a bare string as a user turn.
      return { type: 'user', text: message };
    }
  }

  private sendHermes(connection: Connection, text: string): void {
    connection.send(JSON.stringify({ type: 'hermes', text }));
  }
}
