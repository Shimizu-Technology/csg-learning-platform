type DisableMobilePushOptions = {
  previousEnabled: boolean;
  persistDisabled: () => Promise<unknown>;
  invalidateRegistration: () => void;
  setEnabled: (enabled: boolean) => void;
  clearRegistrationError: () => void;
  setUpdating: (updating: boolean) => void;
  reloadPreferences: () => Promise<void>;
  reportError: (error: Error) => void;
};

export async function disableMobilePushPreference({
  previousEnabled,
  persistDisabled,
  invalidateRegistration,
  setEnabled,
  clearRegistrationError,
  setUpdating,
  reloadPreferences,
  reportError,
}: DisableMobilePushOptions) {
  invalidateRegistration();
  setEnabled(false);
  clearRegistrationError();
  setUpdating(true);

  try {
    await persistDisabled();
  } catch (requestError) {
    setEnabled(previousEnabled);
    reportError(requestError instanceof Error ? requestError : new Error('Could not update device notifications.'));
    await reloadPreferences();
  } finally {
    setUpdating(false);
  }
}
