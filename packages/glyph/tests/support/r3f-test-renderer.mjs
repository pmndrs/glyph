const webgpu = process.env.PMNDRS_GLYPH_R3F_ENTRY === 'webgpu';
export const { create, waitFor } = await import(
  webgpu ? '@react-three/test-renderer/webgpu' : '@react-three/test-renderer'
);
export const { createPortal, extend } = await import(webgpu ? '@react-three/fiber/webgpu' : '@react-three/fiber');
