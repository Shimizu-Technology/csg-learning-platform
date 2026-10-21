import { AlertCircle } from 'lucide-react-native';
import { EmptyState } from './ui/empty-state';
export { EmptyState } from './ui/empty-state';
export { LoadingState } from './ui/loading-state';
export function ErrorState({ message, retry, title = 'Couldn’t load this', retryLabel = 'Try again' }: { message: string; retry?: () => void; title?: string; retryLabel?: string }) {
  return <EmptyState title={title} copy={message} icon={AlertCircle} action={retry ? { label: retryLabel, onPress: retry } : undefined} />;
}
