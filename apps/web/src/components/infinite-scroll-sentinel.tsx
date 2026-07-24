import { useEffect, useRef } from "react";

interface InfiniteScrollSentinelProps {
  hasMore: boolean;
  isLoading: boolean;
  label: string;
  onLoadMore: () => void;
}

export function InfiniteScrollSentinel({
  hasMore,
  isLoading,
  label,
  onLoadMore,
}: InfiniteScrollSentinelProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = sentinelRef.current;

    if (
      !element ||
      !hasMore ||
      isLoading ||
      typeof IntersectionObserver === "undefined"
    ) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          onLoadMore();
        }
      },
      {
        rootMargin: "480px 0px",
        threshold: 0.01,
      },
    );

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [hasMore, isLoading, onLoadMore]);

  return (
    <div
      aria-live="polite"
      className="infinite-scroll-sentinel"
      ref={sentinelRef}
    >
      <span className="visually-hidden">{isLoading ? `Loading ${label}` : ""}</span>
    </div>
  );
}
