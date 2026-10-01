declare module 'liquid-gl' {
  export interface LiquidGLOptions {
    target: string;
    snapshot?: string;
    engine?: 'auto' | 'webgpu' | 'webgl2' | 'webgl';
    resolution?: number;
    zIndex?: number;
    content?: string | boolean;
    refraction?: number;
    aberration?: number;
    bevelDepth?: number;
    bevelWidth?: number;
    frost?: number;
    shadow?: boolean;
    specular?: boolean;
    reveal?: 'none' | 'fade';
    tint?: string | null;
    on?: { init?: (lens: unknown) => void };
  }
  export interface LiquidGLLens {
    destroy?: () => void;
  }
  export default function liquidGL(options: LiquidGLOptions): LiquidGLLens | LiquidGLLens[] | undefined;
}
