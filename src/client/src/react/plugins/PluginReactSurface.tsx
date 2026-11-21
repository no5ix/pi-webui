import { Component, type ReactNode } from "react";
import { asReactNode, PluginReactContributionError } from "./pluginReactNode";

export interface PluginReactSurfaceProps {
  /** What to name in a report, so a failure says which contribution broke. */
  readonly contributionId: string;
  /** The plugin's own label, shown to the reader. */
  readonly pluginLabel: string;
  /** A contribution's node. Anything may arrive; the surface checks it. */
  readonly node: unknown;
  readonly className?: string;
}

/**
 * One plugin's React contribution, rendered inside the application.
 *
 * A plugin's component is third-party code inside the page's tree. Without a boundary its exception
 * unmounts the workspace, and a reader who loses the session, the composer and the other plugins
 * cannot tell which plugin asked for that. The boundary keeps the failure inside the contribution: the
 * surface says which plugin failed and why, the rest of the page keeps working, and the console keeps
 * the stack for the person who will fix it.
 *
 * The node is produced inside the boundary, not before it. A contribution that returns something React
 * cannot draw is a throw, and a throw raised in the parent's render would walk past the boundary and
 * unmount the page — the very thing here to prevent.
 */
export function PluginReactSurface({ contributionId, pluginLabel, node, className }: PluginReactSurfaceProps) {
  return (
    <PluginRenderBoundary contributionId={contributionId} pluginLabel={pluginLabel} className={className}>
      <PluginReactContent contributionId={contributionId} node={node} />
    </PluginRenderBoundary>
  );
}

function PluginReactContent({ contributionId, node }: { readonly contributionId: string; readonly node: unknown }) {
  return <>{asReactNode(node, contributionId)}</>;
}

interface BoundaryProps {
  readonly contributionId: string;
  readonly pluginLabel: string;
  readonly className?: string | undefined;
  readonly children: ReactNode;
}

class PluginRenderBoundary extends Component<BoundaryProps, { failure: string | undefined }> {
  override state: { failure: string | undefined } = { failure: undefined };

  static getDerivedStateFromError(error: unknown): { failure: string } {
    return { failure: describePluginFailure(error) };
  }

  override componentDidCatch(error: unknown): void {
    console.error(`[pi-web] plugin contribution ${this.props.contributionId} failed`, error);
  }

  override componentDidUpdate(previous: BoundaryProps): void {
    if (previous.contributionId !== this.props.contributionId && this.state.failure !== undefined) {
      this.setState({ failure: undefined });
    }
  }

  override render(): ReactNode {
    if (this.state.failure !== undefined) {
      return <p className="plugin-react-failure" role="status">{this.props.pluginLabel}: {this.state.failure}</p>;
    }
    return this.props.children;
  }
}

function describePluginFailure(error: unknown): string {
  if (error instanceof PluginReactContributionError) {
    return `returned ${error.received}, which this host cannot draw.`;
  }
  if (error instanceof Error && error.message !== "") return error.message;
  return "its interface failed.";
}
