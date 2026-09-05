export interface UserStorageCleanup {
  userId: number;
  generation: number;
}

const userStorageGenerations = new Map<number, number>();
const blockedStorageUsers = new Set<number>();

export function beginUserStorageCleanup(userId: number): UserStorageCleanup {
  const generation = (userStorageGenerations.get(userId) || 0) + 1;
  userStorageGenerations.set(userId, generation);
  blockedStorageUsers.add(userId);
  return { userId, generation };
}

export function activateUserStorage(userId: number) {
  if (!userStorageGenerations.has(userId)) {
    userStorageGenerations.set(userId, 0);
  } else if (blockedStorageUsers.delete(userId)) {
    userStorageGenerations.set(userId, (userStorageGenerations.get(userId) || 0) + 1);
  }
}

export function userStorageIsActive(userId: number) {
  return !blockedStorageUsers.has(userId);
}

export function userStorageGeneration(userId: number) {
  return userStorageGenerations.get(userId) || 0;
}

export function userStorageGenerationIsCurrent(userId: number, generation: number) {
  return userStorageIsActive(userId) && userStorageGeneration(userId) === generation;
}

export function userStorageCleanupIsCurrent(cleanup: UserStorageCleanup) {
  return blockedStorageUsers.has(cleanup.userId)
    && userStorageGenerations.get(cleanup.userId) === cleanup.generation;
}
