import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  observeContinuousListingView,
  type ListingViewObserverEntry,
  type ListingViewObserverFactory,
} from "./listing-view-observer";

class FakeVisibilityDocument {
  visibilityState: DocumentVisibilityState = "visible";
  private readonly listeners = new Set<() => void>();

  addEventListener(_type: "visibilitychange", listener: () => void) {
    this.listeners.add(listener);
  }

  removeEventListener(_type: "visibilitychange", listener: () => void) {
    this.listeners.delete(listener);
  }

  setVisibility(state: DocumentVisibilityState) {
    this.visibilityState = state;

    for (const listener of this.listeners) {
      listener();
    }
  }
}

function createFakeObserver() {
  let callback: ((entries: ListingViewObserverEntry[]) => void) | undefined;
  const disconnect = vi.fn();
  const observe = vi.fn();
  const factory: ListingViewObserverFactory = (nextCallback) => {
    callback = nextCallback;

    return {
      disconnect,
      observe,
    };
  };

  return {
    disconnect,
    emit(entries: ListingViewObserverEntry[]) {
      callback?.(entries);
    },
    factory,
    observe,
  };
}

describe("continuous listing view observer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("qualifies only after 1000ms continuously in the viewport", () => {
    const element = {} as Element;
    const fakeObserver = createFakeObserver();
    const onQualifiedView = vi.fn();

    observeContinuousListingView({
      document: new FakeVisibilityDocument(),
      element,
      observerFactory: fakeObserver.factory,
      onQualifiedView,
    });

    fakeObserver.emit([
      {
        intersectionRatio: 0.8,
        isIntersecting: true,
        target: element,
      },
    ]);
    vi.advanceTimersByTime(999);
    expect(onQualifiedView).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onQualifiedView).toHaveBeenCalledOnce();
    expect(onQualifiedView).toHaveBeenCalledWith(1_000);
    expect(fakeObserver.disconnect).toHaveBeenCalledOnce();
  });

  it("resets the duration when the card leaves the viewport", () => {
    const element = {} as Element;
    const fakeObserver = createFakeObserver();
    const onQualifiedView = vi.fn();

    observeContinuousListingView({
      document: new FakeVisibilityDocument(),
      element,
      observerFactory: fakeObserver.factory,
      onQualifiedView,
    });

    fakeObserver.emit([
      {
        intersectionRatio: 0.75,
        isIntersecting: true,
        target: element,
      },
    ]);
    vi.advanceTimersByTime(700);
    fakeObserver.emit([
      {
        intersectionRatio: 0,
        isIntersecting: false,
        target: element,
      },
    ]);
    vi.advanceTimersByTime(1_000);
    expect(onQualifiedView).not.toHaveBeenCalled();

    fakeObserver.emit([
      {
        intersectionRatio: 0.6,
        isIntersecting: true,
        target: element,
      },
    ]);
    vi.advanceTimersByTime(1_000);
    expect(onQualifiedView).toHaveBeenCalledOnce();
  });

  it("does not accumulate view time while the document is hidden", () => {
    const element = {} as Element;
    const fakeObserver = createFakeObserver();
    const visibilityDocument = new FakeVisibilityDocument();
    const onQualifiedView = vi.fn();

    const cleanup = observeContinuousListingView({
      document: visibilityDocument,
      element,
      observerFactory: fakeObserver.factory,
      onQualifiedView,
    });

    fakeObserver.emit([
      {
        intersectionRatio: 1,
        isIntersecting: true,
        target: element,
      },
    ]);
    vi.advanceTimersByTime(600);
    visibilityDocument.setVisibility("hidden");
    vi.advanceTimersByTime(5_000);
    expect(onQualifiedView).not.toHaveBeenCalled();

    visibilityDocument.setVisibility("visible");
    vi.advanceTimersByTime(1_000);
    expect(onQualifiedView).toHaveBeenCalledOnce();

    cleanup();
  });
});
