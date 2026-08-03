import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { VoiceDraftPanel } from '../voice-draft-controls';

jest.mock('lucide-react-native', () => {
  const Icon = () => null;
  return { AudioLines: Icon, CircleAlert: Icon, Mic: Icon, RotateCcw: Icon, Square: Icon, X: Icon };
});

const handlers = {
  onStop: jest.fn(),
  onCancel: jest.fn(),
  onRetry: jest.fn(),
  onRecordAgain: jest.fn(),
  onRestore: jest.fn(),
  onDismiss: jest.fn(),
};

describe('VoiceDraftPanel', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows an open-ended listening experience until the final warning window', () => {
    const view = render(
      <VoiceDraftPanel state="recording" durationMillis={91_000} maxDurationSeconds={300} metering={-20} error={null} notice={null} hasReview={false} {...handlers} />,
    );

    expect(view.getByText('Listening…')).toBeTruthy();
    expect(view.getByText('1:31')).toBeTruthy();
    expect(view.queryByText(/left/)).toBeNull();
    expect(view.getByLabelText('Stop and transcribe recording')).toBeTruthy();
  });

  it('warns when a five-minute recording is nearly full', () => {
    const view = render(
      <VoiceDraftPanel state="recording" durationMillis={280_000} maxDurationSeconds={300} error={null} notice={null} hasReview={false} {...handlers} />,
    );

    expect(view.getByText('4:40 · 20s left')).toBeTruthy();
  });

  it('preserves failed audio for retry or a fresh recording', () => {
    const view = render(
      <VoiceDraftPanel state="error" durationMillis={0} error="The voice service is temporarily unavailable." notice={null} hasReview={false} hasRecording {...handlers} />,
    );

    fireEvent.press(view.getByText('Retry transcription'));
    fireEvent.press(view.getByText('Record again'));
    expect(handlers.onRetry).toHaveBeenCalledTimes(1);
    expect(handlers.onRecordAgain).toHaveBeenCalledTimes(1);
  });

  it('stacks the primary retry action above flexible secondary actions', () => {
    const view = render(
      <VoiceDraftPanel state="error" durationMillis={0} error="The voice service is temporarily unavailable. Try again when your connection is stable." notice={null} hasReview={false} hasRecording {...handlers} />,
    );

    const retryStyle = StyleSheet.flatten(view.getByLabelText('Retry transcription').props.style);
    const recordAgainStyle = StyleSheet.flatten(view.getByLabelText('Discard this recording and record again').props.style);
    const dismissStyle = StyleSheet.flatten(view.getByLabelText('Dismiss voice draft error').props.style);

    expect(retryStyle).toMatchObject({ width: '100%', minHeight: 48 });
    expect(recordAgainStyle).toMatchObject({ flex: 1, minHeight: 46 });
    expect(dismissStyle).toMatchObject({ flex: 1, minHeight: 46 });
    expect(view.getByTestId('voice-error-actions')).toBeTruthy();
    expect(view.getByText('Your recording is saved for this retry.')).toBeTruthy();
  });
});
