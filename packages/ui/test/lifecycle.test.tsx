// @vitest-environment jsdom
import { act, StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import {
  PageProgress,
  PageProgressProvider,
  useProgressOperation,
} from "../src/patterns/page-progress.js";
import {
  FeedbackProvider,
  useConfirmedFeedback,
} from "../src/patterns/feedback.js";

const { success, dismiss } = vi.hoisted(() => ({
  success: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { success, dismiss },
  Toaster: () => <div data-toaster />,
}));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const container = document.createElement("div");
const root = createRoot(container);
afterEach(() => {
  act(() => root.render(null));
  vi.clearAllMocks();
});

function Operation() {
  useProgressOperation(true);
  return null;
}

it("cleans operations on StrictMode unmount without leaving progress stuck", () => {
  act(() =>
    root.render(
      <StrictMode>
        <PageProgressProvider>
          <PageProgress label="Loading session" />
          <Operation />
          <Operation />
        </PageProgressProvider>
      </StrictMode>,
    ),
  );
  const progress = container.querySelector('[role="progressbar"]');
  expect(progress?.getAttribute("aria-label")).toBe("Loading session");
  expect(progress?.hasAttribute("aria-valuenow")).toBe(false);
  act(() =>
    root.render(
      <StrictMode>
        <PageProgressProvider>
          <PageProgress />
          <Operation />
        </PageProgressProvider>
      </StrictMode>,
    ),
  );
  expect(container.querySelector('[role="progressbar"]')).not.toBeNull();
  act(() =>
    root.render(
      <StrictMode>
        <PageProgressProvider>
          <PageProgress />
        </PageProgressProvider>
      </StrictMode>,
    ),
  );
  expect(container.querySelector('[role="progressbar"]')).toBeNull();
});

it("deduplicates confirmed feedback and ignores callbacks from a discarded identity", () => {
  let feedback!: ReturnType<typeof useConfirmedFeedback>;
  function Consumer() {
    const callback = useConfirmedFeedback();
    useEffect(() => {
      feedback = callback;
    }, [callback]);
    return null;
  }
  act(() =>
    root.render(
      <StrictMode>
        <FeedbackProvider key="A">
          <Consumer />
        </FeedbackProvider>
      </StrictMode>,
    ),
  );
  expect(container.querySelectorAll("[data-toaster]")).toHaveLength(1);
  const previous = feedback;
  previous("operation-1", "Saved");
  previous("operation-1", "Saved");
  expect(success).toHaveBeenCalledTimes(1);
  act(() =>
    root.render(
      <StrictMode>
        <FeedbackProvider key="B">
          <Consumer />
        </FeedbackProvider>
      </StrictMode>,
    ),
  );
  expect(dismiss).toHaveBeenCalledWith(expect.any(String));
  previous("late-operation", "Saved");
  expect(success).toHaveBeenCalledTimes(1);
  feedback("operation-1", "Saved");
  expect(success).toHaveBeenCalledTimes(2);
});
