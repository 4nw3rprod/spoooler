import { snapshotRun } from './lib/checkpoints';
console.log('Testing snapshotRun...');
try {
  const result = snapshotRun("ui-reel-78f6cff1");
  console.log('Result exists:', result.exists);
} catch (error) {
  console.error('Error during snapshotRun:', error);
}
