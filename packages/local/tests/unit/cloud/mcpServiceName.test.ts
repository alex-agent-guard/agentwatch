import { describe, expect, it } from 'vitest';

import { resolveMcpServiceName } from '../../../src/cloud/mcpServiceName.js';

describe('resolveMcpServiceName', () => {
  it('extracts scoped npm package from npx args', () => {
    expect(
      resolveMcpServiceName({
        command: 'npx',
        args: ['-y', '@okx_ai/okx-trade-mcp'],
      }),
    ).toBe('@okx_ai/okx-trade-mcp');
  });

  it('extracts unscoped npm package', () => {
    expect(
      resolveMcpServiceName({
        command: 'npx',
        args: ['-y', 'some-mcp-server'],
      }),
    ).toBe('some-mcp-server');
  });

  it('falls back to script basename for node entry', () => {
    expect(
      resolveMcpServiceName({
        command: 'node',
        args: ['/path/to/echo-mcp.js'],
      }),
    ).toBe('echo-mcp');
  });

  it('returns unknown when command is generic npx without package token', () => {
    expect(
      resolveMcpServiceName({
        command: 'npx',
        args: ['-y'],
      }),
    ).toBe('unknown-mcp-server');
  });
});
