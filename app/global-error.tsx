"use client";

/**
 * Catches errors thrown in the root layout itself (where `app/error.tsx`
 * cannot help). It must render its own <html>/<body>, so styling is inline.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          background: "#ffffff",
          color: "#18181b",
          padding: "24px",
          textAlign: "center",
        }}
      >
        <div style={{ maxWidth: 360 }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              background: "rgba(220,38,38,0.1)",
              color: "#dc2626",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 24,
              margin: "0 auto 12px",
            }}
          >
            !
          </div>
          <h1 style={{ fontSize: 18, margin: "0 0 8px" }}>
            HealthRepo hit an error
          </h1>
          <p style={{ fontSize: 14, color: "#71717a", margin: "0 0 16px" }}>
            {error.message || "The app failed to load. Please reload the page."}
          </p>
          <button
            onClick={reset}
            style={{
              background: "#0D9488",
              color: "#fff",
              border: 0,
              borderRadius: 10,
              padding: "10px 16px",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
