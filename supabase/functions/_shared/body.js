// Read at most limit bytes, including requests without Content-Length.
// null means the request exceeded the limit.
export async function boundedText(request, limit) {
  if (Number(request.headers.get("content-length")) > limit) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const buffer = new Uint8Array(limit);
  let used = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) return new TextDecoder("utf-8", {fatal: true}).decode(buffer.subarray(0, used));
      if (value.length > limit - used) {
        void reader.cancel().catch(() => {});
        return null;
      }
      buffer.set(value, used);
      used += value.length;
    }
  } finally {
    reader.releaseLock();
  }
}
