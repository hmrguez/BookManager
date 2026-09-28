import { expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))

// Capacitor module mocks run in separate processes so they cannot replace the
// native bridges used by other repository suites in the same Bun test run.
test.each(['android', 'ios'])('private erasure drains scoped journals on %s with its supported reader methods', platform => {
  const script = `
    import { mock } from 'bun:test';
    const calls = [];
    mock.module('@capacitor/core', () => ({ Capacitor: {
      isNativePlatform: () => true,
      getPlatform: () => ${JSON.stringify(platform)},
      isPluginAvailable: () => true,
    }}));
    mock.module(${JSON.stringify(`${root}src/reviews/snapshot-export.ts`)}, () => ({
      clearSnapshotCache: async () => { calls.push('cache'); },
    }));
    mock.module(${JSON.stringify(`${root}src/libby/use-libby.ts`)}, () => ({
      disableLibbyForPrivateErasure: async () => { calls.push('disable'); },
    }));
    mock.module(${JSON.stringify(`${root}src/reader/bridge.ts`)}, () => ({ nativeReader: {
      closeForIncomingFile: async () => {
        if (${JSON.stringify(platform)} === 'android') throw new Error('Not implemented on Android');
        calls.push('dismiss');
      },
      drainOutbox: async () => ({ events: [{id:'erase-reader',bookId:'erase'}, {id:'keep-reader',bookId:'keep'}] }),
      acknowledge: async ({ids}) => { calls.push(ids); },
    }}));
    mock.module(${JSON.stringify(`${root}src/playback/bridge.ts`)}, () => ({ nativePlayback: {
      getSnapshot: async () => ({queueId:'keep',revision:1}),
      stop: async () => { throw new Error('Unrelated playback must remain'); },
      drainJournal: async () => ({ events: [{id:'erase-audio',queueId:'erase'}, {id:'keep-audio',queueId:'keep'}] }),
      acknowledgeJournal: async ({ids}) => { calls.push(ids); },
    }}));
    const { eraseNativeJournals } = await import(${JSON.stringify(`${root}src/storage/native-erasure.ts`)});
    await eraseNativeJournals({bookIds:['erase'],queueIds:['erase'],all:false});
    console.log(JSON.stringify(calls));
  `
  const child = Bun.spawnSync([process.execPath, '--eval', script], { cwd: root })
  expect(child.stderr.toString()).toBe('')
  expect(child.exitCode).toBe(0)
  expect(JSON.parse(child.stdout.toString())).toEqual([
    'cache', 'disable', ...(platform === 'ios' ? ['dismiss'] : []), ['erase-reader'], ['erase-audio'],
  ])
})
