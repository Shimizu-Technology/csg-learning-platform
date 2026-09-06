import { disableMobilePushPreference } from '../mobile-push-preference';

it('reloads the persisted preference and starts fresh registration after disabling fails', async () => {
  let registrationGeneration = 1;
  let enabled = true;
  let registrationError: string | null = 'Previous registration failed';
  let updating = false;
  let finishFirstRegistration!: (result: { generation: number; ok: boolean }) => void;
  const firstRegistrationFailure = new Promise<{ generation: number; ok: boolean }>((resolve) => {
    finishFirstRegistration = resolve;
  });
  const registrationAttempts: number[] = [];
  const reportError = jest.fn();

  await disableMobilePushPreference({
    previousEnabled: true,
    persistDisabled: () => Promise.reject(new Error('Network unavailable')),
    invalidateRegistration: () => { registrationGeneration += 1; },
    setEnabled: (value) => { enabled = value; },
    clearRegistrationError: () => { registrationError = null; },
    setUpdating: (value) => { updating = value; },
    reloadPreferences: async () => {
      enabled = true;
      registrationGeneration += 1;
      registrationAttempts.push(registrationGeneration);
    },
    reportError,
  });

  finishFirstRegistration({ generation: 1, ok: false });
  const staleResult = await firstRegistrationFailure;
  expect(staleResult.generation).not.toBe(registrationGeneration);
  expect(enabled).toBe(true);
  expect(registrationError).toBeNull();
  expect(registrationAttempts).toEqual([3]);
  expect(updating).toBe(false);
  expect(reportError).toHaveBeenCalledWith(new Error('Network unavailable'));
});
