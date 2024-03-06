import { EventEmitter } from 'events';
import { getTrianglePoints, mergeObjects } from '../utils';
import { Dot, Mouse, RectRenderQueue, Stroke, Text, TooltipField, TriangleDirections } from '../types';
import { OffscreenRenderEngine } from './offscreen-render-engine';
import { RenderEngine } from './render-engine';
import { DefaultPatterns, defaultPatterns, Pattern, PatternCreator } from '../patterns';

// eslint-disable-next-line prettier/prettier -- prettier complains about escaping of the " character
const allChars = 'QWERTYUIOPASDFGHJKLZXCVBNMqwertyuiopasdfghjklzxcvbnm1234567890_-+()[]{}\\/|\'";:.,?~';

const checkSafari = () => {
    const ua = navigator.userAgent.toLowerCase();

    return ua.includes('safari') ? !ua.includes('chrome') : false;
};

function getPixelRatio(context: CanvasRenderingContext2D) {
    // Unfortunately using any here, since typescript is not aware of all of the browser prefixes
    const ctx = context as any;
    const dpr = window.devicePixelRatio || 1;
    const bsr =
        ctx.webkitBackingStorePixelRatio ||
        ctx.mozBackingStorePixelRatio ||
        ctx.msBackingStorePixelRatio ||
        ctx.oBackingStorePixelRatio ||
        ctx.backingStorePixelRatio ||
        1;

    return dpr / bsr;
}

export type RenderOptions = {
    tooltip?:
        | ((data: any, renderEngine: RenderEngine | OffscreenRenderEngine, mouse: Mouse | null) => boolean | void)
        | boolean;
    timeUnits: string;
};

export type RenderStyles = {
    blockHeight: number;
    blockPaddingLeftRight: number;
    backgroundColor: string;
    font: string;
    fontColor: string;
    badgeSize: number;
    tooltipHeaderFontColor: string;
    tooltipBodyFontColor: string;
    tooltipBackgroundColor: string;
    tooltipShadowColor: string;
    tooltipShadowBlur: number;
    tooltipShadowOffsetX: number;
    tooltipShadowOffsetY: number;
    headerHeight: number;
    headerColor: string;
    headerStrokeColor: string;
    headerTitleLeftPadding: number;
};

export type CustomPattern = { name: string; creator: PatternCreator };
export type RenderPatterns = Array<DefaultPatterns | CustomPattern>;

export type RenderSettings = {
    options?: Partial<RenderOptions>;
    styles?: Partial<RenderStyles>;
    patterns?: RenderPatterns;
};

export const defaultRenderSettings: RenderOptions = {
    tooltip: undefined,
    timeUnits: 'ms',
};

export const defaultRenderStyles: RenderStyles = {
    blockHeight: 16,
    blockPaddingLeftRight: 4,
    backgroundColor: 'white',
    font: '10px sans-serif',
    fontColor: 'black',
    badgeSize: 8,
    tooltipHeaderFontColor: 'black',
    tooltipBodyFontColor: '#688f45',
    tooltipBackgroundColor: 'white',
    tooltipShadowColor: 'black',
    tooltipShadowBlur: 6,
    tooltipShadowOffsetX: 0,
    tooltipShadowOffsetY: 0,
    headerHeight: 14,
    headerColor: 'rgba(112, 112, 112, 0.25)',
    headerStrokeColor: 'rgba(112, 112, 112, 0.5)',
    headerTitleLeftPadding: 16,
};

export type Shadow = {
    color: string;
    blur: number;
    offsetX?: number;
    offsetY?: number;
};

export class BasicRenderEngine extends EventEmitter {
    width: number;
    height: number;
    isSafari: boolean;
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    pixelRatio: number;
    options: RenderOptions = defaultRenderSettings;
    timeUnits = 'ms';
    styles: RenderStyles = defaultRenderStyles;
    blockPaddingLeftRight = 0;
    blockHeight = 0;
    blockPaddingTopBottom = 0;
    charHeight = 0;
    placeholderWidth = 0;
    avgCharWidth = 0;
    minTextWidth = 0;
    queue: Record<
        string,
        {
            text: Text[];
            stroke: Stroke[];
            rect: RectRenderQueue;
        }
    > = {};
    zoom: number = 0;
    positionX = 0;
    min = 0;
    max = 0;
    patterns: Record<string, Pattern> = {};

    ctxCachedSettings = {};
    ctxCachedCalls = {};

    constructor(canvas: HTMLCanvasElement, settings: RenderSettings) {
        super();

        this.width = canvas.width;
        this.height = canvas.height;

        this.isSafari = checkSafari();
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d', { alpha: false })!;
        this.pixelRatio = getPixelRatio(this.ctx);

        this.setSettings(settings);

        this.applyCanvasSize();
        this.reset();
    }

