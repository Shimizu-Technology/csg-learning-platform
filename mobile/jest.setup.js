jest.mock('react-native-worklets', () => require('react-native-worklets/src/mock'));
jest.mock('react-native-reanimated', () => ({
  ...require('react-native-reanimated/mock'),
  useReducedMotion: () => false,
}));

// Shared CI/dev machines can be heavily loaded; give async UI assertions room
// before failing instead of relying on the 1s default.
require('@testing-library/react-native').configure({ asyncUtilTimeout: 5000 });
