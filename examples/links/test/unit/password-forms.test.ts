import { describe, expect, it } from "vitest";
import {
  authFormSchema,
  type FormValues,
} from "../../src/client/auth-validation.js";

const modes: Array<{
  name: string;
  fields: Array<keyof FormValues>;
  input: FormValues;
}> = [
  {
    name: "signup",
    fields: ["name", "email", "password", "confirmPassword"],
    input: { name: "Reader", email: "reader@example.com" },
  },
  { name: "reset", fields: ["password", "confirmPassword"], input: {} },
  {
    name: "change",
    fields: ["currentPassword", "password", "confirmPassword"],
    input: { currentPassword: "a" },
  },
];

describe("frontend password form validation", () => {
  it.each(modes)(
    "associates mismatched confirmation with its field in $name",
    ({ fields, input }) => {
      const parsed = authFormSchema(fields).safeParse({
        ...input,
        password: "new-password",
        confirmPassword: "other-password",
      });
      expect(parsed.success).toBe(false);
      if (!parsed.success)
        expect(
          parsed.error.issues.some(
            (issue) =>
              issue.path[0] === "confirmPassword" &&
              issue.message === "Passwords do not match",
          ),
        ).toBe(true);
    },
  );
  it.each(modes)("requires confirmation in $name", ({ fields, input }) => {
    expect(
      authFormSchema(fields).safeParse({ ...input, password: "new-password" })
        .success,
    ).toBe(false);
  });
  it.each(modes)(
    "enforces new password 8/128 bounds without normalizing in $name",
    ({ fields, input }) => {
      for (const length of [7, 129]) {
        expect(
          authFormSchema(fields).safeParse({
            ...input,
            password: "x".repeat(length),
            confirmPassword: "x".repeat(length),
          }).success,
        ).toBe(false);
      }
      for (const length of [8, 128]) {
        expect(
          authFormSchema(fields).safeParse({
            ...input,
            password: "x".repeat(length),
            confirmPassword: "x".repeat(length),
          }).success,
        ).toBe(true);
      }
      const password = "  new password  ";
      const parsed = authFormSchema(fields).parse({
        ...input,
        password,
        confirmPassword: password,
      });
      expect(
        parsed.password === password && parsed.confirmPassword === password,
      ).toBe(true);
    },
  );
  it("requires only presence for current password, not new-password length or trim", () => {
    const schema = authFormSchema([
      "currentPassword",
      "password",
      "confirmPassword",
    ]);
    for (const currentPassword of ["a", " ", "x".repeat(129)]) {
      const parsed = schema.parse({
        currentPassword,
        password: "new-password",
        confirmPassword: "new-password",
      });
      expect(parsed.currentPassword === currentPassword).toBe(true);
    }
    expect(
      schema.safeParse({
        password: "new-password",
        confirmPassword: "new-password",
      }).success,
    ).toBe(false);
  });
  it("does not require confirmation on login, magic link or recovery", () => {
    expect(
      authFormSchema(["email", "password"]).safeParse({
        email: "reader@example.com",
        password: "existing-password",
      }).success,
    ).toBe(true);
    expect(
      authFormSchema(["email"]).safeParse({ email: "reader@example.com" })
        .success,
    ).toBe(true);
  });
});
