import { getMaxContextForDevice, getGpuLayersForDevice, BYTES_PER_GB } from '../../../src/services/llmHelpers';

const GB = BYTES_PER_GB;

describe('getMaxContextForDevice', () => {
  it('caps at 2048 for 3GB RAM', () => {
    expect(getMaxContextForDevice(3 * GB)).toBe(2048);
  });

  it('caps at 2048 for 4GB RAM (iPhone XS)', () => {
    expect(getMaxContextForDevice(4 * GB)).toBe(2048);
  });

  it('caps at 2048 for 6GB RAM', () => {
    expect(getMaxContextForDevice(6 * GB)).toBe(2048);
  });

  it('caps at 4096 for 8GB RAM', () => {
    expect(getMaxContextForDevice(8 * GB)).toBe(4096);
  });

  it('caps at 4096 for 7GB RAM', () => {
    expect(getMaxContextForDevice(7 * GB)).toBe(4096);
  });

  it('caps at 8192 for 12GB RAM', () => {
    expect(getMaxContextForDevice(12 * GB)).toBe(8192);
  });

  it('caps at 8192 for 16GB RAM', () => {
    expect(getMaxContextForDevice(16 * GB)).toBe(8192);
  });
});

describe('getGpuLayersForDevice', () => {
  it('disables GPU on 3GB RAM device', () => {
    expect(getGpuLayersForDevice(3 * GB, 99)).toBe(0);
  });

  it('disables GPU on 4GB RAM device (iPhone XS)', () => {
    expect(getGpuLayersForDevice(4 * GB, 99)).toBe(0);
  });

  it('keeps requested GPU layers on 6GB RAM device', () => {
    expect(getGpuLayersForDevice(6 * GB, 99)).toBe(99);
  });

  it('keeps requested GPU layers on 8GB RAM device', () => {
    expect(getGpuLayersForDevice(8 * GB, 99)).toBe(99);
  });

  it('passes through 0 GPU layers unchanged', () => {
    expect(getGpuLayersForDevice(4 * GB, 0)).toBe(0);
    expect(getGpuLayersForDevice(8 * GB, 0)).toBe(0);
  });
});
