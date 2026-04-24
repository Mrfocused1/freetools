"use client";

import { useState } from "react";
import { useToast, Toast } from "./Toast";

type Key = {
  id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

export function ApiKeysManager({ initial }: { initial: Key[] }) {
  const [keys, setKeys] = useState<Key[]>(initial);
  const [newName, setNewName] = useState("");
  const [justCreated, setJustCreated] = useState<{ key: string; id: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  async function refresh() {
    const r = await fetch("/api/api-keys");
    if (r.ok) {
      const { keys } = await r.json();
      setKeys(keys);
    }
  }

  async function create() {
    if (!newName.trim()) return;
    setLoading(true);
    try {
      const r = await fetch("/api/api-keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: "Create failed" }));
        toast.show(err.error ?? "Create failed", { tone: "error" });
        return;
      }
      const { key } = await r.json();
      setJustCreated({ key, id: key });
      setNewName("");
      await refresh();
    } finally {
      setLoading(false);
    }
  }

  async function revoke(id: string) {
    if (!confirm("Revoke this key? Apps using it will stop working.")) return;
    const r = await fetch(`/api/api-keys/${id}`, { method: "DELETE" });
    if (r.ok) await refresh();
    else toast.show("Revoke failed", { tone: "error" });
  }

  return (
    <div>
      {justCreated && (
        <div className="mb-6 rounded-2xl border border-[var(--color-accent)] bg-[var(--color-accent)]/10 p-5">
          <p className="text-sm font-medium">Your new API key — save it now</p>
          <p className="mt-1 text-xs text-[var(--color-muted)]">
            This is the only time you'll see the full key. Lose it and you'll need to create a new one.
          </p>
          <div className="mt-3 flex gap-2">
            <code className="flex-1 overflow-auto rounded-md bg-[var(--color-bg)] px-3 py-2 text-xs">
              {justCreated.key}
            </code>
            <button
              onClick={async () => {
                await navigator.clipboard.writeText(justCreated.key);
                toast.show("Key copied");
              }}
              className="rounded-md border border-[var(--color-border)] px-3 py-1 text-xs"
            >
              Copy
            </button>
            <button
              onClick={() => setJustCreated(null)}
              className="rounded-md border border-[var(--color-border)] px-3 py-1 text-xs"
            >
              Done
            </button>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <p className="text-sm font-medium">Create a new key</p>
        <div className="mt-3 flex gap-2">
          <input
            type="text"
            placeholder="e.g. Production server"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
          />
          <button
            onClick={create}
            disabled={loading || !newName.trim()}
            className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-60"
          >
            {loading ? "…" : "Create key"}
          </button>
        </div>
      </div>

      <div className="mt-6">
        <h2 className="text-sm font-medium">Existing keys</h2>
        {keys.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--color-muted)]">
            No keys yet. Create one above.
          </p>
        ) : (
          <div className="mt-3 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-bg)]/40 text-xs text-[var(--color-muted)]">
                <tr>
                  <th className="px-3 py-2 text-left">Name</th>
                  <th className="px-3 py-2 text-left">Key</th>
                  <th className="px-3 py-2 text-left">Last used</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id} className="border-t border-[var(--color-border)]">
                    <td className="px-3 py-2">{k.name}</td>
                    <td className="px-3 py-2 font-mono text-xs text-[var(--color-muted)]">{k.key_prefix}…</td>
                    <td className="px-3 py-2 text-xs text-[var(--color-muted)]">
                      {k.last_used_at ? new Date(k.last_used_at).toLocaleString() : "never"}
                    </td>
                    <td className="px-3 py-2">
                      {k.revoked_at ? (
                        <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-xs text-red-400">revoked</span>
                      ) : (
                        <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-400">active</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {!k.revoked_at && (
                        <button
                          onClick={() => revoke(k.id)}
                          className="text-xs text-[var(--color-muted)] hover:text-red-400"
                        >
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <Toast />
    </div>
  );
}
