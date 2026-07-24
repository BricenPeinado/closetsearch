export interface ListingViewObserverEntry {
  intersectionRatio: number;
  isIntersecting: boolean;
  target: Element;
}

export interface ListingViewObserver {
  disconnect(): void;
  observe(element: Element): void;
}

export type ListingViewObserverFactory = (
  callback: (entries: ListingViewObserverEntry[]) => void,
) => ListingViewObserver;

interface VisibilityDocument {
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
  visibilityState: DocumentVisibilityState;
}

export interface ObserveContinuousListingViewOptions {
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
  document?: VisibilityDocument;
  durationMs?: number;
  element: Element;
  minimumIntersectionRatio?: number;
  observerFactory?: ListingViewObserverFactory;
  onQualifiedView: (durationMs: number) => void;
  setTimer?: (callback: () => void, durationMs: number) => ReturnType<typeof setTimeout>;
}

function createDefaultObserverFactory(
  minimumIntersectionRatio: number,
): ListingViewObserverFactory | undefined {
  if (typeof IntersectionObserver === "undefined") {
    return undefined;
  }

  return (callback) =>
    new IntersectionObserver(
      (entries) => {
        callback(
          entries.map((entry) => ({
            intersectionRatio: entry.intersectionRatio,
            isIntersecting: entry.isIntersecting,
            target: entry.target,
          })),
        );
      },
      { threshold: minimumIntersectionRatio },
    );
}

export function observeContinuousListingView({
  clearTimer = clearTimeout,
  document: visibilityDocument = typeof document === "undefined" ? undefined : document,
  durationMs = 1_000,
  element,
  minimumIntersectionRatio = 0.5,
  observerFactory = createDefaultObserverFactory(minimumIntersectionRatio),
  onQualifiedView,
  setTimer = setTimeout,
}: ObserveContinuousListingViewOptions) {
  if (!observerFactory) {
    return () => undefined;
  }

  let completed = false;
  let isIntersecting = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function clearQualificationTimer() {
    if (timer !== undefined) {
      clearTimer(timer);
      timer = undefined;
    }
  }

  function canAccumulateViewTime() {
    return !completed && isIntersecting && visibilityDocument?.visibilityState !== "hidden";
  }

  function startQualificationTimer() {
    if (!canAccumulateViewTime() || timer !== undefined) {
      return;
    }

    timer = setTimer(() => {
      timer = undefined;

      if (!canAccumulateViewTime()) {
        return;
      }

      completed = true;
      observer.disconnect();
      visibilityDocument?.removeEventListener("visibilitychange", handleVisibilityChange);
      onQualifiedView(durationMs);
    }, durationMs);
  }

  function handleVisibilityChange() {
    clearQualificationTimer();
    startQualificationTimer();
  }

  const observer = observerFactory((entries) => {
    const entry = entries.find((candidate) => candidate.target === element);

    if (!entry || completed) {
      return;
    }

    isIntersecting = entry.isIntersecting && entry.intersectionRatio >= minimumIntersectionRatio;
    clearQualificationTimer();
    startQualificationTimer();
  });

  visibilityDocument?.addEventListener("visibilitychange", handleVisibilityChange);
  observer.observe(element);

  return () => {
    completed = true;
    clearQualificationTimer();
    observer.disconnect();
    visibilityDocument?.removeEventListener("visibilitychange", handleVisibilityChange);
  };
}
