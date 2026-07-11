/**
 * useBenchSocket — the Bench live control channel to Hermes (Tab B's brain DO).
 *
 * Connects to `${BRAIN_WS_BASE}/engagements/:id/bench` (WebSocket upgrade) and
 * speaks the brain's protocol:
 *   Inbound:  { type:'hermes', text } · { type:'status', phase } ·
 *             { type:'cf_agent_state', state } (Agents SDK state sync; carries
 *             the conversationally-scoped repoUrl / ready flag)  (others ignored)
 *   Outbound: { type:'user', text }   · { type:'commence', repoUrl }
 *
 * This is a management/steering surface, NOT the replay render path — every
 * agent step still lands in the events table and renders there. If the socket is
 * down we degrade: status reflects it and COMMENCE falls back to the HTTP POST
 * trigger (`POST /engagements/:id/commence`).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { BRAIN_WS_BASE, BRAIN_HTTP_BASE } from './config';

export type BenchStatus = 'connecting' | 'open' | 'closed' | 'error';

export interface BenchMessage {
  id: string;
  role: 'hermes' | 'user' | 'system';
  text: string;
  ts: number;
}

const MAX_RETRIES = 4;

/** Conversationally-scoped agent state synced from the brain over the socket. */
export interface BenchAgentState {
  repoUrl?: string;
  ready?: boolean;
  [k: string]: unknown;
}

export function useBenchSocket(engagementId: string) {
  const [status, setStatus] = useState<BenchStatus>('connecting');
  const [messages, setMessages] = useState<BenchMessage[]>([]);
  const [agentState, setAgentState] = useState<BenchAgentState | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  const closedByUs = useRef(false);

  const push = useCallback((m: Omit<BenchMessage, 'id' | 'ts'> & { ts?: number }) => {
    setMessages((prev) => [
      ...prev,
      { id: `bm_${prev.length}_${Date.now()}`, ts: m.ts ?? Date.now(), role: m.role, text: m.text },
    ]);
  }, []);

  useEffect(() => {
    closedByUs.current = false;
    retryRef.current = 0;
    setAgentState(null);
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      setStatus('connecting');
      let ws: WebSocket;
      try {
        ws = new WebSocket(`${BRAIN_WS_BASE}/engagements/${engagementId}/bench`);
      } catch {
        setStatus('error');
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        retryRef.current = 0;
        setStatus('open');
      };
      ws.onmessage = (ev) => {
        let msg: unknown;
        try {
          msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
        } catch {
          return;
        }
        if (!msg || typeof msg !== 'object') return;
        const m = msg as { type?: string; text?: string; phase?: string; state?: BenchAgentState };
        if (m.type === 'hermes' && m.text) push({ role: 'hermes', text: m.text });
        else if (m.type === 'status' && m.phase) push({ role: 'system', text: `Phase → ${m.phase}` });
        else if (m.type === 'cf_agent_state' && m.state && typeof m.state === 'object')
          setAgentState((prev) => ({ ...(prev ?? {}), ...m.state }));
        // other cf_agent_* and unknown frames are ignored per the protocol.
      };
      ws.onerror = () => setStatus('error');
      ws.onclose = () => {
        if (closedByUs.current) return;
        setStatus('closed');
        if (retryRef.current < MAX_RETRIES) {
          const delay = 600 * 2 ** retryRef.current;
          retryRef.current += 1;
          retryTimer = setTimeout(connect, delay);
        }
      };
    };

    connect();
    return () => {
      closedByUs.current = true;
      if (retryTimer) clearTimeout(retryTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [engagementId, push]);

  const sendUser = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      push({ role: 'user', text: trimmed });
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'user', text: trimmed }));
      } else {
        push({ role: 'system', text: 'Not connected — message not delivered.' });
      }
    },
    [push],
  );

  const commence = useCallback(
    async (repoUrl: string) => {
      const url = repoUrl.trim();
      // Empty is allowed only when the brain already scoped the repo into state;
      // it then commences off state.repoUrl. Otherwise the caller gates on canCommence.
      push({ role: 'user', text: `COMMENCE RESEARCH${url ? ` · ${url}` : ''}` });
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'commence', repoUrl: url }));
        return;
      }
      // Degrade to the HTTP trigger when the socket is unavailable.
      try {
        const res = await fetch(`${BRAIN_HTTP_BASE}/engagements/${engagementId}/commence`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ repoUrl: url }),
        });
        push({
          role: 'system',
          text: res.ok ? 'Engagement kicked off via HTTP.' : `Kickoff failed (${res.status}).`,
        });
      } catch {
        push({ role: 'system', text: 'Brain unreachable — could not start the engagement.' });
      }
    },
    [engagementId, push],
  );

  return { status, messages, agentState, sendUser, commence };
}
