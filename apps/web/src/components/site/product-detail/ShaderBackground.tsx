// src/components/site/product-detail/ShaderBackground.tsx
// ═══ stage-78 — sinshin-food-delivery ═══
// پس‌زمینه‌ی متحرکِ WebGL صفحه‌ی اختصاصی «محصول ویژه».
//
// منبع: کد جاوااسکریپت کارفرما (ShaderAnimation) — تبدیل‌شده به TypeScript و
// مچ‌شده با صفحه‌ی محصول. منطق شیدر (پالت کسینوسی + چهار لایه‌ی حلقه‌ی
// fract + موج + پوشش گرادیان) عمداً دست‌نخورده مانده؛ فقط این‌ها اضافه شد:
//   ① تم‌پذیری — سه یونیفرم تازه (u_grad1/u_grad2/u_soft):
//        دارک ⇒ مثل پس‌زمینه‌ی دارکِ کارت ویژه (Aurora): سیاه + خانواده‌ی
//               فیروزه‌ای/سرخابی عمیق — «همان چیزی که بود» (u_soft=0)
//        لایت ⇒ مثل Aurora لایتِ stage-78: سفید + پاستل‌های همان رنگ‌ها
//               (u_soft محو به سفید می‌کند)
//   ② رسپانسیو کامل — resize + devicePixelRatio (سقف ۲ — شارپ در رتینا،
//      بدون کشتن GPU موبایل) + pointermove (ماوس و لمس)
//   ③ prefers-reduced-motion — یک قاب ثابت (بدون حلقه‌ی rAF)
//   ④ webglcontextlost/restored — توقف/بازسازی (موبایل‌ها واقعاً می‌گیرند)
//   ⑤ بدون WebGL ⇒ fallback همان .aurora-card (لایت/دارک خودکار)
// حذف‌شده از دموی اصلی (عمداً): دکمه‌ی Interactive/Static و تایتل overlay —
// این پس‌زمینه‌ی صفحه است، نه دمو؛ تعامل با حرکت اشاره‌گر همیشه روشن است.

import { useEffect, useRef, useState } from 'react'
import { useThemeStore } from '#/stores/themeStore'

/** پالت هر تم — «عین پس‌زمینه‌ی کارت محصول ویژه» (stage-78):
 *  دارک = گرادیان‌های عمیق خانواده‌ی Aurora (سرمه‌ای-فیروزه‌ای + سرخابی)؛
 *  لایت = پاستل‌های روشن همان رنگ‌ها (مثل html:not(.dark) .aurora-card) */
interface ThemePalette {
	gradient1: readonly [number, number, number]
	gradient2: readonly [number, number, number]
	/** میزان محو به سفید — دارک ۰ (رفتار اصلی شیدر)، لایت ~۰٫۶۲ (پاستل) */
	soft: number
}

const DARK_PALETTE: ThemePalette = {
	// فیروزه‌ای عمیق (#00C2FF تیره‌شده — هم‌خانواده‌ی لکه‌ی ۶۲٪/۹٪ کارت)
	gradient1: [0.05, 0.24, 0.55],
	// سرخابی-بنفش (#E54CFF تیره‌شده — هم‌خانواده‌ی لکه‌ی ۵۱٪/۷۷٪ کارت)
	gradient2: [0.72, 0.17, 0.78],
	soft: 0,
}

const LIGHT_PALETTE: ThemePalette = {
	// پاستل فیروزه‌ای — rgba(0,194,255,0.25) روی سفید
	gradient1: [0.81, 0.9, 1.0],
	// پاستل سرخابی — rgba(229,76,255,0.24) روی سفید
	gradient2: [0.96, 0.83, 1.0],
	soft: 0.62,
}

// ─── شیدرها (منبع کارفرما — فقط یونیفرم‌های تم افزوده شده) ───

const VERTEX_SHADER_SOURCE = `
  attribute vec2 a_position;
  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`

