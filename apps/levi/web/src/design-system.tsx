import type { ComponentProps, ReactNode } from "react";
import { Button as FoundationButton } from "@t00ls-dev/ui/components/button";
import { Input as FoundationInput } from "@t00ls-dev/ui/components/input";

// As primitivas Foundation continuam responsáveis pelos contratos nativos.
export function Button({
  className = "",
  variant = "primary",
  ...props
}: Omit<ComponentProps<typeof FoundationButton>, "variant"> & {
  variant?: "primary" | "secondary" | "text" | "danger";
}) {
  return (
    <FoundationButton
      {...props}
      variant={
        variant === "primary"
          ? "default"
          : variant === "secondary"
            ? "outline"
            : "ghost"
      }
      className={`levi-button ${variant} ${className}`}
    />
  );
}
export function Input({
  className = "",
  ...props
}: ComponentProps<typeof FoundationInput>) {
  return <FoundationInput {...props} className={`levi-input ${className}`} />;
}
export function Select({ className = "", ...props }: ComponentProps<"select">) {
  return <select {...props} className={`levi-input ${className}`} />;
}
export function Pill({
  tone = "neutral",
  children,
}: {
  tone?: "success" | "warning" | "danger" | "neutral" | "accent";
  children: ReactNode;
}) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}
export function Avatar({
  name,
  size = 40,
}: {
  name: string;
  size?: 34 | 40 | 44 | 60 | 76;
}) {
  const words = name.trim().split(/\s+/);
  const initials = [words[0]?.[0], words.length > 1 ? words.at(-1)?.[0] : ""]
    .join("")
    .toLocaleUpperCase("pt-BR");
  return (
    <span className={`avatar avatar-${size}`} aria-hidden="true">
      {initials}
    </span>
  );
}
export function Card({
  className = "",
  list = false,
  ...props
}: ComponentProps<"div"> & { list?: boolean }) {
  return (
    <div
      {...props}
      className={`surface card ${list ? "card-list" : ""} ${className}`}
    />
  );
}
export function ListRow({ className = "", ...props }: ComponentProps<"li">) {
  return <li {...props} className={`list-row ${className}`} />;
}
// Composição preserva radios, links e handlers do consumidor, sem estado paralelo.
export function SegmentedControl({
  className = "",
  ...props
}: ComponentProps<"div">) {
  return <div {...props} className={`segmented ${className}`} />;
}
export function FilterChip({ children, ...props }: ComponentProps<"label">) {
  return (
    <label {...props} className="filter-chip">
      {children}
    </label>
  );
}
export function PageHeader({
  className = "",
  ...props
}: ComponentProps<"header">) {
  return <header {...props} className={`topbar ${className}`} />;
}
export function TabBar({ className = "", ...props }: ComponentProps<"nav">) {
  return <nav {...props} className={`admin-nav ${className}`} />;
}
export function Fab({
  className = "",
  ...props
}: ComponentProps<typeof Button>) {
  return <Button {...props} className={`fab ${className}`} />;
}
export function FormFooter({
  className = "",
  ...props
}: ComponentProps<"div">) {
  return <div {...props} className={`form-actions ${className}`} />;
}
export function InfoRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="info-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
