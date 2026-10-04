// Adapted from shadcn/ui (MIT), Radix family; Foundation tokens and touch targets.
import type { ComponentProps } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils.js";

const buttonVariants = cva(
  "inline-flex min-h-11 min-w-11 max-w-full items-center justify-center gap-2 rounded-md border px-4 py-2 text-sm font-semibold whitespace-normal transition-colors focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-65 motion-reduce:transition-none",
  {
    variants: {
      variant: {
        default:
          "border-primary bg-primary text-primary-foreground hover:bg-primary-hover",
        outline: "border-border bg-background text-primary hover:bg-accent",
        ghost: "border-transparent bg-transparent text-primary hover:bg-accent",
        destructive:
          "border-destructive bg-destructive text-primary-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export function Button({
  className,
  variant,
  asChild = false,
  ...props
}: ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Component = asChild ? Slot : "button";
  return (
    <Component
      data-slot="button"
      className={cn(buttonVariants({ variant, className }))}
      {...props}
    />
  );
}
