/**
 * Shared draft-autosave hook used by wizard pages (camps, drop-ins, etc.)
 *
 * Responsibilities:
 *  - Debounced localStorage save (500ms) on every state change
 *  - Debounced remote draft save (3s) via POST /…/drafts or PATCH /…/drafts/:id
 *  - Remote draft restore on mount (if a draftId was stored from a previous session)
 *  - clearDraft(): removes both localStorage keys and the draftId ref
 *  - publishedRef: set to `true` to prevent any autosave from firing after publish
 */

import { useState, useEffect, useRef, useCallback, MutableRefObject } from "react";

interface Options<T> {
  localStorageKey: string;
  draftIdKey: string;
  remoteDraftBaseUrl: string;
  state: T;
  getHeaders: () => Promise<Record<string, string>>;
  /** Enable both localStorage and remote draft saves (default: true). */
  enabled?: boolean;
  /** Independently disable only the remote draft save (default: true). */
  enableRemoteSave?: boolean;
}

interface Result<T> {
  restoredFromDraft: boolean;
  setRestoredFromDraft: (v: boolean) => void;
  clearDraft: () => void;
  publishedRef: MutableRefObject<boolean>;
  remoteRestoreState: T | null;
}

export function useDraftAutosave<T>({
  localStorageKey,
  draftIdKey,
  remoteDraftBaseUrl,
  state,
  getHeaders,
  enabled = true,
  enableRemoteSave = true,
}: Options<T>): Result<T> {
  const [restoredFromDraft, setRestoredFromDraft] = useState(false);
  const [remoteRestoreState, setRemoteRestoreState] = useState<T | null>(null);

  const publishedRef = useRef(false);
  const draftIdRef = useRef<string | null>(null);
  const savingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  // On mount: pick up any stored draft id and restore remote state
  useEffect(() => {
    try {
      if (localStorage.getItem(localStorageKey)) setRestoredFromDraft(true);
      const storedId = localStorage.getItem(draftIdKey);
      if (storedId) {
        draftIdRef.current = storedId;
        // Try to restore from remote (best-effort; falls back to localStorage state)
        getHeaders().then(headers =>
          fetch(`${remoteDraftBaseUrl}/${storedId}`, { headers })
            .then(r => r.ok ? r.json() : null)
            .then(data => {
              if (data?.data) {
                setRemoteRestoreState(data.data as T);
                setRestoredFromDraft(true);
              }
            })
            .catch(() => {})
        );
      }
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced localStorage save
  useEffect(() => {
    if (!enabled || publishedRef.current) return;
    const timer = setTimeout(() => {
      try { localStorage.setItem(localStorageKey, JSON.stringify(state)); } catch {}
    }, 500);
    return () => clearTimeout(timer);
  }, [state, localStorageKey, enabled]);

  // Debounced remote draft save
  useEffect(() => {
    if (!enabled || !enableRemoteSave || publishedRef.current) return;
    const stateWithName = state as any;
    if (!stateWithName?.name?.trim?.()) return;

    const timer = setTimeout(async () => {
      if (publishedRef.current || savingRef.current) return;
      savingRef.current = true;
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const headers = await getHeaders();
        if (publishedRef.current) return;

        if (draftIdRef.current) {
          await fetch(`${remoteDraftBaseUrl}/${draftIdRef.current}`, {
            method: "PATCH",
            headers,
            body: JSON.stringify(state),
            signal: controller.signal,
          });
        } else {
          const r = await fetch(remoteDraftBaseUrl, {
            method: "POST",
            headers,
            body: JSON.stringify(state),
            signal: controller.signal,
          });
          if (r.ok) {
            const data = await r.json();
            draftIdRef.current = data.id;
            try { localStorage.setItem(draftIdKey, String(data.id)); } catch {}
          }
        }
      } catch (e: any) {
        if (e?.name !== "AbortError") { /* best-effort — ignore */ }
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        savingRef.current = false;
      }
    }, 3000);

    return () => clearTimeout(timer);
  }, [state, remoteDraftBaseUrl, draftIdKey, getHeaders, enabled]);

  const clearDraft = useCallback(() => {
    try {
      localStorage.removeItem(localStorageKey);
      localStorage.removeItem(draftIdKey);
    } catch {}
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    draftIdRef.current = null;
    setRestoredFromDraft(false);
    setRemoteRestoreState(null);
  }, [localStorageKey, draftIdKey]);

  return { restoredFromDraft, setRestoredFromDraft, clearDraft, publishedRef, remoteRestoreState };
}
