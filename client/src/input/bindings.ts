// Mapowanie klawiszy na akcje (dane, nie kod). Pad dojdzie jako kolejne źródło.
export type Axis = 'throttle' | 'steer' | 'lift';
export type Button = 'run' | 'handbrake';
export type Action = 'modeWalk' | 'modeCar' | 'modeHeli' | 'camera' | 'xray' | 'menu' | 'interact';

export interface Bindings {
  axes: Record<Axis, { pos: string[]; neg: string[] }>;
  buttons: Record<Button, string[]>;
  actions: Record<Action, string[]>;
}

export const DEFAULT_BINDINGS: Bindings = {
  axes: {
    throttle: { pos: ['KeyW', 'ArrowUp'], neg: ['KeyS', 'ArrowDown'] },
    steer: { pos: ['KeyD', 'ArrowRight'], neg: ['KeyA', 'ArrowLeft'] },
    lift: { pos: ['KeyE', 'Space'], neg: ['KeyQ', 'ControlLeft'] },
  },
  buttons: {
    run: ['ShiftLeft', 'ShiftRight'],
    handbrake: ['Space'],
  },
  actions: {
    modeWalk: ['Digit1'],
    modeCar: ['Digit2', 'KeyG'],
    modeHeli: ['Digit3', 'KeyF'],
    camera: ['KeyV'],
    xray: ['KeyX'],
    menu: ['KeyM'],
    interact: ['KeyE'],
  },
};
