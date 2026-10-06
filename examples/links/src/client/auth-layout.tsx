import type { ReactNode } from "react";

// Presentation only; callers own routes, authentication and result semantics.
export function AuthLayout({
  title,
  children,
  footer,
  result = false,
  success = false,
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  result?: boolean;
  success?: boolean;
}) {
  return (
    <section
      className={`auth-page auth-layout${result ? " auth-result" : ""}`}
      aria-label="Authentication"
    >
      <div className="cross-page-intro" role={success ? "status" : undefined}>
        <h1 className={success ? "text-primary" : undefined}>{title}</h1>
      </div>
      {children}
      {footer}
    </section>
  );
}

export function AuthResult({
  title,
  children,
  action,
  success = false,
}: {
  title: string;
  children?: ReactNode;
  action: ReactNode;
  success?: boolean;
}) {
  return (
    <AuthLayout title={title} result success={success}>
      {children}
      {action}
    </AuthLayout>
  );
}
