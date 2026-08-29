type AppToastProps = {
  message: string;
};

export function AppToast({ message }: AppToastProps) {
  if (!message) return null;
  return <div className="toast" role="status">✓ {message}</div>;
}