    setSettings({ options, styles, patterns }: RenderSettings) {
        this.options = mergeObjects(defaultRenderSettings, options);
        this.styles = mergeObjects(defaultRenderStyles, styles);

        if (patterns) {
            const customPatterns = patterns.filter((preset) => 'creator' in preset) as CustomPattern[];
            const defaultPatterns = patterns.filter((preset) => !('creator' in preset)) as DefaultPatterns[];

            defaultPatterns.forEach((pattern) => this.createDefaultPattern(pattern));
            customPatterns.forEach((pattern) => this.createBlockPattern(pattern));
        }

        this.timeUnits = this.options.timeUnits;

        this.blockHeight = this.styles.blockHeight;
        this.ctx.font = this.styles.font;

        const {
            actualBoundingBoxAscent: fontAscent,
            actualBoundingBoxDescent: fontDescent,
            width: allCharsWidth,
        } = this.ctx.measureText(allChars);
        const { width: placeholderWidth } = this.ctx.measureText('…');
        const fontHeight = fontAscent + fontDescent;

        this.blockPaddingLeftRight = this.styles.blockPaddingLeftRight;
        this.blockPaddingTopBottom = Math.ceil((this.blockHeight - fontHeight) / 2);
        this.charHeight = fontHeight + 1;
        this.placeholderWidth = placeholderWidth;
        this.avgCharWidth = allCharsWidth / allChars.length;
        this.minTextWidth = this.avgCharWidth + this.placeholderWidth;
    }

    reset() {
        this.queue = {};
        this.ctxCachedCalls = {};
        this.ctxCachedSettings = {};
    }

    setCtxValue = (field: string, value: number | string) => {
        if (this.ctxCachedSettings[field] !== value) {
            this.ctx[field] = value;
            this.ctxCachedSettings[field] = value;
        }
    };

    callCtx = (fn, value) => {
        if (!this.ctxCachedCalls[fn] || this.ctxCachedCalls[fn] !== value) {
            this.ctx[fn](value);
            this.ctxCachedCalls[fn] = value;
        }
    };

    setCtxShadow(shadow: Shadow) {
        this.setCtxValue('shadowBlur', shadow.blur);
        this.setCtxValue('shadowColor', shadow.color);
        this.setCtxValue('shadowOffsetY', shadow.offsetY ?? 0);
        this.setCtxValue('shadowOffsetX', shadow.offsetX ?? 0);
    }

    setCtxFont(font: string) {
        if (font && this.ctx.font !== font) {
            this.ctx.font = font;
        }
    }

    fillRect(x: number, y: number, w: number, h: number) {
        this.ctx.fillRect(x, y, w, h);
    }

    fillText(text: string, x: number, y: number) {
        this.ctx.fillText(text, x, y);
    }

    renderBlock(x: number, y: number, w: number, h?: number) {
        const truncatedX = Math.min(this.width, Math.max(0, x));
        const delta = truncatedX - x;
        const width = Math.min(this.width - truncatedX, Math.max(0, w - delta));

        this.ctx.fillRect(truncatedX, y, width, h ?? this.blockHeight);
    }

    renderStroke(color: string, x: number, y: number, w: number, h: number) {
        this.setCtxValue('strokeStyle', color);
        this.ctx.setLineDash([]);
        this.ctx.lineWidth = 1.5; // 设置选中线宽度
        this.ctx.strokeRect(x, y, w, h);
    }

    clear(w = this.width, h = this.height, x = 0, y = 0) {
        this.setCtxValue('fillStyle', this.styles.backgroundColor);
        this.ctx.clearRect(x, y, w, h - 1);
        this.ctx.fillRect(x, y, w, h);

        this.ctxCachedCalls = {};
        this.ctxCachedSettings = {};

        this.emit('clear');
    }

    timeToPosition(time: number) {
        return time * this.zoom - this.positionX * this.zoom;
    }

    pixelToTime(width: number) {
        return width / this.zoom;
    }

    setZoom(zoom: number) {
        this.zoom = zoom;
    }

    setPositionX(x: number) {
        const currentPos = this.positionX;

        this.positionX = x;

        return x - currentPos;
    }

    getQueue(priority: number = 0) {
        const queue = this.queue[priority];

        if (!queue) {
            this.queue[priority] = { text: [], stroke: [], rect: {} };
        }

        return this.queue[priority];
    }

