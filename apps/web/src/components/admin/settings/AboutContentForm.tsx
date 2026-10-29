import { type ArticleBlocksDoc, isArticleBlockUrl } from '@sinshin/shared'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { ArField } from '#/components/admin/ArField'
import { ArticlePageBuilder } from '#/components/admin/articles/builder/ArticlePageBuilder'
import { ConfirmModal } from '#/components/ConfirmModal'
import { ImageField } from '#/components/shared/ImageField'
import { MapPicker } from '#/components/shared/MapPicker'
import type { AboutContent, AboutContentInput } from '#/types/site/about'
import { isNeshanCoord } from '#/utils/neshanLinks'

interface AboutContentFormProps {
	initialData: AboutContent
	isSaving: boolean
	onSave: (input: AboutContentInput) => Promise<unknown>
}

const inputCls =
	'w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-[#1a0a0e] border border-gray-200 dark:border-[#3a151c] focus:border-primary outline-none text-gray-800 dark:text-white text-sm'
const secondaryCls =
	'px-4 py-2 rounded-xl border border-gray-200 dark:border-[#3a151c] text-sm font-DanaMedium cursor-pointer hover:bg-gray-50 dark:hover:bg-white/5 disabled:opacity-50'
const emptyBlocks: ArticleBlocksDoc = { version: 1, blocks: [] }
type BlockLanguage = 'fa' | 'ar'
type DeleteTarget = 'team' | BlockLanguage
type ContentPatch =
	| Partial<AboutContentInput>
	| ((previous: AboutContentInput) => Partial<AboutContentInput>)

function blocksError(doc: ArticleBlocksDoc | null | undefined): string | null {
	for (const block of doc?.blocks ?? []) {
		if (
			block.type === 'location' &&
			!isNeshanCoord(block.props.lat, block.props.lng)
		)
			return 'برای بلوک موقعیت، مختصات معتبر وارد کنید.'
		if (
			block.type === 'link' &&
			(!block.props.label.trim() || !isArticleBlockUrl(block.props.href))
		)
			return 'برای بلوک لینک، متن دکمه و یک پیوند معتبر وارد کنید.'
		if (
			block.type === 'cta' &&
			(!block.props.label.trim() ||
				(block.props.to === 'url' && !isArticleBlockUrl(block.props.href)))
		)
			return 'برای دکمه اقدام، متن دکمه و مقصد معتبر وارد کنید.'
		if (block.type === 'gallery' && block.props.images.length > 12) {
			return 'حداکثر ۱۲ عکس در هر بلوک گالری مجاز است.'
		}
	}
	return null
}

function fieldsFromContent(content: AboutContent): AboutContentInput {
	return {
		heroTitle: content.heroTitle,
		heroText: content.heroText,
		heroGradient: content.heroGradient,
		teamTitle: content.teamTitle,
		teamGradient: content.teamGradient,
		teamAlt: content.teamAlt,
		heroTitleAr: content.heroTitleAr ?? '',
		heroTextAr: content.heroTextAr ?? '',
		teamTitleAr: content.teamTitleAr ?? '',
		teamAltAr: content.teamAltAr ?? '',
		blocks: content.blocks ?? null,
		blocksAr: content.blocksAr ?? null,
		location: content.location ? { ...content.location } : null,
	}
}