const FRAGMENT_SHADER_SOURCE = `
  precision mediump float;

  uniform vec2 u_resolution;
  uniform float u_time;
  uniform vec2 u_mouse;
  // stage-78 — تم‌پذیری (دارک/لایت هم‌رنگ کارت ویژه)
  uniform vec3 u_grad1;
  uniform vec3 u_grad2;
  uniform float u_soft;

  vec3 palette(float t) {
    vec3 a = vec3(0.5, 0.5, 0.5);
    vec3 b = vec3(0.5, 0.5, 0.5);
    vec3 c = vec3(1.0, 1.0, 1.0);
    vec3 d = vec3(0.263, 0.416, 0.557);

    return a + b * cos(6.28318 * (c * t + d));
  }

  void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution.xy;
    vec2 uv0 = uv;
    uv = uv * 2.0 - 1.0;
    uv.x *= u_resolution.x / u_resolution.y;

    float d = length(uv);
    vec3 col = vec3(0.0);

    // Create multiple animated layers
    for(float i = 0.0; i < 4.0; i++) {
      uv = fract(uv * 1.5) - 0.5;

      d = length(uv) * exp(-length(uv0));
      vec3 color = palette(length(uv0) + i * 0.4 + u_time * 0.01);

      d = sin(d * 4.0 + u_time) / 36.0;

      d = pow(0.005 / d, 1.5);

      // Mouse interaction
      vec2 mouseEffect = u_mouse - uv0;
      float mouseDist = length(mouseEffect);
      d *= 1.0 + sin(mouseDist * 10.0 - u_time * 2.0) * 0.1;

      col += color * d;
    }

    // Add wave distortion
    float wave = sin(uv0.x * 2.0 + u_time) * 0.01;
    col += vec3(wave);

    // Add gradient overlay — stage-78: u_grad1/u_grad2 از تم می‌آیند
    vec3 gradientMix = mix(u_grad1, u_grad2, uv0.y + sin(u_time) * 0.2);
    col = mix(col, gradientMix, 0.3);

    // stage-78 — لایت: شسته‌شدن به سفید (پاستل — مثل Aurora لایت).
    // دارک: u_soft=0 ⇒ mix بدون اثر ⇒ «همان تصویر قبلی»
    col = mix(col, vec3(1.0), u_soft);

    gl_FragColor = vec4(col, 1.0);
  }
`

/** کمپایل شیدر + گزارش خطا (از کد کارفرما — با تایپ) */
function createShader(
	gl: WebGLRenderingContext,
	type: number,
	source: string,
): WebGLShader | null {
	const shader = gl.createShader(type)
	if (!shader) return null
	gl.shaderSource(shader, source)
	gl.compileShader(shader)
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		console.error('Shader compilation error:', gl.getShaderInfoLog(shader))
		gl.deleteShader(shader)
		return null
	}
	return shader
}

/** قاب ثاتی برای prefers-reduced-motion — ترکیب خوبی از پالت/موج */
const STATIC_FRAME_TIME = 8

