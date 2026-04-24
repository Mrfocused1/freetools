"use client";

import { useCallback, useRef, useState } from "react";
import JSZip from "jszip";
import { Toast, useToast } from "./Toast";

type ItemStatus = "pending" | "uploading" | "queued" | "processing" | "succeeded" | "failed";

type BatchItem = {
  id: string;       // client-local id
  file: File;
  status: ItemStatus;
  jobId?: string;
  outputUrl?: string;
  error?: string;
};

type Tool = "bg-remove" | "upscale";

type Props = {
  tool: Tool;
  maxFiles: number;
  // When the backend needs extra options (scale, hairMode, etc.), pass them.
  extraOptions?: Record<string, unknown>;
};

export function BatchUpload({ tool, maxFiles, extraOptions }: Props) {
  const [items, setItems] = useState<BatchItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [zipping, setZipping] = useState(false);
  const toast = useToast();
  const cancelRef = useRef(false);

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const arr = Array.from(files);
      if (items.length + arr.length > maxFiles) {
        toast.show(`Your plan allows up to ${maxFiles} files at a time`, { tone: "error" });
        return;
      }
      const newItems: BatchItem[] = arr
        .filter((f) => ["image/jpeg", "image/png", "image/webp"].includes(f.type))
        .filter((f) => f.size <= 20 * 1024 * 1024)
        .map((f, i) => ({
          id: `${Date.now()}-${i}-${f.name}`,
          file: f,
          status: "pending",
        }));
      setItems((cur) => [...cur, ...newItems]);
    },
    [items.length, maxFiles, toast]
  );

  async function run() {
    if (processing) return;
    setProcessing(true);
    cancelRef.current = false;

    // Sequential: one at a time. Easier on the CPU worker.
    for (let i = 0; i < items.length; i++) {
      if (cancelRef.current) break;
      const it = items[i];
      if (it.status === "succeeded" || it.status === "processing" || it.status === "queued" || it.status === "uploading") continue;

      try {
        update(it.id, { status: "uploading" });
        const initBody: Record<string, unknown> = {
          fileName: it.file.name,
          contentType: it.file.type,
          sizeBytes: it.file.size,
          tool,
          ...(extraOptions ?? {}),
        };
        const initRes = await fetch("/api/jobs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(initBody),
        });
        if (!initRes.ok) {
          const err = await initRes.json().catch(() => ({ error: "Upload failed" }));
          throw new Error(err.error ?? `HTTP ${initRes.status}`);
        }
        const { jobId, uploadUrl, inputPath } = await initRes.json();
        update(it.id, { jobId });

        const put = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "content-type": it.file.type },
          body: it.file,
        });
        if (!put.ok) throw new Error(`Upload failed (${put.status})`);

        const enq = await fetch(`/api/jobs/${jobId}/start`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ inputPath }),
        });
        if (!enq.ok) throw new Error("Enqueue failed");

        update(it.id, { status: "queued" });

        const outputUrl = await waitForJob(jobId, (status) => update(it.id, { status }));
        update(it.id, { status: "succeeded", outputUrl });
      } catch (e) {
        update(it.id, { status: "failed", error: e instanceof Error ? e.message : "Unknown error" });
      }
    }

    setProcessing(false);
  }

  function update(id: string, patch: Partial<BatchItem>) {
    setItems((cur) => cur.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  function remove(id: string) {
    setItems((cur) => cur.filter((it) => it.id !== id));
  }

  async function downloadZip() {
    const done = items.filter((it) => it.status === "succeeded" && it.outputUrl);
    if (done.length === 0) return;
    setZipping(true);
    try {
      const zip = new JSZip();
      await Promise.all(
        done.map(async (it) => {
          const res = await fetch(it.outputUrl!);
          const blob = await res.blob();
          const baseName = it.file.name.replace(/\.[^.]+$/, "");
          const extName = tool === "upscale" ? "upscaled.png" : "cutout.png";
          zip.file(`${baseName}-${extName}`, blob);
        })
      );
      const out = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(out);
      const a = document.createElement("a");
      a.href = url;
      a.download = `quickfix-batch-${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Zip failed", { tone: "error" });
    } finally {
      setZipping(false);
    }
  }

  const doneCount = items.filter((it) => it.status === "succeeded").length;

  return (
    <div>
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
        }}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-8 py-10 text-center transition ${
          dragging
            ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10"
            : "border-[var(--color-border)] hover:border-[var(--color-accent)]"
        }`}
      >
        <p className="text-lg font-medium">Drop images here — up to {maxFiles} at a time</p>
        <p className="mt-1 text-sm text-[var(--color-muted)]">JPG, PNG, or WebP up to 20 MB each</p>
        <input
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
          }}
        />
      </label>

      {items.length > 0 && (
        <>
          <div className="mt-4 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-bg)]/40 text-xs text-[var(--color-muted)]">
                <tr>
                  <th className="px-3 py-2 text-left">File</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id} className="border-t border-[var(--color-border)]">
                    <td className="truncate px-3 py-2">{it.file.name}</td>
                    <td className="px-3 py-2">
                      <StatusBadge status={it.status} error={it.error} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      {it.outputUrl && (
                        <a
                          href={it.outputUrl}
                          download={`${it.file.name.replace(/\.[^.]+$/, "")}-cutout.png`}
                          className="text-xs text-[var(--color-accent)] hover:underline"
                        >
                          download
                        </a>
                      )}
                      {!it.outputUrl && it.status !== "processing" && it.status !== "queued" && (
                        <button
                          onClick={() => remove(it.id)}
                          className="text-xs text-[var(--color-muted)] hover:text-red-400"
                          aria-label="Remove"
                        >
                          ×
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              onClick={run}
              disabled={processing || items.every((i) => i.status === "succeeded")}
              className="flex-1 min-w-[180px] rounded-md bg-[var(--color-accent)] px-4 py-2.5 font-medium text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-60"
            >
              {processing
                ? `Processing ${items.filter((i) => i.status === "processing" || i.status === "queued" || i.status === "uploading").length || "…"} / ${items.length}`
                : doneCount === items.length
                  ? "All done"
                  : `Process ${items.filter((i) => i.status === "pending" || i.status === "failed").length} images`}
            </button>
            {doneCount > 0 && (
              <button
                onClick={downloadZip}
                disabled={zipping}
                className="rounded-md border border-[var(--color-border)] px-4 py-2.5 text-sm hover:border-[var(--color-accent)]"
              >
                {zipping ? "Zipping…" : `Download ${doneCount} as ZIP`}
              </button>
            )}
            {processing && (
              <button
                onClick={() => {
                  cancelRef.current = true;
                }}
                className="rounded-md border border-[var(--color-border)] px-4 py-2.5 text-sm"
              >
                Cancel queue
              </button>
            )}
            <button
              onClick={() => setItems([])}
              disabled={processing}
              className="rounded-md border border-[var(--color-border)] px-4 py-2.5 text-sm disabled:opacity-50"
            >
              Clear
            </button>
          </div>
        </>
      )}
      <Toast />
    </div>
  );
}

