import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 text-error bg-error-container/20 rounded-xl border border-error/30 m-6">
          <h3 className="font-bold mb-2 flex items-center gap-2"><span className="material-symbols-outlined">warning</span>Đã xảy ra lỗi khi tải Component.</h3>
          <p className="text-sm opacity-80 font-mono">{this.state.error?.toString()}</p>
        </div>
      );
    }
    return this.props.children;
  }
}
