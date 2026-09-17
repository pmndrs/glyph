export type GlyphPresentationState<Scene, Camera> = Readonly<{
  camera: Camera;
  renderPipeline: Readonly<{ render(): unknown }> | null;
  scene: Scene;
}>;

/** Render through an installed post-processing pipeline, falling back to the scene renderer. */
export function renderGlyphPresentation<Scene, Camera>(
  renderer: Readonly<{ render(scene: Scene, camera: Camera): unknown }>,
  state: GlyphPresentationState<Scene, Camera>,
): void {
  if (state.renderPipeline !== null) state.renderPipeline.render();
  else renderer.render(state.scene, state.camera);
}
