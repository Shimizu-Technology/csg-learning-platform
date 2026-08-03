import { fireEvent, render } from '@testing-library/react-native';

import { VoiceDraftPanel } from '../voice-draft-controls';

jest.mock('lucide-react-native', () => {
  const Icon = () => null;
  return { AudioLines: Icon, Mic: Icon, RotateCcw: Icon, Square: Icon, X: Icon };
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
});
