/** Enhancement only: missing browser APIs must leave article content readable. */
export function observeArticleBlocks(root: HTMLElement): () => void {
	const elements = root.querySelectorAll<HTMLElement>('[data-anim]')
	root.classList.remove('ab-js')
	const reduced =
		typeof window.matchMedia === 'function' &&
		window.matchMedia('(prefers-reduced-motion: reduce)').matches
	if (reduced || typeof IntersectionObserver === 'undefined') {
		for (const element of elements) element.classList.add('ab-inview')
		return () => root.classList.remove('ab-js')
	}

	const observer = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (!entry.isIntersecting) continue
				entry.target.classList.add('ab-inview')
				observer.unobserve(entry.target)
			}
		},
		{
			// A tall paragraph may never expose 15% of its area in a small viewport.
			threshold: 0,
			rootMargin: '0px 0px -8% 0px',
		},
	)
	for (const element of elements) {
		if (element.getAttribute('data-anim') === 'none')
			element.classList.add('ab-inview')
		else {
			element.classList.remove('ab-inview')
			observer.observe(element)
		}
	}
	root.classList.add('ab-js')
	return () => {
		observer.disconnect()
		root.classList.remove('ab-js')
	}
}
