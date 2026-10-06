'use client';

import { Component, type ReactNode } from 'react';

/** A shared result is someone else's data: if it doesn't render, show `fallback`
 *  instead of a blank page. */
export default class ShareErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