export const AboutContentForm = memo(function AboutContentForm({
	initialData,
	isSaving,
	onSave,
}: AboutContentFormProps) {
	const [form, setForm] = useState<AboutContentInput>(() =>
		fieldsFromContent(initialData),
	)
	const [isDirty, setIsDirty] = useState(false)
	const [saving, setSaving] = useState(false)
	const [saveError, setSaveError] = useState<string | null>(null)
	const [validMapDraft, setValidMapDraft] = useState(true)
	const [mapRevision, setMapRevision] = useState(0)
	const [blockLanguage, setBlockLanguage] = useState<BlockLanguage>('fa')
	const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
	const savingRef = useRef(false)
	const revisionRef = useRef(0)
	const appliedVersionRef = useRef(new Date(initialData.updatedAt).getTime())
	const busy = isSaving || saving
	const location = form.location ?? initialData.defaultLocation ?? null
	const defaultLocationRef = useRef(initialData.defaultLocation)
	defaultLocationRef.current = initialData.defaultLocation
	const validLocation =
		!!location && isNeshanCoord(location.lat, location.lng) && validMapDraft
	const canSave = isDirty && !!form.heroTitle.trim() && validLocation && !busy

	// Consume every incoming version, even while dirty. Otherwise an ignored
	// pre-save response could overwrite the saved draft if the next refetch fails.
	useEffect(() => {
		const version = new Date(initialData.updatedAt).getTime()
		if (version === appliedVersionRef.current) return
		appliedVersionRef.current = version
		if (isDirty || savingRef.current) return
		setForm(fieldsFromContent(initialData))
		setValidMapDraft(true)
	}, [initialData, isDirty])

	const edit = useCallback((patch: ContentPatch) => {
		revisionRef.current++
		setIsDirty(true)
		setSaveError(null)
		setForm((previous) => ({
			...previous,
			...(typeof patch === 'function' ? patch(previous) : patch),
		}))
	}, [])

	const changeMapValidity = useCallback((valid: boolean) => {
		setValidMapDraft(valid)
		if (!valid) {
			// A partial coordinate is still an unsaved edit; a refetch must not
			// replace it with the previously saved pin.
			revisionRef.current++
			setIsDirty(true)
			setSaveError(null)
		}
	}, [])

	const changeLocation = useCallback((coords: { lat: number; lng: number }) => {
		revisionRef.current++
		setIsDirty(true)
		setSaveError(null)
		setValidMapDraft(true)
		setForm((previous) => ({
			...previous,
			location: {
				...(previous.location ?? defaultLocationRef.current),
				...coords,
				address:
					(previous.location ?? defaultLocationRef.current)?.address ?? '',
			},
		}))
	}, [])

	const changeAddress = useCallback(
		(field: 'address' | 'addressAr', value: string) => {
			edit((previous) => {
				const point = previous.location ?? defaultLocationRef.current
				return point ? { location: { ...point, [field]: value } } : {}
			})
		},
		[edit],
	)

	const save = async (event: React.FormEvent) => {
		event.preventDefault()
		if (!canSave || savingRef.current) return
		for (const language of ['fa', 'ar'] as const) {
			const error = blocksError(language === 'fa' ? form.blocks : form.blocksAr)
			if (error) {
				setBlockLanguage(language)
				setSaveError(
					`${language === 'fa' ? 'محتوای فارسی' : 'محتوای عربی'}: ${error}`,
				)
				return
			}
		}
		savingRef.current = true
		setSaving(true)
		setSaveError(null)
		const revision = revisionRef.current
		try {
			await onSave(form)
			if (revision === revisionRef.current) setIsDirty(false)
		} catch (error) {
			setSaveError(
				error instanceof Error && error.message
					? error.message
					: 'ذخیره انجام نشد. تغییرات شما حفظ شده است؛ دوباره تلاش کنید.',
			)
		} finally {
			savingRef.current = false
			setSaving(false)
		}
	}

	const removeContent = () => {
		if (deleteTarget === 'team') {
			edit({
				teamTitle: '',
				teamTitleAr: '',
				teamAlt: '',
				teamAltAr: '',
				teamGradient: '',
			})
		} else if (deleteTarget) {
			edit(deleteTarget === 'fa' ? { blocks: null } : { blocksAr: null })
		}
		setDeleteTarget(null)
	}
	const activeBlocks = blockLanguage === 'fa' ? form.blocks : form.blocksAr
	const hasTeam = !!(
		form.teamTitle ||
		form.teamTitleAr ||
		form.teamGradient ||
		form.teamAlt ||
		form.teamAltAr
	)

	return (
		<form
			onSubmit={save}
			className="overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm dark:border-[#3a151c] dark:bg-[#2a1015]"
		>
			<div className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-100 bg-gray-50/70 p-5 sm:p-7 dark:border-white/10 dark:bg-white/5">
				<div>
					<h3 className="font-DanaDemiBold text-xl text-gray-800 dark:text-white">
						صفحه درباره ما
					</h3>
					<p className="mt-2 max-w-2xl text-sm leading-6 text-gray-500 dark:text-gray-400">
						داستان رستوران، تصاویر و بخش‌های دلخواه را مدیریت کنید و موقعیت دقیق
						رستوران را روی نقشه نشان مشخص کنید.
					</p>
				</div>
				<a
					href="/about"
					target="_blank"
					rel="noopener noreferrer"
					className={secondaryCls}
				>
					مشاهده صفحه منتشرشده ↗
				</a>
			</div>

			<fieldset disabled={busy} className="min-w-0 space-y-9 p-5 sm:p-7">
				<section aria-label="معرفی رستوران" className="space-y-5">
					<div>
						<h4 className="font-DanaDemiBold text-lg text-gray-800 dark:text-white">
							معرفی رستوران
						</h4>
						<p className="mt-1 text-xs leading-6 text-gray-500 dark:text-gray-400">
							عنوان صفحه الزامی است؛ متن و تصاویر را می‌توانید حذف یا جایگزین
							کنید.
						</p>
					</div>
					<div className="grid gap-6 lg:grid-cols-2">
						<div className="space-y-4">
							<label className="block space-y-2 text-sm text-gray-700 dark:text-gray-300">
								<span>عنوان اصلی</span>
								<input
									name="heroTitle"
									required
									maxLength={120}
									value={form.heroTitle}
									onChange={(event) => edit({ heroTitle: event.target.value })}
									className={inputCls}
								/>
							</label>
							<label className="block space-y-2 text-sm text-gray-700 dark:text-gray-300">
								<span>داستان برند</span>
								<textarea
									name="heroText"
									rows={6}
									maxLength={2000}
									value={form.heroText}
									onChange={(event) => edit({ heroText: event.target.value })}
									className={`${inputCls} leading-8`}
								/>
							</label>
						</div>
						<div className="space-y-4">
							<ImageField
								label="تصویر اصلی (اختیاری)"
								accept="image/webp,image/png"
								fileTypeText="WebP/PNG"
								images={form.heroGradient ? [form.heroGradient] : []}
								onAdd={(url) => edit({ heroGradient: url })}
								onRemove={() => edit({ heroGradient: '' })}
							/>
							<details className="rounded-xl border border-gray-200 p-4 dark:border-[#3a151c]">
								<summary className="cursor-pointer text-sm font-DanaMedium">
									ترجمه عربی معرفی
								</summary>
								<div className="mt-4 space-y-4">
									<ArField
										label="عنوان اصلی"
										value={form.heroTitleAr}
										onChange={(value) => edit({ heroTitleAr: value })}
										arAuto={initialData.arAuto}
										faReference={form.heroTitle}
										maxLength={120}
									/>
									<ArField
										label="داستان برند"
										value={form.heroTextAr}
										onChange={(value) => edit({ heroTextAr: value })}
										arAuto={initialData.arAuto}
										faReference={form.heroText}
										multiline
										rows={6}
										maxLength={2000}
									/>
								</div>
							</details>
						</div>
					</div>
				</section>

				<section
					aria-label="بخش تیم"
					className="space-y-5 border-t border-gray-100 pt-7 dark:border-white/10"
				>
					<div className="flex flex-wrap items-start justify-between gap-3">
						<div>
							<h4 className="font-DanaDemiBold text-lg text-gray-800 dark:text-white">
								تیم و فضای رستوران
							</h4>
							<p className="mt-1 text-xs leading-6 text-gray-500 dark:text-gray-400">
								این بخش اختیاری است. بخش خالی در صفحه نمایش داده نمی‌شود.
							</p>
						</div>
						{hasTeam && (
							<button
								type="button"
								className={`${secondaryCls} text-red-600 dark:text-red-400`}
								onClick={() => setDeleteTarget('team')}
							>
								حذف بخش تیم
							</button>
						)}
					</div>
					<div className="grid gap-6 lg:grid-cols-2">
						<div className="space-y-4">
							<label className="block space-y-2 text-sm text-gray-700 dark:text-gray-300">
								<span>عنوان بخش تیم</span>
								<input
									name="teamTitle"
									maxLength={120}
									value={form.teamTitle}
									onChange={(event) => edit({ teamTitle: event.target.value })}
									className={inputCls}
								/>
							</label>
							<label className="block space-y-2 text-sm text-gray-700 dark:text-gray-300">
								<span>توضیح تصویر تیم برای دسترس‌پذیری</span>
								<input
									name="teamAlt"
									maxLength={200}
									value={form.teamAlt}
									onChange={(event) => edit({ teamAlt: event.target.value })}
									className={inputCls}
								/>
							</label>
							<details className="rounded-xl border border-gray-200 p-4 dark:border-[#3a151c]">
								<summary className="cursor-pointer text-sm font-DanaMedium">
									ترجمه عربی بخش تیم
								</summary>
								<div className="mt-4 space-y-4">
									<ArField
										label="عنوان بخش تیم"
										value={form.teamTitleAr}
										onChange={(value) => edit({ teamTitleAr: value })}
										arAuto={initialData.arAuto}
										faReference={form.teamTitle}
										maxLength={120}
									/>
									<ArField
										label="توضیح تصویر تیم"
										value={form.teamAltAr}
										onChange={(value) => edit({ teamAltAr: value })}
										arAuto={initialData.arAuto}
										faReference={form.teamAlt}
										maxLength={200}
									/>
								</div>
							</details>
						</div>
						<ImageField
							label="تصویر تیم یا فضای رستوران (اختیاری)"
							accept="image/webp,image/png"
							fileTypeText="WebP/PNG"
							images={form.teamGradient ? [form.teamGradient] : []}
							onAdd={(url) => edit({ teamGradient: url })}
							onRemove={() => edit({ teamGradient: '' })}
						/>
					</div>
				</section>

				<section
					aria-label="محتوای تکمیلی"
					className="space-y-5 border-t border-gray-100 pt-7 dark:border-white/10"
				>
					<div className="flex flex-wrap items-start justify-between gap-3">
						<div>
							<h4 className="font-DanaDemiBold text-lg text-gray-800 dark:text-white">
								بخش‌های دلخواه
							</h4>
							<p className="mt-1 max-w-3xl text-xs leading-6 text-gray-500 dark:text-gray-400">
								متن، تصاویر، گالری و بخش‌های جدید اضافه کنید؛ ترتیب و ظاهر هر بخش
								قابل تغییر است. محتوای عربیِ خالی از نسخه فارسی استفاده می‌کند.
							</p>
						</div>
						<fieldset className="flex gap-2">
							<legend className="sr-only">زبان محتوای تکمیلی</legend>
							{(['fa', 'ar'] as const).map((language) => (
								<button
									key={language}
									type="button"
									aria-pressed={blockLanguage === language}
									onClick={() => setBlockLanguage(language)}
									className={`${secondaryCls} ${blockLanguage === language ? 'border-primary bg-primary/10 text-primary dark:text-dark-primary' : ''}`}
								>
									{language === 'fa' ? 'فارسی' : 'عربی'}
								</button>
							))}
						</fieldset>
					</div>
					<ArticlePageBuilder
						key={blockLanguage}
						requireText={false}
						doc={activeBlocks ?? emptyBlocks}
						onChange={(doc) =>
							edit(blockLanguage === 'fa' ? { blocks: doc } : { blocksAr: doc })
						}
					/>
					{!!activeBlocks?.blocks.length && (
						<button
							type="button"
							onClick={() => setDeleteTarget(blockLanguage)}
							className={`${secondaryCls} text-red-600 dark:text-red-400`}
						>
							{blockLanguage === 'fa'
								? 'حذف همه بخش‌های فارسی'
								: 'حذف محتوای عربی و استفاده از فارسی'}
						</button>
					)}
				</section>

				<section
					aria-label="موقعیت رستوران"
					className="space-y-5 border-t border-gray-100 pt-7 dark:border-white/10"
				>
					<div>
						<h4 className="font-DanaDemiBold text-lg text-gray-800 dark:text-white">
							موقعیت رستوران روی نشان
						</h4>
						<p className="mt-1 text-xs leading-6 text-gray-500 dark:text-gray-400">
							نقطه دقیق ورودی رستوران را انتخاب کنید. این موقعیت همراه با دکمه
							«مسیریابی از موقعیت من» در پایین صفحه نمایش داده می‌شود.
						</p>
					</div>
					<div className="grid items-start gap-6 lg:grid-cols-2">
						<MapPicker
							key={mapRevision}
							value={location ?? null}
							onChange={changeLocation}
							onValidityChange={changeMapValidity}
						/>
						<div className="space-y-4">
							<label className="block space-y-2 text-sm text-gray-700 dark:text-gray-300">
								<span>آدرس رستوران</span>
								<textarea
									name="locationAddress"
									rows={3}
									maxLength={500}
									disabled={!location}
									value={location?.address ?? ''}
									onChange={(event) =>
										changeAddress('address', event.target.value)
									}
									className={`${inputCls} leading-7`}
								/>
							</label>
							<ArField
								label="آدرس رستوران"
								disabled={!location}
								value={location?.addressAr ?? ''}
								onChange={(value) => changeAddress('addressAr', value)}
								faReference={location?.address}
								multiline
								maxLength={500}
							/>
							{initialData.defaultLocation && (
								<div className="space-y-2 text-xs leading-6 text-gray-500 dark:text-gray-400">
									<p>
										{form.location
											? 'موقعیت اختصاصی صفحه درباره ما انتخاب شده است.'
											: 'از موقعیت رستوران در تنظیمات اصلی استفاده می‌شود.'}
									</p>
									{form.location && (
										<button
											type="button"
											className={secondaryCls}
											onClick={() => {
												edit({ location: null })
												setValidMapDraft(true)
												setMapRevision((revision) => revision + 1)
											}}
										>
											استفاده از موقعیت تنظیمات اصلی
										</button>
									)}
								</div>
							)}
							{!validLocation && (
								<p
									role="alert"
									className="text-xs leading-6 text-red-600 dark:text-red-400"
								>
									برای ذخیره، موقعیت معتبر رستوران را انتخاب و مختصات ناقص را
									اصلاح کنید.
								</p>
							)}
						</div>
					</div>
				</section>
			</fieldset>

			<div className="flex flex-wrap items-center justify-between gap-4 border-t border-gray-100 bg-gray-50/70 p-5 sm:p-7 dark:border-white/10 dark:bg-white/5">
				<div aria-live="polite">
					<p className="text-sm font-DanaMedium text-gray-700 dark:text-gray-300">
						{busy
							? 'در حال ذخیره...'
							: isDirty
								? 'تغییرات ذخیره‌نشده دارید'
								: 'همه تغییرات ذخیره شده‌اند'}
					</p>
					<p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
						آخرین ویرایش:{' '}
						{new Date(initialData.updatedAt).toLocaleString('fa-IR')}
					</p>
					{saveError && (
						<p
							role="alert"
							className="mt-2 text-sm text-red-600 dark:text-red-400"
						>
							{saveError}
						</p>
					)}
				</div>
				<button
					type="submit"
					disabled={!canSave}
					className="cursor-pointer rounded-xl bg-primary px-7 py-3 text-sm font-DanaDemiBold text-white transition hover:opacity-90 disabled:opacity-50 dark:bg-dark-primary"
				>
					{busy ? 'در حال ذخیره...' : 'ذخیره تغییرات'}
				</button>
			</div>
			<ConfirmModal
				isOpen={deleteTarget !== null}
				title="حذف محتوا"
				message="این محتوا از پیش‌نویس حذف می‌شود. برای اعمال در سایت، تغییرات را ذخیره کنید."
				onConfirm={removeContent}
				onCancel={() => setDeleteTarget(null)}
			/>
		</form>
	)
})