    addRect(
        rect: { color: string; pattern?: string; x: number; y: number; w: number; h?: number },
        priority: number = 0,
    ) {
        const queue = this.getQueue(priority);

        rect.pattern = rect.pattern || 'none';

        if (!queue.rect[rect.pattern]) {
            queue.rect[rect.pattern] = {};
        }

        if (!queue.rect[rect.pattern][rect.color]) {
            queue.rect[rect.pattern][rect.color] = [];
        }

        queue.rect[rect.pattern][rect.color].push(rect);
    }

    addText({ text, x, y, w }: { text: string; x: number; y: number; w: number }, priority: number = 0) {
        if (text) {
            const textMaxWidth = w - (this.blockPaddingLeftRight * 2 - (x < 0 ? x : 0));

            if (textMaxWidth > 0) {
                const queue = this.getQueue(priority);

                queue.text.push({ text, x, y, w, textMaxWidth });
            }
        }
    }

    addStroke(stroke: { color: string; x: number; y: number; w: number; h: number }, priority: number = 0) {
        const queue = this.getQueue(priority);

        queue.stroke.push(stroke);
    }

    resolveQueue() {
        Object.keys(this.queue)
            .map((priority) => parseInt(priority))
            .sort()
            .forEach((priority) => {
                const { rect, text, stroke } = this.queue[priority];

                this.renderRects(rect);
                this.renderTexts(text);
                this.renderStrokes(stroke);
            });

        this.queue = {};
    }

    renderRects(rects: RectRenderQueue) {
        Object.entries(rects).forEach(([patternName, colors]) => {
            let matrix = new DOMMatrixReadOnly();
            let pattern;

            if (patternName !== 'none' && this.patterns[patternName]) {
                pattern = this.patterns[patternName];

                if (pattern.scale !== 1) {
                    matrix = matrix.scale(1 / pattern.scale, 1 / pattern.scale);
                }

                this.ctx.fillStyle = pattern.pattern;
                this.ctxCachedSettings['fillStyle'] = patternName;
            }

            Object.entries(colors).forEach(([color, items]) => {
                if (!pattern) {
                    this.setCtxValue('fillStyle', color);
                }

                items.forEach((rect) => {
                    if (pattern) {
                        const fullDeltaX = rect.x * pattern.scale;
                        const deltaX = fullDeltaX - Math.floor(fullDeltaX / pattern.width) * pattern.width;

                        pattern.pattern.setTransform(matrix.translate(deltaX, rect.y * pattern.scale));
                    }

                    this.renderBlock(rect.x, rect.y, rect.w, rect.h);
                });
            });
        });
    }

    renderTexts(texts: Text[]) {
        this.setCtxValue('fillStyle', this.styles.fontColor);

        texts.forEach(({ text, x, y, textMaxWidth }) => {
            const { width: textWidth } = this.ctx.measureText(text);

            if (textWidth > textMaxWidth) {
                const avgCharWidth = textWidth / text.length;
                const maxChars = Math.floor((textMaxWidth - this.placeholderWidth) / avgCharWidth);
                const halfChars = (maxChars - 1) / 2;

                if (halfChars > 0) {
                    text =
                        text.slice(0, Math.ceil(halfChars)) +
                        '…' +
                        text.slice(text.length - Math.floor(halfChars), text.length);
                } else {
                    text = '';
                }
            }

            if (text) {
                this.ctx.fillText(
                    text,
                    (x < 0 ? 0 : x) + this.blockPaddingLeftRight,
                    y + this.blockHeight - this.blockPaddingTopBottom,
                );
            }
        });
    }

    renderStrokes(strokes: Stroke[]) {
        strokes.forEach(({ color, x, y, w, h }) => {
            this.renderStroke(color, x, y, w, h);
        });
    }

    setMinMax(min: number, max: number) {
        const hasChanges = min !== this.min || max !== this.max;

        this.min = min;
        this.max = max;

        if (hasChanges) {
            this.emit('min-max-change', min, max);
        }
    }

    getTimeUnits() {
        return this.timeUnits;
    }

    tryToChangePosition(positionDelta: number) {
        const realView = this.getRealView();

        if (this.positionX + positionDelta + realView <= this.max && this.positionX + positionDelta >= this.min) {
            this.setPositionX(this.positionX + positionDelta);
        } else if (this.positionX + positionDelta <= this.min) {
            this.setPositionX(this.min);
        } else if (this.positionX + positionDelta + realView >= this.max) {
            this.setPositionX(this.max - realView);
        }
    }

    getInitialZoom() {
        if (this.max - this.min > 0) {
            return this.width / (this.max - this.min);
        }

        return 1;
    }

    getRealView() {
        return this.width / this.zoom;
    }

    resetView() {
        this.setZoom(this.getInitialZoom());
        this.setPositionX(this.min);
    }

