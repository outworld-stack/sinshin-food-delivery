/** Synchronous SHA-256 for source proofs shared by browser editors and the API. */
const ROUND_CONSTANTS = new Uint32Array([
	0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
	0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
	0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
	0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
	0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
	0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
	0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
	0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

const rotateRight = (value: number, bits: number) => (value >>> bits) | (value << (32 - bits))
// All accesses below use the fixed SHA-256 word/round bounds.
const wordAt = (words: Uint32Array, index: number): number => words[index] ?? 0

export function contentSourceFingerprint(text: string): string {
	const source = new TextEncoder().encode(text)
	const padded = new Uint8Array(Math.ceil((source.length + 9) / 64) * 64)
	padded.set(source)
	padded[source.length] = 0x80
	const data = new DataView(padded.buffer)
	const bitLength = source.length * 8
	data.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000))
	data.setUint32(padded.length - 4, bitLength >>> 0)
	const hash = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19])
	const words = new Uint32Array(64)
	for (let offset = 0; offset < padded.length; offset += 64) {
		for (let index = 0; index < 16; index++) words[index] = data.getUint32(offset + index * 4)
		for (let index = 16; index < 64; index++) {
			const previous15 = wordAt(words, index - 15)
			const previous2 = wordAt(words, index - 2)
			const sigma0 = rotateRight(previous15, 7) ^ rotateRight(previous15, 18) ^ (previous15 >>> 3)
			const sigma1 = rotateRight(previous2, 17) ^ rotateRight(previous2, 19) ^ (previous2 >>> 10)
			words[index] = (wordAt(words, index - 16) + sigma0 + wordAt(words, index - 7) + sigma1) >>> 0
		}
		let a = wordAt(hash, 0)
		let b = wordAt(hash, 1)
		let c = wordAt(hash, 2)
		let d = wordAt(hash, 3)
		let e = wordAt(hash, 4)
		let f = wordAt(hash, 5)
		let g = wordAt(hash, 6)
		let h = wordAt(hash, 7)
		for (let index = 0; index < 64; index++) {
			const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25)
			const choose = (e & f) ^ (~e & g)
			const temp1 = (h + sum1 + choose + wordAt(ROUND_CONSTANTS, index) + wordAt(words, index)) >>> 0
			const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22)
			const majority = (a & b) ^ (a & c) ^ (b & c)
			const temp2 = (sum0 + majority) >>> 0
			h = g; g = f; f = e; e = (d + temp1) >>> 0
			d = c; c = b; b = a; a = (temp1 + temp2) >>> 0
		}
		for (const [index, value] of [a, b, c, d, e, f, g, h].entries()) hash[index] = (wordAt(hash, index) + value) >>> 0
	}
	return Array.from(hash, value => value.toString(16).padStart(8, '0')).join('')
}
