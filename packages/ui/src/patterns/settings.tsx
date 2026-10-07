import type { ReactNode } from "react";

export function SettingSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="grid min-w-0 gap-4 text-foreground">
      <h2 className="m-0 text-lg font-semibold">{title}</h2>
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
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="grid min-w-0 gap-3 border-b border-border py-4 last:border-b-0">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="m-0 text-base font-semibold">{title}</h3>
          {description ? (
            <div className="mt-1 text-sm text-muted-foreground [overflow-wrap:anywhere]">
              {description}
            </div>
          ) : null}
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
