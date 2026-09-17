export interface TransformState {
	scale: number;
	tx: number;
	ty: number;
}

export interface GestureOptions {
	minScale: number;
	maxScale: number;
	onChange: (state: TransformState) => void;
	getState: () => TransformState;
	setState: (state: TransformState) => void;
	onDoubleTap?: () => void;
}

/**
 * Unified pointer / pinch / wheel gestures for the lightbox stage.
 */
export class GestureController {
	private el: HTMLElement;
	private opts: GestureOptions;
	private pointers = new Map<number, { x: number; y: number }>();
	private dragging = false;
	private dragOrigin = { x: 0, y: 0 };
	private startTx = 0;
	private startTy = 0;
	private pinching = false;
	private pinchStartDist = 0;
	private pinchStartScale = 1;
	private pinchMid = { x: 0, y: 0 };
	private lastTapTime = 0;
	private lastTapPos = { x: 0, y: 0 };
	private unbound: Array<() => void> = [];

	constructor(el: HTMLElement, opts: GestureOptions) {
		this.el = el;
		this.opts = opts;
		this.bind();
	}

	destroy(): void {
		for (const off of this.unbound) off();
		this.unbound = [];
		this.pointers.clear();
	}

	private on<K extends keyof HTMLElementEventMap>(
		target: HTMLElement | Document,
		type: K,
		handler: (ev: HTMLElementEventMap[K]) => void,
		options?: AddEventListenerOptions,
	): void {
		const listener = handler as EventListener;
		target.addEventListener(type, listener, options);
		this.unbound.push(() => target.removeEventListener(type, listener, options));
	}

	private bind(): void {
		this.on(this.el, "pointerdown", (e) => this.onPointerDown(e));
		this.on(this.el, "pointermove", (e) => this.onPointerMove(e));
		this.on(this.el, "pointerup", (e) => this.onPointerUp(e));
		this.on(this.el, "pointercancel", (e) => this.onPointerUp(e));
		this.on(
			this.el,
			"wheel",
			(e) => {
				e.preventDefault();
				this.onWheel(e);
			},
			{ passive: false },
		);
		// Prevent native page scroll / browser gestures while interacting
		this.on(
			this.el,
			"touchmove",
			(e) => {
				e.preventDefault();
			},
			{ passive: false },
		);
	}

	private onPointerDown(e: PointerEvent): void {
		if (e.button !== 0 && e.pointerType === "mouse") return;
		this.el.setPointerCapture(e.pointerId);
		this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

		if (this.pointers.size === 1) {
			const state = this.opts.getState();
			this.dragging = true;
			this.pinching = false;
			this.dragOrigin = { x: e.clientX, y: e.clientY };
			this.startTx = state.tx;
			this.startTy = state.ty;
			this.el.classList.add("is-dragging");
			this.maybeDoubleTap(e);
		} else if (this.pointers.size === 2) {
			this.dragging = false;
			this.pinching = true;
			const pts = [...this.pointers.values()];
			const a = pts[0]!;
			const b = pts[1]!;
			this.pinchStartDist = distance(a, b);
			this.pinchStartScale = this.opts.getState().scale;
			this.pinchMid = midpoint(a, b);
		}
	}

	private onPointerMove(e: PointerEvent): void {
		if (!this.pointers.has(e.pointerId)) return;
		this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

		if (this.pinching && this.pointers.size >= 2) {
			const pts = [...this.pointers.values()];
			const a = pts[0]!;
			const b = pts[1]!;
			const dist = distance(a, b);
			if (this.pinchStartDist <= 0) return;
			const nextScale = clamp(
				this.pinchStartScale * (dist / this.pinchStartDist),
				this.opts.minScale,
				this.opts.maxScale,
			);
			this.zoomAround(this.pinchMid.x, this.pinchMid.y, nextScale);
			return;
		}

		if (this.dragging && this.pointers.size === 1) {
			const dx = e.clientX - this.dragOrigin.x;
			const dy = e.clientY - this.dragOrigin.y;
			const state = this.opts.getState();
			this.opts.setState({
				...state,
				tx: this.startTx + dx,
				ty: this.startTy + dy,
			});
			this.opts.onChange(this.opts.getState());
		}
	}

	private onPointerUp(e: PointerEvent): void {
		this.pointers.delete(e.pointerId);
		try {
			this.el.releasePointerCapture(e.pointerId);
		} catch {
			/* already released */
		}

		if (this.pointers.size < 2) {
			this.pinching = false;
		}
		if (this.pointers.size === 0) {
			this.dragging = false;
			this.el.classList.remove("is-dragging");
		} else if (this.pointers.size === 1) {
			// Resume single-finger pan from remaining pointer
			const remaining = [...this.pointers.values()][0]!;
			const state = this.opts.getState();
			this.dragging = true;
			this.dragOrigin = { x: remaining.x, y: remaining.y };
			this.startTx = state.tx;
			this.startTy = state.ty;
		}
	}

	private onWheel(e: WheelEvent): void {
		const state = this.opts.getState();
		const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
		const next = clamp(
			state.scale * factor,
			this.opts.minScale,
			this.opts.maxScale,
		);
		this.zoomAround(e.clientX, e.clientY, next);
	}

	private maybeDoubleTap(e: PointerEvent): void {
		const now = Date.now();
		const dt = now - this.lastTapTime;
		const dist = Math.hypot(e.clientX - this.lastTapPos.x, e.clientY - this.lastTapPos.y);
		this.lastTapTime = now;
		this.lastTapPos = { x: e.clientX, y: e.clientY };
		if (dt > 0 && dt < 300 && dist < 28) {
			this.opts.onDoubleTap?.();
			this.lastTapTime = 0;
		}
	}

	/** Zoom so the point under (clientX, clientY) stays fixed. */
	zoomAround(clientX: number, clientY: number, nextScale: number): void {
		const state = this.opts.getState();
		const rect = this.el.getBoundingClientRect();
		const cx = clientX - rect.left - rect.width / 2;
		const cy = clientY - rect.top - rect.height / 2;
		const ratio = nextScale / state.scale;
		const next: TransformState = {
			scale: nextScale,
			tx: cx - (cx - state.tx) * ratio,
			ty: cy - (cy - state.ty) * ratio,
		};
		this.opts.setState(next);
		this.opts.onChange(next);
	}
}

function distance(
	a: { x: number; y: number },
	b: { x: number; y: number },
): number {
	return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(
	a: { x: number; y: number },
	b: { x: number; y: number },
): { x: number; y: number } {
	return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function clamp(n: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, n));
}
