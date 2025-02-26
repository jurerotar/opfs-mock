# opfs-mock

This is a pure JS in-memory implementation of the [origin private file system](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system). Its main utility is for testing OPFS-dependent code in Node.js.

## Installation

```shell
npm install -save-dev opfs-mock
```

## Usage

It replicates the behavior of origin private file system, except data is not persisted to disk.

The easiest way to use it is to import `opfs-mock`, which will polyfill OPFS API to global scope.

```ts
import "opfs-mock";
```

Alternatively, you can explicitly import `storageFactory`:

```ts
import { storageFactory } from "opfs-mock";

test('Your test', async () => {
  const storage = await storageFactory();
  const root = await storage.getDirectory();
  const directoryHandle = await root.getFileHandle('test-file.txt', { create: true });
  // rest of your test
});
```

`storageFactory` has `quota` and `usage` values set to `1024 ** 3 (1 GB)` and `0` respectively. When calling `storage.estimate()`, `usage` is dynamically calculated by summing the predefined usage value and any additional computed storage consumption.
In case you need specific values, you can pass both as arguments to `storageFactory`.

```ts
import { storageFactory } from "opfs-mock";

test('Your test', async () => {
  const storage = await storageFactory({ quota: 1_000_000, usage: 1_000 });
  const root = await storage.getDirectory();
  const directoryHandle = await root.getFileHandle('test-file.txt', { create: true });
  // rest of your test
});
```

### Vitest

To use `opfs-mock` in a single Vitest test suite, require `opfs-mock` at the beginning of the test file, as described above.

To use it on all Vitest tests without having to include it in each file, add the auto setup script to the `test.setupFiles` in your Vite config:

```ts
// vite.config.ts

import { defineConfig as defineViteConfig, mergeConfig } from 'vite';
import { defineConfig as defineVitestConfig } from 'vitest/config';

const viteConfig = defineViteConfig({
  ...
});

const vitestConfig = defineVitestConfig({
  test: {
    setupFiles: ['opfs-mock'],
  },
});

export default mergeConfig(viteConfig, vitestConfig);
```

Alternatively you can create a new setup file which then imports this module.

```ts
// vitest-setup.ts

import "opfs-mock";
```

Add that file to your `test.setupFiles` array:

```ts
// vite.config.ts

import { defineConfig as defineViteConfig, mergeConfig } from 'vite';
import { defineConfig as defineVitestConfig } from 'vitest/config';

const viteConfig = defineViteConfig({
  ...
});

const vitestConfig = defineVitestConfig({
  test: {
    setupFiles: ['vitest-setup.ts'],
  },
});

export default mergeConfig(viteConfig, vitestConfig);
```


### Jest

To use `opfs-mock` in a single Jest test suite, require `opfs-mock` at the beginning of the test file, as described above.

To use it on all Jest tests without having to include it in each file, add the auto setup script to the `setupFiles` in your Jest config:

```ts
// jest.config.js

{
  ...
  "setupFiles": [
    "opfs-mock"
  ]
}
```

Alternatively you can create a new setup file which then imports this module.

```ts
// jest-setup.ts

import "opfs-mock";
```

Add that file to your `setupFiles` array:

```ts
// jest.config.js

{
  ...
  "setupFiles": [
    "jest-setup"
  ]
}
```

## Wiping/resetting the OPFS mock for a fresh state

If you are keeping your tests completely isolated you might want to "reset" the state of the mocked OPFS. You can do this by using `resetMockOPFS` function, which creates a completely new instance of the mock.

```ts
import { resetMockOPFS } from 'opfs-mock';

beforeEach(() => {
  resetMockOPFS();
});

test('First isolated test', async () => {
  // rest of your test
});

test('Second isolated test', async () => {
  // rest of your test
});
```
