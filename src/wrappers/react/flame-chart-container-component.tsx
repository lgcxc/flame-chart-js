import { useCallback, useEffect, useRef } from 'react';
import { UIPlugin, FlameChartContainer, FlameChartContainerSettings } from '../../index';
import useResizeObserver from 'use-resize-observer';

export type FlameChartContainerProps = {
    settings?: FlameChartContainerSettings;
    position?: { x: number; y: number };
    zoom?: {
        start: number;
        end: number;
    };
    hotkeys?: boolean;
    plugins: UIPlugin[];
    instance?: (instance: FlameChartContainer) => void;
    className?: string;
};

export const FlameChartContainerComponent = (props: FlameChartContainerProps) => {
    const boxRef = useRef<null | HTMLDivElement>(null);
    const canvasRef = useRef<null | HTMLCanvasElement>(null);
    const flameChart = useRef<null | FlameChartContainer>(null);

    useResizeObserver({
        ref: boxRef,
        onResize: ({ width = 0, height = 0 }) => flameChart.current?.resize(width, height - 3),
    });

    const initialize = useCallback(() => {
        const { settings, plugins } = props;

        if (canvasRef.current && boxRef.current) {
            const { width = 0, height = 0 } = boxRef.current.getBoundingClientRect();

            canvasRef.current.width = width;
            canvasRef.current.height = height - 3;

            flameChart.current = new FlameChartContainer({
                canvas: canvasRef.current,
                settings,
                plugins,
            });

            props.instance?.(flameChart.current);
        }
    }, []);

    const setBoxRef = useCallback((ref: HTMLDivElement) => {
        const isNewRef = ref !== boxRef.current;

        boxRef.current = ref;

        if (isNewRef) {
            initialize();
        }
    }, []);

    const setCanvasRef = useCallback((ref: HTMLCanvasElement) => {
        const isNewRef = ref !== canvasRef.current;

        canvasRef.current = ref;

        if (isNewRef) {
            initialize();
        }
    }, []);

    useEffect(() => {
        if (props.settings) {
            flameChart.current?.setSettings(props.settings);
        }
    }, [props.settings]);

    useEffect(() => {
        if (props.zoom) {
            flameChart.current?.setZoom(props.zoom.start, props.zoom.end);
        }
    }, [props.zoom]);

    useEffect(() => {
        if (typeof props.hotkeys === 'boolean') {
            flameChart.current?.hotkeys(props.hotkeys);
        }
    }, [props.hotkeys]);

    return (
        <div className={props.className} ref={setBoxRef}>
            <canvas ref={setCanvasRef} />
        </div>
    );
};
