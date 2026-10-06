import type { EmailProvider, SendEmailInput } from "@t00ls-dev/email";

const messages = new Map([
  [
    "Verify your email",
    {
      subject: "Verify your email for Links",
      introduction: "Verify your email to finish creating your Links account.",
      action: "Verify email:",
      notice:
        "If you didn't create a Links account, you can ignore this email.",
    },
  ],
  [
    "Sign in",
    {
      subject: "Sign in to Links",
      introduction: "Use this link to sign in to Links without a password.",
      action: "Sign in:",
      notice:
        "If you didn't request this link, you can ignore this email. Don't share the link.",
    },
  ],
  [
    "Reset your password",
    {
      subject: "Reset your Links password",
      introduction:
        "Use this link to choose a new password for your Links account.",
      action: "Reset password:",
      notice:
        "If you didn't request a password reset, you can ignore this email. Your password won't change unless you complete the reset.",
    },
  ],
]);

// Better Auth supplies the original URL as text. Only Links owns this copy;
// delivery, URL creation, recipients and error handling stay with the caller.
export function withLinksAuthEmail(provider: EmailProvider): EmailProvider {
  return {
    send(input: SendEmailInput) {
      const message = messages.get(input.subject);
      if (!message) return provider.send(input);
      return provider.send({
        ...input,
        subject: message.subject,
        text: `${message.introduction}\n\n${message.action}\n${input.text}\n\n${message.notice}\n\nLinks`,
      });
    },
  };
}
