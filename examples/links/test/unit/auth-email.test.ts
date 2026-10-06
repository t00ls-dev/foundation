import { describe, expect, it, vi } from "vitest";
import type { SendEmailInput } from "@t00ls-dev/email";
import { withLinksAuthEmail } from "../../src/server/auth-email.js";
import { extractEmailUrl } from "../email-link.js";

const origin = "https://links.example";

describe("Links transactional email", () => {
  it.each([
    [
      "Verify your email",
      "Verify your email for Links",
      "/verify-email?token=a%2Bb&callbackURL=%2Fverify-email",
      "finish creating your Links account",
    ],
    [
      "Sign in",
      "Sign in to Links",
      "/magic-link/verify?token=a%2Bb&callbackURL=%2Fbookmarks",
      "without a password",
    ],
    [
      "Reset your password",
      "Reset your Links password",
      "/reset-password/a%2Bb?callbackURL=%2Freset-password",
      "Your password won't change unless you complete the reset",
    ],
  ])(
    "delivers %s once with its intact link and actionable copy",
    async (subject, expectedSubject, path, copy) => {
      const send = vi
        .fn<(input: SendEmailInput) => Promise<void>>()
        .mockResolvedValue();
      const url = `${origin}/api/auth${path}`;
      await withLinksAuthEmail({ send }).send({
        subject,
        text: url,
        to: "reader@example.com",
      });
      expect(send).toHaveBeenCalledTimes(1);
      const message = send.mock.calls[0]![0];
      expect(message.to).toBe("reader@example.com");
      expect(message.subject).toBe(expectedSubject);
      expect(message.text).toContain(copy);
      expect(message.text).toContain("you can ignore this email");
      expect(message.text).toMatch(/\n\nLinks$/);
      expect(extractEmailUrl(message.text, origin)).toBe(url);
    },
  );

  it("passes unknown messages through intact", async () => {
    const send = vi
      .fn<(input: SendEmailInput) => Promise<void>>()
      .mockResolvedValue();
    const input = {
      from: "support@example.com",
      to: "reader@example.com",
      subject: "Support",
      text: "A reply",
    };
    await withLinksAuthEmail({ send }).send(input);
    expect(send).toHaveBeenCalledExactlyOnceWith(input);
    expect(send.mock.calls[0]![0]).toBe(input);
  });

  it("propagates provider failures without retrying", async () => {
    const error = new Error("Delivery unavailable");
    const send = vi
      .fn<(input: SendEmailInput) => Promise<void>>()
      .mockRejectedValue(error);
    await expect(
      withLinksAuthEmail({ send }).send({
        to: "reader@example.com",
        subject: "Sign in",
        text: `${origin}/api/auth/magic-link/verify?token=fixture`,
      }),
    ).rejects.toBe(error);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("test email link extraction", () => {
  const url = `${origin}/api/auth/verify-email?token=a%2Bb`;
  it("also accepts a bare URL from generic auth fixtures", () => {
    expect(extractEmailUrl(url, origin)).toBe(url);
  });
  it.each([
    "No link",
    `${url}\n${url}`,
    `${url}\nhttps://other.example/help`,
    "https://other.example/api/auth/verify-email?token=fixture",
    `${origin}/bookmarks`,
  ])("rejects missing, ambiguous or unexpected destinations", (text) => {
    expect(() => extractEmailUrl(text, origin)).toThrow();
  });
});
