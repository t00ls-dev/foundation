import { z } from "zod";

const formSchema = z.object({
  email: z.string().trim().email("Enter a valid email address").optional(),
  name: z.string().trim().min(1, "Enter your name").optional(),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .optional(),
  currentPassword: z.string().optional(),
  confirmPassword: z.string().optional(),
  code: z
    .string()
    .regex(/^\d{6}$/, "Enter the six-digit authenticator code")
    .optional(),
});

export type FormValues = z.infer<typeof formSchema>;

export function authFormSchema(requiredFields: Array<keyof FormValues>) {
  return formSchema.superRefine((values, context) => {
    for (const name of requiredFields) {
      if (!values[name])
        context.addIssue({
          code: "custom",
          path: [name],
          message:
            name === "currentPassword"
              ? "Enter your current password"
              : name === "confirmPassword"
                ? "Confirm your password"
                : `Enter your ${name}`,
        });
    }
    if (!requiredFields.includes("confirmPassword")) return;
    if (values.password && values.password.length > 128) {
      context.addIssue({
        code: "custom",
        path: ["password"],
        message: "Password must be at most 128 characters",
      });
    }
    if (values.confirmPassword && values.confirmPassword !== values.password) {
      context.addIssue({
        code: "custom",
        path: ["confirmPassword"],
        message: "Passwords do not match",
      });
    }
  });
}
