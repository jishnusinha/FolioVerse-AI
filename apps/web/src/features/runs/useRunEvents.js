import { useEffect, useReducer, useRef } from 'react';
import { readEventStream } from '@/api/client.js';
import { initialRunState, isFinalEvent, reduceRunEvent } from './runState.js';

const MAX_BACKOFF_MS = 8000;

function reducer(state, action) {
  if (action.type === 'reset') return initialRunState(action.seed);
  if (action.type === 'error') return { ...state, streamError: action.error };
  return reduceRunEvent(state, action.env);
}

function sleep(ms, signal) {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    });
  });
}

/**
 * Live state of one run from `GET /workspaces/:wid/runs/:runId/events`. Reconnects with the last seen
 * event id (no duplicate tokens) until a final event arrives. A run that is already terminal replays
 * its recorded events and stops.
 * @param {string | undefined} wid
 * @param {string | undefined} runId
 * @param {{ enabled?: boolean, onFinished?: (state: any) => void }} [opts]
 */
export function useRunEvents(wid, runId, opts = {}) {
  const enabled = opts.enabled ?? true;
  const [state, dispatch] = useReducer(reducer, undefined, () => initialRunState());
  const onFinished = useRef(opts.onFinished);
  onFinished.current = opts.onFinished;

  useEffect(() => {
    if (!wid || !runId || !enabled) return undefined;
    dispatch({ type: 'reset' });
    const ac = new AbortController();
    let last;
    let finished = false;
    let latest = initialRunState();
    (async () => {
      let attempt = 0;
      while (!ac.signal.aborted && !finished) {
        try {
          await readEventStream(`/workspaces/${wid}/runs/${runId}/events`, {
            lastEventId: last,
            signal: ac.signal,
            onEvent: (raw) => {
              let env;
              try {
                env = JSON.parse(raw.data);
              } catch {
                return;
              }
              env.id = raw.id ?? env.id;
              if (env.id) last = env.id;
              latest = reduceRunEvent(latest, env);
              dispatch({ type: 'event', env });
              if (isFinalEvent(env)) finished = true;
            },
          });
          attempt = 0;
        } catch (e) {
          if (ac.signal.aborted) return;
          if (e?.status === 404 || e?.status === 403) {
            dispatch({ type: 'error', error: e });
            return;
          }
          attempt += 1;
        }
        if (finished) break;
        await sleep(Math.min(500 * 2 ** attempt, MAX_BACKOFF_MS), ac.signal);
      }
      if (finished && !ac.signal.aborted) onFinished.current?.(latest);
    })();
    return () => ac.abort();
  }, [wid, runId, enabled]);

  return state;
}
