import net from 'node:net'

export type RawPrintResult =
  | { online: true; reply: Buffer | null }
  | { online: false; reason: string }

/** A successful write means the entire payload was flushed to TCP, not that paper was printed. */
export function sendRaw(
  host: string,
  port: number,
  payload: Uint8Array,
  opts: { connectTimeoutMs: number; writeTimeoutMs?: number; collectReplyMs?: number },
): Promise<RawPrintResult> {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    const chunks: Buffer[] = []
    let replyLength = 0
    let settled = false
    let written = false
    let phaseTimer: ReturnType<typeof setTimeout>
    const reply = (): Buffer | null => chunks.length ? Buffer.concat(chunks) : null
    const finish = (result: RawPrintResult) => {
      if (settled) return
      settled = true
      clearTimeout(phaseTimer)
      if (result.online) socket.end(() => socket.destroy())
      else socket.destroy()
      resolve(result)
    }

    phaseTimer = setTimeout(
      () => finish({ online: false, reason: 'timeout' }),
      opts.connectTimeoutMs,
    )
    socket.once('connect', () => {
      clearTimeout(phaseTimer)
      if (payload.length === 0) {
        written = true
        finish({ online: true, reply: null })
        return
      }
      // Do not start the reply timer while the write is still backpressured.
      // Destroying a socket at that point silently discards the unsent receipt.
      phaseTimer = setTimeout(
        () => finish({ online: false, reason: 'write-timeout' }),
        opts.writeTimeoutMs ?? 3_000,
      )
      socket.write(payload, (err) => {
        if (settled) return
        if (err) {
          finish({ online: false, reason: 'write-error' })
          return
        }
        written = true
        clearTimeout(phaseTimer)
        // A fixed, bounded window also handles printers that continuously send
        // unsolicited status bytes. They must not keep the request alive forever.
        phaseTimer = setTimeout(
          () => finish({ online: true, reply: reply() }),
          opts.collectReplyMs ?? 600,
        )
      })
    })
    socket.on('data', (data: Buffer) => {
      // DLE EOT replies are single bytes; bound unsolicited device data.
      const remaining = 256 - replyLength
      if (remaining <= 0) return
      const chunk = Buffer.from(data.subarray(0, remaining))
      chunks.push(chunk)
      replyLength += chunk.length
    })
    socket.once('error', (err: NodeJS.ErrnoException) => {
      finish({ online: false, reason: err.code ?? 'error' })
    })
    socket.once('close', () => {
      finish(written
        ? { online: true, reply: reply() }
        : { online: false, reason: 'closed-before-write' })
    })
    socket.connect(port, host)
  })
}
