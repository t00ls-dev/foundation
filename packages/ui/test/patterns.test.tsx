import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PendingButton } from "../src/patterns/pending-button.js";
import { InlineFeedback } from "../src/patterns/inline-feedback.js";
import { Skeleton } from "../src/components/ui/skeleton.js";

it("names and disables the initiating action while decorative loading stays hidden", () => {
  const markup = renderToStaticMarkup(
    <PendingButton pending pendingLabel="Saving">
      Save
    </PendingButton>,
  );
  expect(markup).toContain('disabled=""');
  expect(markup).toContain('aria-busy="true"');
  expect(markup).toContain('aria-hidden="true"');
  expect(markup).toContain("Saving");
  expect(markup).not.toContain('role="status"');
});

it("separates urgency from tone and hides placeholder shapes from AT", () => {
  const markup = renderToStaticMarkup(
    <InlineFeedback tone="neutral" announce="assertive">
      Result unknown
    </InlineFeedback>,
  );
  expect(markup).toContain('role="alert"');
  expect(markup).toContain("bg-muted");
  expect(markup).not.toContain("text-destructive");
  expect(renderToStaticMarkup(<Skeleton />)).toContain('aria-hidden="true"');
});