function StatusBadge({ status, error }: { status: ItemStatus; error?: string }) {
  const map: Record<ItemStatus, string> = {
    pending: "bg-[var(--color-border)] text-[var(--color-muted)]",
    uploading: "bg-sky-500/15 text-sky-500",
    queued: "bg-sky-500/15 text-sky-500",
    processing: "bg-amber-500/15 text-amber-500",
    succeeded: "bg-emerald-500/15 text-emerald-500",
    failed: "bg-red-500/15 text-red-500",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs ${map[status]}`} title={error ?? undefined}>
      {status}
    </span>
  );
}

async function waitForJob(jobId: string, onStatus: (s: ItemStatus) => void): Promise<string> {
  const started = Date.now();
  const timeout = 15 * 60 * 1000;
  while (Date.now() - started < timeout) {
    await new Promise((r) => setTimeout(r, 2000));
    const res = await fetch(`/api/jobs/${jobId}`);
    if (!res.ok) continue;
    const data = (await res.json()) as { status: string; outputUrl?: string; error?: string };
    if (data.status === "processing") onStatus("processing");
    if (data.status === "succeeded" && data.outputUrl) return data.outputUrl;
    if (data.status === "failed") throw new Error(data.error ?? "Processing failed");
  }
  throw new Error("Timed out waiting for result");
}
