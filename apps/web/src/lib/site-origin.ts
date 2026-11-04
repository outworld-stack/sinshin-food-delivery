export const DEFAULT_SITE_URL = 'https://sinshin-foodpark.ir'

/** DOMAIN is the canonical host; APEX_DOMAIN is only a redirect alias. */
export function siteOriginFromDomain(domain?: string): string {
	const host = domain?.trim()
	if (!host) return DEFAULT_SITE_URL
	const url = new URL(`https://${host}`)
	if (url.host.toLowerCase() !== host.toLowerCase()) {
		throw new Error('DOMAIN must contain only a hostname (and optional port)')
	}
	return url.origin
}