    resize(width?: number, height?: number) {
        const resolvedWidth = Math.max(0, width || 0);
        const resolvedHeight = Math.max(0, height || 0);

        const isWidthChanged = typeof width === 'number' && this.width !== resolvedWidth;
        const isHeightChanged = typeof height === 'number' && this.height !== resolvedHeight;

        if (isWidthChanged || isHeightChanged) {
            this.width = isWidthChanged ? resolvedWidth : this.width;
            this.height = isHeightChanged ? resolvedHeight : this.height;

            this.applyCanvasSize();

            this.emit('resize', { width: this.width, height: this.height });

            return isHeightChanged;
        }

        return false;
    }

    applyCanvasSize() {
        this.canvas.style.backgroundColor = 'white';
        this.canvas.style.overflow = 'hidden';
        this.canvas.style.width = this.width + 'px';
        this.canvas.style.height = this.height + 'px';
        this.canvas.width = this.width * this.pixelRatio;
        this.canvas.height = this.height * this.pixelRatio;
        this.ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
        this.ctx.font = this.styles.font;
    }

    copy(engine: OffscreenRenderEngine) {
        const ratio = this.isSafari ? 1 : engine.pixelRatio;

        if (engine.canvas.height) {
            this.ctx.drawImage(
                engine.canvas,
                0,
                0,
                engine.canvas.width * ratio,
                engine.canvas.height * ratio,
                0,
                engine.position || 0,
                engine.width * ratio,
                engine.height * ratio,
            );
        }
    }

    createDefaultPattern({ name, type, config }: DefaultPatterns) {
        const defaultPattern = defaultPatterns[type];

        if (defaultPattern) {
            this.createBlockPattern({
                name,
                creator: defaultPattern(config as any),
            });
        }
    }

    createCachedDefaultPattern(pattern: DefaultPatterns) {
        if (!this.patterns[pattern.name]) {
            this.createDefaultPattern(pattern);
        }
    }

    createBlockPattern({ name, creator }: { name: string; creator: PatternCreator }) {
        this.patterns[name] = {
            scale: 1,
            width: 10,
            ...creator(this),
        };
    }

    renderTooltipFromData(fields: TooltipField[], mouse: Mouse) {
        const mouseX = mouse.x + 10;
        const mouseY = mouse.y + 10;

        const maxWidth = fields
            .map(({ text }) => text)
            .map((text) => this.ctx.measureText(text))
            .reduce((acc, { width }) => Math.max(acc, width), 0);
        const fullWidth = maxWidth + this.blockPaddingLeftRight * 2;

        this.setCtxShadow({
            color: this.styles.tooltipShadowColor,
            blur: this.styles.tooltipShadowBlur,
            offsetX: this.styles.tooltipShadowOffsetX,
            offsetY: this.styles.tooltipShadowOffsetY,
        });

        this.setCtxValue('fillStyle', this.styles.tooltipBackgroundColor);

        this.ctx.fillRect(
            mouseX,
            mouseY,
            fullWidth + this.blockPaddingLeftRight * 2,
            (this.charHeight + 2) * fields.length + this.blockPaddingLeftRight * 2,
        );

        this.setCtxShadow({
            color: 'transparent',
            blur: 0,
        });

        fields.forEach(({ text, color }, index) => {
            if (color) {
                this.setCtxValue('fillStyle', color);
            } else if (!index) {
                this.setCtxValue('fillStyle', this.styles.tooltipHeaderFontColor);
            } else {
                this.setCtxValue('fillStyle', this.styles.tooltipBodyFontColor);
            }

            this.ctx.fillText(
                text,
                mouseX + this.blockPaddingLeftRight,
                mouseY + this.blockHeight - this.blockPaddingTopBottom + (this.charHeight + 2) * index,
            );
        });
    }

    renderShape(color: string, dots: Dot[], posX: number, posY: number) {
        this.setCtxValue('fillStyle', color);

        this.ctx.beginPath();

        this.ctx.moveTo(dots[0].x + posX, dots[0].y + posY);

        dots.slice(1).forEach(({ x, y }) => this.ctx.lineTo(x + posX, y + posY));

        this.ctx.closePath();

        this.ctx.fill();
    }

    renderTriangle({
        color,
        x,
        y,
        width,
        height,
        direction,
    }: {
        color: string;
        x: number;
        y: number;
        width: number;
        height: number;
        direction: TriangleDirections;
    }) {
        this.renderShape(color, getTrianglePoints(width, height, direction), x, y);
    }

    renderCircle(color: string, x: number, y: number, radius: number) {
        this.ctx.beginPath();
        this.ctx.arc(x, y, radius, 0, 2 * Math.PI, false);
        this.setCtxValue('fillStyle', color);
        this.ctx.fill();
    }
}