export function ShaderBackground() {
	const canvasRef = useRef<HTMLCanvasElement | null>(null)
	const isDark = useThemeStore((s) => s.isDark)

	// پالت فعلی — حلقه‌ی رندر هر فریم از همین رفرنس می‌خواند (تعویض تم
	// بدون بازسازی GL؛ یک‌نواخت و بدون پرش)
	const paletteRef = useRef<ThemePalette>(isDark ? DARK_PALETTE : LIGHT_PALETTE)
	// قاب‌کشی دستی برای حالت قاب-ثابت (reduced-motion/تعویض تم/resize)
	const redrawStaticRef = useRef<(() => void) | null>(null)
	// stage-78 — reinit بعد از webglcontextrestored (اثر کلاینت)
	const [reinit, setReinit] = useState(0)
	// WebGL در دسترس نیست ⇒ fallback همان aurora-card
	const [glFailed, setGlFailed] = useState(false)

	// تعویض تم ⇒ پالت تازه (+ در حالت قاب-ثابت، یک قاب با پالت نو)
	useEffect(() => {
		paletteRef.current = isDark ? DARK_PALETTE : LIGHT_PALETTE
		redrawStaticRef.current?.()
	}, [isDark])

	useEffect(() => {
		// reinit یک شمارنده‌ی عمدی است — فقط برای اجرای دوباره‌ی همین
		// افکت بعد از webglcontextrestored (منابع GL از بین رفته‌اند)
		void reinit
		const canvasEl = canvasRef.current
		if (!canvasEl) return

		const glContext = canvasEl.getContext(
			'webgl',
		) as WebGLRenderingContext | null
		if (!glContext) {
			console.error('WebGL not supported')
			setGlFailed(true)
			return
		}
		// اسامی محلی غیر-nullable — تنگستنِ TS به داخل بسته‌ها (drawFrame و
		// handleResize) هم برسد
		const canvas: HTMLCanvasElement = canvasEl
		const gl: WebGLRenderingContext = glContext

		// ── برنامه‌ی شیدر ──
		const vertexShader = createShader(
			gl,
			gl.VERTEX_SHADER,
			VERTEX_SHADER_SOURCE,
		)
		const fragmentShader = createShader(
			gl,
			gl.FRAGMENT_SHADER,
			FRAGMENT_SHADER_SOURCE,
		)
		if (!vertexShader || !fragmentShader) {
			setGlFailed(true)
			return
		}

		const program = gl.createProgram()
		if (!program) {
			setGlFailed(true)
			return
		}
		gl.attachShader(program, vertexShader)
		gl.attachShader(program, fragmentShader)
		gl.linkProgram(program)
		if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
			console.error('Program linking error:', gl.getProgramInfoLog(program))
			setGlFailed(true)
			return
		}

		// ─── تمام‌صفحه (quad) ───
		const positions = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1])
		const positionBuffer = gl.createBuffer()
		gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
		gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW)

		const positionLocation = gl.getAttribLocation(program, 'a_position')
		const resolutionLocation = gl.getUniformLocation(program, 'u_resolution')
		const timeLocation = gl.getUniformLocation(program, 'u_time')
		const mouseLocation = gl.getUniformLocation(program, 'u_mouse')
		const grad1Location = gl.getUniformLocation(program, 'u_grad1')
		const grad2Location = gl.getUniformLocation(program, 'u_grad2')
		const softLocation = gl.getUniformLocation(program, 'u_soft')

		// ── ماوس/لمس (نرمال ۰..۱ با y معکوس — مثل کد اصلی) ──
		const mouse = { x: 0.5, y: 0.5 }
		const handlePointerMove = (e: PointerEvent) => {
			mouse.x = e.clientX / window.innerWidth
			mouse.y = 1.0 - e.clientY / window.innerHeight
		}
		window.addEventListener('pointermove', handlePointerMove)

		// ── قاب‌کشی ──
		const startTime = performance.now()
		function drawFrame(currentTime: number) {
			const { gradient1, gradient2, soft } = paletteRef.current
			gl.clearColor(0, 0, 0, 1)
			gl.clear(gl.COLOR_BUFFER_BIT)

			// biome-ignore lint/correctness/useHookAtTopLevel: متدِ WebGL است نه هوکِ React
			gl.useProgram(program)

			gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
			gl.enableVertexAttribArray(positionLocation)
			gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0)

			gl.uniform2f(resolutionLocation, canvas.width, canvas.height)
			gl.uniform1f(timeLocation, currentTime)
			gl.uniform2f(mouseLocation, mouse.x, mouse.y)
			gl.uniform3f(grad1Location, gradient1[0], gradient1[1], gradient1[2])
			gl.uniform3f(grad2Location, gradient2[0], gradient2[1], gradient2[2])
			gl.uniform1f(softLocation, soft)

			gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
		}

		const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

		// ── رسپانسیو: ابعاد پنجره × DPR (سقف ۲ — رتینا شارپ، GPU سبک) ──
		const dpr = Math.min(window.devicePixelRatio || 1, 2)
		const handleResize = () => {
			canvas.width = Math.round(window.innerWidth * dpr)
			canvas.height = Math.round(window.innerHeight * dpr)
			gl.viewport(0, 0, canvas.width, canvas.height)
			if (reducedMotion.matches) drawFrame(STATIC_FRAME_TIME)
		}
		handleResize()
		window.addEventListener('resize', handleResize)

		// ── حلقه‌ی انیمیشن / قاب-ثابت ──
		let animationId: number | null = null

		if (reducedMotion.matches) {
			drawFrame(STATIC_FRAME_TIME)
		} else {
			const render = () => {
				drawFrame((performance.now() - startTime) / 1000)
				animationId = requestAnimationFrame(render)
			}
			render()
		}

		// قاب دستی برای reduced-motion: تعویض تم/resize همین رفرنس را صدا می‌زنند
		redrawStaticRef.current = () => {
			if (reducedMotion.matches) drawFrame(STATIC_FRAME_TIME)
		}

		// ── از دست رفتن کانتکست (موبایل: پس‌زمینه‌ی تاره‌ی بی‌ته مجاز نیست) ──
		const handleContextLost = (e: Event) => {
			e.preventDefault() // اجازه‌ی restore بعداً
			if (animationId !== null) {
				cancelAnimationFrame(animationId)
				animationId = null
			}
		}
		const handleContextRestored = () => {
			// منابع GL با از دست رفتن کانتکست نابود شده‌اند —
			// بازسازی کامل با تکرارِ همین افکت (reinit++)
			setReinit((n) => n + 1)
		}
		canvas.addEventListener('webglcontextlost', handleContextLost)
		canvas.addEventListener('webglcontextrestored', handleContextRestored)

		// ── پاک‌سازی ──
		return () => {
			if (animationId !== null) cancelAnimationFrame(animationId)
			window.removeEventListener('pointermove', handlePointerMove)
			window.removeEventListener('resize', handleResize)
			canvas.removeEventListener('webglcontextlost', handleContextLost)
			canvas.removeEventListener('webglcontextrestored', handleContextRestored)
			redrawStaticRef.current = null
			// (حذف برنامه/بافر برای بازسازیِ امن reinit هم درست است —
			// هنگل‌های قدیمی روی کانتکستِ تازه بی‌اثرند)
			gl.deleteBuffer(positionBuffer)
			gl.deleteProgram(program)
			gl.deleteShader(vertexShader)
			gl.deleteShader(fragmentShader)
		}
	}, [reinit])

	return (
		<div
			className="fixed inset-0 z-0 overflow-hidden pointer-events-none"
			aria-hidden="true"
		>
			{glFailed ? (
				/* WebGL نیست ⇒ همان Aurora کارت (لایت/دارک خودکار) */
				<div className="h-full w-full aurora-card" />
			) : (
				<canvas ref={canvasRef} className="block h-full w-full" />
			)}
		</div>
	)
}
