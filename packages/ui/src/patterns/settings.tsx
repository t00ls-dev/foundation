import type { ReactNode } from "react";

export function SettingSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="grid min-w-0 gap-0 rounded-lg border border-border bg-card text-card-foreground"
    >
      <h2 className="m-0 border-b border-border px-5 py-4 text-lg font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}
export function SettingRow({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="grid min-w-0 gap-4 border-b border-border p-5 last:border-b-0">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="m-0 text-base font-semibold">{title}</h3>
          <div className="mt-1 text-sm text-muted-foreground [overflow-wrap:anywhere]">
            {description}
          </div>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}
export function SettingFlow({ children }: { children: ReactNode }) {
  return <div className="grid gap-4">{children}</div>;
}
