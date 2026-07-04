declare module 'byline' {
  import type { Readable } from 'node:stream';

  function createStream(stream: Readable): Readable;

  export default {
    createStream,
  };
}
