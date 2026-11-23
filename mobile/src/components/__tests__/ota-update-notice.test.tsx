import { render } from '@testing-library/react-native';
import { Platform } from 'react-native';

const mockBrand = { productName: 'CSG Learn' };

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/hooks/use-ota-updates', () => ({
  useOtaUpdates: () => true,
}));
jest.mock('@/lib/brand', () => ({
  get brand() {
    return mockBrand;
  },
}));

import { OtaUpdateNotice } from '../ota-update-notice';

describe('OtaUpdateNotice branding', () => {
  const originalOs = Platform.OS;

  afterEach(() => {
    mockBrand.productName = 'CSG Learn';
    Object.defineProperty(Platform, 'OS', { value: originalOs, configurable: true });
  });

  it('uses CSG Learn by default on iOS and Android', () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    const ios = render(<OtaUpdateNotice />);
    expect(ios.getByText(/Swipe CSG Learn away in the app switcher, then reopen it\./)).toBeTruthy();
    ios.unmount();

    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    const android = render(<OtaUpdateNotice />);
    expect(android.getByText(/Close CSG Learn from recent apps, then reopen it\./)).toBeTruthy();
  });

  it('uses brand.productName on alternate brands without CSG Learn copy', () => {
    mockBrand.productName = 'Actualize Learn';
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    const ios = render(<OtaUpdateNotice />);
    expect(ios.getByText(/Swipe Actualize Learn away in the app switcher, then reopen it\./)).toBeTruthy();
    expect(ios.queryByText(/CSG Learn/)).toBeNull();
    ios.unmount();

    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    const android = render(<OtaUpdateNotice />);
    expect(android.getByText(/Close Actualize Learn from recent apps, then reopen it\./)).toBeTruthy();
    expect(android.queryByText(/CSG Learn/)).toBeNull();
  });
});
