"use client";

// ─────────────────────────────────────────────────────────────────────────────
// MBUMAH HARDWARE — Console Section Error Boundary (v2.18.2.1)
// Isolates each console section: a crash inside one panel degrades to a styled
// retry card instead of blanking the whole organization console.
// ─────────────────────────────────────────────────────────────────────────────

import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

interface Props {
  /** Human label of the guarded section, shown in the fallback card. */
  section: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class SectionErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Console-side breadcrumb only — never throws, never blocks the UI.
    console.error(`[org-console] Section "${this.props.section}" crashed:`, error.message, info.componentStack);
  }

  private reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        role="alert"
        className="flex flex-col items-start gap-3 rounded-xl border border-orange-300/60 bg-orange-50 p-6 text-slate-900 shadow-sm"
      >
        <div className="flex items-center gap-2 font-semibold">
          <AlertTriangle className="h-5 w-5 text-orange-600" aria-hidden />
          {this.props.section} hit a snag
        </div>
        <p className="text-sm text-slate-600">
          This section failed to render but the rest of the console is unaffected. Your data is safe — retry below.
        </p>
        <code className="max-w-full truncate rounded bg-slate-900/90 px-2 py-1 text-xs text-orange-200">
          {this.state.error.message || "Unknown render error"}
        </code>
        <button
          type="button"
          onClick={this.reset}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[#12243D] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#0F1E33] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FF8C00]"
        >
          <RotateCcw className="h-4 w-4" aria-hidden />
          Retry section
        </button>
      </div>
    );
  }
}
