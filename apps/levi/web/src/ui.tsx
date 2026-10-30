import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";

export type IconName =
  | "home"
  | "people"
  | "church"
  | "arrow"
  | "plus"
  | "more"
  | "swap"
  | "logout"
  | "lock"
  | "chevron";
export function Icon({ name }: { name: IconName }) {
  const paths = {
    home: "m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z",
    people:
      "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
    church: "M4 21V7l8-4 8 4v14M2 21h20M9 21v-5h6v5M8 8h1m6 0h1m-8 4h1m6 0h1",
    arrow: "M5 12h14m-5-5 5 5-5 5",
    plus: "M12 5v14M5 12h14",
    more: "M6.5 12a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm7 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm7 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z",
    swap: "m16 3 4 4-4 4m4-4H4m4 14-4-4 4-4m-4 4h16",
    logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14 5-5-5-5m5 5H9",
    lock: "M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4",
    chevron: "m9 6 6 6-6 6",
  };
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
// Links mantêm abertura em outra aba; a navegação corrente passa pela guarda de rascunho.
export function NavigationLink({
  href,
  navigate,
  disabled = false,
  children,
  className,
  ...attributes
}: Omit<ComponentProps<"a">, "href" | "onClick"> & {
  href: string;
  navigate: (path: string) => void;
  disabled?: boolean;
}) {
  return (
    <a
      {...attributes}
      href={href}
      className={`button-link ${className ?? ""}`}
      aria-disabled={disabled || undefined}
      onClick={(event) => {
        if (disabled) {
          event.preventDefault();
          return;
        }
        if (
          event.defaultPrevented ||
          (attributes.target && attributes.target !== "_self") ||
          attributes.download !== undefined ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        event.preventDefault();
        navigate(href);
      }}
    >
      {children}
    </a>
  );
}
export function EmptyState({
  title,
  children,
  icon = "people",
}: {
  title: string;
  children?: ReactNode;
  icon?: IconName;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon name={icon} />
      </span>
      <h2>{title}</h2>
      {children}
    </div>
  );
}
// Tom estável por identificador: facilita a leitura da lista sem fotos.
export function avatarTone(id: string) {
  let sum = 0;
  for (const char of id) sum = (sum + char.charCodeAt(0)) % 997;
  return `tone-${(sum % 5) + 1}`;
}
export function Status({ value }: { value: string }) {
  return (
    <span className={`badge ${value === "Ativo" ? "active" : "inactive"}`}>
      <span aria-hidden="true" />
      {value}
    </span>
  );
}
// Guarda apenas memória. Não persiste dados pessoais ou segredos no navegador.
export function useDraftGuard() {
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, []);
  return {
    dirty,
    change: () => {
      dirtyRef.current = true;
      setDirty(true);
    },
  };
}

// Mantém o controle focado na área útil, inclusive quando o viewport visual
// diminui com o teclado. Não intercepta teclas nem muda o foco do usuário.
export function useFormFocusVisibility() {
  useEffect(() => {
    let frame = 0;
    const reveal = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const target = document.activeElement;
        if (!(target instanceof HTMLElement) || !target.closest("form")) return;
        const viewport = window.visualViewport;
        const viewportTop = viewport?.offsetTop ?? 0;
        let top = viewportTop + 12;
        const bottom =
          viewportTop + (viewport?.height ?? window.innerHeight) - 12;
        const header = document
          .querySelector(".topbar")
          ?.getBoundingClientRect();
        if (header && header.bottom > top && header.bottom < bottom)
          top = header.bottom + 12;
        const rect = target.getBoundingClientRect();
        let visibleBottom = bottom;
        // Barras fixas ou aderentes que não contêm o controle reduzem a área útil.
        for (const element of document.querySelectorAll(
          ".sidebar, .form-actions",
        )) {
          if (!(element instanceof HTMLElement) || element.contains(target))
            continue;
          const style = getComputedStyle(element);
          if (
            !["fixed", "sticky"].includes(style.position) ||
            style.visibility === "hidden"
          )
            continue;
          const bounds = element.getBoundingClientRect();
          if (bounds.right <= rect.left || bounds.left >= rect.right) continue;
          if (bounds.top < top && bounds.bottom < bottom)
            top = Math.max(top, bounds.bottom + 12);
          else if (bounds.top > top && bounds.top < visibleBottom)
            visibleBottom = bounds.top - 12;
        }
        if (rect.bottom > visibleBottom)
          window.scrollBy(0, rect.bottom - visibleBottom);
        else if (rect.top < top) window.scrollBy(0, rect.top - top);
      });
    };
    document.addEventListener("focusin", reveal);
    window.addEventListener("resize", reveal);
    window.visualViewport?.addEventListener("resize", reveal);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("focusin", reveal);
      window.removeEventListener("resize", reveal);
      window.visualViewport?.removeEventListener("resize", reveal);
    };
  }, []);
}
