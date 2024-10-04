import { fileSystemDirectoryHandleFactory } from './opfs';

const storage = (): StorageManager => {
  const root = fileSystemDirectoryHandleFactory('root');

  return {
    estimate: async (): Promise<StorageEstimate> => {
      return {
        usage: 0,
        quota: 0,
      };
    },
    getDirectory: async () => root,
    persist: async (): Promise<boolean> => {
      return true;
    },
    persisted: async (): Promise<boolean> => {
      return true;
    },
  };
};

const mockOPFS = () => {
  // Navigator was added to Node.js in v21
  if (!('navigator' in globalThis)) {
    Object.defineProperty(globalThis, 'navigator', {
      value: {},
      writable: true,
    });
  }

  if (!globalThis.navigator.storage) {
    const { getDirectory } = storage();

    Object.defineProperty(globalThis.navigator, 'storage', {
      value: {
        getDirectory,
      },
      writable: true,
    });
  }
};

const resetMockOPFS = () => {
  // Clear the mock state, e.g., reset the root directory
  const root = fileSystemDirectoryHandleFactory('root');
  Object.defineProperty(globalThis.navigator.storage, 'getDirectory', {
    value: () => root,
    writable: true,
  });
};

// Automatically add to globalThis if imported directly
if (typeof globalThis !== 'undefined') {
  mockOPFS();
}

export { mockOPFS, resetMockOPFS, storage };
