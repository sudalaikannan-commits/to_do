import type { ReactNode } from "react";
import { statusColor, priorityColor, prettyEnum } from "../lib/utils";

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${statusColor(status)}`}>{prettyEnum(status)}</span>;
}

export function PriorityBadge({ priority }: { priority: string }) {
  return <span className={`badge ${priorityColor(priority)}`}>{prettyEnum(priority)}</span>;
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="card p-10 text-center">
      <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-ationic-yellow text-xl font-extrabold text-black">
        A
      </div>
      <h3 className="font-semibold text-neutral-900">{title}</h3>
      {hint && <p className="mt-1 text-sm text-neutral-500">{hint}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />;
}

export function SkeletonList({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="card p-4">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="mt-2 h-3 w-2/3" />
        </div>
      ))}
    </div>
  );
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full max-w-lg rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl max-h-[92vh] overflow-y-auto">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold">{title}</h2>
          <button onClick={onClose} className="btn-ghost !px-3 !py-1.5" aria-label="Close dialog">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Confirm({ open, onClose, onConfirm, title, body }: { open: boolean; onClose: () => void; onConfirm: () => void; title: string; body: string }) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <p className="text-sm text-neutral-600">{body}</p>
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="inline-flex items-center rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700" onClick={onConfirm}>
          Delete
        </button>
      </div>
    </Modal>
  );
}

export function Field({ label, children, htmlFor }: { label: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>{label}</label>
      {children}
    </div>
  );
}
