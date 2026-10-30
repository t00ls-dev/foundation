import { useEffect, useRef, type ReactNode } from "react";
import { Icon, NavigationLink, type IconName } from "./ui.js";

export type NavigationItem = {
  path: string;
  label: string;
  icon: IconName;
  current: boolean;
};

// A mesma ordem no DOM e na tela, em todas as larguras.
export function ChurchNavigation({
  items,
  navigate,
  busy,
  menuKey,
  children,
}: {
  items: NavigationItem[];
  navigate: (path: string) => void;
  busy: boolean;
  menuKey: string;
  children: ReactNode;
}) {
  return (
    <nav aria-label="Navegação da igreja" className="admin-nav">
      {items.map((item) => (
        <NavigationLink
          key={item.path}
          href={item.path}
          navigate={navigate}
          disabled={busy}
          aria-current={item.current ? "page" : undefined}
        >
          <Icon name={item.icon} />
          {item.label}
        </NavigationLink>
      ))}
      <MoreMenu key={menuKey}>{children}</MoreMenu>
    </nav>
  );
}

// Disclosure nativo. Fecha com Escape (devolvendo o foco ao resumo), com
// toque fora do menu ou quando o foco sai dele.
export function MoreMenu({ children }: { children: ReactNode }) {
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const pointer = (event: PointerEvent) => {
      const element = menu.current;
      if (element?.open && !element.contains(event.target as Node))
        element.open = false;
    };
    const key = (event: KeyboardEvent) => {
      const element = menu.current;
      if (event.key !== "Escape" || !element?.open) return;
      element.open = false;
      element.querySelector("summary")?.focus();
    };
    document.addEventListener("pointerdown", pointer);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", pointer);
      document.removeEventListener("keydown", key);
    };
  }, []);
  return (
    <details
      ref={menu}
      className="navigation-more"
      onBlur={(event) => {
        if (
          event.relatedTarget instanceof Node &&
          !event.currentTarget.contains(event.relatedTarget)
        )
          event.currentTarget.open = false;
      }}
    >
      <summary>
        <Icon name="more" />
        Mais
      </summary>
      <div className="navigation-actions">{children}</div>
    </details>
  );
}
